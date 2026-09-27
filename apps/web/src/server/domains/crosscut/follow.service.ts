/** S4 DASH-002 Follow 横切：通用关注开关与状态查询（entityType 白名单；各域端点薄封装消费）。
 * 通知消费在 S5 MSG-001（Follow 表为通知源，本文件只落数据）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

/** 可关注实体白名单（七维度对应） */
export const FOLLOW_ENTITY_TYPES = [
  "functional_case",
  "test_plan",
  "case_review",
  "api_case",
  "scenario",
  "bug",
] as const;
export type FollowEntityType = (typeof FOLLOW_ENTITY_TYPES)[number];

export async function setFollow(userId: string, entityType: FollowEntityType, entityId: string, on: boolean) {
  if (on) {
    const existing = await prisma.follow.findFirst({
      where: { userId, entityType, entityId },
      select: { id: true },
    });
    if (existing) return { followed: true, idempotent: true };
    await prisma.follow.create({ data: { userId, entityType, entityId } });
    return { followed: true, idempotent: false };
  }
  await prisma.follow.deleteMany({ where: { userId, entityType, entityId } });
  return { followed: false };
}

export async function getFollowed(userId: string, entityType: FollowEntityType, entityId: string) {
  const row = await prisma.follow.findFirst({
    where: { userId, entityType, entityId },
    select: { id: true },
  });
  return Boolean(row);
}

/** 目标存在性校验（关注不存在的对象 → 40432）。 */
export async function assertFollowTargetExists(entityType: FollowEntityType, entityId: string) {
  const exists = await (async () => {
    switch (entityType) {
      case "functional_case":
        return prisma.functionalCase.count({ where: { id: entityId, deletedAt: null } });
      case "test_plan":
        return prisma.testPlan.count({ where: { id: entityId, deletedAt: null } });
      case "case_review":
        return prisma.caseReview.count({ where: { id: entityId, deletedAt: null } });
      case "api_case":
        return prisma.apiCase.count({ where: { id: entityId, deletedAt: null } });
      case "scenario":
        return prisma.scenario.count({ where: { id: entityId, deletedAt: null } });
      case "bug":
        return prisma.bug.count({ where: { id: entityId, deletedAt: null } });
    }
  })();
  if (!exists) throw new DomainError(ErrCode.FOLLOW_TARGET_NOT_FOUND, "关注目标不存在或已删除");
}
