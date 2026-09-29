"use client";

import { Empty, Segmented, Spin, Table } from "antd";
import { BarChart3 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportV2Api } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { StatsTrendChart } from "@/components/report/StatsTrendChart";
import { useProjectStore } from "@/stores/project";

/** S-future RPT-004：报告统计（7/14/30 天趋势 + 类型分布 + 失败 TOP5；超出基线自主设计）。 */

const TYPE_LABEL: Record<string, string> = {
  api_case: "接口用例",
  api_debug: "调试",
  scenario: "场景",
  plan: "测试计划",
};
const pct = (r: number | null) => (r === null ? "—" : `${(r * 100).toFixed(1)}%`);

export default function ReportStatsPage() {
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const [days, setDays] = useState<7 | 14 | 30>(14);

  const { data, isLoading } = useQuery({
    queryKey: ["report-stats", currentProjectId, days],
    queryFn: () => reportV2Api.stats(currentProjectId!, days),
    enabled: Boolean(currentProjectId),
  });

  if (!currentProjectId) {
    return (
      <div>
        <PageHeader title="报告统计" sub="接口报告 · 统计" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }

  const empty = !isLoading && (data?.trend.every((t) => t.total === 0) ?? true);

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]">
      <PageHeader
        title="报告统计"
        sub={`接口报告 · 列表 ｜ 统计 · ${data ? `${data.range.from} ~ ${data.range.to}` : ""}`}
        extra={
          <Segmented
            value="stats"
            onChange={(v) => v === "list" && router.push("/reports")}
            options={[
              { label: "列表", value: "list" },
              { label: "统计", value: "stats" },
            ]}
            data-testid="report-tab"
          />
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-slate-500">统计窗口</span>
          <Segmented
            value={days}
            onChange={(v) => setDays(v as 7 | 14 | 30)}
            options={[
              { label: "7 天", value: 7 },
              { label: "14 天", value: 14 },
              { label: "30 天", value: 30 },
            ]}
            data-testid="stats-range"
          />
        </div>
      </div>

      {isLoading || !data ? (
        <div className="rabbit-card flex justify-center py-16">
          <Spin />
        </div>
      ) : empty ? (
        <div
          className="rabbit-card p-10 flex flex-col items-center text-center space-y-2"
          data-testid="stats-empty"
        >
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <BarChart3 size={22} className="text-slate-400" />
          </div>
          <div className="font-medium">窗口内暂无报告</div>
          <p className="text-slate-500 text-xs">
            执行接口用例 / 场景 / 测试计划后，此处呈现趋势与失败分布
          </p>
          <a
            className="text-[#574BFF] text-xs underline cursor-pointer"
            onClick={() => router.push("/debug")}
          >
            去接口调试执行一次 →
          </a>
        </div>
      ) : (
        <>
          <div className="rabbit-card p-4" data-testid="stats-trend">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">执行趋势</span>
              <span className="text-xs text-slate-400">
                ■ 报告总量 · ─ 通过率（零报告日标记灰点）
              </span>
            </div>
            <StatsTrendChart points={data.trend} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rabbit-card p-4" data-testid="stats-bytype">
              <div className="font-medium text-sm mb-3">类型分布</div>
              <div className="space-y-3 text-xs">
                {data.byType.map((t) => (
                  <div key={t.reportType} className="flex items-center gap-2">
                    <span className="w-16 text-slate-500">
                      {TYPE_LABEL[t.reportType] ?? t.reportType}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded">
                      <div
                        className="h-2 rounded"
                        style={{
                          width: `${Math.round((t.passRate ?? 0) * 100)}%`,
                          background:
                            (t.passRate ?? 0) >= 0.9
                              ? "#52c41a"
                              : (t.passRate ?? 0) >= 0.7
                                ? "#faad14"
                                : "#ff4d4f",
                        }}
                      />
                    </div>
                    <span className="w-28 text-right text-slate-400">
                      {t.total} 项 · {pct(t.passRate)}
                    </span>
                  </div>
                ))}
                {data.byType.length === 0 && (
                  <span className="text-slate-400">窗口内无类型数据</span>
                )}
              </div>
            </div>

            <div className="rabbit-card p-4" data-testid="stats-topfailed">
              <div className="font-medium text-sm mb-2">失败 TOP5</div>
              <Table
                rowKey={(r) => r.taskId}
                dataSource={data.topFailed}
                size="small"
                pagination={false}
                locale={{
                  emptyText: (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="窗口内无失败报告" />
                  ),
                }}
                columns={[
                  {
                    title: "报告",
                    dataIndex: "name",
                    render: (v: string, r) => (
                      <a
                        className="text-[#574BFF]"
                        onClick={() => router.push(`/reports/${r.taskId}`)}
                      >
                        {v}
                      </a>
                    ),
                  },
                  {
                    title: "类型",
                    dataIndex: "reportType",
                    width: 90,
                    render: (v: string) => TYPE_LABEL[v] ?? v,
                  },
                  {
                    title: "失败",
                    dataIndex: "failed",
                    width: 70,
                    render: (v: number) => <span className="text-red-500">{v}</span>,
                  },
                  {
                    title: "耗时",
                    dataIndex: "durationMs",
                    width: 90,
                    render: (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1)}s`),
                  },
                ]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
