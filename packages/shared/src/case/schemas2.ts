/** CASE-002/003/004/005：模块树、列表 v2、视图、依赖、评论、评审契约。 */
import { z } from "zod";
import { caseCreateSchema, caseLevelSchema } from "./schemas";

// ── 模块树（CASE-002；一表多场景 case/bug 复用）──

export const moduleUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  parentId: z.string().uuid().nullable().optional(),
});
export const moduleMoveSchema = z.object({
  parentId: z.string().uuid().nullable(), // null = 根级
  order: z.number().int().min(0).default(0),
});

// ── 列表 v2（CASE-002 全字段筛选 + 动态字段）──

export const caseListQueryV2Schema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().max(128).optional(),
  level: caseLevelSchema.optional(),
  orderBy: z.enum(["num", "updatedAt", "name"]).default("num"),
  order: z.enum(["asc", "desc"]).default("asc"),
  recycled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  moduleId: z.string().uuid().optional(),
  includeChildren: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
  tags: z.string().max(256).optional(), // 逗号分隔，命中任一
  status: z.string().max(32).optional(),
  creator: z.string().uuid().optional(),
  updatedFrom: z.string().datetime().optional(),
  updatedTo: z.string().datetime().optional(),
  fields: z.string().max(2048).optional(), // JSON：{"severity":"P1"}（等值）或 {"severity":["P1","P2"]}（任一）
  viewId: z.string().max(64).optional(),
  followedBy: z.string().uuid().optional(), // 我关注的（服务端按登录用户覆写校验）
  createdByMe: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
});
export type CaseListQueryV2 = z.infer<typeof caseListQueryV2Schema>;

export const caseCreateV2Schema = caseCreateSchema.extend({
  moduleId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  fields: z.record(z.unknown()).default({}), // 动态字段值（buildValidator 校验）
});
export const caseUpdateV2Schema = caseCreateV2Schema.extend({
  version: z.number().int().positive(),
});

export const caseBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  moduleId: z.string().uuid().optional(), // batch-move 目标
  level: caseLevelSchema.optional(), // batch-update
  addTags: z.array(z.string().max(64)).max(10).optional(),
  removeTags: z.array(z.string().max(64)).max(10).optional(),
});
export type CaseBatchInput = z.infer<typeof caseBatchSchema>;

// ── 自定义视图与用户偏好（CASE-002/DASH-001）──

export const viewUpsertSchema = z.object({
  name: z.string().min(1).max(64),
  query: z.record(z.unknown()), // 序列化的筛选组合
  columns: z.array(z.string().max(64)).max(32).optional(),
  isDefault: z.boolean().default(false),
});

// ── 依赖关系（CASE-003）──

export const dependencyUpsertSchema = z.object({
  preCaseId: z.string().uuid(),
  postCaseId: z.string().uuid(),
});

// ── 评论横切（CASE-003，bug 详情复用）──

export const commentUpsertSchema = z.object({
  content: z.string().min(1).max(4000),
  parentId: z.string().uuid().optional(),
});

// ── 用例评审（CASE-005）──

export const reviewUpsertSchema = z.object({
  name: z.string().min(1).max(256),
  description: z.string().max(2000).optional(),
  reviewMode: z.enum(["SINGLE", "MULTI"]).default("SINGLE"),
  reviewers: z.array(z.string().uuid()).min(1).max(20),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  caseIds: z.array(z.string().uuid()).max(500).default([]),
});
export const reviewJudgeSchema = z.object({
  result: z.enum(["PASS", "FAIL", "SUGGEST"]),
  comment: z.string().max(2000).default(""), // FAIL/SUGGEST 必填（服务端校验）
});
export const reviewBatchJudgeSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(200),
  result: z.enum(["PASS", "FAIL", "SUGGEST"]),
  comment: z.string().max(2000).default(""),
});
export const reviewBatchReviewerSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(200),
  reviewer: z.string().uuid(),
});
export const reviewCasesAddSchema = z.object({
  caseIds: z.array(z.string().uuid()).min(1).max(500),
});

/** multi 模式聚合：全员 PASS 才 PASS；任一 FAIL 即 FAIL；Suggest 不否决（CASE-005 §2）。 */
export function aggregateReviewResult(
  mode: "SINGLE" | "MULTI",
  reviewerIds: string[],
  results: { userId: string; result: "PASS" | "FAIL" | "SUGGEST" }[],
): "PASS" | "FAIL" | "SUGGEST" | "PENDING" {
  const marks = results.filter((r) => reviewerIds.includes(r.userId));
  if (mode === "SINGLE") {
    const last = marks[marks.length - 1];
    return last?.result ?? "PENDING";
  }
  if (reviewerIds.length === 0) return "PENDING";
  const voted = new Set(marks.map((m) => m.userId));
  const allVoted = reviewerIds.every((r) => voted.has(r));
  if (marks.some((m) => m.result === "FAIL")) return "FAIL";
  if (allVoted && marks.every((m) => m.result === "PASS")) return "PASS";
  if (
    allVoted &&
    marks.every((m) => m.result === "PASS" || m.result === "SUGGEST") &&
    marks.some((m) => m.result === "SUGGEST")
  )
    return "SUGGEST";
  return "PENDING";
}
