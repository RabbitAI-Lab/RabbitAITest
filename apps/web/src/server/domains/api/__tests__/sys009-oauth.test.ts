/** SYS-009 单测：Device Flow 状态机（发码/批准/交换/双花）、refresh 旋转与重放吊销、token 校验失效面。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, ErrCode } from "@rabbit/shared";

interface DeviceRow {
  id: string;
  clientId: string;
  deviceCodeHash: string;
  userCode: string;
  scope: string;
  status: string;
  userId: string | null;
  ip: string | null;
  userAgent: string | null;
  approveFails: number;
  expiresAt: Date;
  approvedAt: Date | null;
  createdAt: Date;
}
interface GrantRow {
  id: string;
  userId: string;
  clientId: string;
  deviceName: string | null;
  scope: string;
  status: string;
  accessTokenHash: string;
  accessExpiresAt: Date;
  prevRefreshHash: string | null;
  refreshTokenHash: string | null;
  refreshExpiresAt: Date | null;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  ip: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}
interface UserRow {
  id: string;
  status: string;
  deletedAt: Date | null;
}

vi.mock("@rabbit/db", () => {
  const state: { devices: DeviceRow[]; grants: GrantRow[]; users: UserRow[] } = {
    devices: [],
    grants: [],
    users: [],
  };
  const now = () => new Date();
  const prisma = {
    oAuthDeviceCode: {
      create: async ({ data }: { data: Partial<DeviceRow> }) => {
        const row: DeviceRow = {
          id: `dc${state.devices.length + 1}`,
          clientId: data.clientId ?? "rabbit-cli",
          deviceCodeHash: data.deviceCodeHash!,
          userCode: data.userCode!,
          scope: data.scope!,
          status: data.status ?? "PENDING",
          userId: data.userId ?? null,
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          approveFails: data.approveFails ?? 0,
          expiresAt: data.expiresAt!,
          approvedAt: data.approvedAt ?? null,
          createdAt: now(),
        };
        state.devices.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.devices.find((d) => {
            if (where.deviceCodeHash && d.deviceCodeHash !== where.deviceCodeHash) return false;
            if (where.userCode && d.userCode !== where.userCode) return false;
            if (where.status && d.status !== where.status) return false;
            if (where.expiresAt?.gt && !(d.expiresAt > (where.expiresAt.gt as Date))) return false;
            return true;
          }) ?? null
        );
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<DeviceRow> }) => {
        const row = state.devices.find((d) => d.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const row = state.devices.find((d) => d.id === where.id && d.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    oAuthGrant: {
      create: async ({ data }: { data: Partial<GrantRow> }) => {
        const row: GrantRow = {
          id: `g${state.grants.length + 1}`,
          userId: data.userId!,
          clientId: data.clientId ?? "rabbit-cli",
          deviceName: data.deviceName ?? null,
          scope: data.scope!,
          status: data.status ?? "ACTIVE",
          accessTokenHash: data.accessTokenHash!,
          accessExpiresAt: data.accessExpiresAt!,
          prevRefreshHash: data.prevRefreshHash ?? null,
          refreshTokenHash: data.refreshTokenHash ?? null,
          refreshExpiresAt: data.refreshExpiresAt ?? null,
          lastUsedAt: data.lastUsedAt ?? null,
          rotatedAt: data.rotatedAt ?? null,
          ip: data.ip ?? null,
          createdAt: now(),
          revokedAt: data.revokedAt ?? null,
        };
        state.grants.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          state.grants.find((g) => {
            if (where.accessTokenHash && g.accessTokenHash !== where.accessTokenHash) return false;
            if (where.refreshTokenHash && g.refreshTokenHash !== where.refreshTokenHash) return false;
            if (where.prevRefreshHash && g.prevRefreshHash !== where.prevRefreshHash) return false;
            if (where.status && g.status !== where.status) return false;
            if (where.id && g.id !== where.id) return false;
            return true;
          }) ?? null
        );
      },
      findMany: async ({ where }: { where: { userId: string } }) =>
        state.grants.filter((g) => g.userId === where.userId),
      update: async ({ where, data }: { where: { id: string }; data: object }) => {
        const row = state.grants.find((g) => g.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
        const rows = state.grants.filter((g) => {
          if (where.id && g.id !== where.id) return false;
          if (where.accessTokenHash && g.accessTokenHash !== where.accessTokenHash) return false;
          if (where.status && g.status !== where.status) return false;
          return true;
        });
        for (const r of rows) Object.assign(r, data);
        return { count: rows.length };
      },
    },
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        state.users.find((u) => {
          if (where.id && u.id !== where.id) return false;
          if (where.status && u.status !== where.status) return false;
          if (where.deletedAt !== undefined && (u.deletedAt === null) !== (where.deletedAt === null))
            return false;
          return true;
        }) ?? null,
    },
    __state: state,
    __reset: () => {
      state.devices = [];
      state.grants = [];
      state.users = [];
    },
  };
  return { prisma };
});

import { prisma } from "@rabbit/db";
import {
  approveDeviceCode,
  exchangeDeviceToken,
  formatUserCode,
  issueDeviceCode,
  listGrants,
  lookupPendingByUserCode,
  maskIp,
  refreshGrant,
  revokeByAccessToken,
  verifyAccessToken,
} from "../oauth.service";

const state = prisma as unknown as {
  __state: { devices: DeviceRow[]; grants: GrantRow[]; users: UserRow[] };
  __reset: () => void;
};
const USER = "u-1";

beforeEach(() => {
  state.__reset();
  state.__state.users.push({ id: USER, status: "ACTIVE", deletedAt: null });
});

async function loginFlow(scope = "read,exec") {
  const issued = await issueDeviceCode({ scope, origin: "http://localhost:3000" });
  await approveDeviceCode(issued.user_code, USER, true);
  const token = await exchangeDeviceToken(issued.device_code);
  return { issued, token };
}

describe("Device Flow 状态机", () => {
  it("发码形状：user_code XXXX-XXXX、RFC 字段齐、库内只存哈希", async () => {
    const issued = await issueDeviceCode({ scope: "read", origin: "http://x" });
    expect(issued.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    expect(issued.device_code).toMatch(/^rdc_/);
    expect(issued.expires_in).toBe(600);
    expect(issued.interval).toBe(5);
    expect(issued.verification_uri_complete).toContain("?code=");
    const row = state.__state.devices[0]!;
    expect(row.userCode).toHaveLength(8);
    expect(row.deviceCodeHash).not.toContain(issued.device_code);
    expect(row.status).toBe("PENDING");
  });
  it("未批准轮询 → pending；批准后交换 → issued；再换 → expired（一次性）", async () => {
    const { issued, token } = await loginFlow();
    // 交换前先验一发 pending：重新发码走未批准路径
    const issued2 = await issueDeviceCode({ scope: "read", origin: "http://x" });
    expect(await exchangeDeviceToken(issued2.device_code)).toEqual({ kind: "pending" });
    expect(token.kind).toBe("issued");
    if (token.kind === "issued") {
      expect(token.access_token).toMatch(/^rat_/);
      expect(token.refresh_token).toMatch(/^rrt_/);
      expect(token.expires_in).toBe(7200);
      expect(token.scope).toBe("read,exec");
    }
    expect(await exchangeDeviceToken(issued.device_code)).toEqual({ kind: "expired" });
  });
  it("拒绝 → access_denied 形态（denied）", async () => {
    const issued = await issueDeviceCode({ scope: "read", origin: "http://x" });
    await approveDeviceCode(issued.user_code, USER, false);
    expect(await exchangeDeviceToken(issued.device_code)).toEqual({ kind: "denied" });
  });
  it("坏 device_code → expired；批准后确认页回显与列表", async () => {
    expect(await exchangeDeviceToken("rdc_notexist")).toEqual({ kind: "expired" });
    const issued = await issueDeviceCode({ scope: "read,exec", origin: "http://x", ip: "192.168.1.23" });
    const pending = await lookupPendingByUserCode(formatUserCode(issued.user_code.toLowerCase()));
    expect(pending?.scope).toEqual(["read", "exec"]);
    expect(pending?.ip).toBe("192.168.1.∗");
    await approveDeviceCode(issued.user_code, USER, true);
    await exchangeDeviceToken(issued.device_code);
    const grants = await listGrants(USER);
    expect(grants).toHaveLength(1);
    expect(grants[0]!.scope).toEqual(["read", "exec"]);
    expect(grants[0]!.status).toBe("ACTIVE");
  });
  it("坏 user_code 批准 → 422 10030", async () => {
    await expect(approveDeviceCode("ZZZZ-ZZZZ", USER, true)).rejects.toMatchObject({
      code: ErrCode.OAUTH_USER_CODE_INVALID,
    } satisfies Partial<DomainError>);
  });
});

describe("verifyAccessToken 失效面", () => {
  it("有效 token → userId+scope；lastUsedAt 回写", async () => {
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    const v = await verifyAccessToken(token.access_token);
    expect(v).toEqual({ userId: USER, scope: ["read", "exec"] });
    expect(state.__state.grants[0]!.lastUsedAt).not.toBeNull();
  });
  it("吊销后 → null", async () => {
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    expect(await revokeByAccessToken(token.access_token)).toBe(true);
    expect(await verifyAccessToken(token.access_token)).toBeNull();
  });
  it("用户禁用 → null（与 session 同语义）", async () => {
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    state.__state.users[0]!.status = "DISABLED";
    expect(await verifyAccessToken(token.access_token)).toBeNull();
  });
  it("access 过期 → null（refresh 仍可旋转）", async () => {
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    state.__state.grants[0]!.accessExpiresAt = new Date(Date.now() - 1000);
    expect(await verifyAccessToken(token.access_token)).toBeNull();
    const r = await refreshGrant(token.refresh_token);
    expect(r.kind).toBe("issued");
  });
});

describe("refresh 旋转与重放检测", () => {
  it("旋转后旧 refresh 再用 → invalid 且整会话吊销", async () => {
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    const rotated = await refreshGrant(token.refresh_token);
    expect(rotated.kind).toBe("issued");
    if (rotated.kind !== "issued") throw new Error("unreachable");
    expect(rotated.access_token).not.toBe(token.access_token);
    // 重放：旧 refresh 二次使用
    expect(await refreshGrant(token.refresh_token)).toEqual({ kind: "invalid" });
    const grant = state.__state.grants[0]!;
    expect(grant.status).toBe("REVOKED");
    // 会话吊销后新 token 也失效
    expect(await verifyAccessToken(rotated.access_token)).toBeNull();
  });
  it("伪造/过期 refresh → invalid", async () => {
    expect(await refreshGrant("rrt_forged")).toEqual({ kind: "invalid" });
    const { token } = await loginFlow();
    if (token.kind !== "issued") throw new Error("unreachable");
    state.__state.grants[0]!.refreshExpiresAt = new Date(Date.now() - 1000);
    expect(await refreshGrant(token.refresh_token)).toEqual({ kind: "invalid" });
  });
});

describe("maskIp", () => {
  it("IPv4 保留 /24、IPv6 截断、空值透传", () => {
    expect(maskIp("192.168.1.23")).toBe("192.168.1.∗");
    expect(maskIp("fd00::1")).toBe("fd00:∗");
    expect(maskIp(null)).toBeNull();
  });
});
