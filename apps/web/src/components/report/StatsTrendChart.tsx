/** S-future RPT-004：纯函数 SVG 趋势图（零图表库依赖，供应链红线+可单测）。
 * 双序列：total 面积（主轴）+ passRate 折线（副轴 0-100%）；无数据日期补零不断轴。 */
"use client";

export interface TrendPoint {
  date: string;
  total: number;
  passed: number;
  failed: number;
  fakeError: number;
  passRate: number | null;
}

const W = 640;
const H = 160;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 12;
const PAD_B = 24;

/** 归一化坐标序列 → path 字符串（纯函数导出供单测：T3 断言无 NaN/undefined） */
export function buildTrendPaths(points: TrendPoint[]): {
  area: string;
  line: string;
  rateLine: string;
  max: number;
} {
  const n = points.length;
  if (n === 0) return { area: "", line: "", rateLine: "", max: 0 };
  const max = Math.max(1, ...points.map((p) => p.total));
  const step = n > 1 ? (W - PAD_L - PAD_R) / (n - 1) : 0;
  const x = (i: number) => PAD_L + i * step;
  const yTotal = (v: number) => H - PAD_B - (v / max) * (H - PAD_T - PAD_B);
  const yRate = (r: number | null) => H - PAD_B - (r ?? 0) * (H - PAD_T - PAD_B); // null 按 0 起画
  const totalPts = points.map((p, i) => `${x(i).toFixed(1)},${yTotal(p.total).toFixed(1)}`);
  const line = n === 1 ? "" : `M${totalPts.join(" L")}`;
  const area =
    `M${PAD_L},${H - PAD_B} L${totalPts.join(" L")}` +
    (n > 1 ? ` L${x(n - 1).toFixed(1)},${H - PAD_B}` : "") +
    " Z";
  const ratePts = points.map(
    (p, i) =>
      `${x(i).toFixed(1)},${yRate(p.passRate === null ? null : p.passRate / 100).toFixed(1)}`,
  );
  const rateLine = n === 1 ? "" : `M${ratePts.join(" L")}`;
  return { area, line, rateLine, max };
}

export function StatsTrendChart({ points }: { points: TrendPoint[] }) {
  const { area, line, rateLine, max } = buildTrendPaths(points);
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((f) => H - PAD_B - f * (H - PAD_T - PAD_B));
  const first = points[0]?.date?.slice(5) ?? "";
  const last = points[points.length - 1]?.date?.slice(5) ?? "";
  const sumTotal = points.reduce((s, p) => s + p.total, 0);
  const sumPassed = points.reduce((s, p) => s + p.passed, 0);
  const sumFailed = points.reduce((s, p) => s + p.failed, 0);
  const rate = sumTotal > 0 ? ((sumPassed / sumTotal) * 100).toFixed(1) : "—";
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="执行趋势图"
        data-testid="stats-trend-svg"
      >
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={PAD_L}
            y1={y}
            x2={W - PAD_R}
            y2={y}
            stroke={i === 0 ? "#e2e8f0" : "#f1f5f9"}
          />
        ))}
        {area && <path d={area} fill="#574BFF" fillOpacity="0.12" />}
        {line && <path d={line} fill="none" stroke="#574BFF" strokeWidth="1.5" />}
        {rateLine && <path d={rateLine} fill="none" stroke="#10b981" strokeWidth="1.5" />}
        {points.map((p, i) =>
          p.total === 0 ? (
            <circle
              key={p.date}
              cx={PAD_L + (points.length > 1 ? (i * (W - PAD_L - PAD_R)) / (points.length - 1) : 0)}
              cy={H - PAD_B}
              r="3"
              fill="#94a3b8"
            >
              <title>{`${p.date} · 0 报告（补零）`}</title>
            </circle>
          ) : null,
        )}
        <text x={PAD_L} y={H - 8} fontSize="10" fill="#94a3b8">
          {first}
        </text>
        <text x={W - PAD_R} y={H - 8} fontSize="10" fill="#94a3b8" textAnchor="end">
          {last}
        </text>
        <text x={PAD_L - 6} y={PAD_T + 4} fontSize="10" fill="#94a3b8" textAnchor="end">
          {max}
        </text>
      </svg>
      <div className="text-xs text-slate-400 mt-1" data-testid="stats-trend-summary">
        {first} … {last} · 共 {points.length} 天 · Σtotal {sumTotal} · Σpassed {sumPassed} · Σfailed{" "}
        {sumFailed} · passRate {rate}
        {sumTotal > 0 ? "%" : ""}
      </div>
    </div>
  );
}
