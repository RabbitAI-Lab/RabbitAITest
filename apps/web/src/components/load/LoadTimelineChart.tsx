/** S11 LOAD-003：SVG 秒级时间线曲线（多序列，零图表库——RPT-004 StatsTrendChart 先例扩展）。 */
import type { LoadMetricFrame } from "@rabbit/shared";

export interface LoadSeries {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  pick: (f: LoadMetricFrame) => number;
}

export function LoadTimelineChart({
  frames,
  series,
  height = 160,
  testid,
}: {
  frames: LoadMetricFrame[];
  series: LoadSeries[];
  height?: number;
  testid: string;
}) {
  const W = 640;
  const H = height;
  const padB = 18;
  const maxY = Math.max(1, ...frames.flatMap((f) => series.map((s) => s.pick(f))));
  const x = (i: number) => (frames.length > 1 ? (i / (frames.length - 1)) * W : W / 2);
  const y = (v: number) => H - padB - (v / maxY) * (H - padB - 8);
  return (
    <div className="border rounded p-3 bg-white" data-testid={testid}>
      <div className="flex items-center gap-3 text-xs text-slate-500 mb-1">
        {series.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span
              className="inline-block w-4 border-t-2"
              style={{ borderColor: s.color, borderStyle: s.dashed ? "dashed" : "solid" }}
            />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-slate-400">{frames.length} 秒级点</span>
      </div>
      {frames.length === 0 ? (
        <div className="h-32 flex items-center justify-center text-xs text-slate-400">
          暂无度量数据
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
          {[0.25, 0.5, 0.75].map((r) => (
            <line
              key={r}
              x1={0}
              y1={H - padB - r * (H - padB - 8)}
              x2={W}
              y2={H - padB - r * (H - padB - 8)}
              stroke="#e2e8f0"
              strokeWidth={1}
            />
          ))}
          {series.map((s) => (
            <polyline
              key={s.key}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 3" : undefined}
              points={frames.map((f, i) => `${x(i)},${y(s.pick(f))}`).join(" ")}
            />
          ))}
          <text x={4} y={12} fontSize={10} fill="#94a3b8">
            max {Math.round(maxY)}
          </text>
        </svg>
      )}
    </div>
  );
}
