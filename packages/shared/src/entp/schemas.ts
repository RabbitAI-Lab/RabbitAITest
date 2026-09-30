/** 企业版域（S9 ENTP-001~008）：License / 认证源 / 组织 / 资源池 / 部门 / SSO 公共契约。 */
import { z } from "zod";
import { ENTP_FEATURE_KEYS, type EntpFeature } from "./features";

// ── License（ENTP-007）──

export const licensePayloadSchema = z.object({
  lic: z.string().min(8).max(64),
  edition: z.literal("ENTERPRISE"),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  /** 特性子集；缺省=全部六项 */
  features: z.array(z.enum(ENTP_FEATURE_KEYS as [EntpFeature, ...EntpFeature[]])).optional(),
  /** 用户上限封顶；缺省=不限 */
  maxUsers: z.number().int().positive().optional(),
});
export type LicensePayload = z.infer<typeof licensePayloadSchema>;

export const licenseAddSchema = z.object({ code: z.string().min(16).max(8192) });
export type LicenseAddInput = z.infer<typeof licenseAddSchema>;

export const licenseStatusSchema = z.object({
  edition: z.enum(["COMMUNITY", "ENTERPRISE"]),
  expiresAt: z.string().datetime().nullable(),
  features: z.array(z.enum(ENTP_FEATURE_KEYS as [EntpFeature, ...EntpFeature[]])),
  daysLeft: z.number().int().nullable(),
  lic: z.string().nullable(),
  maxUsers: z.number().int().nullable(),
  /** ENTP-009：true=ENTP-007 特性门控生效（企业发行口径）；false=开源全功能（默认，License 不门控） */
  featureGateEnabled: z.boolean(),
});
export type LicenseStatus = z.infer<typeof licenseStatusSchema>;

// ── 认证源（ENTP-002/003）──

export const AUTH_SOURCE_TYPES = [
  "LDAP",
  "CAS",
  "OIDC",
  "OAUTH2",
  "SAML",
  "WECOM",
  "DINGTALK",
  "FEISHU",
] as const;
export type AuthSourceType = (typeof AUTH_SOURCE_TYPES)[number];

/** 属性映射：username/email 必填键名（IdP 属性名） */
export const propMappingSchema = z.object({
  username: z.string().min(1).max(64),
  name: z.string().max(64).default("name"),
  email: z.string().min(1).max(64),
});
export type PropMapping = z.infer<typeof propMappingSchema>;

export const ldapAuthConfigSchema = z.object({
  host: z.string().min(1).max(256),
  port: z.number().int().min(1).max(65535).default(389),
  bindDn: z.string().min(1).max(256),
  bindPassword: z.string().min(1).max(256),
  userOu: z.string().min(1).max(256),
  filterKey: z.enum(["uid", "sAMAccountName", "cn"]).default("uid"),
  propMapping: propMappingSchema.default({ username: "uid", name: "cn", email: "mail" }),
});

export const oidcAuthConfigSchema = z.object({
  authEndpoint: z.string().url().max(512),
  tokenEndpoint: z.string().url().max(512),
  userinfoEndpoint: z.string().url().max(512),
  clientId: z.string().min(1).max(128),
  clientSecret: z.string().min(1).max(256),
  scope: z.string().max(128).default("openid profile email"),
  propMapping: propMappingSchema.default({
    username: "preferred_username",
    name: "name",
    email: "email",
  }),
});

/** OAuth2 与 OIDC 同构（GitHub 形态：无 openid scope 约定） */
export const oauth2AuthConfigSchema = oidcAuthConfigSchema.extend({
  scope: z.string().max(128).default("read:user user:email"),
  propMapping: propMappingSchema.default({ username: "login", name: "name", email: "email" }),
});

export const casAuthConfigSchema = z.object({
  serverUrl: z.string().url().max(512),
  propMapping: propMappingSchema.default({ username: "username", name: "name", email: "email" }),
});

export const wecomAuthConfigSchema = z.object({
  corpId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64),
  secret: z.string().min(1).max(256),
  /** 展示型（可信域提示），不做校验 */
  redirectDomain: z.string().max(256).default(""),
  /** 测试栈注入 mock 平台端点（缺省=真实平台） */
  apiBase: z.string().max(512).optional(),
  authorizeBase: z.string().max(512).optional(),
});

export const dingtalkAuthConfigSchema = z.object({
  clientId: z.string().min(1).max(64),
  agentId: z.string().min(1).max(64),
  clientSecret: z.string().min(1).max(256),
  callbackDomain: z.string().max(256).default(""),
  /** 测试栈注入 mock 平台端点（缺省=真实平台） */
  apiBase: z.string().max(512).optional(),
  authorizeBase: z.string().max(512).optional(),
});

export const feishuAuthConfigSchema = z.object({
  appId: z.string().min(1).max(64),
  appSecret: z.string().min(1).max(256),
  redirectUrl: z.string().max(512).default(""),
  /** 测试栈注入 mock 平台端点（缺省=真实平台） */
  apiBase: z.string().max(512).optional(),
  authorizeBase: z.string().max(512).optional(),
});

