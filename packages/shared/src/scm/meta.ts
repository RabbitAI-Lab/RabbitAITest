/**
 * SCM-001 代码平台元数据单一事实源（仿 plugins/spi PLATFORM_META）。
 * 纯数据/纯函数（env 注入可测）；平台 API 形态差异在 git-adapters/scm-oauth 服务层吸收。
 */
import { z } from "zod";

export const SCM_PROVIDERS = ["github", "gitee", "gitlab", "gitea", "custom"] as const;
export type ScmProvider = (typeof SCM_PROVIDERS)[number];

/** 支持 OAuth 授权选择的平台（gitea/custom 仅 URL 直填 + Token/账密） */
export const SCM_OAUTH_PROVIDERS = ["github", "gitee", "gitlab"] as const;
export type ScmOauthProvider = (typeof SCM_OAUTH_PROVIDERS)[number];

export const SCM_AUTH_TYPES = ["none", "oauth", "token", "password"] as const;
export type ScmAuthType = (typeof SCM_AUTH_TYPES)[number];

export const SCM_VERIFY_STATUSES = ["UNVERIFIED", "OK", "INVALID_CRED", "FAILED"] as const;
export type ScmVerifyStatus = (typeof SCM_VERIFY_STATUSES)[number];

/** 全平台展示名（UI tag/文案用；Gitee 一律写「Gitee（码云）」——SCM-001 §3 文案口径） */
export const SCM_PROVIDER_LABEL: Record<ScmProvider, string> = {
  github: "GitHub",
  gitee: "Gitee（码云）",
  gitlab: "GitLab",
  gitea: "Gitea",
  custom: "自建/其他",
};

export const scmProviderSchema = z.enum(SCM_PROVIDERS);
export const scmOauthProviderSchema = z.enum(SCM_OAUTH_PROVIDERS);
export const scmAuthTypeSchema = z.enum(SCM_AUTH_TYPES);

export interface ScmOauthProviderMeta {
  label: string;
  /** 授权页/token 端点域（gitlab 允许被 App 配置的实例地址替换） */
  webBase: string;
  /** API 域；gitlab 为空串=按实例地址拼 /api/v4 */
  apiBase: string;
  authorizePath: string;
  tokenPath: string;
  /** 当前用户信息端点（相对 apiBase；gitlab 自带 /api/v4 前缀） */
  userPath: string;
  /** 仓库列表端点（相对 apiBase；gitlab 自带 /api/v4 前缀） */
  reposPath: string;
  scopes: string;
  /** API 是否支持 Basic 账密（SCM-001 §1.2 #7 平台能力矩阵） */
  supportsPassword: boolean;
  /** token 以 access_token query 传递（gitee 形态） */
  tokenInQuery: boolean;
  /** access_token 是否会过期需 refresh（gitlab 2h） */
  refreshable: boolean;
}

export const SCM_PROVIDER_META: Record<ScmOauthProvider, ScmOauthProviderMeta> = {
  github: {
    label: "GitHub",
    webBase: "https://github.com",
    apiBase: "https://api.github.com",
    authorizePath: "/login/oauth/authorize",
    tokenPath: "/login/oauth/access_token",
    userPath: "/user",
    reposPath: "/user/repos",
    scopes: "read:user repo",
    supportsPassword: false,
    tokenInQuery: false,
    refreshable: false,
  },
  gitee: {
    label: "Gitee（码云）",
    webBase: "https://gitee.com",
    apiBase: "https://gitee.com/api/v5",
    authorizePath: "/oauth/authorize",
    tokenPath: "/oauth/token",
    userPath: "/user",
    reposPath: "/user/repos",
    scopes: "user_info projects",
    supportsPassword: true,
    tokenInQuery: true,
    refreshable: false,
  },
  gitlab: {
    label: "GitLab",
    webBase: "https://gitlab.com",
    apiBase: "",
    authorizePath: "/oauth/authorize",
    tokenPath: "/oauth/token",
    userPath: "/api/v4/user",
    reposPath: "/api/v4/projects",
    scopes: "read_user read_api",
    supportsPassword: false,
    tokenInQuery: false,
    refreshable: true,
  },
};

/**
 * 计算平台实际端点基址（纯函数，env 由调用方注入）。
 * 优先级：测试栈 env 覆盖（SCM_{PROVIDER}_BASE_URL，web+api 同域指向 mock）>
 *         GitLab App 配置的实例地址（自建）> 官方默认域。
 */
export function resolveScmBases(
  provider: ScmOauthProvider,
  opts: { appBaseUrl?: string | null; envBase?: string | null } = {},
): { webBase: string; apiBase: string } {
  const meta = SCM_PROVIDER_META[provider];
  if (opts.envBase) {
    const base = opts.envBase.replace(/\/$/, "");
    return { webBase: base, apiBase: base };
  }
  if (provider === "gitlab") {
    const base = (opts.appBaseUrl || meta.webBase).replace(/\/$/, "");
    return { webBase: base, apiBase: `${base}/api/v4` };
  }
  return { webBase: meta.webBase, apiBase: meta.apiBase };
}

/** env 覆盖变量名（apps/web 侧读取后注入 resolveScmBases） */
export function scmEnvOverrideKey(provider: ScmOauthProvider): string {
  return `SCM_${provider.toUpperCase()}_BASE_URL`;
}
