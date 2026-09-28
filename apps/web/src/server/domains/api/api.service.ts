/** API-002 接口定义：CRUD/列表（模块子树）/调试执行/变更历史/引用关系。导入导出见 import.service.ts。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import type { ApiRequestBundle } from "@rabbit/shared";
import { apiListQuerySchema, apiUpdateSchema, apiUpsertSchema } from "@rabbit/shared";
import { nextNum, prisma } from "@rabbit/db";
import type { Prisma } from "@prisma/client";
import { createDebugTask } from "@/server/domains/exec/exec.service";

type UpsertInput = z.infer<typeof apiUpsertSchema>;
type UpdateInput = z.infer<typeof apiUpdateSchema>;
type ListQuery = z.infer<typeof apiListQuerySchema>;

const apiSelect = {
  id: true,
  moduleId: true,
  num: true,
  protocol: true,
  method: true,
  path: true,
  name: true,
  status: true,
  request: true,
  response: true,
  version: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

function serialize(a: {
  id: string;
  moduleId: string;
  num: number;
  protocol: string;
  method: string;
  path: string;
  name: string;
  status: string;
  request: unknown;
  response: unknown;
  version: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: a.id,
    moduleId: a.moduleId,
    num: a.num,
    protocol: a.protocol,
    method: a.method,
    path: a.path,
    name: a.name,
    status: a.status,
    request: a.request as ApiRequestBundle,
    response: a.response as {
      status: number;
      headers: { key: string; value: string }[];
      body: string;
    },
    version: a.version,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

/** 模块子树 id 集合（含自身；includeChildren=false 仅自身）。 */
export async function moduleSubtreeIds(
  projectId: string,
  scene: string,
  rootId: string,
  includeChildren: boolean,
) {
  if (!includeChildren) return [rootId];
  const nodes = await prisma.moduleNode.findMany({
    where: { projectId, scene },
    select: { id: true, parentId: true },
  });
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    if (!childrenOf.has(n.parentId)) childrenOf.set(n.parentId, []);
    childrenOf.get(n.parentId)!.push(n.id);
  }
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    for (const c of childrenOf.get(id) ?? []) walk(c);
  };
  walk(rootId);
  return out;
}

async function requireModule(projectId: string, moduleId: string) {
  const m = await prisma.moduleNode.findFirst({
    where: { id: moduleId, projectId, scene: "api" },
    select: { id: true },
  });
  if (!m) throw new DomainError(ErrCode.MODULE_NOT_FOUND, "接口模块不存在");
}

async function getApi(projectId: string, id: string) {
  const api = await prisma.apiDefinition.findFirst({
    where: { id, projectId, deletedAt: null },
  });
  if (!api) throw new DomainError(ErrCode.API_NOT_FOUND, "接口定义不存在或已删除");
  return api;
}

export async function listApis(projectId: string, query: ListQuery) {
  const moduleIds = query.moduleId
    ? await moduleSubtreeIds(projectId, "api", query.moduleId, query.includeChildren)
    : undefined;
  const where = {
    projectId,
    deletedAt: null,
    ...(moduleIds ? { moduleId: { in: moduleIds } } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.name ? { name: { contains: query.name } } : {}),
  };
  const [total, apis, caseCounts] = await Promise.all([
    prisma.apiDefinition.count({ where }),
    prisma.apiDefinition.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: { ...apiSelect, _count: { select: { cases: { where: { deletedAt: null } } } } },
    }),
    prisma.apiCase.groupBy({
      by: ["apiId"],
      where: { projectId, deletedAt: null },
      _count: { _all: true },
    }),
  ]);
  void caseCounts;
  return {
    total,
    items: apis.map((a) => ({
      ...serialize(a),
      caseCount: (a as unknown as { _count: { cases: number } })._count.cases,
    })),
  };
}

export async function getApiDetail(projectId: string, id: string) {
  const api = await getApi(projectId, id);
  return serialize(api);
}

export async function createApi(projectId: string, userId: string, input: UpsertInput) {
  await requireModule(projectId, input.moduleId);
  const api = await prisma.$transaction(async (tx) => {
    const num = await nextNum(tx, "api_definitions", projectId);
    const created = await tx.apiDefinition.create({
      data: {
        projectId,
        moduleId: input.moduleId,
        num,
        protocol: "HTTP",
        method: input.request.spec.method,
        path: input.request.spec.url.slice(0, 1024),
        name: input.name,
        status: input.status,
        request: input.request as unknown as Prisma.InputJsonValue,
        response: input.response as unknown as Prisma.InputJsonValue,
        createdBy: userId,
      },
      select: apiSelect,
    });
    await tx.changeLog.create({
      data: {
        entityType: "api_definition",
        entityId: created.id,
        seq: 1,
        action: "create",
        userId,
        diff: { after: { name: input.name, method: created.method, path: created.path } },
      },
    });
    return created;
  });
  return serialize(api);
}

