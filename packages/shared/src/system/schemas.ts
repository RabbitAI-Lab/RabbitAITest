/** SYS-004/SYS-005：系统用户、用户组、系统参数契约。 */
import { z } from "zod";
import { PERMISSION_POINTS, isValidPermissionPoint } from "../permissions";

// ── 用户管理（SYS-004）──

export const userCreateSchema = z.object({
  email: z.string().email().max(256),
  name: z.string().min(1).max(128),
  phone: z.string().max(32).optional(),
  password: z.string().min(8).max(64).optional(), // 缺省则服务端生成并一次性返回
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
export const paramGroupSchema = z.discriminatedUnion("group", [
  z.object({ group: z.literal("basic"), value: basicParamSchema }),
  z.object({ group: z.literal("smtp"), value: smtpParamSchema }),
  z.object({ group: z.literal("file"), value: fileParamSchema }),
  z.object({ group: z.literal("cleanup"), value: cleanupParamSchema }),
]);

export const USER_LIMIT = 30; // 社区版用户上限（SYS-004 §1.2，代码硬校验）
export type UserCreateInput = z.infer<typeof userCreateSchema>;
export type GroupUpsertInput = z.infer<typeof groupUpsertSchema>;
