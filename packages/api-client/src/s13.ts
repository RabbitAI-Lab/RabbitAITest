/** Sprint 13 域客户端（SCM-001 项目代码仓库）。路径唯一出口（门禁 4）。 */
import { get, put, patch, del, post } from "./client";
import type {
  ScmOauthProvider,
  ScmProvider,
  ScmRepoCreateInput,
  ScmRepoUpdateInput,
} from "@rabbit/shared";

// ── OAuth 应用（系统级走 paramApi group=scm；此处为组织级覆盖与解析视图） ──

export interface ScmAppResolvedView {
  provider: ScmOauthProvider;
  source: "org" | "system" | "none";
  clientId: string;
  hasSecret: boolean;
  baseUrl: string;
  enabled: boolean;
}

export interface ScmOrgAppUpsertBody {
  clientId: string;
  clientSecret?: string;
  baseUrl?: string;
  enabled: boolean;
}

export const scmAppApi = {
  list: (orgId: string) =>
    get<{ total: number; items: ScmAppResolvedView[] }>(`/api/v1/orgs/${orgId}/scm-apps`),
  save: (orgId: string, provider: ScmOauthProvider, body: ScmOrgAppUpsertBody) =>
    put<{ provider: string; clientId: string; hasSecret: boolean }>(
      `/api/v1/orgs/${orgId}/scm-apps/${provider}`,
      body,
    ),
  remove: (orgId: string, provider: ScmOauthProvider) =>
    del<{ ok: boolean }>(`/api/v1/orgs/${orgId}/scm-apps/${provider}`),
  /** 发起授权的跳转地址（浏览器整页跳转，非 fetch） */
  oauthStartUrl: (orgId: string, provider: ScmOauthProvider) =>
    `/api/v1/orgs/${orgId}/scm/oauth/${provider}/start`,
};

// ── 授权账号 ──

export interface ScmAccountView {
  id: string;
  provider: ScmOauthProvider;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdById: string;
  createdByName: string | null;
  expiresAt: string | null;
  scopes: string | null;
  status: "ACTIVE" | "EXPIRED" | "REVOKED";
  createdAt: string;
}

export interface ScmAccountRepoView {
  owner: string;
  repo: string;
  defaultBranch: string | null;
  visibility: "public" | "private" | "internal";
  httpsUrl: string;
  sshUrl: string | null;
}

export const scmAccountApi = {
  list: (orgId: string) =>
    get<{ total: number; items: ScmAccountView[] }>(`/api/v1/orgs/${orgId}/scm-accounts`),
  revoke: (orgId: string, accountId: string) =>
    del<{ id: string }>(`/api/v1/orgs/${orgId}/scm-accounts/${accountId}`),
  repos: (
    orgId: string,
    accountId: string,
    q: { keyword?: string; page?: number; pageSize?: number },
  ) => {
    const params = new URLSearchParams();
    if (q.keyword) params.set("keyword", q.keyword);
    if (q.page) params.set("page", String(q.page));
    if (q.pageSize) params.set("pageSize", String(q.pageSize));
    const qs = params.toString();
    return get<{ total: number; items: ScmAccountRepoView[] }>(
      `/api/v1/orgs/${orgId}/scm-accounts/${accountId}/repos${qs ? `?${qs}` : ""}`,
    );
  },
};

// ── 项目仓库绑定 ──

export interface ScmRepoView {
  id: string;
  name: string | null;
  provider: ScmProvider;
  repoUrl: string;
  sshUrl: string | null;
  host: string;
  owner: string;
  repo: string;
  authType: "none" | "oauth" | "token" | "password";
  accountId: string | null;
  accountLogin: string | null;
  username: string | null;
  hasSecret: boolean;
  defaultBranch: string | null;
  visibility: string | null;
  isDefault: boolean;
  verifyStatus: "UNVERIFIED" | "OK" | "INVALID_CRED" | "FAILED";
  verifyMessage: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
}

export interface ScmVerifyResult {
  status: "UNVERIFIED" | "OK" | "INVALID_CRED" | "FAILED";
  message: string;
  defaultBranch: string | null;
  visibility: string | null;
  latestCommit: { sha: string; message: string; committedAt: string | null } | null;
}

export const scmRepoApi = {
  list: (projectId: string) =>
    get<{ total: number; items: ScmRepoView[] }>(`/api/v1/projects/${projectId}/scm-repos`),
  create: (projectId: string, body: ScmRepoCreateInput) =>
    post<ScmRepoView>(`/api/v1/projects/${projectId}/scm-repos`, body),
  update: (projectId: string, repoId: string, body: ScmRepoUpdateInput) =>
    patch<ScmRepoView>(`/api/v1/projects/${projectId}/scm-repos/${repoId}`, body),
  remove: (projectId: string, repoId: string) =>
    del<{ id: string }>(`/api/v1/projects/${projectId}/scm-repos/${repoId}`),
  verify: (projectId: string, repoId: string) =>
    post<ScmVerifyResult>(`/api/v1/projects/${projectId}/scm-repos/${repoId}/verify`, {}),
};
