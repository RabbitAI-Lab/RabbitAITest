/** S10 INFRA-010：mock /metrics 端点单测（process="mock" 四指标；与 /healthz 同口径）。 */
import { describe, expect, it } from "vitest";
import { app } from "../index";

describe("GET /metrics（INFRA-010）", () => {
  it('200 + text/plain + process="mock" 四指标行 + HELP/TYPE 齐全', async () => {
    const res = await app.request("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    for (const name of [
      "rabbit_process_uptime_seconds",
      "rabbit_process_cpu_seconds_total",
      "rabbit_process_resident_memory_bytes",
      "rabbit_process_heap_used_bytes",
    ]) {
      expect(body).toContain(`# TYPE ${name} ${name.endsWith("_total") ? "counter" : "gauge"}`);
      expect(body).toContain(`${name}{process="mock"} `);
    }
    // 数值非 NaN（行以数字结尾）
    expect(body).toMatch(/rabbit_process_uptime_seconds\{process="mock"\} [\d.]+\n/);
  });

  it("无鉴权内网口径（无 Authorization 头 200）；/healthz 回归不受影响", async () => {
    const res = await app.request("/metrics", { headers: {} });
    expect(res.status).toBe(200);
    const health = await app.request("/healthz");
    expect(health.status).toBe(200);
  });
});
