/** Sprint 9 域客户端（ENTP-001~008）。路径唯一出口（门禁 4）。 */
import { get, post, put, patch, del } from "./client";
// PoolRow 定义于 s2（poolApi）；此处仅引用类型
import type { PoolRow } from "./s2";

// ── ENTP-007 License ──

export interface LicenseStatus {
  edition: "COMMUNITY" | "ENTERPRISE";
  expiresAt: string | null;
  features: string[];
  daysLeft: number | null;
  lic: string | null;
  maxUsers: number | null;
  /** ENTP-009：true=特性门控生效（企业口径）；false=开源全功能（License 不门控，默认） */
  featureGateEnabled: boolean;
}

export const licenseApi = {
  status: () => get<LicenseStatus>("/api/v1/system/license"),
  add: (code: string) => post<LicenseStatus>("/api/v1/system/license", { code }),
  remove: () => del<LicenseStatus>("/api/v1/system/license"),
  /** 公开（无鉴权）：前端按钮解锁驱动 */
  publicStatus: () => get<LicenseStatus>("/api/v1/public/license-status"),
};

// ── ENTP-001 多组织 ──

export interface OrgRow {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ENDED";
  memberCount: number;
  projectCount: number;
  isDefault: boolean;
  createdAt: string;
}

export const orgAdminApi = {
  list: () => get<{ total: number; items: OrgRow[] }>("/api/v1/system/orgs"),
  create: (body: { name: string; ownerEmail: string; description?: string }) =>
    post<{ id: string }>("/api/v1/system/orgs", body),
  update: (
    orgId: string,
    body: { name?: string; description?: string; status?: "ACTIVE" | "ENDED" },
  ) => patch<{ id: string }>(`/api/v1/orgs/${orgId}`, body),
  remove: (orgId: string) =>
    del<{ id: string; deletedProjects: number }>(`/api/v1/orgs/${orgId}?needConfirm=true`),
};

export const personalOrgApi = {
  list: () => get<{ id: string; name: string }[]>("/api/v1/personal/orgs"),
};

// ── ENTP-002/003 SSO 认证源 ──

export interface AuthSourceRow {
  id: string;
  type: "LDAP" | "CAS" | "OIDC" | "OAUTH2" | "SAML" | "WECOM" | "DINGTALK" | "FEISHU";
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export const ssoApi = {
  list: () => get<{ total: number; items: AuthSourceRow[] }>("/api/v1/system/sso"),
  create: (body: {
    type: AuthSourceRow["type"];
    name: string;
    enabled: boolean;
    config: Record<string, unknown>;
  }) => post<{ id: string }>("/api/v1/system/sso", body),
  update: (
    authId: string,
    body: {
      type: AuthSourceRow["type"];
      name: string;
      enabled: boolean;
      config: Record<string, unknown>;
    },
  ) => patch<{ id: string }>(`/api/v1/system/sso/${authId}`, body),
  remove: (authId: string) => del<{ id: string }>(`/api/v1/system/sso/${authId}`),
  testConnection: (authId: string) =>
    post<{ ok: boolean; message: string }>(`/api/v1/system/sso/${authId}/test-connection`, {}),
  /** 公开：登录页「更多登录方式」 */
  publicMethods: () =>
    get<{ authId: string; type: AuthSourceRow["type"]; name: string }[]>(
      "/api/v1/public/sso-methods",
    ),
  /** LDAP 目录登录（mode=ldap） */
  ldapLogin: (body: { authId: string; username: string; password: string }) =>
    post<{ userId: string; email: string }>("/api/v1/auth/login", { mode: "ldap", ...body }),
};

// ── ENTP-006 多资源池 ──

export interface PoolOrgScopeInput {
  orgScope?: "ALL" | string[];
  type?: "NODE" | "K8S";
  name?: string;
  maxConcurrency?: number;
  status?: "ACTIVE" | "DISABLED";
}

export const poolEntpApi = {
  create: (body: {
    name: string;
    type: "NODE" | "K8S";
    maxConcurrency: number;
    orgScope: "ALL" | string[];
  }) => post<PoolRow>(`/api/v1/system/pools`, body),
  updateEntp: (poolId: string, body: PoolOrgScopeInput) =>
    patch<PoolRow>(`/api/v1/system/pools/${poolId}`, body),
  remove: (poolId: string) => del<{ id: string }>(`/api/v1/system/pools/${poolId}`),
};

// ── ENTP-004 主题 ──

export interface ThemeParam {
  primaryColor: string;
  followPrimary: boolean;
  siteName: string;
  slogan: string;
  loginLogo: string;
  loginBg: string;
  icon: string;
  platformName: string;
  platformLogo: string;
  helpUrl: string;
}

export const themeApi = {
  publicTheme: () => get<ThemeParam>("/api/v1/public/theme"),
};

// ── ENTP-005 消息模板 ──

export interface MessageTemplateRow {
  event: string;
  title: string;
  content: string;
  customized: boolean;
  updatedAt: string | null;
}

export const messageTemplateApi = {
  list: (projectId: string) =>
    get<{ total: number; items: MessageTemplateRow[] }>(
      `/api/v1/projects/${projectId}/message-templates`,
    ),
  upsert: (projectId: string, body: { event: string; title: string; content: string }) =>
    put<{ event: string }>(`/api/v1/projects/${projectId}/message-templates`, body),
  reset: (projectId: string, event: string) =>
    del<{ event: string }>(`/api/v1/projects/${projectId}/message-templates/${event}`),
  preview: (projectId: string, body: { event: string; title: string; content: string }) =>
    post<{ title: string; content: string }>(
      `/api/v1/projects/${projectId}/message-templates/preview`,
      body,
    ),
};

// ── ENTP-008 部门 ──

export interface DepartmentTreeNode {
  id: string;
  name: string;
  parentId: string | null;
  memberCount: number;
  children: DepartmentTreeNode[];
}

export interface DepartmentMemberRow {
  userId: string;
  name: string;
  email: string;
}

export const departmentApi = {
  tree: (orgId: string) => get<DepartmentTreeNode[]>(`/api/v1/orgs/${orgId}/departments`),
  create: (orgId: string, body: { name: string; parentId?: string | null }) =>
    post<{ id: string }>(`/api/v1/orgs/${orgId}/departments`, body),
  update: (orgId: string, departmentId: string, body: { name: string; parentId?: string | null }) =>
    patch<{ id: string }>(`/api/v1/orgs/${orgId}/departments/${departmentId}`, body),
  remove: (orgId: string, departmentId: string) =>
    del<{ id: string }>(`/api/v1/orgs/${orgId}/departments/${departmentId}`),
  members: (orgId: string, departmentId: string) =>
    get<DepartmentMemberRow[]>(`/api/v1/orgs/${orgId}/departments/${departmentId}/members`),
  addMembers: (orgId: string, departmentId: string, userIds: string[]) =>
    post<{ added: number }>(`/api/v1/orgs/${orgId}/departments/${departmentId}/members`, {
      userIds,
    }),
  removeMember: (orgId: string, departmentId: string, userId: string) =>
    del<{ ok: boolean }>(`/api/v1/orgs/${orgId}/departments/${departmentId}/members/${userId}`),
};
