/** API-003 接口用例：CRUD/差量同步/执行（单条+批量）/执行历史/批量删除。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import type { ApiRequestBundle } from "@rabbit/shared";
import { apiCaseListQuerySchema, apiCaseUpsertSchema } from "@rabbit/shared";
import { nextNum, prisma } from "@rabbit/db";
import type { Prisma } from "@prisma/client";
import { createApiCaseTask, createDebugTask } from "@/server/domains/exec/exec.service";

type UpsertInput = z.infer<typeof apiCaseUpsertSchema>;
type ListQuery = z.infer<typeof apiCaseListQuerySchema>;

const caseSelect = {
  id: true,
  apiId: true,
  num: true,
  name: true,
  level: true,
  status: true,
  tags: true,
  request: true,
  version: true,
  syncedVersion: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

function serialize(c: {
  id: string;
  apiId: string;
  num: number;
  name: string;
  level: string;
  status: string;
  tags: unknown;
  request: unknown;
  version: number;
  syncedVersion: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    apiId: c.apiId,
    num: c.num,
    name: c.name,
    level: c.level,
    status: c.status,
    tags: (c.tags as string[]) ?? [],
    request: c.request as ApiRequestBundle,
    version: c.version,
    syncedVersion: c.syncedVersion,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

async function getApi(projectId: string, apiId: string) {
  const api = await prisma.apiDefinition.findFirst({
    where: { id: apiId, projectId, deletedAt: null },
    select: { id: true, version: true, request: true, method: true, path: true },
  });
  if (!api) throw new DomainError(ErrCode.API_NOT_FOUND, "接口定义不存在或已删除");
  return api;
}

async function getCase(projectId: string, id: string) {
  const c = await prisma.apiCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!c) throw new DomainError(ErrCode.API_CASE_NOT_FOUND, "接口用例不存在或已删除");
  return c;
}

export async function listCases(projectId: string, apiId: string, query: ListQuery) {
  await getApi(projectId, apiId);
  const where = {
    projectId,
    apiId,
    deletedAt: null,
    ...(query.level ? { level: query.level } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.name ? { name: { contains: query.name } } : {}),
  };
  const [total, cases] = await Promise.all([
    prisma.apiCase.count({ where }),
    prisma.apiCase.findMany({
      where,
      orderBy: { num: "asc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { api: { select: { version: true } } },
    }),
  ]);
  return {
    total,
    apiVersion: cases[0]?.api.version ?? (await getApi(projectId, apiId)).version,
    items: cases.map((c) => {
      const { api, ...rest } = c;
      return { ...serialize(rest), outOfSync: api.version > rest.syncedVersion };
    }),
  };
}

export async function createCase(
  projectId: string,
  userId: string,
  apiId: string,
  input: UpsertInput,
) {
  const api = await getApi(projectId, apiId);
  const created = await prisma.$transaction(async (tx) => {
    const num = await nextNum(tx, "api_cases", projectId);
    return tx.apiCase.create({
      data: {
        apiId: api.id,
        projectId,
        num,
        name: input.name,
        level: input.level,
        status: input.status,
        tags: input.tags as unknown as Prisma.InputJsonValue,
        request: input.request as unknown as Prisma.InputJsonValue,
        syncedVersion: api.version, // 新建以定义当前版为基线（API-003 §1.2）
        createdBy: userId,
      },
      select: caseSelect,
    });
  });
  return serialize(created);
}

export async function updateCase(
  projectId: string,
  id: string,
  userId: string,
  input: UpsertInput & { version: number },
) {
  const c = await getCase(projectId, id);
  if (input.version !== c.version)
    throw new DomainError(ErrCode.VERSION_CONFLICT, "内容已被他人修改，请刷新后重试");
  const updated = await prisma.apiCase.update({
    where: { id: c.id },
    data: {
      name: input.name,
      level: input.level,
      status: input.status,
      tags: input.tags as unknown as Prisma.InputJsonValue,
      request: input.request as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
    select: caseSelect,
  });
  void userId;
  return serialize(updated);
}

/** 差异同步：以定义最新 request 覆盖（名称/等级/状态/标签保留；syncedVersion 对齐，API-003 §2）。 */
export async function syncCase(projectId: string, id: string) {
  const c = await getCase(projectId, id);
  const api = await getApi(projectId, c.apiId);
  const defBundle = api.request as ApiRequestBundle;
  const cur = c.request as ApiRequestBundle;
  const diff = diffBundles(defBundle, cur);
  const updated = await prisma.apiCase.update({
    where: { id: c.id },
    data: {
      request: defBundle as unknown as Prisma.InputJsonValue,
      syncedVersion: api.version,
      version: { increment: 1 },
    },
    select: caseSelect,
  });
  return { ...serialize(updated), diffApplied: diff };
}

