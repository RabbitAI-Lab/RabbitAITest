/** API-010 误报规则：项目级 CRUD（≤50）+ 匹配器校验。改判在 exec.service.handleCallback（事务内）。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import { falseAlarmRuleSaveSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";

type SaveInput = z.infer<typeof falseAlarmRuleSaveSchema>;

export const FALSE_ALARM_RULES_LIMIT = 50;

function validateMatcher(input: SaveInput) {
  const m = input.matcher;
  const any =
    m.status !== undefined ||
    m.bodyContains !== undefined ||
    m.headerContains !== undefined ||
    m.responseTimeGt !== undefined;
  if (!any) throw new DomainError(ErrCode.MATCHER_EMPTY, "匹配器至少一项条件");
  return m;
}

export async function listRules(projectId: string) {
  const rules = await prisma.falseAlarmRule.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      matcher: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return {
    total: rules.length,
    list: rules.map((r) => ({
      id: r.id,
      name: r.name,
      matcher: r.matcher,
      enabled: r.enabled,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  };
}

export async function createRule(projectId: string, userId: string, input: SaveInput) {
  const matcher = validateMatcher(input);
  const count = await prisma.falseAlarmRule.count({ where: { projectId } });
  if (count >= FALSE_ALARM_RULES_LIMIT)
    throw new DomainError(
      ErrCode.RULES_LIMIT_EXCEEDED,
      `误报规则上限 ${FALSE_ALARM_RULES_LIMIT} 条`,
    );
  void userId;
  const r = await prisma.falseAlarmRule.create({
    data: { projectId, name: input.name, matcher: matcher as object, enabled: input.enabled },
  });
  return { id: r.id };
}

export async function updateRule(projectId: string, id: string, input: SaveInput) {
  const matcher = validateMatcher(input);
  const existing = await prisma.falseAlarmRule.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.FALSE_ALARM_RULE_NOT_FOUND, "误报规则不存在");
  await prisma.falseAlarmRule.update({
    where: { id },
    data: { name: input.name, matcher: matcher as object, enabled: input.enabled },
  });
  return { id };
}

export async function deleteRule(projectId: string, id: string) {
  const existing = await prisma.falseAlarmRule.findFirst({ where: { id, projectId } });
  if (!existing) throw new DomainError(ErrCode.FALSE_ALARM_RULE_NOT_FOUND, "误报规则不存在");
  // 物理删除；历史 FalseAlarmHit 留痕（ruleName 冗余名仍可展示——API-010 §2）
  await prisma.falseAlarmRule.delete({ where: { id } });
  return { id };
}
