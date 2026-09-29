/** S10 INFRA-008：采样器错误指标行 / 运行时指标块 / errorCode 提取单测。 */
import { describe, expect, it } from "vitest";
import { samplerErrorRows } from "../metrics-format";
import { runtimeBlock, type RuntimeSnapshot } from "../metrics-runtime";
import { errorCodeOfFrames } from "../domains/exec/exec.service";

describe("INFRA-008 samplerErrorRows", () => {
  it("码透传 + label 转义 + 空集无行", () => {
    expect(
      samplerErrorRows([
        { code: "dns", n: 3 },
        { code: "other_net", n: 1 },
      ]),
    ).toEqual([
      'rabbit_sampler_errors_24h{code="dns"} 3',
      'rabbit_sampler_errors_24h{code="other_net"} 1',
    ]);
    expect(samplerErrorRows([])).toEqual([]);
  });
});

describe("INFRA-008 runtimeBlock", () => {
  const snap: RuntimeSnapshot = {
    uptimeSeconds: 12.5,
    cpuSeconds: 1.25,
    rssBytes: 123456.6,
    heapUsedBytes: 65432.4,
    eventLoopLagMs: 2.25,
  };

  it("五指标 HELP/TYPE/样本齐全，命名对齐 client_golang 惯例", () => {
    const block = runtimeBlock(snap);
    const names = [
      "rabbit_process_uptime_seconds",
      "rabbit_process_cpu_seconds_total",
      "rabbit_process_resident_memory_bytes",
      "rabbit_process_heap_used_bytes",
      "rabbit_process_eventloop_lag_ms",
    ];
    for (const n of names) {
      expect(
        block.some((l) => l === `# TYPE ${n} ${n.endsWith("_total") ? "counter" : "gauge"}`),
      ).toBe(true);
      expect(block.some((l) => l.startsWith(`${n} `))).toBe(true);
    }
    expect(block).toContain("rabbit_process_uptime_seconds 12.5");
    expect(block).toContain("rabbit_process_cpu_seconds_total 1.25");
    expect(block).toContain("rabbit_process_resident_memory_bytes 123457");
    expect(block).toContain("rabbit_process_eventloop_lag_ms 2.25");
  });

  it("非法数值（NaN/负数/Infinity）归 0——无 NaN 保证", () => {
    const block = runtimeBlock({
      uptimeSeconds: Number.NaN,
      cpuSeconds: -1,
      rssBytes: Number.POSITIVE_INFINITY,
      heapUsedBytes: 1,
      eventLoopLagMs: Number.NaN,
    });
    expect(block).toContain("rabbit_process_uptime_seconds 0");
    expect(block).toContain("rabbit_process_cpu_seconds_total 0");
    expect(block).toContain("rabbit_process_resident_memory_bytes 0");
    expect(block).toContain("rabbit_process_eventloop_lag_ms 0");
  });
});

describe("INFRA-008 errorCodeOfFrames", () => {
  it("提取首个带 code 的错误 log 帧；无 code → undefined", () => {
    const base = { taskId: "00000000-0000-0000-0000-000000000000", seq: 1, ts: 1 };
    expect(
      errorCodeOfFrames([
        { ...base, type: "log", level: "info", message: "任务开始" },
        { ...base, type: "log", level: "error", message: "网络错误（dns）：…", code: "dns" },
        { ...base, type: "item-final", status: "FAILED", message: "" },
      ]),
    ).toBe("dns");
    expect(
      errorCodeOfFrames([{ ...base, type: "log", level: "error", message: "无码错误" }]),
    ).toBeUndefined();
    expect(errorCodeOfFrames([])).toBeUndefined();
  });
});