/** 分区级 diff 摘要（参数/认证/请求体/前后置/断言/提取——API-003 §1.2 简化口径）。 */
export function diffBundles(a: ApiRequestBundle, b: ApiRequestBundle) {
  const sections: { section: string; different: boolean; detail: string[] }[] = [];
  const cmp = (
    name: string,
    x: unknown,
    y: unknown,
    fmt: (v: unknown) => string = (v) => JSON.stringify(v),
  ) => {
    const ax = JSON.stringify(x);
    const ay = JSON.stringify(y);
    if (ax !== ay) sections.push({ section: name, different: true, detail: [fmt(x), fmt(y)] });
  };
  cmp("参数", { q: a.spec.query, h: a.spec.headers }, { q: b.spec.query, h: b.spec.headers });
  cmp("认证", a.spec.auth, b.spec.auth);
  cmp("请求体", a.spec.body, b.spec.body);
  cmp("前置", a.pre, b.pre);
  cmp("后置", a.post, b.post);
  cmp("断言", a.asserts, b.asserts);
  cmp("提取", a.extracts, b.extracts);
  return sections;
}

export async function deleteCase(projectId: string, id: string) {
  const c = await getCase(projectId, id);
  await prisma.apiCase.update({ where: { id: c.id }, data: { deletedAt: new Date() } });
  return { id };
}

export async function batchDelete(projectId: string, apiId: string, ids: string[]) {
  await getApi(projectId, apiId);
  const r = await prisma.apiCase.updateMany({
    where: { id: { in: ids }, projectId, apiId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  return { deleted: r.count };
}

/** 单条执行（clientTaskId 幂等防连点）。 */
export async function executeCase(
  projectId: string,
  userId: string,
  id: string,
  input: { envId?: string; clientTaskId?: string },
) {
  const c = await getCase(projectId, id);
  return createApiCaseTask(projectId, userId, {
    caseIds: [c.id],
    envId: input.envId,
    stopOnFail: false,
    clientTaskId: input.clientTaskId,
  });
}

/** 批量执行（1 任务 N item 串行；API-003 §2）。 */
export async function executeCases(
  projectId: string,
  userId: string,
  apiId: string,
  input: { caseIds: string[]; envId?: string; stopOnFail: boolean },
) {
  await getApi(projectId, apiId);
  return createApiCaseTask(projectId, userId, input);
}

/** 执行历史（用例维度 ExecItem 聚合，API-003 §1.2）。 */
export async function caseHistory(projectId: string, id: string) {
  const c = await getCase(projectId, id);
  const items = (
    await prisma.execItem.findMany({
      where: { refType: "api_case", refId: c.id },
      take: 80,
      include: { task: { select: { id: true, status: true, durationMs: true, createdAt: true } } },
    })
  ).sort((a, b) => b.task.createdAt.getTime() - a.task.createdAt.getTime());
  return {
    items: items.map((i) => ({
      itemId: i.id,
      taskId: i.task.id,
      taskStatus: i.task.status,
      itemStatus: i.status,
      durationMs: i.task.durationMs,
      createdAt: i.task.createdAt.toISOString(),
    })),
  };
}

/** 调试入口复用（用例编辑态不落库直接执行）。 */
export async function debugCase(
  projectId: string,
  userId: string,
  id: string,
  input: { request: ApiRequestBundle; envId?: string; clientTaskId?: string },
) {
  const c = await getCase(projectId, id);
  void c;
  return createDebugTask(projectId, userId, {
    request: input.request.spec,
    asserts: input.request.asserts,
    pre: input.request.pre,
    post: input.request.post,
    extracts: input.request.extracts,
    envId: input.envId,
    clientTaskId: input.clientTaskId,
  });
}
