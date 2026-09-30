/** LOAD-003-T1~T4：调度表/聚合器/schema/汇总纯函数 + 内嵌 echo 真施压。 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  loadPressureSchema,
  loadTargetSchema,
  loadThresholdsSchema,
  loadTestCreateSchema,
  percentile,
  type LoadCommand,
} from "@rabbit/shared";
import { aggregateSecond, concurrencySchedule, summarize, tpsSchedule, runLoad } from "../load/generator";

const UUID = "00000000-0000-4000-8000-000000000001";

function mkCmd(partial: Partial<LoadCommand["pressure"]> = {}): LoadCommand {
  return {
    taskId: UUID,
    projectId: UUID,
    loadTestId: UUID,
    name: "t",
    target: { method: "GET", url: "http://127.0.0.1:9/x", headers: [], body: "" },
    pressure: { mode: "concurrency", durationSec: 10, maxConcurrency: 10, ramp: [{ atSec: 0, concurrency: 2 }, ...([] as never[])], ...partial } as LoadCommand["pressure"],
    thresholds: { okRateMin: 99, p95MsMax: 500, avgMsMax: 200 },
  };
}

describe("LOAD-003-T1 调度表（concurrencySchedule/tpsSchedule 纯函数）", () => {
  it("并发阶梯：首点稳值→线性爬升→末点稳态", () => {
    const cmd = mkCmd({
      mode: "concurrency",
      durationSec: 10,
      maxConcurrency: 100,
      ramp: [
        { atSec: 0, concurrency: 10 },
        { atSec: 5, concurrency: 50 },
      ],
    });
    const s = concurrencySchedule(cmd);
    expect(s).toHaveLength(10);
    expect(s[0]).toBe(10);
    expect(s[2]).toBeGreaterThan(10); // 爬升中
    expect(s[2]).toBeLessThan(50);
    expect(s[5]).toBe(50); // 到达顶点
    expect(s[9]).toBe(50); // 稳态
  });
  it("并发上限钳制：阶梯超出 maxConcurrency 截断", () => {
    const cmd = mkCmd({
      mode: "concurrency",
      durationSec: 5,
      maxConcurrency: 20,
      ramp: [{ atSec: 0, concurrency: 999 }],
    });
    expect(concurrencySchedule(cmd).every((v) => v <= 20)).toBe(true);
  });
  it("tps 模式：rampSec 线性爬升→稳态", () => {
    const cmd = mkCmd();
    cmd.pressure = { mode: "tps", durationSec: 8, targetTps: 100, rampSec: 4 };
    const s = tpsSchedule(cmd);
    expect(s).toHaveLength(8);
    expect(s[0]).toBe(25);
    expect(s[3]).toBe(100);
    expect(s[7]).toBe(100);
  });
  it("tps 模式 rampSec=0：全程稳态", () => {
    const cmd = mkCmd();
    cmd.pressure = { mode: "tps", durationSec: 3, targetTps: 7, rampSec: 0 };
    expect(tpsSchedule(cmd)).toEqual([7, 7, 7]);
  });
});

describe("LOAD-003-T2 聚合器（aggregateSecond/summarize/percentile）", () => {
  it("percentile nearest-rank：空样本 0，单样本自身，分位取上界", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([10], 95)).toBe(10);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([1, 5, 9], 50)).toBe(5); // 入参契约=已排序（调用方 aggregateSecond 内排序）
  });
  it("秒窗口聚合：sent/ok/fail 计数 + 分位 + concurrent 透传", () => {
    const f = aggregateSecond(UUID, 3, 1000, [
      { ok: true, rtMs: 10 },
      { ok: true, rtMs: 20 },
      { ok: false, rtMs: 900 },
    ], 8);
    expect(f.sec).toBe(3);
    expect(f.sent).toBe(3);
    expect(f.ok).toBe(2);
    expect(f.fail).toBe(1);
    expect(f.concurrent).toBe(8);
    expect(f.rtMin).toBe(10);
    expect(f.rtP50).toBe(20);
    expect(f.rtP99).toBe(900);
  });
  it("汇总：阈值全部达标 SUCCESS；任一越限 FAILED 且 items 逐项标记", () => {
    const ok1 = aggregateSecond(UUID, 0, 0, [{ ok: true, rtMs: 100 }], 1);
    const ok2 = aggregateSecond(UUID, 1, 0, [{ ok: true, rtMs: 120 }], 1);
    const s = summarize({ okRateMin: 99, p95MsMax: 500, avgMsMax: 200 }, [ok1, ok2]);
    expect(s.verdict).toBe("SUCCESS");
    expect(s.totalSent).toBe(2);
    expect(s.okRate).toBe(100);
    expect(s.items.every((i) => i.passed)).toBe(true);

    const bad = aggregateSecond(UUID, 0, 0, [{ ok: true, rtMs: 3000 }], 1);
    const s2 = summarize({ okRateMin: 99, p95MsMax: 500, avgMsMax: 200 }, [bad]);
    expect(s2.verdict).toBe("FAILED");
    expect(s2.items.find((i) => i.key === "p95")?.passed).toBe(false);
    expect(s2.items.find((i) => i.key === "okRate")?.passed).toBe(true);
  });
});

describe("LOAD-003-T3 zod schema（loadTargetSchema/loadPressureSchema/thresholds/create）", () => {
  it("目标 URL：相对路径与非 http(s) 拒绝", () => {
    expect(loadTargetSchema.safeParse({ method: "GET", url: "/ping" }).success).toBe(false);
    expect(loadTargetSchema.safeParse({ method: "GET", url: "ftp://x/y" }).success).toBe(false);
    expect(loadTargetSchema.safeParse({ method: "GET", url: "http://127.0.0.1:1/ping" }).success).toBe(true);
  });
  it("压力模型上界：时长>600/并发>200/TPS>1000 拒绝", () => {
    expect(loadPressureSchema.safeParse({ mode: "concurrency", durationSec: 601, maxConcurrency: 1, ramp: [{ atSec: 0, concurrency: 1 }] }).success).toBe(false);
    expect(loadPressureSchema.safeParse({ mode: "concurrency", durationSec: 10, maxConcurrency: 201, ramp: [{ atSec: 0, concurrency: 1 }] }).success).toBe(false);
    expect(loadPressureSchema.safeParse({ mode: "tps", durationSec: 10, targetTps: 1001, rampSec: 0 }).success).toBe(false);
  });
  it("并发阶梯：atSec 非递增 / 首点非 0 拒绝", () => {
    const base = { mode: "concurrency", durationSec: 10, maxConcurrency: 10 };
    expect(loadPressureSchema.safeParse({ ...base, ramp: [{ atSec: 5, concurrency: 1 }] }).success).toBe(false);
    expect(loadPressureSchema.safeParse({ ...base, ramp: [{ atSec: 0, concurrency: 1 }, { atSec: 0, concurrency: 2 }] }).success).toBe(false);
    expect(loadPressureSchema.safeParse({ ...base, ramp: [{ atSec: 0, concurrency: 1 }, { atSec: 3, concurrency: 2 }] }).success).toBe(true);
  });
  it("阈值与整体 create：默认值补齐 + 非法拒绝", () => {
    expect(loadThresholdsSchema.parse({})).toEqual({ okRateMin: 99, p95MsMax: 500, avgMsMax: 200 });
    const ok = loadTestCreateSchema.safeParse({
      name: "x",
      target: { method: "POST", url: "http://127.0.0.1:1/ping" },
      pressure: { mode: "tps", durationSec: 10, targetTps: 10, rampSec: 2 },
    });
    expect(ok.success).toBe(true);
    expect(loadTestCreateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("LOAD-003-T4 内嵌 echo 真施压（本地 http server + 停止键 ≤2s）", () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("pong");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  const fakeRedis = () => {
    const keys = new Set<string>();
    return {
      keys,
      exists: async (k: string) => (keys.has(k) ? 1 : 0),
    };
  };

  it("3s 小压力：发压数>0、帧连续秒序、汇总 SUCCESS", async () => {
    const redis = fakeRedis();
    const frames: unknown[] = [];
    const cmd = mkCmd();
    cmd.target = { method: "GET", url: `http://127.0.0.1:${port}/`, headers: [], body: "" };
    cmd.pressure = { mode: "tps", durationSec: 3, targetTps: 10, rampSec: 0 };
    const r = await runLoad(cmd, {
      redis: redis as never,
      onFrame: async (f) => {
        frames.push(f);
      },
    });
    expect(r.aborted).toBe(false);
    expect(r.frames).toHaveLength(3);
    expect(r.frames.map((f) => f.sec)).toEqual([0, 1, 2]);
    const total = r.frames.reduce((a, f) => a + f.sent, 0);
    expect(total).toBeGreaterThan(0);
    const s = summarize(cmd.thresholds, r.frames);
    expect(s.okRate).toBe(100);
    expect(s.verdict).toBe("SUCCESS");
    expect(frames).toHaveLength(3);
  }, 15000);

  it("停止键 ≤2s 生效：第 1 秒后设键→aborted=true 且帧数显著少于时长", async () => {
    const redis = fakeRedis();
    const cmd = mkCmd();
    cmd.target = { method: "GET", url: `http://127.0.0.1:${port}/`, headers: [], body: "" };
    cmd.pressure = { mode: "tps", durationSec: 30, targetTps: 5, rampSec: 0 };
    const stopKey = `load:stop:${cmd.taskId}`;
    setTimeout(() => redis.keys.add(stopKey), 1200);
    const r = await runLoad(cmd, { redis: redis as never, onFrame: async () => undefined });
    expect(r.aborted).toBe(true);
    expect(r.frames.length).toBeLessThan(10); // 30s 任务被提前停
  }, 20000);
});
