/** PLAN-001：测试计划契约。 */
import { z } from "zod";

export const planSettingsSchema = z.object({
  allowDuplicate: z.boolean().default(false),
  autoUpdateStatus: z.boolean().default(false),
  threshold: z.number().int().min(0).max(100).default(100),
});

export const planUpsertSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  moduleId: z.string().uuid().nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  tags: z.array(z.string().max(64)).max(10).default([]),
  settings: planSettingsSchema.optional(),
});

/** PUT 部分更新（updatePlan 语义） */
export const planUpdateSchema = planUpsertSchema.partial();

export const planCasesAddSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(500),
  execUserId: z.string().uuid().optional(),
});

export const planExecStatusSchema = z.enum(["NOT_RUN", "PASS", "FAIL", "BLOCKED", "SKIPPED"]);

export const planExecSchema = z.object({
  status: planExecStatusSchema,
  actualResult: z.string().max(4000).default(""),
  comment: z.string().max(2000).default(""),
  /** 步骤级结果（与用例 steps 对位；缺省全部随主状态） */
  steps: z
    .array(
      z.object({
        status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIPPED", "NOT_RUN"]),
        result: z.string().max(2000).default(""),
      }),
    )
    .max(100)
    .optional(),
});

export const planBatchExecutorSchema = z.object({
  refIds: z.array(z.string().uuid()).min(1).max(200),
  execUserId: z.string().uuid(),
});

export const planReportSummarySchema = z.object({
  summary: z.string().max(4000),
});

/** 通过率口径：pass / (pass+fail+blocked)，skipped 不计分母（PLAN-001 §2）。 */
export function planPassRate(refs: { status: string }[]): {
  passRate: number | null;
  executed: number;
  pass: number;
  fail: number;
  blocked: number;
  skipped: number;
  pending: number;
} {
  const pass = refs.filter((r) => r.status === "PASS").length;
  const fail = refs.filter((r) => r.status === "FAIL").length;
  const blocked = refs.filter((r) => r.status === "BLOCKED").length;
  const skipped = refs.filter((r) => r.status === "SKIPPED").length;
  const pending = refs.filter((r) => r.status === "NOT_RUN").length;
  const denom = pass + fail + blocked;
  return {
    passRate: denom === 0 ? null : Math.round((pass / denom) * 100),
    executed: pass + fail + blocked,
    pass,
    fail,
    blocked,
    skipped,
    pending,
  };
}
