import { get, post, del } from "./client";

// ── S11 SYS-009：OAuth Token 通道（Device Flow 授权确认页 + 授权会话管理）──
// 注：oauth/device/code 与 oauth/token 为 RFC 8628 原生形状（CLI 专用，非信封），不经此客户端。

export interface OAuthPendingDevice {
  clientId: string;
  scope: string[];
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface AuthorizationRow {
  id: string;
  clientId: string;
  deviceName: string | null;
  scope: string[];
  ip: string | null;
  status: string;
  lastUsedAt: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export const oauthApi = {
  /** 确认页「校验」步：PENDING 待授权请求回显（无效 422 10030） */
  pending: (code: string) =>
    get<OAuthPendingDevice>(`/api/v1/oauth/device/pending?code=${encodeURIComponent(code)}`),
  approve: (userCode: string, approve: boolean) =>
    post<{ approved: boolean }>(`/api/v1/oauth/device/approve`, { userCode, approve }),
};

export const authorizationApi = {
  list: () => get<AuthorizationRow[]>(`/api/v1/personal/authorizations`),
  revoke: (id: string) => del<{ revoked: boolean }>(`/api/v1/personal/authorizations/${id}`),
  revokeAll: () => del<{ revoked: number }>(`/api/v1/personal/authorizations`),
};
