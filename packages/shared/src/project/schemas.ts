/** PROJ-001/PROJ-002：项目、成员、模板、字段定义、工作流契约。 */
import { z } from "zod";
import { templateFieldBindingSchema } from "../fields";

// ── 项目与成员（PROJ-001）──

export const KNOWN_MODULES = ["case", "api", "plan", "bug"] as const;
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
  scene: z.enum(["case", "bug"]),
  name: z.string().min(1).max(128),
  key: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  type: z.enum([
    "input",
    "textarea",
    "number",
    "date",
    "single_select",
    "multi_select",
    "checkbox",
    "radio",
    "member",
    "url",
  ]),
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
  scene: z.enum(["case", "bug"]),
  name: z.string().min(1).max(128),
  fields: z.array(templateFieldBindingSchema).default([]),
});
/** PUT /templates/{id}/fields 请求体（仅更新字段绑定；templateApi.updateFields 契约） */
export const templateFieldsUpdateSchema = z.object({
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
  transitions: z
    .array(z.object({ fromSerial: z.string().min(1), toSerial: z.string().min(1) }))
    .max(400),
});

export type ProjectUpdateInput = z.infer<typeof projectUpdateSchema>;
export type FieldDefUpsertInput = z.infer<typeof fieldDefUpsertSchema>;
export type TemplateUpsertInput = z.infer<typeof templateUpsertSchema>;

// ── 公共脚本（S5 PROJ-005）──

export const PUBLIC_SCRIPT_LIMIT = 100; // 脚本上限/项目
export const publicScriptParamSchema = z.object({
  name: z.string().min(1).max(64),
  defaultValue: z.string().max(1024).default(""),
  required: z.boolean().default(false),
});
export const publicScriptUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  /** 引擎 quickjs-only：多语言登记 Backlog（PROJ-005 §1.4） */
  language: z.literal("javascript").default("javascript"),
  tags: z.array(z.string().min(1).max(32)).max(10).default([]),
  params: z.array(publicScriptParamSchema).max(20).default([]),
  content: z.string().max(64 * 1024).default(""),
});
export const publicScriptDebugSchema = z.object({
  vars: z.record(z.string().min(1).max(128), z.string().max(8192)).default({}),
  params: z.record(z.string().min(1).max(64), z.string().max(2048)).default({}),
});
export const publicScriptStatusSchema = z.object({
  status: z.enum(["DRAFT", "ENABLED"]),
});

// ── 环境组与全局参数（S5 PROJ-006）──

export const ENV_GROUP_LIMIT = 20; // 组上限/项目
export const ENV_GROUP_MAX_ENVS = 10; // 组内环境上限
export const envGroupUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  /** 有序环境 id 列表（去重由服务端保证） */
  environmentIds: z.array(z.string().uuid()).min(1).max(ENV_GROUP_MAX_ENVS),
});
export const GLOBAL_PARAM_LIMIT = 100; // 全局参数条数上限
export const globalParamItemSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(2048).default(""),
  description: z.string().max(200).default(""),
});
export const globalParamsUpsertSchema = z.object({
  params: z.array(globalParamItemSchema).max(GLOBAL_PARAM_LIMIT).default([]),
});

// ── Git 存储库（S5 FILE-001）──

export const FILE_REPO_LIMIT = 10; // 仓库上限/项目
export const FILE_REPO_PLATFORMS = ["gitea", "github", "gitlab", "gitee"] as const;
export type FileRepoPlatform = (typeof FILE_REPO_PLATFORMS)[number];
export const fileRepoUpsertSchema = z.object({
  platform: z.enum(FILE_REPO_PLATFORMS),
  /** https 仓库地址（https://host/owner/repo[.git]） */
  url: z.string().min(1).max(1024),
  /** Token 加密落库永不回显；PATCH 留空=不更新 */
  token: z.string().max(512).optional(),
});
export const fileRepoPullSchema = z.object({
  branch: z.string().min(1).max(128),
  /** 文件或目录路径（目录递归深度≤3、文件数≤50） */
  path: z.string().min(1).max(512),
});

export type PublicScriptUpsertInput = z.infer<typeof publicScriptUpsertSchema>;
export type EnvGroupUpsertInput = z.infer<typeof envGroupUpsertSchema>;
export type FileRepoUpsertInput = z.infer<typeof fileRepoUpsertSchema>;
