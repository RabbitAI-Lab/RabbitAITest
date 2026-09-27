/**
 * 本地执行 CLI（验收标准 6；EXEC-002 勘误 2：改经 BullMQ 入队，与 web 同一执行路径）：
 *   pnpm --filter engine local -- --url https://httpbin.org/get --expect-status 200 \
 *        --task-id <uuid> [--timeout-ms 60000]
 * 前提：engine worker 已运行（pnpm --filter engine start）——CLI 只入队并轮询事件流取终态，
 * 回调/事件写回均由 worker 进程完成（单一执行路径，本地与平台行为一致）。
 */
interface CliArgs {
  url: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "HEAD" | "CONNECT";
  expectStatus: string;
  taskId: string;
  timeoutMs: number;
}

/**
 * 探测目标守卫（本地 CLI 语义=操作者显式指定目标；仍封禁 SSRF 经典面）：
 * 云元数据端点 / 链路本地段 / CGNAT 内网段一律拒绝——即便参数被脚本注入也打不到凭据面。
 */
const BLOCKED_HOST_PATTERNS = [
  /^169\.254\./, // 链路本地（含 AWS/GCP/Azure 元数据 169.254.169.254）
  /^metadata\./i, // metadata.google.internal 等
  /^fd00:ec2/i, // AWS IPv6 元数据
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 段（常作内网服务位）
];

function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

function assertSafeProbeTarget(raw: string): void {
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    fail(`--url 不是合法 URL：${raw}`);
  }
  if (BLOCKED_HOST_PATTERNS.some((re) => re.test(host))) {
    fail(`探测目标被本地 CLI 安全策略封禁（内网/元数据段）：${host}`);
  }
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const get = (k: string, fallback?: string): string => {
    const i = args.indexOf(`--${k}`);
    const v = i >= 0 ? args[i + 1] : undefined;
    return v ?? fallback ?? "";
  };
  const url = get("url", "https://httpbin.org/get");
  if (!/^https?:\/\//.test(url)) {
    fail(
      "用法: --url <http-url> [--method GET] [--expect-status 200] --task-id <uuid> [--timeout-ms 60000]",
    );
  }
  assertSafeProbeTarget(url);
  const timeoutMs = Number(get("timeout-ms", "60000"));
  return {
    url,
    method: (get("method", "GET") || "GET") as CliArgs["method"],
    expectStatus: get("expect-status", "200"),
    taskId: get("task-id") || crypto.randomUUID(),
    timeoutMs: Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 1000), 120000) : 60000,
  };
}

/** 轮询事件流直至 task-final（与 SSE 同源；worker 写入）。 */
async function waitFinal(
  redis: import("ioredis").default,
  streamKey: string,
  budgetMs: number,
): Promise<"success" | "failed" | "stopped" | "timeout"> {
  const deadline = Date.now() + budgetMs;
  let last = "-";
  while (Date.now() < deadline) {
    const exclusiveStart = last === "-" ? "-" : `(${last}`;
    const raw = await redis.xrange(streamKey, exclusiveStart, "+");
    for (const [id, fields] of raw) {
      last = id;
      const json = fields[fields.indexOf("data") + 1];
      if (!json) continue;
      try {
        const frame = JSON.parse(json as string) as { type?: string; outcome?: string };
        if (frame.type === "task-final") {
          return (frame.outcome as "success" | "failed" | "stopped") ?? "failed";
        }
      } catch {
        // 跳过坏帧
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return "timeout";
}

async function main() {
  const args = parseArgs();
  const { config } = await import("@rabbit/shared");
  const Redis = (await import("ioredis")).default;
  const { Queue } = await import("bullmq");
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(config.execQueueName, { connection: redis.duplicate() });
  await queue.add(
    "exec",
    {
      taskId: args.taskId,
      projectId: "00000000-0000-0000-0000-000000000000",
      type: "api_debug" as const,
      request: {
        method: args.method,
        url: args.url,
        headers: [],
        query: [],
        body: { kind: "none" as const },
        auth: { kind: "none" as const },
        timeoutMs: args.timeoutMs,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      },
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: args.expectStatus }],
      pre: [],
      post: [],
      extracts: [],
    },
    { jobId: args.taskId, attempts: 1 },
  );
  await queue.close();
  console.log(`[local] 已入队 taskId=${args.taskId}，等待 worker 执行…`);
  const outcome = await waitFinal(redis, config.execStreamKey(args.taskId), args.timeoutMs + 30000);
  redis.disconnect();
  if (outcome === "timeout") {
    console.error("[local] 超时未收到终态帧（worker 是否在运行？）");
    process.exit(3);
  }
  console.log(`[local] outcome=${outcome}`);
  process.exit(outcome === "success" ? 0 : 1);
}

void main();
