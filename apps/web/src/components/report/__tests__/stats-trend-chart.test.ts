/** S-future RPT-004-T3：SVG 趋势图纯函数（路径无 NaN/undefined；单点退化；空输入）。 */
import { describe, expect, it } from "vitest";
import { buildTrendPaths } from "../StatsTrendChart";

const pt = (date: string, total: number, passRate: number | null) => ({
  date,
  total,
  passed: Math.round(total * (passRate ?? 0)),
  failed: total - Math.round(total * (passRate ?? 0)),
  fakeError: 0,
  passRate,
});

describe("buildTrendPaths", () => {
  it("常规序列：路径完整且不含 NaN/undefined", () => {
    const { area, line, rateLine, max } = buildTrendPaths([
      pt("2026-09-26", 5, 0.8),
      pt("2026-09-27", 0, null),
      pt("2026-09-28", 9, 0.9),
    ]);
    expect(max).toBe(9);
    for (const p of [area, line, rateLine]) {
      expect(p).toBeTruthy();
      expect(p).not.toMatch(/NaN|undefined/);
    }
    expect(area.endsWith("Z")).toBe(true); // 面积闭合
  });
  it("单点序列：折线退化为空、面积零宽", () => {
    const { line, area } = buildTrendPaths([pt("2026-09-28", 3, 1)]);
    expect(line).toBe("");
    expect(area).not.toMatch(/NaN|undefined/);
  });
  it("空输入：全部空串", () => {
    expect(buildTrendPaths([])).toEqual({ area: "", line: "", rateLine: "", max: 0 });
  });
});