export const authSourceUpsertSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("LDAP"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: ldapAuthConfigSchema,
  }),
  z.object({
    type: z.literal("CAS"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: casAuthConfigSchema,
  }),
  z.object({
    type: z.literal("OIDC"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: oidcAuthConfigSchema,
  }),
  z.object({
    type: z.literal("OAUTH2"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: oauth2AuthConfigSchema,
  }),
  z.object({
    type: z.literal("WECOM"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: wecomAuthConfigSchema,
  }),
  z.object({
    type: z.literal("DINGTALK"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: dingtalkAuthConfigSchema,
  }),
  z.object({
    type: z.literal("FEISHU"),
    name: z.string().min(1).max(128),
    enabled: z.boolean().default(true),
    config: feishuAuthConfigSchema,
  }),
]);
export type AuthSourceUpsert = z.infer<typeof authSourceUpsertSchema>;

/** SAML 仅枚举占位（ENTP-002 §1.2：后续迭代实现） */
export const SAML_PLACEHOLDER = {
  type: "SAML" as const,
  reason: "SAML 协议未实现（验收环境缺失，登记后续迭代）",
};

export const authSourceItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(AUTH_SOURCE_TYPES),
  name: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});
export type AuthSourceItem = z.infer<typeof authSourceItemSchema>;

export const ssoMethodItemSchema = z.object({
  authId: z.string().uuid(),
  type: z.enum(AUTH_SOURCE_TYPES),
  name: z.string(),
});
export type SsoMethodItem = z.infer<typeof ssoMethodItemSchema>;

export const ldapLoginSchema = z.object({
  mode: z.literal("ldap"),
  authId: z.string().uuid(),
  username: z.string().min(1).max(128),
  password: z.string().min(1).max(256),
});

// ── 多组织（ENTP-001）──

export const orgCreateSchema = z.object({
  name: z.string().min(1).max(128),
  ownerEmail: z.string().email().max(256),
  description: z.string().max(512).optional(),
});
export type OrgCreateInput = z.infer<typeof orgCreateSchema>;

export const orgUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  status: z.enum(["ACTIVE", "ENDED"]).optional(),
});
export type OrgUpdateInput = z.infer<typeof orgUpdateSchema>;

export const orgItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["ACTIVE", "ENDED"]),
  memberCount: z.number().int(),
  projectCount: z.number().int(),
  isDefault: z.boolean(),
  createdAt: z.string().datetime(),
});
export type OrgItem = z.infer<typeof orgItemSchema>;

export const personalOrgItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type PersonalOrgItem = z.infer<typeof personalOrgItemSchema>;

// ── 多资源池（ENTP-006）──

export const poolOrgScopeSchema = z.union([
  z.literal("ALL"),
  z.array(z.string().uuid()).min(1).max(50),
]);
export type PoolOrgScope = z.infer<typeof poolOrgScopeSchema>;

export const poolCreateSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.enum(["NODE", "K8S"]).default("NODE"),
  maxConcurrency: z.number().int().min(2).max(64),
  orgScope: poolOrgScopeSchema.default("ALL"),
});
export type PoolCreateInput = z.infer<typeof poolCreateSchema>;

/** ETP-006 启停/orgScope 编辑入参（名称/并发复用 P4 版 poolUpdateSchema——execution/schemas，避免重名导出冲突） */
export const poolEntpUpdateSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  maxConcurrency: z.number().int().min(2).max(64).optional(),
  orgScope: poolOrgScopeSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export type PoolEntpUpdateInput = z.infer<typeof poolEntpUpdateSchema>;

// ── 部门（ENTP-008）──

export const departmentUpsertSchema = z.object({
  name: z.string().min(1).max(64),
  parentId: z.string().uuid().nullable().optional(),
});
export type DepartmentUpsertInput = z.infer<typeof departmentUpsertSchema>;

export const departmentMemberAddSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
});

export const departmentTreeItemSchema: z.ZodType<DepartmentTreeItem> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    parentId: z.string().uuid().nullable(),
    memberCount: z.number().int(),
    children: z.array(departmentTreeItemSchema),
  }),
);
export interface DepartmentTreeItem {
  id: string;
  name: string;
  parentId: string | null;
  memberCount: number;
  children: DepartmentTreeItem[];
}

export const departmentMemberItemSchema = z.object({
  userId: z.string().uuid(),
  name: z.string(),
  email: z.string(),
});
export type DepartmentMemberItem = z.infer<typeof departmentMemberItemSchema>;

// ── 公开主题（ENTP-004）──

export const themePublicSchema = z.object({
  primaryColor: z.string(),
  followPrimary: z.boolean(),
  siteName: z.string(),
  slogan: z.string(),
  loginLogo: z.string(),
  loginBg: z.string(),
  icon: z.string(),
  platformName: z.string(),
  platformLogo: z.string(),
  helpUrl: z.string(),
});
export type ThemePublic = z.infer<typeof themePublicSchema>;
