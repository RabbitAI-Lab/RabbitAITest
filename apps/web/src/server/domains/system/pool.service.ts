/** EXEC-002 资源池（公开面）：默认池详情/并发编辑（心跳下发）/节点在线态判定。
 * S9 ENTP-006：多池 CRUD（create/updateEntp/delete/assertExecutable——License MULTI_POOL 门控在路由层）。
 * S-future EXEC-004：默认池 type NODE↔K8S 切换 + k8s 四项配置（config Json 载体，token 只写不读）+
 * 连通性测试（safe-fetch 池守卫口径：https 强制、环回/非路由拒、私网放行）；调度面零变化（两型同构单 exec 队列）。 */
import { DomainError, ErrCode, config, poolK8sConfigSchema } from "@rabbit/shared";
import type {
  PoolK8sConfig,
  PoolK8sConfigView,
  PoolUpdateInput,
  PoolCreateInput,
  PoolEntpUpdateInput,
} from "@rabbit/shared";
import type { Agent } from "undici";
import { outboundDispatcher } from "@/server/safe-fetch";
import { recordAudit } from "@/server/domains/system/audit.service";
import { prisma } from "@rabbit/db";
import type { Prisma } from "@rabbit/db";

const BEAT_INTERVAL_MS = 10_000;
const OFFLINE_AFTER_BEATS = 3;
/** 契约 v6 引擎版本（心跳版本协商：不一致节点标 UNMATCHED 仅供展示，不下发新类型任务） */
const EXPECTED_ENGINE_VERSION = "0.6.0"; // 与 apps/engine runner/worker.ts VERSION 同步（契约 v6：+ui_validate 命令、ui_case/ui_batch script 模式、ui-trace 帧；升版须两端同改——S13 教训：漏改此常量致 CI 全分片节点 UNMATCHED）
const K8S_TEST_TIMEOUT_MS = 5_000;

interface NodeRow {
  nodeId: string;
  version: string;
  slots: number;
  busy?: number;
  ts: number;
}

interface PoolK8sStored {
  apiServer?: string;
  namespace?: string;
  token?: string;
  image?: string;
}

export async function listPools() {
  const pools = await prisma.resourcePool.findMany({ orderBy: { createdAt: "asc" } });
  return {
    total: pools.length,
    items: pools.map((p) => serializePool(p.nodes as unknown as NodeRow[], p)),
  };
}

export async function getPool(id: string) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  return serializePool(pool.nodes as unknown as NodeRow[], pool);
}

/** k8s 配置摘要：休眠（type=NODE）也回显（EXEC-004 §2 免重填语义；激活态由 type 表征——§8 勘误 3） */
function k8sView(p: { config: unknown }): PoolK8sConfigView | null {
  const c = (p.config ?? {}) as PoolK8sStored;
  if (!c.apiServer) return null;
  return {
    apiServer: c.apiServer,
    namespace: c.namespace ?? "",
    image: c.image ?? "rabbitaitest/task-runner:latest",
    tokenSet: typeof c.token === "string" && c.token.length > 0,
  };
}

function serializePool(
  nodes: NodeRow[],
  p: {
    id: string;
    name: string;
    type: string;
    isDefault: boolean;
    maxConcurrency: number;
    status: string;
    lastBeatAt: Date | null;
    updatedAt: Date;
    orgScope?: unknown;
    config: unknown;
  },
) {
  const now = Date.now();
  const staleCut = now - BEAT_INTERVAL_MS * OFFLINE_AFTER_BEATS * 1000;
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    isDefault: p.isDefault,
    maxConcurrency: p.maxConcurrency,
    status: p.status,
    orgScope: p.orgScope ?? "ALL", // S9 ENTP-006：ALL | [orgId]
    canDelete: !p.isDefault, // 默认池保护（社区版单池语义）；有历史任务的池删除时再校验
    lastBeatAt: p.lastBeatAt?.toISOString() ?? null,
    // S-future EXEC-004 §4：k8s 配置摘要（token 永不回明文）
    k8s: k8sView(p),
    // S-future LOAD-001/UIT-001 §4：企业版方向占位字段（对齐基线资源池 DTO loadTest/uiTest；恒 false）
    loadTest: false,
    uiTest: false,
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      version: n.version,
      slots: n.slots,
      busy: n.busy ?? 0,
      lastBeatAt: new Date(n.ts).toISOString(),
      state:
        n.ts < staleCut
          ? "OFFLINE"
          : n.version !== EXPECTED_ENGINE_VERSION
            ? "UNMATCHED"
            : "ONLINE",
    })),
  };
}

