/** SCM-001 契约：OAuth App 双层配置 / 授权账号 / 项目仓库绑定。 */
import { z } from "zod";
import { SCM_AUTH_TYPES, SCM_OAUTH_PROVIDERS, SCM_PROVIDERS, SCM_VERIFY_STATUSES } from "./meta";

export const SCM_REPO_LIMIT = 10; // 仓库上限/项目（对齐 FILE_REPO_LIMIT）

// ── OAuth App 配置（系统级 SystemParam group=scm + 组织级覆盖共用字段形状） ──

/** clientSecret：缺省/空串/「******」= 不修改（沿用 SMTP pass 语义） */
export const scmAppProviderValueSchema = z.object({
  clientId: z.string().max(255),
  clientSecret: z.string().max(512).optional(),
  /** GitLab 实例地址（自建）；github/gitee 忽略 */
  baseUrl: z.string().max(512).optional(),
  enabled: z.boolean().default(true),
});

/** SystemParam group=scm 值形状（三平台齐备；clientId 空=未配置） */
export const scmParamValueSchema = z.object({
  github: scmAppProviderValueSchema,
  gitee: scmAppProviderValueSchema,
  gitlab: scmAppProviderValueSchema,
});
export type ScmParamValue = z.infer<typeof scmParamValueSchema>;

/** 组织级覆盖（PUT body）：clientId 必填非空（覆盖即生效配置） */
export const scmOrgAppUpsertSchema = scmAppProviderValueSchema.extend({
  clientId: z.string().min(1).max(255),
});
export type ScmOrgAppUpsertInput = z.infer<typeof scmOrgAppUpsertSchema>;

/** App 配置解析结果（GET 视图：clientSecret 只回 hasSecret） */
export const scmAppResolvedSchema = z.object({
  provider: z.enum(SCM_OAUTH_PROVIDERS),
  source: z.enum(["org", "system", "none"]),
  clientId: z.string(),
  hasSecret: z.boolean(),
  baseUrl: z.string().nullable(),
  enabled: z.boolean(),
});

// ── 授权账号 ──

export const scmAccountViewSchema = z.object({
  id: z.string(),
  provider: z.enum(SCM_OAUTH_PROVIDERS),
  login: z.string(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  /** 授权人（展示名与 id） */
  createdById: z.string(),
  createdByName: z.string().nullable(),
  expiresAt: z.string().nullable(),
  scopes: z.string().nullable(),
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]),
  createdAt: z.string(),
});

/** 授权账号的仓库列表条目（OAuth 选仓） */
export const scmAccountRepoSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  defaultBranch: z.string().nullable(),
  visibility: z.enum(["public", "private", "internal"]),
  httpsUrl: z.string(),
  sshUrl: z.string().nullable(),
});

export const scmAccountReposQuerySchema = z.object({
  keyword: z.string().max(128).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 项目仓库绑定 ──

export const scmRepoCreateSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("oauth"),
    accountId: z.string().uuid(),
    owner: z.string().min(1).max(255),
    repo: z.string().min(1).max(255),
    name: z.string().max(128).optional(),
  }),
  z.object({
    source: z.literal("url"),
    provider: z.enum(SCM_PROVIDERS),
    repoUrl: z.string().min(1).max(1024),
    authType: z.enum(SCM_AUTH_TYPES),
    /** token/password 提交后即加密落库，响应永不回显 */
    token: z.string().max(512).optional(),
    username: z.string().max(255).optional(),
    password: z.string().max(512).optional(),
    name: z.string().max(128).optional(),
  }),
]);
export type ScmRepoCreateInput = z.infer<typeof scmRepoCreateSchema>;

/**
 * 编辑：三块独立可变——改名 / 设默认 / 整体换认证（authType 与配套字段同送）。
 * 凭据字段留空=不更新（authType 未变时）；authType 变更时按新类型全量校验。
 */
export const scmRepoUpdateSchema = z.object({
  name: z.string().max(128).nullable().optional(),
  isDefault: z.boolean().optional(),
  authType: z.enum(SCM_AUTH_TYPES).optional(),
  accountId: z.string().uuid().nullable().optional(),
  token: z.string().max(512).optional(),
  username: z.string().max(255).optional(),
  password: z.string().max(512).optional(),
});
export type ScmRepoUpdateInput = z.infer<typeof scmRepoUpdateSchema>;

export const scmRepoViewSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  provider: z.enum(SCM_PROVIDERS),
  repoUrl: z.string(),
  sshUrl: z.string().nullable(),
  host: z.string(),
  owner: z.string(),
  repo: z.string(),
  authType: z.enum(SCM_AUTH_TYPES),
  accountId: z.string().nullable(),
  /** authType=oauth 时回显平台登录名 */
  accountLogin: z.string().nullable(),
  username: z.string().nullable(),
  hasSecret: z.boolean(),
  defaultBranch: z.string().nullable(),
  visibility: z.string().nullable(),
  isDefault: z.boolean(),
  verifyStatus: z.enum(SCM_VERIFY_STATUSES),
  verifyMessage: z.string().nullable(),
  lastVerifiedAt: z.string().nullable(),
  createdAt: z.string(),
});

export const scmRepoVerifyResultSchema = z.object({
  status: z.enum(SCM_VERIFY_STATUSES),
  message: z.string(),
  defaultBranch: z.string().nullable(),
  visibility: z.string().nullable(),
  latestCommit: z
    .object({
      sha: z.string(),
      message: z.string(),
      committedAt: z.string().nullable(),
    })
    .nullable(),
});
export type ScmRepoVerifyResult = z.infer<typeof scmRepoVerifyResultSchema>;
