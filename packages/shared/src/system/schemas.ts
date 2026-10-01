/** SYS-004/SYS-005：系统用户、用户组、系统参数契约。 */
import { z } from "zod";
import { PERMISSION_POINTS, isValidPermissionPoint } from "../permissions";
import { scmParamValueSchema } from "../scm/schemas";

// ── 用户管理（SYS-004）──

/** QA-002 密码策略：≥8 位且同时含字母与数字（注册/创建用户/改密/重置统一口径）。 */
export const passwordPolicy = z
  .string()
  .min(8, "密码至少 8 位")
  .max(128)
  .refine((v) => /[a-zA-Z]/.test(v) && /[0-9]/.test(v), "密码须同时包含字母与数字");

export const userCreateSchema = z.object({
  email: z.string().email().max(256),
  name: z.string().min(1).max(128),
  phone: z.string().max(32).optional(),
  password: passwordPolicy.optional(), // 缺省则服务端生成并一次性返回（QA-002：字母+数字）
});
export const userUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  phone: z.string().max(32).nullable().optional(),
});
export const userStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});
export const userListQuerySchema = z.object({
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 用户组（SYS-004，三级 scope 复用）──

export const permissionPointListSchema = z.array(
  z.string().refine(isValidPermissionPoint, { message: "非法权限点" }),
);
export const groupUpsertSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  permissions: permissionPointListSchema.default([]),
  disabled: z.array(z.string().max(64)).default([]),
});
export const groupMembersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});

// ── 系统参数（SYS-005）──

export const smtpParamSchema = z.object({
  host: z.string().max(256).default(""),
  port: z.number().int().min(1).max(65535).default(465),
  user: z.string().max(128).default(""),
  pass: z.string().max(256).default(""),
  ssl: z.boolean().default(true),
  from: z.string().max(256).default(""),
});
export const basicParamSchema = z.object({
  siteUrl: z.string().url().max(512),
  loginBanner: z.string().max(256).default(""),
});
export const fileParamSchema = z.object({
  maxSizeMb: z.number().int().min(1).max(1024),
});
export const cleanupParamSchema = z.object({
  logRetentionDays: z.number().int().min(7).max(3650),
  changeLogRetentionDays: z.number().int().min(7).max(3650),
});
// ── 界面设置（S9 ENTP-004；THEME 特性门控，图片内联 dataUrl ≤200KB）──
export const dataUrlImage = z
  .string()
  .max(280_000) // base64 膨胀后 200KB 二进制 ≈ 270KB 文本，留余量后由服务端二次校验字节
  .refine(
    (v) => v === "" || /^data:image\/(png|jpeg|svg\+xml);base64,/.test(v),
    "仅支持 png/jpeg/svg dataUrl 或空串",
  );
export const themeParamSchema = z.object({
  primaryColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "主题色须为 #RRGGBB")
    .default("#574BFF"),
  followPrimary: z.boolean().default(true),
  siteName: z.string().max(64).default("RabbitAITest"),
  slogan: z.string().max(128).default(""),
  loginLogo: dataUrlImage.default(""),
  loginBg: dataUrlImage.default(""),
  icon: dataUrlImage.default(""),
  platformName: z.string().max(64).default("RabbitAITest"),
  platformLogo: dataUrlImage.default(""),
  helpUrl: z.string().max(512).default(""),
});
export const paramGroupSchema = z.discriminatedUnion("group", [
  z.object({ group: z.literal("basic"), value: basicParamSchema }),
  z.object({ group: z.literal("smtp"), value: smtpParamSchema }),
  z.object({ group: z.literal("file"), value: fileParamSchema }),
  z.object({ group: z.literal("cleanup"), value: cleanupParamSchema }),
  z.object({ group: z.literal("theme"), value: themeParamSchema }),
  // SCM-001：系统级代码平台 OAuth 应用（clientSecret 服务端加密；「******」=不修改）
  z.object({ group: z.literal("scm"), value: scmParamValueSchema }),
]);

/** 兼容导出：实际生效值以 config.userLimit（RABBIT_USER_LIMIT 可配）为准 */
export const USER_LIMIT = 30; // 社区版用户上限默认值（SYS-004 §1.2，代码硬校验）
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type GroupUpsertInput = z.infer<typeof groupUpsertSchema>;

// ── 个人中心（S5 SYS-007；personal 段无权限点，登录即本人）──

export const personalMeUpdateSchema = z.object({
  name: z.string().min(1).max(128),
  phone: z.string().max(32).default(""),
});
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(256),
  newPassword: passwordPolicy,
});
export const localRunnerUpsertSchema = z.object({
  /** 仅环回地址（127.0.0.1/localhost/::1），null/空=清除 */
  address: z.string().max(512).nullable().optional(),
  preferLocal: z.boolean().default(false),
});
export const personalAiModelSchema = z.object({
  /** null=清除（回系统默认） */
  modelId: z.string().uuid().nullable(),
});
