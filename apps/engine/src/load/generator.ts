/**
 * S11 LOAD-003 施压内核：调度表纯函数（每秒目标并发/TPS）+ 1s 窗口聚合 +
 * undici 连接池发压 + p-limit 并发槽 + 停止键轮询（≤2s 生效，LOAD-002 §2 冻结）。
 * 单节点实施；多节点分片键位已由 web/shared 预留（load-shard-{taskId}），本模块不启用。
 */
import { Agent, request } from "undici";
import pLimit from "p-limit";
import type Redis from "ioredis";
import { config, percentile } from "@rabbit/shared";
import type { LoadCommand, LoadMetricFrame, LoadSummary, LoadVerdictItem } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";

/** ───────────── 调度表（纯函数，Vitest 直测） ───────────── */

/** 每秒目标并发序列（concurrency 模式：阶梯爬升→稳态；末点稳至 durationSec）。 */
export function concurrencySchedule(cmd: LoadCommand): number[] {
  if (cmd.pressure.mode !== "concurrency") return [];
  const { durationSec, maxConcurrency, ramp } = cmd.pressure;
  const points = [...ramp].sort((a, b) => a.atSec - b.atSec);
  const first = points[0];
  if (!first) return [];
  const out: number[] = [];
  for (let sec = 0; sec < durationSec; sec++) {
    // 当前阶梯：最后一个 atSec<=sec 的点；两点间线性插值爬升
    let prev = first;
    let next = first;
    for (const p of points) {
      if (p.atSec <= sec) prev = p;
      if (p.atSec > sec) {
        next = p;
        break;
      }
      next = p;
    }
    let target: number;
    if (next.atSec > prev.atSec && sec < next.atSec) {
      const ratio = (sec - prev.atSec) / (next.atSec - prev.atSec);
      target = Math.round(prev.concurrency + (next.concurrency - prev.concurrency) * ratio);
    } else {
      target = prev.concurrency;
    }
    out.push(Math.max(1, Math.min(maxConcurrency, target)));
  }
  return out;
}

/** 每秒目标 TPS 序列（tps 模式：rampSec 线性爬升→稳态）。 */
export function tpsSchedule(cmd: LoadCommand): number[] {
  if (cmd.pressure.mode !== "tps") return [];
  const { durationSec, targetTps, rampSec } = cmd.pressure;
  const out: number[] = [];
  for (let sec = 0; sec < durationSec; sec++) {
    if (rampSec > 0 && sec < rampSec) {
      out.push(Math.max(1, Math.round(targetTps * ((sec + 1) / rampSec))));
    } else {
      out.push(targetTps);
    }
  }
  return out;
}

/** ───────────── 聚合器（纯函数，Vitest 直测） ───────────── */

/** 秒窗口样本聚合（rt 分位 nearest-rank）。 */
export function aggregateSecond(
  taskId: string,
  sec: number,
  ts: number,
  samples: { ok: boolean; rtMs: number }[],
  concurrent: number,
): LoadMetricFrame {
  const sent = samples.length;
  const okCount = samples.filter((s) => s.ok).length;
  const rts = samples.map((s) => s.rtMs).sort((a, b) => a - b);
  return {
    taskId,
    sec,
    ts,
    sent,
    ok: okCount,
    fail: sent - okCount,
    concurrent,
    rtMin: rts[0] ?? 0,
    rtAvg: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0,
    rtP50: percentile(rts, 50),
    rtP95: percentile(rts, 95),
    rtP99: percentile(rts, 99),
  };
}

/** 全任务汇总 + 阈值结论（终态回调载荷）。 */
export function summarize(
  thresholds: LoadCommand["thresholds"],
  frames: LoadMetricFrame[],
): LoadSummary {
  const totalSent = frames.reduce((a, f) => a + f.sent, 0);
  const totalOk = frames.reduce((a, f) => a + f.ok, 0);
  const totalFail = totalSent - totalOk;
  const peakTps = frames.reduce((a, f) => Math.max(a, f.sent), 0);
  const okRate = totalSent > 0 ? Math.round((totalOk / totalSent) * 1000) / 10 : 100;
  // 全任务 RT 分位：以每秒 rtAvg 为样本加权近似（LOAD-002 §2「进程内采样 1s 聚合」口径）
  const secAvg = frames.filter((f) => f.sent > 0).map((f) => f.rtAvg);
  const avgMs = secAvg.length ? Math.round(secAvg.reduce((a, b) => a + b, 0) / secAvg.length) : 0;
  const p50Ms = frames.length ? Math.max(...frames.map((f) => f.rtP50)) : 0;
  const p95Ms = frames.length ? Math.max(...frames.map((f) => f.rtP95)) : 0;
  const p99Ms = frames.length ? Math.max(...frames.map((f) => f.rtP99)) : 0;
  const items: LoadVerdictItem[] = [
    {
      key: "okRate",
      threshold: thresholds.okRateMin,
      actual: okRate,
      passed: okRate >= thresholds.okRateMin,
    },
    {
      key: "p95",
      threshold: thresholds.p95MsMax,
      actual: p95Ms,
      passed: p95Ms <= thresholds.p95MsMax,
    },
    {
      key: "avg",
      threshold: thresholds.avgMsMax,
      actual: avgMs,
      passed: avgMs <= thresholds.avgMsMax,
    },
  ];
  return {
    seconds: frames.length,
    totalSent,
    totalOk,
    totalFail,
    peakTps,
    okRate,
    avgMs,
    p50Ms,
    p95Ms,
    p99Ms,
    verdict: items.every((i) => i.passed) ? "SUCCESS" : "FAILED",
    items,
  };
}

