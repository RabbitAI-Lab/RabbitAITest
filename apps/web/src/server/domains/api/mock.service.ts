/** API-005 Mock：规则 CRUD + Redis 全量快照发布（版本号+失效广播）+ 服务端代调试。 */
import { DomainError, ErrCode, config } from "@rabbit/shared";
import type { z } from "zod";
import { mockUpsertSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import type { Prisma } from "@prisma/client";
import { redis } from "@/server/redis";

type UpsertInput = z.infer<typeof mockUpsertSchema>;

const MOCK_RULES_PREFIX = "mock:rules";
const MOCK_INVALIDATE_CHANNEL = "mock:invalidate";

async function getApi(projectId: string, apiId: string) {
  const api = await prisma.apiDefinition.findFirst({
    where: { id: apiId, projectId, deletedAt: null },
    select: { id: true, method: true, path: true, response: true, projectId: true },
  });
  if (!api) throw new DomainError(ErrCode.API_NOT_FOUND, "接口定义不存在或已删除");
  return api;
}

/** 快照构建：项目全部启用规则的 matchers + 定义 method/path/响应（followApi 源）。 */
export async function publishMockSnapshot(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, num: true },
  });
  if (!project) return;
  const apis = await prisma.apiDefinition.findMany({
    where: { projectId, deletedAt: null },
    select: {
      id: true,
      method: true,
      path: true,
      response: true,
      mocks: { where: {} },
    },
  });
  const rules = apis.flatMap((api) =>
    api.mocks
      .filter((m) => m.enabled)
      .map((m) => ({
        id: m.id,
        apiId: api.id,
        enabled: m.enabled,
        followApi: m.followApi,
        method: api.method,
        pathTemplate: api.path,
        matchers: m.matchers as {
          headers: { key: string; value: string }[];
          query: { key: string; value: string }[];
          bodyContains?: string;
        },
        response: m.response as {
          status: number;
          headers: { key: string; value: string }[];
          body: string;
          delayMs: number;
        },
        apiResponse: api.response as { status: number; headers: { key: string; value: string }[]; body: string },
      })),
  );
  const key = `${MOCK_RULES_PREFIX}:${projectId}`;
  const existing = await redis().get(key);
  const version = existing ? (JSON.parse(existing).version ?? 0) + 1 : 1;
  await redis().set(key, JSON.stringify({ projectId, projectNum: project.num, version, rules }));
  // projectNum → projectId 索引（mock 服务路由入口，API-005 §4）
  await redis().set(`mock:proj:${project.num}`, projectId);
  await redis().publish(MOCK_INVALIDATE_CHANNEL, projectId);
  return { version, rules: rules.length };
}

export async function listMocks(projectId: string, apiId: string) {
  await getApi(projectId, apiId);
  const mocks = await prisma.apiMock.findMany({ where: { apiId }, orderBy: { createdAt: "asc" } });
  return { total: mocks.length, items: mocks };
}

export async function createMock(projectId: string, _userId: string, apiId: string, input: UpsertInput) {
  await getApi(projectId, apiId);
  const m = await prisma.apiMock.create({
    data: {
      apiId,
      name: input.name,
      matchers: input.matchers as unknown as Prisma.InputJsonValue,
      response: input.response as unknown as Prisma.InputJsonValue,
      followApi: input.followApi,
      enabled: input.enabled,
    },
  });
  await publishMockSnapshot(projectId);
  return m;
}

export async function updateMock(projectId: string, id: string, input: UpsertInput) {
  const m = await prisma.apiMock.findUnique({ where: { id }, include: { api: { select: { projectId: true } } } });
  if (!m || m.api.projectId !== projectId)
    throw new DomainError(ErrCode.MOCK_NOT_FOUND, "Mock 规则不存在");
  const updated = await prisma.apiMock.update({
    where: { id: m.id },
    data: {
      name: input.name,
      matchers: input.matchers as unknown as Prisma.InputJsonValue,
      response: input.response as unknown as Prisma.InputJsonValue,
      followApi: input.followApi,
      enabled: input.enabled,
    },
  });
  await publishMockSnapshot(projectId);
  return updated;
}

export async function deleteMock(projectId: string, id: string) {
  const m = await prisma.apiMock.findUnique({ where: { id }, include: { api: { select: { projectId: true } } } });
  if (!m || m.api.projectId !== projectId)
    throw new DomainError(ErrCode.MOCK_NOT_FOUND, "Mock 规则不存在");
  await prisma.apiMock.delete({ where: { id: m.id } });
  await publishMockSnapshot(projectId);
  return { id };
}

/** Mock 地址（MOCK_PUBLIC_URL 可覆写展示口径；API-005 §3）。 */
export async function mockUrl(projectId: string, apiId: string) {
  const api = await getApi(projectId, apiId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { num: true } });
  const base = process.env.MOCK_PUBLIC_URL ?? `http://127.0.0.1:${process.env.MOCK_PORT ?? 4000}`;
  return { url: `${base.replace(/\/$/, "")}/mock/${project?.num ?? projectId.slice(0, 8)}${api.path}`, apiPath: api.path };
}

/** 服务端代调试（浏览器跨域规避；命中判定与 mock 服务同构——匹配算法在 apps/mock 单测覆盖）。 */
export async function debugMock(projectId: string, id: string, probe: { query?: Record<string, string>; headers?: Record<string, string>; body?: string }) {
  const m = await prisma.apiMock.findUnique({
    where: { id },
    include: { api: { select: { projectId: true, method: true, path: true, response: true } } },
  });
  if (!m || m.api.projectId !== projectId)
    throw new DomainError(ErrCode.MOCK_NOT_FOUND, "Mock 规则不存在");
  const matchers = m.matchers as { headers: { key: string; value: string }[]; query: { key: string; value: string }[]; bodyContains?: string };
  const unmatched: string[] = [];
  for (const q of matchers.query) {
    if ((probe.query ?? {})[q.key] !== q.value) unmatched.push(`query ${q.key}=${q.value}`);
  }
  for (const h of matchers.headers) {
    if ((probe.headers ?? {})[h.key.toLowerCase()] !== h.value) unmatched.push(`header ${h.key}`);
  }
  if (matchers.bodyContains && !(probe.body ?? "").includes(matchers.bodyContains))
    unmatched.push("body 包含");
  const matched = unmatched.length === 0 && m.enabled;
  const response = m.followApi ? m.api.response : m.response;
  return {
    matched,
    ruleName: m.name,
    enabled: m.enabled,
    unmatched,
    response: response as { status: number; headers: { key: string; value: string }[]; body: string; delayMs?: number },
  };
}

void config;
