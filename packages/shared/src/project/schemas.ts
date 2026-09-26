/** PROJ-001/PROJ-002：项目、成员、模板、字段定义、工作流契约。 */
import { z } from 'zod';
import { templateFieldBindingSchema } from '../fields';

// ── 项目与成员（PROJ-001）──

export const KNOWN_MODULES = ['case', 'api', 'plan', 'bug'] as const;
export const moduleFlagsSchema = z.object({
  case: z.boolean().default(true),
  api: z.boolean().default(true),
  plan: z.boolean().default(true),
  bug: z.boolean().default(true),
});

export const projectUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
});
export const projectUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  modules: moduleFlagsSchema.optional(),
});
export const orgMemberQuerySchema = z.object({
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const projectMembersAddSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(50),
});

// ── 字段定义与模板（PROJ-002）──

export const fieldDefUpsertSchema = z.object({
  scene: z.enum(['case', 'bug']),
  name: z.string().min(1).max(128),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  type: z.enum(['input', 'textarea', 'number', 'date', 'single_select', 'multi_select', 'checkbox', 'radio', 'member', 'url']),
  required: z.boolean().default(false),
  defaultValue: z.union([z.string(), z.number(), z.array(z.string()), z.boolean()]).optional(),
  options: z
    .object({
      options: z.array(z.string().min(1).max(64)).max(50).optional(),
      min: z.number().optional(),
      max: z.number().optional(),
      minLength: z.number().int().min(0).max(4000).optional(),
      maxLength: z.number().int().min(0).max(8000).optional(),
      pattern: z.string().max(256).optional(),
      multiple: z.boolean().optional(),
    })
    .default({}),
  enabled: z.boolean().default(true),
});
export const templateUpsertSchema = z.object({
  scene: z.enum(['case', 'bug']),
  name: z.string().min(1).max(128),
  fields: z.array(templateFieldBindingSchema).default([]),
});
export const BUG_TEMPLATE_LIMIT = 20; // 缺陷模板上限（对齐基线 §8.2）

// ── 工作流（PROJ-002，bug scene）──

export const workflowStateUpsertSchema = z.object({
  serial: z.string().min(1).max(64),
  isStart: z.boolean().default(false),
  isEnd: z.boolean().default(false),
});
export const workflowTransitionsUpsertSchema = z.object({
  transitions: z.array(z.object({ fromSerial: z.string().min(1), toSerial: z.string().min(1) })).max(400),
});

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type FieldDefUpsertInput = z.infer<typeof fieldDefUpsertSchema>;
export type TemplateUpsertInput = z.infer<typeof templateUpsertSchema>;
