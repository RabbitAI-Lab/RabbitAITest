"use client";

import { Collapse, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { ApiError, planShareApi, type PlanReportRow } from "@rabbit/api-client";

/** PLAN-005：计划报告免登分享页（token 即凭证；失效/过期统一灰空态）。
 *  注：本页位于 (console) 路由组之外——console 布局含服务端登录重定向，免登页须独立于该布局。 */

const TYPE_TEXT: Record<string, { label: string; cls: string }> = {
  functional_case: { label: "功能用例", cls: "bg-blue-50 text-blue-600" },
  api_case: { label: "接口用例", cls: "bg-[#574BFF]/10 text-[#574BFF]" },
  scenario: { label: "场 景", cls: "bg-teal-50 text-teal-600" },
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  NOT_RUN: { label: "未执行", color: "#87888D" },
  PASS: { label: "通过", color: "#52C41A" },
  FAIL: { label: "失败", color: "#FF4D4F" },
  BLOCKED: { label: "阻塞", color: "#FA8C16" },
  SKIPPED: { label: "跳过", color: "#C9CDD4" },
  FAKE_ERROR: { label: "误报", color: "#FF4D4F" },
};

const ROW_COLUMNS = [
  {
    title: "类型",
    dataIndex: "refType",
    width: 90,
    render: (v: string) => (
      <span
        className={`rounded px-1.5 py-0.5 text-xs ${TYPE_TEXT[v]?.cls ?? "bg-[#F2F3F5] text-[#646A73]"}`}
      >
        {TYPE_TEXT[v]?.label ?? v}
      </span>
    ),
  },
  { title: "名称", dataIndex: "name", ellipsis: true },
  {
    title: "执行人",
    dataIndex: "executor",
    width: 100,
    render: (v: string | null) => v ?? "—",
  },
  {
    title: "状态",
    dataIndex: "status",
    width: 90,
    render: (v: string) => {
      const meta = STATUS_META[v] ?? { label: v, color: "#87888D" };
      return <span style={{ color: meta.color }}>{meta.label}</span>;
    },
  },
  {
    title: "实际结果",
    dataIndex: "actualResult",
    ellipsis: true,
    render: (v: string) => v || "—",
  },
  {
    title: "最近执行",
    dataIndex: "lastRunAt",
    width: 140,
    render: (v: string | null) =>
      v ? v.replace("T", " ").slice(0, 16) : <span className="text-[#C9CDD4]">—</span>,
  },
];

export default function SharePlanPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error } = useQuery({
    queryKey: ["share-plan", token],
    queryFn: () => planShareApi.detail(token),
    enabled: Boolean(token),
    retry: false,
  });

  // 失效统一空态：过期 / 已撤销 / 不存在（SHARE_NOT_FOUND 60414 → HTTP 404）
  if (error) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] grid place-items-center p-6">
        <div
          className="bg-white border border-[#E5E6EB] rounded-md py-24 px-16 grid place-items-center gap-2 w-full max-w-xl"
          data-testid="share-plan-expired"
        >
          <p className="text-[#C9CDD4] text-2xl font-medium m-0">分享链接不存在或已过期</p>
          <p className="text-[#A8ABB0] text-sm m-0">
            链接可能已被撤销、超过有效期，或从未创建
            {error instanceof ApiError && error.code
              ? `（${error.code}）`
              : "（SHARE_NOT_FOUND 60414）"}
          </p>
          <a className="text-[#574BFF] text-sm mt-2" href="/">
            前往 RabbitAITest 首页
          </a>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F5F6FA] grid place-items-center">
        <p className="text-sm text-[#A8ABB0]">计划报告加载中…</p>
      </div>
    );
  }

  const o = data.overview;
  const cards = [
    { label: "用例总数", value: o.total },
    {
      label: "已执行",
      value: o.executed,
      sub: o.total > 0 ? `${Math.round((o.executed / o.total) * 100)}%` : "0%",
    },
    { label: "通过", value: o.pass, color: "#52C41A" },
    { label: "失败", value: o.fail, color: "#FF4D4F" },
    { label: "阻塞", value: o.blocked, color: "#FA8C16" },
    { label: "跳过", value: o.skipped, sub: `误报 ${o.fakeError}`, color: "#C9CDD4" },
  ];

  return (
    <div className="min-h-screen bg-[#F5F6FA] p-6" data-testid="share-plan-page">
      <div className="max-w-5xl mx-auto space-y-4">
        {/* 只读横幅 */}
        <div
          className="rounded-md bg-[#574BFF]/[.06] border border-[#574BFF]/20 px-4 py-2.5 text-[13px] text-[#574BFF] flex items-center justify-between"
          data-testid="share-plan-banner"
        >
          <span>
            只读分享 · 报告生成于 {data.generatedAt.replace("T", " ").slice(0, 16)}
            <span className="text-xs text-[#574BFF]/70">（撤销或过期后本页不可访问）</span>
          </span>
          <a
            className="text-xs text-[#574BFF] hover:underline"
            href={`/share/plan/${token}/print`}
            target="_blank"
            rel="noreferrer"
            data-testid="share-plan-print-link"
          >
            打印版
          </a>
        </div>

        {/* 头部：计划名 + 阈值横幅（达标绿 / 未达标红 / 无结果灰） */}
        <div className="bg-white border border-[#E5E6EB] rounded-md p-4">
          <h1 className="text-base font-medium m-0" data-testid="share-plan-title">
            {data.planName} · 测试计划报告（分享）
          </h1>
          <div className="mt-2">
            {o.thresholdMet === null ? (
              <span
                className="inline-block rounded px-2 py-0.5 text-xs bg-[#F2F3F5] text-[#646A73]"
                data-testid="share-plan-threshold"
              >
                暂无执行结果，无法判定阈值（阈值 {data.threshold}%）
              </span>
            ) : o.thresholdMet ? (
              <span
                className="inline-block rounded px-2 py-0.5 text-xs bg-[#52C41A]/10 text-[#52C41A]"
                data-testid="share-plan-threshold"
              >
                通过率 {o.passRate}% ≥ 阈值 {data.threshold}% · 阈值达标
              </span>
            ) : (
              <span
                className="inline-block rounded px-2 py-0.5 text-xs bg-[#FF4D4F]/10 text-[#FF4D4F]"
                data-testid="share-plan-threshold"
              >
                通过率 {o.passRate}% &lt; 阈值 {data.threshold}% · 未达标
              </span>
            )}
          </div>
        </div>

        {/* 概览六卡 */}
        <div className="grid grid-cols-6 gap-3" data-testid="share-plan-cards">
          {cards.map((c) => (
            <div key={c.label} className="bg-white border border-[#E5E6EB] rounded-md p-3">
              <p className="text-xs text-[#A8ABB0] m-0">{c.label}</p>
              <p
                className="text-2xl font-semibold mt-1 mb-0"
                style={c.color ? { color: c.color } : undefined}
              >
                {c.value}
              </p>
              {c.sub && <p className="text-xs text-[#A8ABB0] m-0">{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* 测试点分组明细（折叠，默认全展开） */}
        <div
          className="bg-white border border-[#E5E6EB] rounded-md p-3"
          data-testid="share-plan-points"
        >
          <p className="rabbit-card-title">测试点分组明细</p>
          {data.points.length === 0 ? (
            <p className="text-[13px] text-[#A8ABB0] m-0">计划尚未关联用例</p>
          ) : (
            <Collapse
              size="small"
              defaultActiveKey={data.points.map((_, i) => String(i))}
              items={data.points.map((p, i) => ({
                key: String(i),
                label: (
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-[13px]">{p.name}</span>
                    <span className="text-xs text-[#87888D]">{p.rows.length} 条</span>
                    <span
                      className={`text-[10px] rounded px-1 py-0.5 ${
                        p.passRate === null
                          ? "bg-[#F2F3F5] text-[#87888D]"
                          : p.passRate >= data.threshold
                            ? "bg-[#52C41A]/10 text-[#52C41A]"
                            : "bg-[#FF4D4F]/10 text-[#FF4D4F]"
                      }`}
                    >
                      通过率 {p.passRate === null ? "—" : `${p.passRate}%`}
                    </span>
                  </span>
                ),
                children:
                  p.rows.length === 0 ? (
                    <p className="text-[13px] text-[#A8ABB0] m-0">该测试点暂无用例</p>
                  ) : (
                    <Table<PlanReportRow>
                      rowKey="refId"
                      size="small"
                      pagination={false}
                      dataSource={p.rows}
                      columns={ROW_COLUMNS}
                    />
                  ),
              }))}
            />
          )}
        </div>

        {/* 总结（只读） */}
        <div
          className="bg-white border border-[#E5E6EB] rounded-md p-4"
          data-testid="share-plan-summary"
        >
          <p className="rabbit-card-title">报告总结</p>
          <p className="text-[13px] whitespace-pre-wrap m-0">{data.summary || "（暂无总结）"}</p>
        </div>
      </div>
    </div>
  );
}
