/** EXEC-002 资源池（公开面）：默认池详情/并发编辑（心跳下发）/节点在线态判定。新建删除=ENTP-006 不提供端点。
 * S-future EXEC-004：默认池 type NODE↔K8S 切换 + k8s 四项配置（config Json 载体，token 只写不读）+
 * 连通性测试（safe-fetch 池守卫口径：https 强制、环回/非路由拒、私网放行）；调度面零变化（两型同构单 exec 队列）。 */
import { DomainError, ErrCode, config, poolK8sConfigSchema } from "@rabbit/shared";
import type { PoolK8sConfig, PoolK8sConfigView, PoolUpdateInput } from "@rabbit/shared";
import { safeFetch } from "@/server/safe-fetch";
import { recordAudit } from "@/server/domains/system/audit.service";
import { prisma } from "@rabbit/db";
import type { Prisma } from "@rabbit/db";

const BEAT_INTERVAL_MS = 10_000;
const OFFLINE_AFTER_BEATS = 3;
/** 契约 v4 引擎版本（心跳版本协商：不一致节点标 UNMATCHED 仅供展示，不下发新类型任务） */
const EXPECTED_ENGINE_VERSION = "0.4.0"; // 与 apps/engine runner/worker.ts VERSION 同步（契约 v4 plan 命令；升版须两端同改）
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
    canDelete: false, // 标准版单默认池不可删（License 门控 ENTP-006）
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

/** 连通性测试（EXEC-004 §2：test=true 只试连不落库；探测 apiServer /version）。
 * 守卫口径=私网放行、环回/链路本地/非路由拒（管理员配置面）；测试栈 POOL_K8S_ALLOW_LOOPBACK=1 叠加豁免环回。 */
export async function testPoolK8sConnection(id: string, input: PoolUpdateInput) {
  const pool = await prisma.resourcePool.findUnique({ where: { id } });
  if (!pool) throw new DomainError(ErrCode.POOL_NOT_FOUND, "资源池不存在");
  const k8s = mergeK8sConfig(pool.config, input);
  const url = `${k8s.apiServer.replace(/\/+$/, "")}/version`;
  const allowLoopback = process.env.POOL_K8S_ALLOW_LOOPBACK === "1";
  let res: Response;
  try {
    res = await safeFetch(
      url,
      {
        headers: { Authorization: `Bearer ${k8s.token}` },
        signal: AbortSignal.timeout(K8S_TEST_TIMEOUT_MS),
      },
      { allowPrivateKeepLoopback: true, allowLoopback },
    );
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
