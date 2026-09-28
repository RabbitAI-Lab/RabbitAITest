/** S-future EXEC-004 单测：k8s zod 矩阵 / 池更新与 token 合并 / 试连（mock safeFetch）/ 守卫口径 / DTO 占位字段。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, ErrCode, poolK8sConfigSchema, poolUpdateSchema } from "@rabbit/shared";
import { ipIsForbidden } from "@/server/safe-fetch";

vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __set: (k: string, v: unknown) => {
      state[k] = v;
    },
    __get: (k: string) => state[k],
    resourcePool: {
      findUnique: vi.fn(async () => state.pool ?? null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.pool = { ...(state.pool as object), ...data };
        return state.pool;
      }),
    },
    $transaction: undefined,
  };
  return { prisma, nextNum: vi.fn(async () => 1) };
});
vi.mock("@/server/safe-fetch", async () => {
  const impl = await vi.importActual<typeof import("@/server/safe-fetch")>("@/server/safe-fetch");
  return { ...impl, safeFetch: vi.fn() };
});
vi.mock("@/server/domains/system/audit.service", () => ({
  recordAudit: vi.fn(),
  flushAudit: vi.fn(async () => {}),
}));

import { prisma } from "@rabbit/db";
import { safeFetch } from "@/server/safe-fetch";
import { updatePool, testPoolK8sConnection, getPool } from "../pool.service";

const basePool = {
  id: "pool-1",
  name: "默认资源池",
  type: "NODE",
  isDefault: true,
  maxConcurrency: 4,
  status: "ACTIVE",
  lastBeatAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  nodes: [],
  config: {},
};
const setPool = (p: unknown) =>
  (prisma as unknown as { __set: (k: string, v: unknown) => void }).__set("pool", p);

const validK8s = {
  apiServer: "https://k8s.internal:6443",
  namespace: "rabbit-exec",
  token: "t0",
  image: "rabbitaitest/task-runner:latest",
};

beforeEach(() => {
  setPool({ ...basePool });
  vi.mocked(safeFetch).mockReset();
});

describe("EXEC-004-T1 k8s 配置 zod 矩阵", () => {
  it("合法通过（image 缺省补默认）", () => {
    const r = poolK8sConfigSchema.safeParse({
      apiServer: "https://a.b",
      namespace: "rabbit-exec",
      token: "x",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.image).toBe("rabbitaitest/task-runner:latest");
  });
  it.each([
    ["非 https", { ...validK8s, apiServer: "http://k8s.internal:6443" }],
    ["坏 namespace", { ...validK8s, namespace: "Rabbit_Exec" }],
    ["空 token", { ...validK8s, token: "" }],
    ["坏 image", { ...validK8s, image: "Bad Image!" }],
  ])("拒绝：%s", (_n, payload) => {
    expect(poolK8sConfigSchema.safeParse(payload).success).toBe(false);
  });
  it("poolUpdateSchema：type 枚举 + k8s token 可缺省", () => {
    expect(
      poolUpdateSchema.safeParse({
        type: "K8S",
        k8s: { apiServer: validK8s.apiServer, namespace: validK8s.namespace },
      }).success,
    ).toBe(true);
    expect(poolUpdateSchema.safeParse({ type: "DOCKER" }).success).toBe(false);
  });
});

describe("EXEC-004-T2/T4 池更新语义", () => {
  it("切 K8S 落 config；GET 回显 tokenSet=true 无明文 + loadTest/uiTest=false 占位", async () => {
    await updatePool("pool-1", { type: "K8S", k8s: validK8s });
    const view = await getPool("pool-1");
    expect(view.type).toBe("K8S");
    expect(view.k8s?.tokenSet).toBe(true);
    expect(JSON.stringify(view)).not.toContain('"t0"');
    expect(view.loadTest).toBe(false);
    expect(view.uiTest).toBe(false);
  });
  it("token 缺省=保留旧值；K8S→NODE→K8S 休眠往返", async () => {
    await updatePool("pool-1", { type: "K8S", k8s: validK8s });
    await updatePool("pool-1", {
      type: "K8S",
      k8s: { apiServer: "https://b.c", namespace: "ns2" },
    }); // 无 token
    const cfg = (
      prisma as unknown as {
        __get: (k: string) => { config: { token: string; apiServer: string } };
      }
    ).__get("pool").config;
    expect(cfg.token).toBe("t0");
    expect(cfg.apiServer).toBe("https://b.c");
    await updatePool("pool-1", { type: "NODE" });
    const cfgAfter = (
      prisma as unknown as { __get: (k: string) => { type: string; config: { token: string } } }
    ).__get("pool");
    expect(cfgAfter.type).toBe("NODE");
    expect(cfgAfter.config.token).toBe("t0"); // 休眠保留
  });
  it("缺完整配置切 K8S → 422·POOL_CONFIG_INVALID", async () => {
    await expect(updatePool("pool-1", { type: "K8S" })).rejects.toMatchObject({
      code: ErrCode.POOL_CONFIG_INVALID,
    });
  });
  it("纯并发编辑不动 config（NODE 现状兼容）", async () => {
    await updatePool("pool-1", { maxConcurrency: 8 });
    const p = (
      prisma as unknown as { __get: (k: string) => { maxConcurrency: number; config: object } }
    ).__get("pool");
    expect(p.maxConcurrency).toBe(8);
    expect(p.config).toEqual({});
  });
});

describe("EXEC-004-T2 试连（test=true 不落库）", () => {
  it("成功返回 k8sVersion 且不写库", async () => {
    vi.mocked(safeFetch).mockResolvedValue({
      ok: true,
      json: async () => ({ gitVersion: "v1.29.4" }),
    } as unknown as Response);
    const before = (prisma as unknown as { __get: (k: string) => unknown }).__get("pool");
    const r = await testPoolK8sConnection("pool-1", { type: "K8S", k8s: validK8s });
    expect(r.k8sVersion).toBe("v1.29.4");
    expect((prisma as unknown as { __get: (k: string) => unknown }).__get("pool")).toBe(before);
  });
  it("HTTP 错误 → 50423（502 语义）", async () => {
    vi.mocked(safeFetch).mockResolvedValue({ ok: false, status: 401 } as unknown as Response);
    await expect(testPoolK8sConnection("pool-1", { k8s: validK8s })).rejects.toMatchObject({
      code: ErrCode.POOL_K8S_UNREACHABLE,
    });
  });
  it("网络失败（SSRF 拦截/超时）→ 50423", async () => {
    vi.mocked(safeFetch).mockRejectedValue(new Error("SSRF guard: blocked 127.0.0.1"));
    await expect(testPoolK8sConnection("pool-1", { k8s: validK8s })).rejects.toMatchObject({
      code: ErrCode.POOL_K8S_UNREACHABLE,
    });
  });
});

describe("EXEC-004-T3 守卫口径（allowPrivateKeepLoopback）", () => {
  it.each([
    ["127.0.0.1 环回拒", "127.0.0.1", true],
    ["::1 环回拒", "::1", true],
    ["10.x 私网放行", "10.1.2.3", false],
    ["172.16-31 放行", "172.20.0.1", false],
    ["192.168 放行", "192.168.1.1", false],
    ["169.254 链路本地拒", "169.254.169.254", true],
    ["0.0.0.0 非路由拒", "0.0.0.0", true],
    ["ULA fd00:: 放行", "fd00::1", false],
    ["公网放行", "8.8.8.8", false],
  ])("%s", (_n, ip, blocked) => {
    expect(ipIsForbidden(ip, { allowPrivateKeepLoopback: true })).toBe(blocked);
  });
  it("默认口径回归（无新选项时私网仍拒——既有调用方语义不变）", () => {
    expect(ipIsForbidden("10.1.2.3", {})).toBe(true);
    expect(ipIsForbidden("127.0.0.1", { allowLoopback: true })).toBe(false);
  });
});