/** 校验+合并 k8s 配置（保存口径：token 缺省=保留旧值；EXEC-004 §2 休眠语义——K8S→NODE 不清配置） */
function mergeK8sConfig(stored: unknown, input: PoolUpdateInput): PoolK8sConfig {
  const old = (stored ?? {}) as PoolK8sStored;
  const k8s = input.k8s;
  if (!k8s) {
    if (!old.apiServer || !old.namespace || !old.token)
      throw new DomainError(
        ErrCode.POOL_CONFIG_INVALID,
        "K8S 型池需要完整 k8s 配置（apiServer/namespace/token）",
      );
    return {
      apiServer: old.apiServer,
      namespace: old.namespace,
      token: old.token,
      image: old.image ?? "rabbitaitest/task-runner:latest",
    };
  }
  const token = k8s.token && k8s.token.length > 0 ? k8s.token : old.token;
  if (!token) throw new DomainError(ErrCode.POOL_CONFIG_INVALID, "K8S 型池 token 不能为空");
  const candidate = {
    apiServer: k8s.apiServer,
    namespace: k8s.namespace,
    token,
    image: k8s.image ?? old.image ?? "rabbitaitest/task-runner:latest",
  };
  // 复用 shared zod 的约束（https/RFC1123）——双端同源校验
  const parsed = poolK8sConfigSchema.safeParse(candidate);
  if (!parsed.success)
    throw new DomainError(
      ErrCode.POOL_CONFIG_INVALID,
      parsed.error.issues[0]?.message ?? "k8s 配置非法",
    );
  return parsed.data;
}

export async function updatePool(id: string, input: PoolUpdateInput) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  const data: {
    maxConcurrency?: number;
    type?: string;
    config?: Prisma.InputJsonValue;
  } = {};
  if (input.maxConcurrency !== undefined) {
    if (input.maxConcurrency < 2 || input.maxConcurrency > 64)
      throw new DomainError(ErrCode.VALIDATION_FAILED, "最大并发取值 2-64");
    data.maxConcurrency = input.maxConcurrency;
  }
  // 显式带 k8s 或切到 K8S：校验+落 config；K8S→NODE 不清配置（休眠保留）；纯并发编辑不动 config
  if (input.k8s || input.type === "K8S")
    data.config = mergeK8sConfig(pool.config, input) as unknown as Prisma.InputJsonValue;
  if (input.type) data.type = input.type;
  if (Object.keys(data).length > 0) {
    await prisma.resourcePool.update({ where: { id: pool.id }, data });
  }
  return getPool(pool.id);
}

// ── S9 ENTP-006：多池 CRUD（License MULTI_POOL 门控在路由层）──

export async function createPool(input: PoolCreateInput) {
  const dup = await prisma.resourcePool.findFirst({
    where: { name: input.name },
    select: { id: true },
  });
  if (dup) throw new DomainError(ErrCode.POOL_NAME_EXISTS, "资源池名称已存在");
  const created = await prisma.resourcePool.create({
    data: {
      name: input.name,
      type: input.type,
      maxConcurrency: input.maxConcurrency,
      orgScope: input.orgScope as unknown as object,
      isDefault: false,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  return getPool(created.id);
}

export async function updatePoolEntp(id: string, input: PoolEntpUpdateInput) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (input.name && input.name !== pool.name) {
    const dup = await prisma.resourcePool.findFirst({
      where: { name: input.name },
      select: { id: true },
    });
    if (dup) throw new DomainError(ErrCode.POOL_NAME_EXISTS, "资源池名称已存在");
  }
  if (input.status === "DISABLED" && pool.isDefault)
    throw new DomainError(ErrCode.POOL_DEFAULT_UNDISABLEABLE, "默认资源池不可禁用");
  if (input.maxConcurrency !== undefined && (input.maxConcurrency < 2 || input.maxConcurrency > 64))
    throw new DomainError(ErrCode.VALIDATION_FAILED, "最大并发取值 2-64");
  await prisma.resourcePool.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.maxConcurrency !== undefined ? { maxConcurrency: input.maxConcurrency } : {}),
      ...(input.orgScope !== undefined ? { orgScope: input.orgScope as unknown as object } : {}),
      ...(input.status ? { status: input.status } : {}),
    },
  });
  return getPool(id);
}

