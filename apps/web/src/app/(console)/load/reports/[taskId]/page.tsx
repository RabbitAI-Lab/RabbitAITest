"use client";

/** S11 LOAD-003：压测报告（/load/reports/{taskId}）——汇总卡 + RT 分位三线 + 阈值逐项判定。 */
import { Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { loadApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { LoadTimelineChart } from "@/components/load/LoadTimelineChart";
import { useProjectStore } from "@/stores/project";

const VERDICT_LABEL: Record<string, string> = { okRate: "成功率", p95: "P95", avg: "平均 RT" };

export default function LoadReportPage() {
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;

  const { data, isLoading, error } = useQuery({
    queryKey: ["load-report", currentProjectId, taskId],
    queryFn: () => loadApi.report(currentProjectId!, taskId),
    enabled: Boolean(currentProjectId) && Boolean(taskId),
    retry: 1,
  });

  const s = data?.summary;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="load-report-page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            压测报告
            {s && (
              <Tag
                color={s.verdict === "SUCCESS" ? "success" : "error"}
                data-testid="load-report-verdict-tag"
              >
                结论 {s.verdict}
              </Tag>
            )}
          </span>
        }
        sub={data ? `${data.name} · ${new Date(data.createdAt).toLocaleString("zh-CN")}` : ""}
        extra={
          <a className="text-[#574BFF] text-sm" onClick={() => router.push("/load")}>
            返回列表
          </a>
        }
      />
      <Spin spinning={isLoading}>
        {error ? (
          <div className="border rounded p-10 bg-white text-center text-slate-400 text-sm">
            报告不存在（任务未完成或已被清理）
          </div>
        ) : data && s ? (
          <>
            <div className="grid grid-cols-5 gap-3 text-center" data-testid="load-report-summary">
              <div className="border rounded p-2 bg-white">
                <div className="text-xs text-slate-400">总请求</div>
                <div className="text-base font-semibold">{s.totalSent.toLocaleString()}</div>
              </div>
              <div className="border rounded p-2 bg-white">
                <div className="text-xs text-slate-400">成功率</div>
                <div className={`text-base font-semibold ${s.okRate >= 99 ? "text-emerald-600" : "text-amber-600"}`}>
                  {s.okRate}%
                </div>
              </div>
              <div className="border rounded p-2 bg-white">
                <div className="text-xs text-slate-400">峰值 TPS</div>
                <div className="text-base font-semibold">{s.peakTps}</div>
              </div>
              <div className="border rounded p-2 bg-white">
                <div className="text-xs text-slate-400">P95</div>
                <div className="text-base font-semibold">{s.p95Ms}ms</div>
              </div>
              <div className="border rounded p-2 bg-white">
                <div className="text-xs text-slate-400">P99</div>
                <div className="text-base font-semibold">{s.p99Ms}ms</div>
              </div>
            </div>
            <LoadTimelineChart
              testid="load-report-chart"
              frames={data.frames}
              series={[
                { key: "tps", label: "TPS", color: "#574BFF", pick: (f) => f.sent },
                { key: "fail", label: "失败/s", color: "#ef4444", pick: (f) => f.fail },
              ]}
            />
            <LoadTimelineChart
              testid="load-report-rt-chart"
              frames={data.frames}
              height={130}
              series={[
                { key: "p50", label: "P50", color: "#574BFF", pick: (f) => f.rtP50 },
                { key: "p95", label: "P95", color: "#f59e0b", pick: (f) => f.rtP95 },
                { key: "p99", label: "P99", color: "#ef4444", dashed: true, pick: (f) => f.rtP99 },
              ]}
            />
            <div
              className="text-xs border rounded p-3 bg-slate-50 space-y-1"
              data-testid="load-report-verdict"
            >
              <div className="text-slate-500">阈值判定（全部达标=SUCCESS，任一越限=FAILED）：</div>
              {s.items.map((i) => (
                <div key={i.key} className={i.passed ? "text-emerald-600" : "text-red-500"}>
                  {VERDICT_LABEL[i.key]} {i.actual}
                  {i.key === "okRate" ? "%" : "ms"} {i.key === "okRate" ? "≥" : "≤"} {i.threshold}
                  {i.key === "okRate" ? "%" : "ms"} {i.passed ? "✓" : "✗"}
                </div>
              ))}
            </div>
          </>
        ) : null}
      </Spin>
    </div>
  );
}
