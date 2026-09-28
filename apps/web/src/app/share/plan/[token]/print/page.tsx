"use client";

import { Button, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect } from "react";
import { ApiError, planShareApi, type PlanReportRow } from "@rabbit/api-client";

/** PLAN-005：计划报告分享·打印页（白底 A4 版式，加载后 1s 自动 window.print）。
 *  与分享页同数据源（planShareApi.detail），隐藏交互元素（按钮 print:hidden、测试点全部平铺不折叠）。 */

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
    width: 84,
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
    width: 96,
    render: (v: string | null) => v ?? "—",
  },
  {
    title: "状态",
    dataIndex: "status",
    width: 84,
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
    width: 130,
    render: (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—"),
  },
];

export default function SharePlanPrintPage() {
  const { token } = useParams<{ token: string }>();
  const { data, error } = useQuery({
    queryKey: ["share-plan-print", token],
    queryFn: () => planShareApi.detail(token),
    enabled: Boolean(token),
    retry: false,
  });

  // 数据就绪后 1s 自动唤起打印对话框（仅一次）
  useEffect(() => {
    if (!data) return;
    const t = setTimeout(() => window.print(), 1000);
    return () => clearTimeout(t);
  }, [data]);

  if (error) {
    return (
      <div
        className="min-h-screen bg-white grid place-items-center p-6"
        data-testid="share-plan-expired"
      >
        <div className="grid place-items-center gap-2">
          <p className="text-[#C9CDD4] text-2xl font-medium m-0">分享链接不存在或已过期</p>
          <p className="text-[#A8ABB0] text-sm m-0">
            链接可能已被撤销、超过有效期，或从未创建
            {error instanceof ApiError && error.code
              ? `（${error.code}）`
              : "（SHARE_NOT_FOUND 60414）"}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-white grid place-items-center">
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
    <div className="min-h-screen bg-white py-8" data-testid="share-plan-print-page">
      {/* A4 版式（794px ≈ 210mm @96dpi），白底、交互元素仅屏显（print:hidden） */}
      <div className="w-[794px] mx-auto space-y-5">
        <div className="flex items-center justify-between print:hidden">
          <a className="text-xs text-[#574BFF]" href={`/share/plan/${token}`}>
            ← 返回分享页
          </a>
          <Button type="primary" onClick={() => window.print()} data-testid="share-plan-print-btn">
            🖨 打印/导出 PDF
          </Button>
        </div>

        {/* 标题 + 阈值横幅 */}
        <div className="border-b-2 border-[#1F2329] pb-2">
          <h1 className="text-xl font-semibold m-0">{data.planName} · 测试计划报告</h1>
          <p className="text-xs text-[#646A73] mt-1 mb-1">
            报告生成于 {data.generatedAt.replace("T", " ").slice(0, 16)} · 免登只读分享（打印版）
          </p>
          {o.thresholdMet === null ? (
            <span className="text-xs text-[#646A73]" data-testid="share-plan-threshold">
              暂无执行结果，无法判定阈值（阈值 {data.threshold}%）
            </span>
          ) : o.thresholdMet ? (
            <span className="text-xs font-medium text-[#52C41A]" data-testid="share-plan-threshold">
              通过率 {o.passRate}% ≥ 阈值 {data.threshold}% · 阈值达标
            </span>
          ) : (
            <span className="text-xs font-medium text-[#FF4D4F]" data-testid="share-plan-threshold">
              通过率 {o.passRate}% &lt; 阈值 {data.threshold}% · 未达标
            </span>
          )}
        </div>

        {/* 概览六卡 */}
        <div className="grid grid-cols-6 gap-3" data-testid="share-plan-cards">
          {cards.map((c) => (
            <div key={c.label} className="border border-[#E5E6EB] rounded-md p-3">
              <p className="text-xs text-[#646A73] m-0">{c.label}</p>
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

        {/* 测试点分组明细（打印页全展开，不用折叠面板） */}
        <div data-testid="share-plan-points">
          <p className="text-sm font-semibold m-0 mb-2">测试点分组明细</p>
          {data.points.length === 0 ? (
            <p className="text-[13px] text-[#646A73] m-0">计划尚未关联用例</p>
          ) : (
            <div className="space-y-4">
              {data.points.map((p) => (
                <div key={p.pointId ?? "ungrouped"}>
                  <p className="text-[13px] font-medium m-0 mb-1 flex items-center gap-2">
                    {p.name}
                    <span className="text-xs text-[#646A73] font-normal">{p.rows.length} 条</span>
                    <span
                      className={`text-[10px] rounded px-1 py-0.5 font-normal ${
                        p.passRate === null
                          ? "bg-[#F2F3F5] text-[#646A73]"
                          : p.passRate >= data.threshold
                            ? "bg-[#52C41A]/10 text-[#52C41A]"
                            : "bg-[#FF4D4F]/10 text-[#FF4D4F]"
                      }`}
                    >
                      通过率 {p.passRate === null ? "—" : `${p.passRate}%`}
                    </span>
                  </p>
                  {p.rows.length === 0 ? (
                    <p className="text-[13px] text-[#A8ABB0] m-0">该测试点暂无用例</p>
                  ) : (
                    <Table<PlanReportRow>
                      rowKey="refId"
                      size="small"
                      bordered
                      pagination={false}
                      dataSource={p.rows}
                      columns={ROW_COLUMNS}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 总结（只读） */}
        <div data-testid="share-plan-summary">
          <p className="text-sm font-semibold m-0 mb-1">报告总结</p>
          <p className="text-[13px] whitespace-pre-wrap m-0 border border-[#F0F1F3] rounded-md p-3">
            {data.summary || "（暂无总结）"}
          </p>
        </div>
      </div>
    </div>
  );
}
