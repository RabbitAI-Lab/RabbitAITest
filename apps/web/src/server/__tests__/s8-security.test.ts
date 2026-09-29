/** S8 QA-002 安全加固单测：safe-fetch 连接期守卫矩阵 / CSRF 判定矩阵 / 登录限流窗口语义。 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
import { lookup } from "node:dns/promises";
const lookupMock = vi.mocked(lookup);

// rate-limit 依赖 redis 连接——mock 掉（窗口语义在内存里模拟固定窗口）
const store = new Map<string, number>();
vi.mock("@/server/redis", () => ({
  redis: () => ({
    incr: async (k: string) => {
      const n = (store.get(k) ?? 0) + 1;
      store.set(k, n);
      return n;
    },
    get: async (k: string) => (store.has(k) ? String(store.get(k)) : null),
    del: async (k: string) => store.delete(k),
    pexpire: async () => 1,
  }),
}));

import { createGuardLookup, ipIsForbidden } from "../safe-fetch";
import { csrfRejected } from "../csrf";
import { rateCount, rateLimit, rateReset } from "../rate-limit";

describe("safe-fetch ipIsForbidden（连接期黑名单矩阵）", () => {
  const cases: Array<[string, boolean]> = [
    ["93.184.216.34", false], // 公网
    ["1.1.1.1", false],
    ["10.1.2.3", true], // 10/8
    ["172.16.0.1", true], // 172.16/12
    ["172.31.255.254", true],
    ["172.32.0.1", false], // 段外
    ["192.168.1.1", true],
    ["169.254.169.254", true], // 云元数据
    ["0.0.0.0", true],
    ["100.64.0.1", true], // CGNAT
    ["127.0.0.1", true], // 环回（默认拦）
    ["::1", true],
    ["fe80::1", true], // 链路本地
    ["fc00::1", true], // ULA
    ["::ffff:10.0.0.1", true], // v4-mapped
  ];
  for (const [ip, blocked] of cases) {
    it(`${ip} → ${blocked ? "拦截" : "放行"}`, () => {
      expect(ipIsForbidden(ip, {})).toBe(blocked);
    });
  }
  it("allowLoopback：仅环回豁免，私网仍拦（AI 测试栈口径）", () => {
    expect(ipIsForbidden("127.0.0.1", { allowLoopback: true })).toBe(false);
    expect(ipIsForbidden("10.0.0.1", { allowLoopback: true })).toBe(true);
  });
  it("allowPrivate：全部豁免（swagger/webhook 测试栈口径）", () => {
    expect(ipIsForbidden("10.0.0.1", { allowPrivate: true })).toBe(false);
    expect(ipIsForbidden("169.254.169.254", { allowPrivate: true })).toBe(false);
  });
});

describe("createGuardLookup（连接期校验——DNS rebinding 收口）", () => {
  beforeEach(() => {
    vi.mocked(lookupMock).mockReset();
  });

  it("公网解析 → 放行并返回地址（校验与建连同源）", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);
    const cb = vi.fn();
    createGuardLookup({})("api.example.com", {}, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(cb.mock.calls[0]![0]).toBeNull();
    expect(cb.mock.calls[0]![1]).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("多记录含私网 → 拒绝（err 非空，建连不会发生）", async () => {
    lookupMock.mockResolvedValue([
      { address: "93.184.216.34", family: 4 },
      { address: "192.168.0.5", family: 4 },
    ] as never);
    const cb = vi.fn();
    createGuardLookup({})("rebind.example.com", {}, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(cb.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(String(cb.mock.calls[0]![0])).toContain("192.168.0.5");
  });

  it("allowLoopback：环回地址放行（AI mock 供应商）", async () => {
    lookupMock.mockResolvedValue([{ address: "127.0.0.1", family: 4 }] as never);
    const cb = vi.fn();
    createGuardLookup({ allowLoopback: true })("localhost", {}, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(cb.mock.calls[0]![0]).toBeNull();
  });

  it("解析失败 → 错误透传（不静默放行）", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND") as never);
    const cb = vi.fn();
    createGuardLookup({})("nx.example.com", {}, cb);
    await vi.waitFor(() => expect(cb).toHaveBeenCalled());
    expect(cb.mock.calls[0]![0]).toBeInstanceOf(Error);
  });
});

describe("csrfRejected（QA-002 CSRF 判定矩阵）", () => {
  const base = {
    method: "POST",
    hasAuthorization: false,
    hasSessionCookie: true,
    origin: "http://localhost:3000",
    referer: null,
    host: "localhost:3000",
  };
  it("同源 POST → 放行", () => expect(csrfRejected(base)).toBe(false));
  it("跨源 Origin → 拒绝", () =>
    expect(csrfRejected({ ...base, origin: "http://evil.example" })).toBe(true));
  it("Origin 缺失 Referer 同源 → 放行", () =>
    expect(csrfRejected({ ...base, origin: null, referer: "http://localhost:3000/cases" })).toBe(
      false,
    ));
  it("Origin 与 Referer 均缺失 → 放行（SameSite=Lax 第一层；JMeter/SDK 兼容）", () =>
    expect(csrfRejected({ ...base, origin: null, referer: null })).toBe(false));
  it("畸形 Origin → 拒绝", () => expect(csrfRejected({ ...base, origin: "not a url" })).toBe(true));
  it("GET/HEAD/OPTIONS → 放行", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"])
      expect(csrfRejected({ ...base, method: m })).toBe(false);
  });
  it("Authorization（APIKEY）→ 放行（非 cookie 认证）", () =>
    expect(csrfRejected({ ...base, hasAuthorization: true, origin: "http://evil.example" })).toBe(
      false,
    ));
  it("无会话 cookie → 放行（未认证面 401 由 guard 出）", () =>
    expect(csrfRejected({ ...base, hasSessionCookie: false, origin: "http://evil.example" })).toBe(
      false,
    ));
  it("代理：x-forwarded-host 优先", () =>
    expect(csrfRejected({ ...base, host: "public.example" })).toBe(true));
});

describe("登录限流窗口语义（rateCount/rateLimit/rateReset）", () => {
  it("5 过 6 拒；成功清零后恢复", async () => {
    const id = `it-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < 5; i++) {
      const r = await rateLimit("login-fail", id, 5, 600);
      expect(r.allowed).toBe(true);
    }
    expect(await rateCount("login-fail", id, 600)).toBe(5);
    const sixth = await rateLimit("login-fail", id, 5, 600);
    expect(sixth.allowed).toBe(false);
    await rateReset("login-fail", id, 600);
    expect(await rateCount("login-fail", id, 600)).toBe(0);
    const again = await rateLimit("login-fail", id, 5, 600);
    expect(again.allowed).toBe(true);
  });
});