export async function deletePool(id: string) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (pool.isDefault)
    throw new DomainError(ErrCode.POOL_DEFAULT_UNDELETABLE, "默认资源池不可删除（社区版单池保护）");
  const taskCount = await prisma.execTask.count({ where: { poolId: id } });
  if (taskCount > 0) throw new DomainError(ErrCode.POOL_HAS_TASKS, "资源池存在历史任务，不可删除");
  await prisma.resourcePool.delete({ where: { id } });
  return { id };
}

/** 执行入口池校验（ENTP-006）：存在 + ACTIVE + 应用组织含 orgId。 */
export async function assertPoolExecutable(
  poolId: string | null | undefined,
  orgId: string | null,
): Promise<string | null> {
  if (!poolId || poolId === config.defaultPoolId) return config.defaultPoolId;
  const pool = await prisma.resourcePool.findUnique({ where: { id: poolId } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  if (pool.status !== "ACTIVE")
    throw new DomainError(ErrCode.POOL_DISABLED, "资源池已禁用，不可执行");
  const scope = pool.orgScope;
  if (orgId && Array.isArray(scope) && !scope.includes(orgId))
    throw new DomainError(ErrCode.POOL_ORG_NOT_ALLOWED, "资源池未应用到当前组织");
  return pool.id;
}

/** K8S apiServer 探测 dispatcher（模块级实例，v0.7.1 口径：调用方持 dispatcher 直连 fetch——
 * 守卫口径=私网放行、环回/链路本地/非路由拒（管理员配置面）；测试栈 POOL_K8S_ALLOW_LOOPBACK=1 换环回豁免实例） */
const poolK8sDispatcher = outboundDispatcher({ allowPrivateKeepLoopback: true });
const poolK8sLoopbackDispatcher = outboundDispatcher({
  allowPrivateKeepLoopback: true,
  allowLoopback: true,
});

/** 连通性测试（EXEC-004 §2：test=true 只试连不落库；探测 apiServer /version）。 */
export async function testPoolK8sConnection(id: string, input: PoolUpdateInput) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  const k8s = mergeK8sConfig(pool.config, input);
  const url = `${k8s.apiServer.replace(/\/+$/, "")}/version`;
  const allowLoopback = process.env.POOL_K8S_ALLOW_LOOPBACK === "1";
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${k8s.token}` },
      signal: AbortSignal.timeout(K8S_TEST_TIMEOUT_MS),
      dispatcher: allowLoopback ? poolK8sLoopbackDispatcher : poolK8sDispatcher,
    } as RequestInit & { dispatcher: Agent });
  } catch (err) {
    recordAudit({
      userId: null,
      scope: "system",
      action: "system.pool.k8s-test",
      objectType: "resource_pool",
      objectId: id,
      detail: { url, outcome: "blocked-or-unreachable", reason: (err as Error).message },
    });
    throw new DomainError(
      ErrCode.POOL_K8S_UNREACHABLE,
      `apiServer 连接失败：${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    recordAudit({
      userId: null,
      scope: "system",
      action: "system.pool.k8s-test",
      objectType: "resource_pool",
      objectId: id,
      detail: { url, outcome: "http-error", status: res.status },
    });
    throw new DomainError(ErrCode.POOL_K8S_UNREACHABLE, `apiServer 响应异常（HTTP ${res.status}）`);
  }
  const body = (await res.json().catch(() => ({}))) as { gitVersion?: string };
  recordAudit({
    userId: null,
    scope: "system",
    action: "system.pool.k8s-test",
    objectType: "resource_pool",
    objectId: id,
    detail: { url, outcome: "ok", k8sVersion: body.gitVersion ?? "unknown" },
  });
  return { k8sVersion: body.gitVersion ?? "unknown" };
}

export const DEFAULT_POOL_ID = config.defaultPoolId;