/** ───────────── 施压执行（引擎侧消费；emit 回调=每秒 XADD） ───────────── */

export interface LoadRunDeps {
  redis: Redis;
  /** 每秒聚合点发出（controller 侧 XADD 包装） */
  onFrame: (frame: LoadMetricFrame) => Promise<void>;
  /** 停止键轮询周期（测试可注入缩短） */
  stopPollMs?: number;
}

/**
 * 施压主循环：按调度表逐秒推进；concurrency 模式=每秒以该秒并发槽闭环发压；
 * tps 模式=每秒令牌配额发压（不足额的毫秒散布由 p-limit 自然排队）。
 * 返回：aborted=是否人为停止。
 */
export async function runLoad(
  cmd: LoadCommand,
  deps: LoadRunDeps,
): Promise<{ aborted: boolean; frames: LoadMetricFrame[] }> {
  const stopKey = config.loadStopKey(cmd.taskId);
  // 连接池：origin 级 Agent（连接数=min(并发上限,256)；跨 origin 目标由各请求自带绝对 URL 落到默认调度）
  const agent = new Agent({
    connect: undefined,
    connections: Math.min(
      cmd.pressure.mode === "concurrency" ? cmd.pressure.maxConcurrency : 64,
      256,
    ),
    pipelining: 1,
    headersTimeout: 10_000,
    bodyTimeout: 10_000,
  });
  const frames: LoadMetricFrame[] = [];
  let aborted = false;
  try {
    const schedule =
      cmd.pressure.mode === "concurrency" ? concurrencySchedule(cmd) : tpsSchedule(cmd);
    for (let sec = 0; sec < schedule.length; sec++) {
      const target = schedule[sec] ?? 1;
      const secStart = Date.now();
      const samples: { ok: boolean; rtMs: number }[] = [];
      const limit = pLimit(Math.max(target, 1));
      // 本秒任务集：quota=目标（并发模式=并发槽持续闭环一秒；tps=目标发压数）
      const quota =
        cmd.pressure.mode === "concurrency"
          ? Math.max(1, Math.round(target * (1000 / Math.max(avgRtHint(frames), 50))))
          : target;
      const jobs = Array.from({ length: quota }, () =>
        limit(async () => {
          if (Date.now() - secStart >= 1000) return; // 本秒收尾：不再起新请求
          const t0 = Date.now();
          try {
            const res = await request(cmd.target.url, {
              method: cmd.target.method,
              headers: Object.fromEntries(
                cmd.target.headers.filter((h) => h.enabled !== false).map((h) => [h.key, h.value]),
              ),
              body: cmd.target.body || undefined,
              dispatcher: agent,
            });
            await res.body.text(); // 消费 body 释放连接
            samples.push({ ok: res.statusCode < 400, rtMs: Date.now() - t0 });
          } catch {
            samples.push({ ok: false, rtMs: Date.now() - t0 });
          }
        }),
      );
      // 秒末收口：等本秒在执请求完成（≤1s 漂移）
      await Promise.race([Promise.all(jobs), sleep(1100)]);
      const frame = aggregateSecond(
        cmd.taskId,
        sec,
        secStart,
        samples,
        cmd.pressure.mode === "concurrency" ? target : Math.min(target, samples.length),
      );
      frames.push(frame);
      await deps.onFrame(frame);
      // 停止键（≤2s 生效：秒级轮询 + 请求内 1s 上限）
      if (await isStopSet(deps.redis, stopKey)) {
        aborted = true;
        break;
      }
      // 秒步对齐（本秒耗时不足 1s 时补齐，超 1s 则下一秒立即开始）
      const elapsed = Date.now() - secStart;
      if (elapsed < 1000) await sleep(1000 - elapsed);
    }
  } finally {
    await agent.close().catch(() => undefined);
  }
  logFor("engine").info(
    { taskId: cmd.taskId, seconds: frames.length, aborted },
    "load run finished",
  );
  return { aborted, frames };
}

/** 相邻秒 rtAvg 近似（并发模式 quota 换算的历史经验因子，首秒默认 50ms）。 */
function avgRtHint(frames: LoadMetricFrame[]): number {
  if (frames.length === 0) return 50;
  return Math.max(frames[frames.length - 1]?.rtAvg ?? 50, 10);
}

async function isStopSet(redis: Redis, key: string): Promise<boolean> {
  try {
    return (await redis.exists(key)) === 1;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
