import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

/**
 * INFRA-006：RLS 租户纵深防御运行时（租户=组织）。
 *
 * 双客户端：admin（DATABASE_URL 原样，表 owner 免 RLS——系统/个人/分享/内部回调/job/seed 通道，
 * 行为与历史一致）+ tenant（rabbit_tenant 非 owner 角色，RLS 生效）。
 * `prisma` 导出为门面（Proxy）：租户上下文内（withProjectScope/withOrgScope →
 * runWithTenantContext）模型委托/$transaction/raw 路由进请求事务；上下文外直连 admin。
 * 服务层零改动（$transaction 平铺并入请求事务——Prisma 不支持嵌套交互事务）。
 *
 * 降级：外部库无 CREATEROLE/策略未应用 → tenant=admin、RLS 不生效，一次性 warn，
 * 行为回到纯应用层防线（与引入本模块前一致），不阻断启动。
 */

interface TenantStore {
  tx: Prisma.TransactionClient;
  orgId: string;
  closed: boolean;
}

const als = new AsyncLocalStorage<TenantStore>();

/** 全仓 admin 客户端（globalThis 缓存防 Next 多 chunk 多连接池，见 index.ts 注释）。
 * INFRA-007：启用 query 事件（metrics-db 慢查询计量订阅；warn/error 保持 stdout 不变）。 */
const g = globalThis as unknown as { __rabbitPrismaAdmin?: PrismaClient };
export const prismaAdmin = (g.__rabbitPrismaAdmin ??
  new PrismaClient({
    log: [
      { level: "query", emit: "event" },
      { level: "warn", emit: "stdout" },
      { level: "error", emit: "stdout" },
    ],
  })) as PrismaClient;
g.__rabbitPrismaAdmin = prismaAdmin;

