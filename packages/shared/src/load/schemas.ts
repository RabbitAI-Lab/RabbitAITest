import { z } from "zod";
import { httpMethodSchema, kvSchema } from "../execution/schemas";

/**
 * 性能测试契约（S11 LOAD-003；LOAD-002 架构稿兑现——单 controller + 施压内核）。
 * 施压计划=结构化 schema（非 JMX 全集，LOAD-002 §6 差异化冻结）；
 * 秒级时间线载于 Redis Stream（load:stream:{taskId}）与 Report.summary Json，不建度量表。
 */

// ───────────────────────── 施压计划（web 侧 CRUD / engine 消费同构） ─────────────────────────

/** 目标 HTTP 请求（施压对象）：绝对 URL（环境变量不参与——压测目标恒为显式地址）。 */
export const loadTargetSchema = z.object({
  method: httpMethodSchema,
  url: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
      message: "目标必须为 http(s) 绝对 URL",
    }),
  headers: z.array(kvSchema).max(50).default([]),
  body: z
    .string()
    .max(256 * 1024)
    .default(""),
});
export type LoadTarget = z.infer<typeof loadTargetSchema>;

/** 防误操作上界（规格 §2：时长 10 分钟/并发 200/TPS 1000）。 */
export const LOAD_LIMITS = {
  durationSecMax: 600,
  concurrencyMax: 200,
  tpsMax: 1000,
  rampPointsMax: 20,
} as const;

/** 并发阶梯模型：ramp=[{atSec,concurrency}]（时序递增校验；爬升→稳态→收尾由调度表纯函数展开）。 */
export const loadPressureConcurrencySchema = z.object({
  mode: z.literal("concurrency"),
  durationSec: z.number().int().min(5).max(LOAD_LIMITS.durationSecMax),
  maxConcurrency: z.number().int().min(1).max(LOAD_LIMITS.concurrencyMax),
  ramp: z
    .array(
      z.object({
        atSec: z.number().int().min(0).max(LOAD_LIMITS.durationSecMax),
        concurrency: z.number().int().min(1).max(LOAD_LIMITS.concurrencyMax),
      }),
    )
    .min(1)
    .max(LOAD_LIMITS.rampPointsMax)
    .refine((r) => r.every((p, i) => i === 0 || (r[i - 1]?.atSec ?? -1) < p.atSec), {
      message: "阶梯 atSec 必须严格递增",
    })
    .refine(
      (r) => {
        const first = r[0];
        return first !== undefined && first.atSec === 0;
      },
      { message: "首阶梯 atSec 必须为 0" },
    ),
});

/** 目标 TPS 模型：rampSec 内线性爬升至 targetTps 后稳态。 */
export const loadPressureTpsSchema = z.object({
  mode: z.literal("tps"),
  durationSec: z.number().int().min(5).max(LOAD_LIMITS.durationSecMax),
  targetTps: z.number().int().min(1).max(LOAD_LIMITS.tpsMax),
  rampSec: z.number().int().min(0).max(LOAD_LIMITS.durationSecMax).default(0),
});

export const loadPressureSchema = z.discriminatedUnion("mode", [
  loadPressureConcurrencySchema,
  loadPressureTpsSchema,
]);
export type LoadPressure = z.infer<typeof loadPressureSchema>;

/** 断言阈值（报告结论判定；全部达标=SUCCESS，任一越限=FAILED）。 */
export const loadThresholdsSchema = z.object({
  okRateMin: z.number().min(0).max(100).default(99),
  p95MsMax: z.number().int().min(1).max(600000).default(500),
  avgMsMax: z.number().int().min(1).max(600000).default(200),
});
export type LoadThresholds = z.infer<typeof loadThresholdsSchema>;

export const loadTestCreateSchema = z.object({
  name: z.string().min(1).max(128),
  target: loadTargetSchema,
  pressure: loadPressureSchema,
  thresholds: loadThresholdsSchema.default({ okRateMin: 99, p95MsMax: 500, avgMsMax: 200 }),
  envId: z.string().uuid().optional(),
});
export type LoadTestCreate = z.input<typeof loadTestCreateSchema>;

export const loadTestUpdateSchema = loadTestCreateSchema.partial();
export type LoadTestUpdate = z.input<typeof loadTestUpdateSchema>;

// ───────────────────────── 引擎命令（web → BullMQ load 队列） ─────────────────────────

export const loadCommandSchema = z.object({
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  loadTestId: z.string().uuid(),
  name: z.string().min(1).max(128),
  target: loadTargetSchema,
  pressure: loadPressureSchema,
  thresholds: loadThresholdsSchema,
});
export type LoadCommand = z.infer<typeof loadCommandSchema>;

// ───────────────────────── 秒级度量帧（engine XADD → web SSE/报告） ─────────────────────────

/** 单秒聚合点：sec=任务起算秒序；rt 分位由该秒内样本计算。 */
export const loadMetricFrameSchema = z.object({
  taskId: z.string().uuid(),
  sec: z.number().int().min(0),
  ts: z.number(),
  sent: z.number().int().min(0),
  ok: z.number().int().min(0),
  fail: z.number().int().min(0),
  concurrent: z.number().int().min(0),
  rtMin: z.number().int().min(0),
  rtAvg: z.number().int().min(0),
  rtP50: z.number().int().min(0),
  rtP95: z.number().int().min(0),
  rtP99: z.number().int().min(0),
});
export type LoadMetricFrame = z.infer<typeof loadMetricFrameSchema>;

/** 终态汇总（engine 回调携带；完整秒级时间线由 web 从 Stream XRANGE 落 Report）。 */
export const loadVerdictItemSchema = z.object({
  key: z.enum(["okRate", "p95", "avg"]),
  threshold: z.number(),
  actual: z.number(),
  passed: z.boolean(),
});
export type LoadVerdictItem = z.infer<typeof loadVerdictItemSchema>;

export const loadSummarySchema = z.object({
  seconds: z.number().int().min(0),
  totalSent: z.number().int().min(0),
  totalOk: z.number().int().min(0),
  totalFail: z.number().int().min(0),
  peakTps: z.number().min(0),
  okRate: z.number().min(0).max(100),
  avgMs: z.number().min(0),
  p50Ms: z.number().min(0),
  p95Ms: z.number().min(0),
  p99Ms: z.number().min(0),
  verdict: z.enum(["SUCCESS", "FAILED"]),
  items: z.array(loadVerdictItemSchema),
});
export type LoadSummary = z.infer<typeof loadSummarySchema>;

/** 施压任务状态（ExecTask.status 子集扩展；ABORTED=人为停止）。 */
export const LOAD_TASK_STATUSES = ["PENDING", "RUNNING", "SUCCESS", "FAILED", "ABORTED"] as const;
export type LoadTaskStatus = (typeof LOAD_TASK_STATUSES)[number];

/** 分位数（nearest-rank，调度器/聚合器与测试共用同源实现）。 */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1] ?? 0;
}
