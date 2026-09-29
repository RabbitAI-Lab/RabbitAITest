import { z } from "zod";

/**
 * 误报规则匹配（API-010）：项目级规则对 FAILED item 的失败步骤求值，
 * 命中 → ExecItem 改判 FAKE_ERROR + FalseAlarmHit 留痕（web 回调事务内）。
 */

/** 匹配器（多条件 AND，至少一项；API-010 §4 契约）。 */
export const falseAlarmMatcherSchema = z
  .object({
    status: z.number().int().min(100).max(599).optional(),
    bodyContains: z.string().min(1).max(512).optional(),
    headerContains: z.string().min(1).max(512).optional(), // "key=value" 子串（头名=值）
    responseTimeGt: z.number().int().min(1).max(600000).optional(),
  })
  .refine(
    (m) =>
      m.status !== undefined ||
      m.bodyContains !== undefined ||
      m.headerContains !== undefined ||
      m.responseTimeGt !== undefined,
    {
      message: "匹配器至少一项条件",
    },
  );
export type FalseAlarmMatcher = z.infer<typeof falseAlarmMatcherSchema>;

export interface FalseAlarmRuleLike {
  id: string;
  name: string;
  matcher: FalseAlarmMatcher;
  enabled: boolean;
}

/** 匹配输入=失败步骤摘要（step-result.responseSummary，bodyText 调用方截断 4KB）。 */
export interface FailedStepInput {
  status: number;
  bodyText: string;
  headers: { key: string; value: string }[];
  responseTimeMs: number;
  /** 命中留痕的步骤定位（报告 tooltip） */
  stepPath?: string;
}

function headerMatches(headers: { key: string; value: string }[], expect: string): boolean {
  const eq = expect.indexOf("=");
  if (eq <= 0)
    return headers.some((h) => `${h.key}:${h.value}`.includes(expect) || h.key.includes(expect));
  const key = expect.slice(0, eq).trim().toLowerCase();
  const val = expect.slice(eq + 1);
  return headers.some((h) => h.key.toLowerCase() === key && h.value.includes(val));
}

/** 单规则 × 单步骤：全部已配置条件 AND 成立。 */
export function ruleMatchesStep(rule: FalseAlarmRuleLike, step: FailedStepInput): boolean {
  const m = rule.matcher;
  if (m.status !== undefined && step.status !== m.status) return false;
  if (m.bodyContains !== undefined && !step.bodyText.includes(m.bodyContains)) return false;
  if (m.headerContains !== undefined && !headerMatches(step.headers, m.headerContains))
    return false;
  if (m.responseTimeGt !== undefined && step.responseTimeMs <= m.responseTimeGt) return false;
  return true;
}

export interface FalseAlarmHitResult {
  ruleId: string;
  ruleName: string;
  stepPath?: string;
}

/** 多规则 × 多失败步骤：任一规则对任一失败步骤成立即命中（返回全部命中，状态一次改判）。 */
export function matchFalseAlarm(
  rules: FalseAlarmRuleLike[],
  failedSteps: FailedStepInput[],
): FalseAlarmHitResult[] {
  const hits: FalseAlarmHitResult[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const step of failedSteps) {
      if (ruleMatchesStep(rule, step)) {
        hits.push({ ruleId: rule.id, ruleName: rule.name, stepPath: step.stepPath });
        break; // 每规则至多一 hit（步骤级定位取首个命中）
      }
    }
  }
  return hits;
}