const RAW_OPS = new Set(["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]);

export interface TenantRuntime {
  tenant: PrismaClient;
  degraded: boolean;
  reason?: string;
}

let runtimePromise: Promise<TenantRuntime> | undefined;
let warnedClosed = false;
let warnedNested = false;

function warnOnce(key: "closed" | "nested", msg: string): void {
  if (key === "closed" && warnedClosed) return;
  if (key === "nested" && warnedNested) return;
  if (key === "closed") warnedClosed = true;
  else warnedNested = true;
  console.warn(`[db/tenant] ${msg}`);
}

/** 以 admin 连接做幂等角色引导（embedded/CI：随机口令；外部库：RABBIT_PG_TENANT_PASSWORD）。
 *  经 prismaAdmin raw SQL 执行（免引 pg 依赖，Next 服务端打包零额外解析）。 */
async function bootstrapTenantRole(): Promise<string> {
  const password = process.env.RABBIT_PG_TENANT_PASSWORD ?? randomBytes(24).toString("hex");
  // Prisma tagged $executeRaw 静态拒绝 ALTER（DDL 不支持参数化）→ 须 Unsafe 字符串。
  // 口令仅允许 [A-Za-z0-9_-]{8,64}（随机 hex 天然满足；env 口令越界即降级），杜绝拼接注入。
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(password)) {
    throw new Error("RABBIT_PG_TENANT_PASSWORD 仅允许 8-64 位 [A-Za-z0-9_-]");
  }
  await prismaAdmin.$executeRawUnsafe(
    `DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rabbit_tenant') THEN
        CREATE ROLE rabbit_tenant LOGIN;
      END IF;
    END $$;`,
  );
  await prismaAdmin.$executeRawUnsafe(`ALTER ROLE rabbit_tenant LOGIN PASSWORD '${password}'`);
  // 库名经服务端 current_database() + format('%I') 解析，客户端零拼接
  await prismaAdmin.$executeRawUnsafe(
    `DO $$ BEGIN
      EXECUTE format('GRANT CONNECT ON DATABASE %I TO rabbit_tenant', current_database());
    END $$;`,
  );
  await prismaAdmin.$executeRawUnsafe("GRANT USAGE ON SCHEMA public TO rabbit_tenant");
  await prismaAdmin.$executeRawUnsafe(
    "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rabbit_tenant",
  );
  await prismaAdmin.$executeRawUnsafe(
    "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rabbit_tenant",
  );
  await prismaAdmin.$executeRawUnsafe(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rabbit_tenant",
  );
  await prismaAdmin.$executeRawUnsafe(
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rabbit_tenant",
  );
  const pol = await prismaAdmin.$queryRaw<
    { n: number }[]
  >`SELECT count(*)::int AS n FROM pg_policy WHERE polname = 'tenant_isolation'`;
  if ((pol[0]?.n ?? 0) === 0) {
    throw new Error("RLS 策略未应用（pg_policy 无 tenant_isolation）——请先 migrate deploy");
  }
  return password;
}

/** 进程级一次：成功 → tenant 客户端；失败 → 降级（tenant=admin）。 */
export function ensureTenantRuntime(): Promise<TenantRuntime> {
  runtimePromise ??= (async () => {
    try {
      const password = await bootstrapTenantRole();
      const base = new URL(process.env.DATABASE_URL ?? "");
      base.username = "rabbit_tenant";
      base.password = password;
      base.searchParams.set("connection_limit", "20");
      base.searchParams.set("pool_timeout", "20");
      const tenant = new PrismaClient({ datasourceUrl: base.toString() });
      return { tenant, degraded: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[db/tenant] RLS 降级模式（纯应用层防线，行为同历史）：${reason}`);
      return { tenant: prismaAdmin, degraded: true, reason };
    }
  })();
  return runtimePromise;
}

/** 可观测出口（排障/健康巡检用）。 */
export async function tenantRuntimeStatus(): Promise<TenantRuntime & { active: boolean }> {
  const rt = await ensureTenantRuntime();
  return { ...rt, active: !rt.degraded };
}

/** 内部测试钩子：替换运行时（仅 vitest 用，勿在生产路径调用）。 */
export function __setTenantRuntimeForTests(rt: TenantRuntime | undefined): void {
  runtimePromise = rt ? Promise.resolve(rt) : undefined;
}

function bindAdminProp(prop: string): unknown {
  const v = (prismaAdmin as unknown as Record<string, unknown>)[prop];
  return typeof v === "function" ? v.bind(prismaAdmin) : v;
}

function ambientTransaction(arg: unknown, opts?: unknown): Promise<unknown> {
  const store = als.getStore();
  if (!store || store.closed) {
    if (store?.closed)
      warnOnce(
        "closed",
        "事务已关闭后的 $transaction 回落 admin（fire-and-forget 路径应改用 runAsAdmin）",
      );
    return (prismaAdmin.$transaction as (a: unknown, o?: unknown) => Promise<unknown>)(arg, opts);
  }
  if (typeof arg === "function") {
    // 平铺并入请求事务（Prisma 交互事务不可嵌套；回调内的查询本就路由进 ambient）
    return (arg as (tx: Prisma.TransactionClient) => unknown)(store.tx) as Promise<unknown>;
  }
  if (Array.isArray(arg)) {
    // 数组形式：元素已由门面路由进 ambient（Prisma 数组事务语义即顺序执行）
    return (async () => {
      const out: unknown[] = [];
      for (const op of arg) out.push(await op);
      return out;
    })();
  }
  throw new Error("不支持的 $transaction 形态");
}

/** 门面：有租户上下文 → ambient 事务；无/已关闭 → admin（closed 回落告警一次）。 */
export const prismaFacade = new Proxy(prismaAdmin, {
  get(target, prop, receiver) {
    if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
    const store = als.getStore();
    if (!store) return bindAdminProp(prop);
    if (store.closed) {
      warnOnce("closed", "事务已关闭后的查询回落 admin（fire-and-forget 路径应改用 runAsAdmin）");
      return bindAdminProp(prop);
    }
    if (prop === "$transaction") return ambientTransaction;
    const txStore = store.tx as unknown as Record<string, unknown>;
    if (RAW_OPS.has(prop)) {
      return typeof txStore[prop] === "function" ? txStore[prop] : bindAdminProp(prop);
    }
    // 模型委托在 Prisma 上是对象（非函数）：tx 上存在即路由（委托/raw 均覆盖）
    if (txStore[prop] !== undefined) return txStore[prop];
    return bindAdminProp(prop);
  },
}) as PrismaClient;

/**
 * 组织/项目作用域包裹（guard 调用）：一次请求一条 tenant 交互事务，
 * set_config('app.tenant_id') 事务级注入后执行 fn；fn 内全部 prisma 门面查询经 RLS 过滤。
 */
export async function runWithTenantContext<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const outer = als.getStore();
  if (outer) {
    if (outer.orgId !== orgId) {
      warnOnce(
        "nested",
        `租户上下文嵌套且组织不一致（外层 ${outer.orgId}，请求 ${orgId}），沿用外层`,
      );
    }
    return fn();
  }
  const rt = await ensureTenantRuntime();
  if (rt.degraded) return fn();
  const store: TenantStore = {
    tx: undefined as unknown as Prisma.TransactionClient,
    orgId,
    closed: false,
  };
  try {
    return await rt.tenant.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${orgId}, true)`;
        store.tx = tx;
        return await als.run(store, fn);
      },
      { timeout: 60_000, maxWait: 5_000 },
    );
  } finally {
    store.closed = true;
  }
}

/** 管理通道逃逸：租户上下文内显式走 admin（审计 flush/系统级副作用等 fire-and-forget 路径）。 */
export async function runAsAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const store = als.getStore();
  if (!store || store.closed) return fn();
  return await als.exit(async () => fn());
}

/** 测试/工具出口：直接读当前租户上下文。 */
export function currentTenantContext(): { orgId: string } | undefined {
  const store = als.getStore();
  return store && !store.closed ? { orgId: store.orgId } : undefined;
}
