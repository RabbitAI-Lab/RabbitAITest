import { z } from "zod";

export const caseLevelSchema = z.enum(["P0", "P1", "P2", "P3"]);
export type CaseLevel = z.infer<typeof caseLevelSchema>;

export const caseStepSchema = z.object({
  desc: z.string().max(2000).default(""),
  expect: z.string().max(2000).default(""),
});
export type CaseStep = z.infer<typeof caseStepSchema>;

export const caseCreateSchema = z.object({
  name: z.string().min(1, "名称不能为空").max(512),
  precondition: z.string().max(4000).default(""),
  steps: z.array(caseStepSchema).max(100).default([]),
  level: caseLevelSchema.default("P2"),
  tags: z.array(z.string().max(64)).max(10).default([]),
});
export type CaseCreateInput = z.infer<typeof caseCreateSchema>;

export const caseUpdateSchema = caseCreateSchema.extend({
  version: z.number().int().positive(),
});

export const caseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  keyword: z.string().max(128).optional(),
  level: caseLevelSchema.optional(),
  orderBy: z.enum(["num", "updatedAt"]).default("num"),
  order: z.enum(["asc", "desc"]).default("asc"),
  recycled: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default("false"),
});
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;

export const caseDetailSchema = z.object({
  id: z.string().uuid(),
  num: z.number().int(),
  name: z.string(),
  precondition: z.string(),
  steps: z.array(caseStepSchema),
  level: caseLevelSchema,
  tags: z.array(z.string()),
  version: z.number().int(),
  deletedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CaseDetail = z.infer<typeof caseDetailSchema>;

export const pageResultSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ total: z.number().int(), items: z.array(item) });