export async function updateApi(projectId: string, id: string, userId: string, input: UpdateInput) {
  const api = await getApi(projectId, id);
  if (input.version !== api.version)
    throw new DomainError(ErrCode.VERSION_CONFLICT, "内容已被他人修改，请刷新后重试");
  if (input.moduleId) await requireModule(projectId, input.moduleId);
  const updated = await prisma.$transaction(async (tx) => {
    const data: Prisma.ApiDefinitionUpdateInput = {
      version: { increment: 1 },
      ...(input.moduleId ? { module: { connect: { id: input.moduleId } } } : {}),
      ...(input.name ? { name: input.name } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.request
        ? {
            request: input.request as unknown as Prisma.InputJsonValue,
            method: input.request.spec.method,
            path: input.request.spec.url.slice(0, 1024),
          }
        : {}),
      ...(input.response ? { response: input.response as unknown as Prisma.InputJsonValue } : {}),
    };
    const u = await tx.apiDefinition.update({ where: { id: api.id }, data, select: apiSelect });
    await tx.changeLog.create({
      data: {
        entityType: "api_definition",
        entityId: api.id,
        seq:
          (await tx.changeLog.count({
            where: { entityType: "api_definition", entityId: api.id },
          })) + 1,
        action: "update",
        userId,
        diff: {
          before: { name: api.name, status: api.status, method: api.method, path: api.path },
          after: {
            name: input.name ?? api.name,
            status: input.status ?? api.status,
            ...(input.request
              ? {
                  method: input.request.spec.method,
                  path: input.request.spec.url.slice(0, 256),
                  request: true,
                }
              : {}),
          },
        },
      },
    });
    return u;
  });
  return serialize(updated);
}

export async function deleteApi(projectId: string, id: string) {
  const api = await getApi(projectId, id);
  await prisma.$transaction(async (tx) => {
    await tx.apiDefinition.update({ where: { id: api.id }, data: { deletedAt: new Date() } });
    await tx.apiCase.updateMany({
      where: { apiId: api.id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  });
  return { id };
}

/** 变更历史（横切 ChangeLog，API-002 §1.2）。 */
export async function apiChanges(projectId: string, id: string) {
  const api = await getApi(projectId, id);
  const logs = await prisma.changeLog.findMany({
    where: { entityType: "api_definition", entityId: api.id },
    orderBy: { seq: "asc" },
  });
  const userIds = [...new Set(logs.map((l) => l.userId).filter((u): u is string => u !== null))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: logs.map((l) => ({
      seq: l.seq,
      action: l.action,
      user: (l.userId && names.get(l.userId)) || (l.userId ?? "system").slice(0, 8),
      diff: l.diff,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

/** 引用关系（CASE-006 Provider 消费面：用例/计划关联计数与明细）。 */
export async function apiReferences(projectId: string, id: string) {
  const api = await getApi(projectId, id);
  const cases = await prisma.apiCase.findMany({
    where: { apiId: api.id, deletedAt: null },
    select: { id: true, num: true, name: true, level: true, status: true },
    orderBy: { num: "asc" },
  });
  const caseIds = cases.map((c) => c.id);
  const [planRefs, caseRefs] = await Promise.all([
    prisma.planCaseRef.findMany({
      where: { refType: "api_case", refId: { in: caseIds } },
      select: { planId: true, refId: true },
    }),
    prisma.caseApiRef.findMany({
      where: { refType: "api_case", refId: { in: caseIds } },
      select: { refId: true, caseId: true },
    }),
  ]);
  const planIds = [...new Set(planRefs.map((r) => r.planId))];
  const plans = planIds.length
    ? await prisma.testPlan.findMany({
        where: { id: { in: planIds }, deletedAt: null },
        select: { id: true, name: true },
      })
    : [];
  const functionalCaseIds = [...new Set(caseRefs.map((r) => r.caseId))];
  const functionalCases = functionalCaseIds.length
    ? await prisma.functionalCase.findMany({
        where: { id: { in: functionalCaseIds }, deletedAt: null },
        select: { id: true, num: true, name: true },
      })
    : [];
  return {
    cases: cases.map((c) => ({
      ...c,
      planCount: planRefs.filter((r) => r.refId === c.id).length,
    })),
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      refCount: planRefs.filter((r) => r.planId === p.id).length,
    })),
    functionalCases,
  };
}

/** 定义页签「执行」（当前编辑态直接调试，不要求先保存；API-002 §2）。 */
export async function debugApi(
  projectId: string,
  userId: string,
  id: string,
  input: { request: ApiRequestBundle; envId?: string; clientTaskId?: string },
) {
  await getApi(projectId, id); // 存在性+归属校验（编辑态不落库）
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
