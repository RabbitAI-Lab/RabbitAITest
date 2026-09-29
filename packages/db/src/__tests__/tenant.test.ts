/** INFRA-006 门面单测：ambient 路由 / $transaction 平铺与数组顺序 / admin 回落与逃逸 / 降级与断路观测。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  __setTenantRuntimeForTests,
  currentTenantContext,
  prismaAdmin,
  prismaFacade as prisma,
  runAsAdmin,
  runWithTenantContext,
  tenantRuntimeStatus,
} from "../tenant";

let tenantTxOpened = 0;
const order: string[] = [];

const fakeTx = {
  $executeRaw: vi.fn(async (..._a: unknown[]) => 0),
  $queryRaw: vi.fn(async (..._a: unknown[]) => []),
  functionalCase: {
    findMany: vi.fn(async (..._a: unknown[]) => [{ id: "c1" }]),
    create: vi.fn(async (..._a: unknown[]) => ({ id: "c2" })),
  },
} as unknown as Prisma.TransactionClient;

const fakeTenant = {
  $transaction: vi.fn(
    async (fn: (tx: Prisma.TransactionClient) => Promise<unknown>, _opts?: unknown) => {
      tenantTxOpened += 1;
      return fn(fakeTx);
    },
  ),
} as unknown as PrismaClient;

beforeEach(() => {
  tenantTxOpened = 0;
  order.length = 0;
  vi.clearAllMocks();
  __setTenantRuntimeForTests({ tenant: fakeTenant, degraded: false });
});

afterEach(() => {
  __setTenantRuntimeForTests(undefined);
  vi.restoreAllMocks();
});

describe("INFRA-006 门面路由", () => {
  it("租户上下文内：模型委托与 raw 路由进 ambient 事务", async () => {
    await runWithTenantContext("org-a", async () => {
      const rows = await prisma.functionalCase.findMany({ where: {} });
      expect(rows).toEqual([{ id: "c1" }]);
      await prisma.$queryRaw`SELECT 1`;
      expect(currentTenantContext()).toEqual({ orgId: "org-a" });
    });
    expect(fakeTx.functionalCase.findMany).toHaveBeenCalledOnce();
    expect(fakeTx.$queryRaw).toHaveBeenCalledOnce();
    expect(tenantTxOpened).toBe(1);
  });

  it("上下文外：$transaction 直连 admin（不触碰 tenant）", async () => {
    const spy = vi
      .spyOn(prismaAdmin, "$transaction")
      .mockImplementation(async () => "admin-mocked" as never);
    const out = await prisma.$transaction(async () => 42);
    expect(out).toBe("admin-mocked");
    expect(spy).toHaveBeenCalledOnce();
    expect(tenantTxOpened).toBe(0);
  });

  it("ambient 内 $transaction 回调平铺（不嵌套开新事务）", async () => {
    await runWithTenantContext("org-a", async () => {
      const seen = await prisma.$transaction(async (tx) => tx === fakeTx);
      expect(seen).toBe(true);
    });
    expect(tenantTxOpened).toBe(1);
  });

  it("ambient 内 $transaction 数组形式顺序执行", async () => {
    await runWithTenantContext("org-a", async () => {
      const ops = [
        (async () => {
          order.push("a");
          return 1;
        })(),
        (async () => {
          order.push("b");
          return 2;
        })(),
      ];
      const tx = prisma.$transaction as unknown as (a: unknown) => Promise<unknown>;
      const out = await tx(ops);
      expect(out).toEqual([1, 2]);
      expect(order).toEqual(["a", "b"]);
    });
    expect(tenantTxOpened).toBe(1);
  });

  it("runAsAdmin 在 ambient 内显式走 admin 通道", async () => {
    const spy = vi.spyOn(prismaAdmin, "$queryRaw").mockResolvedValue([] as never);
    await runWithTenantContext("org-a", async () => {
      await runAsAdmin(() => prisma.$queryRaw`SELECT 1`);
      expect(spy).toHaveBeenCalledOnce();
      expect(fakeTx.$queryRaw).not.toHaveBeenCalled();
    });
  });

  it("事务关闭后（fire-and-forget 越界）回落 admin", async () => {
    const spy = vi.spyOn(prismaAdmin, "$queryRaw").mockResolvedValue([] as never);
    let late: () => Promise<unknown> = () => Promise.resolve();
    await runWithTenantContext("org-a", async () => {
      late = () => prisma.$queryRaw`SELECT 1`;
    });
    await late();
    expect(spy).toHaveBeenCalledOnce();
    expect(tenantTxOpened).toBe(1);
    expect(currentTenantContext()).toBeUndefined();
  });

  it("嵌套 runWithTenantContext 沿用外层（组织一致时零副作用）", async () => {
    await runWithTenantContext("org-a", async () => {
      await runWithTenantContext("org-a", async () => {
        expect(currentTenantContext()).toEqual({ orgId: "org-a" });
      });
    });
    expect(tenantTxOpened).toBe(1);
  });

  it("降级模式：不开租户事务，状态可观测 active=false", async () => {
    __setTenantRuntimeForTests({ tenant: prismaAdmin, degraded: true, reason: "test" });
    const marker = await runWithTenantContext("org-a", async () => "ok");
    expect(marker).toBe("ok");
    expect(tenantTxOpened).toBe(0);
    const st = await tenantRuntimeStatus();
    expect(st.active).toBe(false);
    expect(st.reason).toBe("test");
  });
});
