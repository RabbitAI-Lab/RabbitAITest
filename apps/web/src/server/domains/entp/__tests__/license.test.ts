/** S9 单测（ENTP-007）：License 三段式校验管线 + 状态机 + 六特性门控矩阵 + 用户上限（prisma mock）。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, type LicensePayload } from "@rabbit/shared";

// prisma mock：license 表 + $transaction
vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __setState: (k: string, v: unknown) => {
      state[k] = v;
    },
    __state: state,
    license: {
      findFirst: vi.fn(async () => state.license ?? null),
      findUnique: vi.fn(async () => state.license ?? null),
      update: vi.fn(async ({ data }: { data: { status?: string } }) => {
        if (state.license && data.status)
          (state.license as { status: string }).status = data.status;
        return state.license;
      }),
      deleteMany: vi.fn(async () => {
        state.license = null;
        return { count: state.license ? 1 : 0 };
      }),
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.license = data as { code: string; status: string; payload: unknown };
        return state.license;
      }),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  };
  return { prisma };
});

import { prisma } from "@rabbit/db";
import {
  signLicensePayload,
  verifyLicenseCode,
  getLicenseState,
  assertEntpEnabled,
  entpFeatureActive,
  effectiveUserLimit,
  addLicense,
} from "../license.service";

const __setState = (k: string, v: unknown) =>
  (prisma as unknown as { __setState: (k: string, v: unknown) => void }).__setState(k, v);

const payload = (over: Partial<LicensePayload> = {}): LicensePayload => ({
  lic: "RAB-2026-ENT-TEST0001",
  edition: "ENTERPRISE",
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  ...over,
});

beforeEach(() => {
  __setState("license", null);
});

function expectDomain(fn: () => unknown, code: number) {
  try {
    fn();
    throw new Error(`expected DomainError ${code}, but no throw`);
  } catch (err) {
    if (err instanceof DomainError) expect(err.code).toBe(code);
    else throw err;
  }
}

describe("verifyLicenseCode 四步管线", () => {
  it("合法签发 → 通过", () => {
    const code = signLicensePayload(payload());
    expect(verifyLicenseCode(code).lic).toBe("RAB-2026-ENT-TEST0001");
  });
  it("分段缺失 → 90002", () => {
    expectDomain(() => verifyLicenseCode("not-a-license"), 90002);
  });
  it("payload 坏 JSON → 90002", () => {
    const seg = Buffer.from("{bad", "utf8").toString("base64url");
    expectDomain(() => verifyLicenseCode(`RABBIT-ENT1.${seg}.x`), 90002);
  });
  it("字段缺失（edition 错）→ 90002", () => {
    const seg = Buffer.from(JSON.stringify({ lic: "x".repeat(10) }), "utf8").toString("base64url");
    expectDomain(() => verifyLicenseCode(`RABBIT-ENT1.${seg}.sig`), 90002);
  });
  it("签名篡改 → 90003", () => {
    const code = signLicensePayload(payload());
    const parts = code.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${"A".repeat(parts[2]!.length)}`;
    expectDomain(() => verifyLicenseCode(tampered), 90003);
  });
  it("过期 → 90004（拒绝添加）", () => {
    const code = signLicensePayload(
      payload({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
    );
    expectDomain(() => verifyLicenseCode(code), 90004);
  });
});

describe("状态机与门控（prisma mock）", () => {
  it("NONE：社区版，门控 90001", async () => {
    const s = await getLicenseState();
    expect(s.edition).toBe("COMMUNITY");
    await expect(assertEntpEnabled("MULTI_ORG")).rejects.toMatchObject({ code: 90001 });
    expect(await entpFeatureActive("SSO")).toBe(false);
  });
  it("VALID：全特性放行", async () => {
    __setState("license", { code: "x", status: "VALID", payload: payload() });
    const s = await getLicenseState();
    expect(s.edition).toBe("ENTERPRISE");
    expect(s.features!).toHaveLength(6);
    await expect(assertEntpEnabled("MSG_TEMPLATE")).resolves.toBeUndefined();
    expect(await entpFeatureActive("THEME")).toBe(true);
  });
  it("features 子集：未含特性 90005", async () => {
    __setState("license", {
      code: "x",
      status: "VALID",
      payload: payload({ features: ["MULTI_ORG"] }),
    });
    await expect(assertEntpEnabled("MULTI_ORG")).resolves.toBeUndefined();
    await expect(assertEntpEnabled("SSO")).rejects.toMatchObject({ code: 90005 });
  });
  it("EXPIRED：惰性降级按 NONE 门控", async () => {
    __setState("license", {
      code: "x",
      status: "VALID",
      payload: payload({ expiresAt: new Date(Date.now() - 5000).toISOString() }),
    });
    expect((await getLicenseState()).edition).toBe("COMMUNITY");
    await expect(assertEntpEnabled("MULTI_POOL")).rejects.toMatchObject({ code: 90001 });
  });
  it("用户上限四态：社区 30 / 无限 / maxUsers 封顶", async () => {
    expect(await effectiveUserLimit()).toBe(30); // config.userLimit 默认
    __setState("license", { code: "x", status: "VALID", payload: payload() });
    expect(await effectiveUserLimit()).toBe(Number.POSITIVE_INFINITY);
    __setState("license", { code: "x", status: "VALID", payload: payload({ maxUsers: 500 }) });
    expect(await effectiveUserLimit()).toBe(500);
  });
  it("addLicense：过期拒绝；合法覆盖落库", async () => {
    await expect(
      addLicense(
        signLicensePayload(payload({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
      ),
    ).rejects.toMatchObject({ code: 90004 });
    const s = await addLicense(signLicensePayload(payload()));
    expect(s.edition).toBe("ENTERPRISE");
  });
});
