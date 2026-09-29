/** S10 INFRA-007：指标面 v2 单测（时延环形缓冲/格式化纯函数/慢查询计量）。 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@rabbit/db", () => {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  return {
    prisma: {
      $on: vi.fn((event: string, cb: (e: unknown) => void) => {
        listeners[event] ??= [];
        listeners[event].push(cb);
      }),
      __emit: (event: string, e: unknown) => (listeners[event] ?? []).forEach((cb) => cb(e)),
      __resetListeners: () => {
        for (const k of Object.keys(listeners)) delete listeners[k];
      },
    },
  };
});

import { DURATION_WINDOW, httpDurationSnapshot, httpObserve } from "../metrics-counter";
import {
  escapeLabelValue,
  failureKindRows,
  httpDurationRows,
  percentile,
  ratio,
  taskStatusRows,
} from "../metrics-format";
import { initSlowQueryMeter, slowQueryCount, slowQueryThresholdMs } from "../metrics-db";
import { prisma } from "@rabbit/db";

const g = globalThis as unknown as {
  __rabbitSlowQueryInit?: boolean;
  __rabbitSlowQueries?: number;
};

describe("INFRA-007 metrics-format", () => {
  it("escapeLabelValue：反斜杠/双引号/换行转义（exposition format §2）", () => {
    expect(escapeLabelValue('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
    expect(escapeLabelValue("plain-Name_1")).toBe("plain-Name_1");
  });

  it("percentile：空集 0 / 单元素 / 上取整口径（与 v1 算法一致）", () => {
    expect(percentile([], 0.95)).toBe(0);
    expect(percentile([42], 0.95)).toBe(42);
    // 1..100：P95 → ceil(95)=第 95 位
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sorted, 0.95)).toBe(95);
    expect(percentile(sorted, 0.5)).toBe(50);
  });

  it("ratio：分母 ≤0 → 0（无 NaN 保证）", () => {
    expect(ratio(5, 0)).toBe(0);
    expect(ratio(5, -1)).toBe(0);
    expect(ratio(1, 4)).toBe(0.25);
  });

  it("failureKindRows：NULL → UNCLASSIFIED，四种 FailureKind 直通", () => {
    const rows = failureKindRows([
      { kind: null, n: 2 },
      { kind: "ASSERT_FAILED", n: 3 },
      { kind: "NETWORK_ERROR", n: 1 },
      { kind: "CONFIG_ERROR", n: 1 },
      { kind: "SCRIPT_ERROR", n: 1 },
    ]);
    expect(rows).toContain('rabbit_task_failures_24h{kind="UNCLASSIFIED"} 2');
    expect(rows).toContain('rabbit_task_failures_24h{kind="ASSERT_FAILED"} 3');
    expect(rows).toContain('rabbit_task_failures_24h{kind="NETWORK_ERROR"} 1');
    expect(rows).toContain('rabbit_task_failures_24h{kind="CONFIG_ERROR"} 1');
    expect(rows).toContain('rabbit_task_failures_24h{kind="SCRIPT_ERROR"} 1');
  });

  it("taskStatusRows：status 分组行 + label 转义", () => {
    expect(
      taskStatusRows([
        { status: "SUCCESS", n: 7 },
        { status: "FAILED", n: 3 },
      ]),
    ).toEqual(['rabbit_tasks_24h{status="SUCCESS"} 7', 'rabbit_tasks_24h{status="FAILED"} 3']);
  });
});

describe("INFRA-007 httpObserve 环形缓冲", () => {
  it("滑动窗口容量：超限淘汰最旧样本，sum/count 口径一致", () => {
    const path = "/api/v1/projects/p-ring/cases";
    for (let i = 1; i <= DURATION_WINDOW + 100; i++) httpObserve(path, i);
    const snap = httpDurationSnapshot().find((s) => s.routeGroup === "projects");
    expect(snap).toBeDefined();
    expect(snap!.samples.length).toBe(DURATION_WINDOW);
    // 窗口内应为 101..612：首尾与求和校验
    expect(snap!.samples[0]).toBe(101);
    expect(snap!.samples[snap!.samples.length - 1]).toBe(DURATION_WINDOW + 100);
    const expectSum = Array.from({ length: DURATION_WINDOW }, (_, i) => i + 101).reduce(
      (a, b) => a + b,
      0,
    );
    expect(snap!.sum).toBe(expectSum);
  });

  it("非法时长丢弃（负数/NaN/Infinity）", () => {
    const before = httpDurationSnapshot().find((s) => s.routeGroup === "orgs");
    const nBefore = before?.samples.length ?? 0;
    httpObserve("/api/v1/orgs/o1/groups", -5);
    httpObserve("/api/v1/orgs/o1/groups", Number.NaN);
    httpObserve("/api/v1/orgs/o1/groups", Number.POSITIVE_INFINITY);
    const after = httpDurationSnapshot().find((s) => s.routeGroup === "orgs");
    expect(after?.samples.length ?? 0).toBe(nBefore);
  });

  it("httpDurationRows：空组跳过；quantile 单调；sum/count 行齐全", () => {
    const rows = httpDurationRows([
      { routeGroup: "system", samples: [10, 20, 30, 40], sum: 100 },
      { routeGroup: "empty", samples: [], sum: 0 },
    ]);
    expect(rows.some((l) => l.includes('route_group="empty"'))).toBe(false);
    expect(rows).toContain(
      'rabbit_http_request_duration_ms{route_group="system",quantile="0.5"} 20',
    );
    expect(rows).toContain(
      'rabbit_http_request_duration_ms{route_group="system",quantile="0.95"} 40',
    );
    expect(rows).toContain('rabbit_http_request_duration_ms_sum{route_group="system"} 100');
    expect(rows).toContain('rabbit_http_request_duration_ms_count{route_group="system"} 4');
  });
});

describe("INFRA-007 metrics-db 慢查询计量", () => {
  beforeEach(() => {
    delete g.__rabbitSlowQueryInit;
    delete g.__rabbitSlowQueries;
    (prisma as unknown as { __resetListeners: () => void }).__resetListeners();
    vi.clearAllMocks();
  });

  it("阈值默认 200ms，非法 env 回退默认", () => {
    delete process.env.RABBIT_SLOW_QUERY_MS;
    expect(slowQueryThresholdMs()).toBe(200);
    process.env.RABBIT_SLOW_QUERY_MS = "abc";
    expect(slowQueryThresholdMs()).toBe(200);
    process.env.RABBIT_SLOW_QUERY_MS = "0";
    expect(slowQueryThresholdMs()).toBe(0);
    delete process.env.RABBIT_SLOW_QUERY_MS;
  });

  it("订阅一次：≥阈值计数、低于阈值不计、重复 init 不重复订阅", () => {
    initSlowQueryMeter();
    initSlowQueryMeter();
    expect(prisma.$on).toHaveBeenCalledTimes(1);
    const db = prisma as unknown as { __emit: (e: string, v: unknown) => void };
    db.__emit("query", { duration: 250 });
    db.__emit("query", { duration: 199.9 });
    db.__emit("query", { duration: 5000 });
    expect(slowQueryCount()).toBe(2);
  });

  it("RABBIT_SLOW_QUERY_MS=0：跳过订阅（逃生门），计数恒 0", () => {
    process.env.RABBIT_SLOW_QUERY_MS = "0";
    initSlowQueryMeter();
    expect(prisma.$on).not.toHaveBeenCalled();
    const db = prisma as unknown as { __emit: (e: string, v: unknown) => void };
    db.__emit("query", { duration: 9999 });
    expect(slowQueryCount()).toBe(0);
    delete process.env.RABBIT_SLOW_QUERY_MS;
  });
});
