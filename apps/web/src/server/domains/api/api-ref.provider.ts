/**
 * CASE-006 跨域 Provider：case/plan 域读 api_test 域的唯一通道（test-domain-model §3）。
 * 消费方（caseDetail/plan 服务）只准 import 本文件，禁止直接查 ApiCase/ApiDefinition。
 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

export interface ApiRefSummary {
  refId: string;
  name: string;
  apiName: string;
  method: string;
  path: string;
  level: string;
  status: string;
  deleted: boolean;
}

export async function listApiRefSummary(projectId: string, refIds: string[]): Promise<ApiRefSummary[]> {
  if (refIds.length === 0) return [];
  const cases = await prisma.apiCase.findMany({
    where: { id: { in: refIds }, projectId },
    include: { api: { select: { name: true, method: true, path: true, deletedAt: true } } },
  });
  return cases.map((c) => ({
    refId: c.id,
    name: c.name,
    apiName: c.api.name,
    method: c.api.method,
    path: c.api.path,
    level: c.level,
    status: c.status,
    deleted: c.deletedAt !== null || c.api.deletedAt !== null,
  }));
}

/** 批量校验：同项目未删 ApiCase 才可关联（无效明细随 40464 返回，CASE-006 §4）。 */
export async function batchValidateApiRefs(
  projectId: string,
  refIds: string[],
): Promise<{ valid: string[]; invalid: string[] }> {
  const cases = await prisma.apiCase.findMany({
    where: { id: { in: refIds }, projectId, deletedAt: null },
    select: { id: true },
  });
  const validSet = new Set(cases.map((c) => c.id));
  const invalid = refIds.filter((id) => !validSet.has(id));
  return { valid: [...validSet], invalid };
}

export function assertNoInvalidRef(invalid: string[]): void {
  if (invalid.length > 0)
    throw new DomainError(ErrCode.REF_TARGET_INVALID, `关联目标无效：${invalid.length} 条（不存在/他项目/已删除）`);
}

/** 用例 ↔ 接口用例关联 CRUD（case 域服务消费；数据经本 Provider 归口）。 */
export async function listCaseApiRefs(userIdScopeCheck: string, projectId: string, caseId: string) {
  void userIdScopeCheck;
  const refs = await prisma.caseApiRef.findMany({
    where: { caseId, refType: "api_case" },
    orderBy: { id: "asc" },
  });
  const summary = await listApiRefSummary(projectId, refs.map((r) => r.refId));
  const byId = new Map(summary.map((s) => [s.refId, s]));
  return {
    total: refs.length,
    items: refs.flatMap((r) => {
      const s = byId.get(r.refId);
      return s
        ? [{ ...s, id: r.id }]
        : [{ id: r.id, refId: r.refId, name: "(已失效)", apiName: "", method: "", path: "", level: "", status: "", deleted: true }];
    }),
  };
}

export async function addCaseApiRefs(projectId: string, caseId: string, refIds: string[]) {
  const { valid, invalid } = await batchValidateApiRefs(projectId, refIds);
  assertNoInvalidRef(invalid);
  const existing = await prisma.caseApiRef.findMany({
    where: { caseId, refType: "api_case", refId: { in: valid } },
    select: { refId: true },
  });
  const existingSet = new Set(existing.map((e) => e.refId));
  const fresh = valid.filter((id) => !existingSet.has(id));
  if (fresh.length === 0) throw new DomainError(ErrCode.DUP_ASSOC, "重复关联");
  await prisma.$transaction(
    fresh.map((refId) =>
      prisma.caseApiRef.create({ data: { caseId, refType: "api_case", refId } }),
    ),
  );
  return { added: fresh.length };
}

export async function removeCaseApiRef(projectId: string, caseId: string, refId: string) {
  void projectId;
  await prisma.caseApiRef.deleteMany({ where: { caseId, refType: "api_case", refId } });
  return { refId };
}
