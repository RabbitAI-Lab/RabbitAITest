/** S10 INFRA-009：engine 进程快照 procSnapshot 单测。 */
import { describe, expect, it } from "vitest";
import { procSnapshot } from "../runner/worker";

describe("INFRA-009 procSnapshot", () => {
  it("四字段齐全且为有限非负数；cpuUsage 折算秒；内存取整", () => {
    const s = procSnapshot();
    expect(Number.isFinite(s.uptimeSeconds)).toBe(true);
    expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(s.cpuSeconds)).toBe(true);
    expect(s.cpuSeconds).toBeGreaterThanOrEqual(0);
    expect(s.rssBytes).toBeGreaterThan(0);
    expect(Number.isInteger(s.rssBytes)).toBe(true);
    expect(s.heapUsedBytes).toBeGreaterThan(0);
    expect(Number.isInteger(s.heapUsedBytes)).toBe(true);
  });

  it("连续两次采样 uptime 不减（进程存活单调）", () => {
    const a = procSnapshot();
    const b = procSnapshot();
    expect(b.uptimeSeconds).toBeGreaterThanOrEqual(a.uptimeSeconds);
    expect(b.cpuSeconds).toBeGreaterThanOrEqual(a.cpuSeconds);
  });
});
