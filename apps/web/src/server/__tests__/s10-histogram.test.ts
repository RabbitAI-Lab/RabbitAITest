/** S10 INFRA-010：HTTP 时延 histogram（seconds 族·加法式）单测——桶累积语义/与 summary 同源一致。 */
import { describe, expect, it } from "vitest";
import { httpHistogramSnapshot, httpObserve } from "../metrics-counter";
import { httpHistogramRows } from "../metrics-format";

const GROUP_PATH = "/api/v1/hist010/demo";

describe("INFRA-010 httpObserve 桶计数", () => {
  it("桶累积语义：3ms/8ms/600ms → le=0.005=1、le=0.01=2、le=1=3、+Inf=count；sum 秒折算", () => {
    httpObserve(GROUP_PATH, 3);
    httpObserve(GROUP_PATH, 8);
    httpObserve(GROUP_PATH, 600);
    const g = httpHistogramSnapshot().find((s) => s.routeGroup === "hist010");
    expect(g).toBeDefined();
    expect(g!.count).toBe(3);
    const rows = httpHistogramRows([g!]);
    expect(rows).toContain(
      'rabbit_http_request_duration_seconds_bucket{route_group="hist010",le="0.005"} 1',
    );
    expect(rows).toContain(
      'rabbit_http_request_duration_seconds_bucket{route_group="hist010",le="0.01"} 2',
    );
    expect(rows).toContain(
      'rabbit_http_request_duration_seconds_bucket{route_group="hist010",le="1"} 3',
    );
    expect(rows).toContain(
      'rabbit_http_request_duration_seconds_bucket{route_group="hist010",le="+Inf"} 3',
    );
    expect(rows).toContain('rabbit_http_request_duration_seconds_sum{route_group="hist010"} 0.611');
    expect(rows).toContain('rabbit_http_request_duration_seconds_count{route_group="hist010"} 3');
  });

  it("超上限样本落 +Inf 语义（桶全不加，count/sum 仍增）", () => {
    httpObserve("/api/v1/hist010/overflow", 9000);
    const g = httpHistogramSnapshot().find((s) => s.routeGroup === "hist010");
    expect(g).toBeDefined();
    const rows = httpHistogramRows([g!]);
    const infLine = rows.find((l) => l.includes('le="+Inf"'));
    expect(infLine).toBeDefined();
    // +Inf 行 = 总 count（含 9s 样本）；最高有限桶（le=5）不含它
    const total = Number(infLine!.split(" ").pop());
    const le5 = rows.find((l) => l.includes('le="5"'));
    expect(Number(le5!.split(" ").pop())).toBeLessThan(total);
  });

  it("空组跳过（count=0 不产行）", () => {
    expect(httpHistogramRows([{ routeGroup: "empty", counts: [], sum: 0, count: 0 }])).toEqual([]);
  });

  it("桶界单调不减（le 行数值非降）", () => {
    httpObserve(GROUP_PATH, 12);
    httpObserve(GROUP_PATH, 120);
    const g = httpHistogramSnapshot().find((s) => s.routeGroup === "hist010");
    const rows = httpHistogramRows([g!]);
    const leValues = rows
      .filter((l) => l.includes("_bucket{") && !l.includes("+Inf"))
      .map((l) => Number(l.split(" ").pop()));
    for (let i = 1; i < leValues.length; i++) {
      expect(leValues[i]).toBeGreaterThanOrEqual(leValues[i - 1] as number);
    }
  });
});
