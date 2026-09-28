/** S-future PLUG-003-T5 单测：保存时协议可用性校验（http/https 放行；未启用插件 → 40511）+ RPT-004 聚合与 SVG 路径。 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DomainError, ErrCode, reportStatsQuerySchema } from "@rabbit/shared";

vi.mock("@rabbit/db", () => {
  const state: Record<string, unknown> = {};
  const prisma = {
    __set: (k: string, v: unknown) => {
      state[k] = v;
    },
    plugin: {
      findFirst: vi.fn(async () => state.pluginHit ?? null),
    },
    report: {
      findMany: vi.fn(async () => state.reports ?? []),
    },
  };
  return { prisma, nextNum: vi.fn(async () => 1) };
});

import { prisma } from "@rabbit/db";
import { assertProtocolAvailable } from "../plugin.service";
import { reportStats } from "../../exec/report-stats.service";

const set = (k: string, v: unknown) =>
  (prisma as unknown as { __set: (k: string, v: unknown) => void }).__set(k, v);

beforeEach(() => {
  set("pluginHit", null);
  set("reports", []);
});

describe("PLUG-003-T5 assertProtocolAvailable", () => {
  it("http/https/undefined 直接放行（不查库）", async () => {
    await expect(assertProtocolAvailable(undefined)).resolves.toBeUndefined();
    await expect(assertProtocolAvailable("http")).resolves.toBeUndefined();
    await expect(assertProtocolAvailable("HTTPS")).resolves.toBeUndefined();
  });
  it("已启用同名协议插件放行", async () => {
    set("pluginHit", { id: "p1" });
    await expect(assertProtocolAvailable("websocket")).resolves.toBeUndefined();
  });
  it("未启用/不存在 → DomainError 40511（PLUG-002 预留码首次兑现）", async () => {
    set("pluginHit", null);
    await expect(assertProtocolAvailable("mqtt")).rejects.toMatchObject({
      code: ErrCode.PROTOCOL_PLUGIN_LOAD_FAILED,
    });
  });
});

describe("RPT-004-T1/T2 报告统计聚合", () => {
  const mk = (offsetDays: number, reportType: string, summary: object) => {
    const d = new Date();
    d.setDate(d.getDate() - offsetDays);
    return {
      summary: JSON.stringify(summary),
      reportType,
      createdAt: d,
      name: `${reportType}-${offsetDays}`,
      taskId: `t-${offsetDays}-${reportType}`,
    };
  };

  it("补零连续序列 + passRate 口径 + 分布 + TOP5 排序", async () => {
    set("reports", [
      mk(0, "scenario", { total: 10, passed: 9, failed: 1, fakeError: 0, durationMs: 4200 }),
      mk(0, "api_case", { total: 4, passed: 4, failed: 0, durationMs: 1100 }),
      mk(3, "scenario", { total: 5, passed: 3, failed: 2, fakeError: 1, durationMs: 12800 }),
    ]);
    const r = await reportStats("p1", 7);
    expect(r.trend).toHaveLength(7);
    const zeroDays = r.trend.filter((t) => t.total === 0);
    expect(zeroDays.length).toBeGreaterThanOrEqual(4); // 至少 7-3 天补零
    const day1 = r.trend[6]!;
    expect(day1).toMatchObject({ total: 14, passed: 13, failed: 1 });
    expect(day1.passRate).toBeCloseTo(13 / 14);
    const sc = r.byType.find((b) => b.reportType === "scenario")!;
    expect(sc.total).toBe(15);
    expect(r.topFailed[0]).toMatchObject({ taskId: "t-3-scenario", failed: 2 });
    expect(r.range.days).toBe(7);
  });

  it("空窗口：全零序列 + 空 TOP", async () => {
    const r = await reportStats("p1", 7);
    expect(r.trend.every((t) => t.total === 0)).toBe(true);
    expect(r.trend.every((t) => t.passRate === null)).toBe(true);
    expect(r.topFailed).toEqual([]);
  });

  it("days 校验：13/abc 拒绝（422·60422 前置）", () => {
    expect(reportStatsQuerySchema.safeParse({ days: 13 }).success).toBe(false);
    expect(reportStatsQuerySchema.safeParse({ days: "abc" }).success).toBe(false);
    expect(reportStatsQuerySchema.safeParse({}).success).toBe(true); // 默认 14
  });
});
