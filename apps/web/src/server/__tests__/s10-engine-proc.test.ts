/** S10 INFRA-009：engine 节点 proc 行构造与 process label 兼容单测。 */
import { describe, expect, it } from "vitest";
import { engineProcRows, runtimeBlock } from "../metrics-runtime";

describe("INFRA-009 engineProcRows", () => {
  it("合法节点 → 四指标行（process=engine-{nodeId}）；eventloop 不产出", () => {
    const rows = engineProcRows([
      {
        nodeId: "node-42",
        proc: { uptimeSeconds: 10.5, cpuSeconds: 1.2, rssBytes: 100.4, heapUsedBytes: 50.6 },
      },
    ]);
    expect(rows).toContain('rabbit_process_uptime_seconds{process="engine-node-42"} 10.5');
    expect(rows).toContain('rabbit_process_cpu_seconds_total{process="engine-node-42"} 1.2');
    expect(rows).toContain('rabbit_process_resident_memory_bytes{process="engine-node-42"} 100');
    expect(rows).toContain('rabbit_process_heap_used_bytes{process="engine-node-42"} 51');
    expect(rows.some((l) => l.includes("eventloop"))).toBe(false);
  });

  it("缺 proc / 缺 nodeId / 字段非法 → 跳过", () => {
    expect(engineProcRows([{ nodeId: "n1" }])).toEqual([]);
    expect(engineProcRows([{ proc: { uptimeSeconds: 1 } } as never])).toEqual([]);
    expect(
      engineProcRows([
        { nodeId: "n2", proc: { uptimeSeconds: "x", cpuSeconds: 1, rssBytes: 1, heapUsedBytes: 1 } },
      ]),
    ).toEqual([]);
  });

  it("nodeId label 转义", () => {
    const rows = engineProcRows([
      {
        nodeId: 'no"de',
        proc: { uptimeSeconds: 1, cpuSeconds: 1, rssBytes: 1, heapUsedBytes: 1 },
      },
    ]);
    expect(rows[0]).toContain('process="engine-no\\"de"');
  });
});

describe("INFRA-009 runtimeBlock process label", () => {
  it("默认 process=web；自定义 label 透出", () => {
    const snap = {
      uptimeSeconds: 1,
      cpuSeconds: 0.5,
      rssBytes: 10,
      heapUsedBytes: 5,
      eventLoopLagMs: 0.1,
    };
    expect(runtimeBlock(snap).some((l) => l === 'rabbit_process_uptime_seconds{process="web"} 1')).toBe(true);
    expect(
      runtimeBlock(snap, "web-2").some((l) => l === 'rabbit_process_uptime_seconds{process="web-2"} 1'),
    ).toBe(true);
  });
});
