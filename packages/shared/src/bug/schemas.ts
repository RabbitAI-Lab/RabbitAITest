/** BUG-001：缺陷契约。 */
import { z } from "zod";

export const bugUpsertSchema = z.object({
  title: z.string().min(1).max(512),
  description: z.string().max(8000).default(""),
  templateId: z.string().uuid().optional(),
  fields: z.record(z.unknown()).default({}),
  handleUserId: z.string().uuid().nullable().optional(),
  moduleId: z.string().uuid().optional(),
  tags: z.array(z.string().max(64)).max(10).default([]),
  version: z.number().int().positive().optional(),
});

export const bugTransitionSchema = z.object({
  toState: z.string().min(1).max(64),
  comment: z.string().max(2000).default(""),
});

export const linkCaseBugSchema = z.object({ bugId: z.string().uuid() });
export const linkBugCaseSchema = z.object({ caseId: z.string().uuid() });
export const linkCaseBugByBugIdSchema = z.object({ bugId: z.string().uuid() });

/** 导入导出（CASE-004）。 */
export const importOptionsSchema = z.object({
  mode: z.enum(["overwrite", "skip"]).default("skip"),
  moduleId: z.string().uuid().optional(),
});
export const exportOptionsSchema = z.object({
  format: z.enum(["excel", "excel_split", "xmind"]).default("excel"),
  fields: z.array(z.string().max(64)).max(32).default([]),
  caseIds: z.array(z.string().uuid()).max(5000).optional(),
});
