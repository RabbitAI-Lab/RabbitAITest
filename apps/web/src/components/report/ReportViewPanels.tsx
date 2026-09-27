"use client";

import { Empty, Input, Table } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { reportV2Api, type ReportDetailV2, type ReportItemView } from "@rabbit/api-client";
import type { EventFrame } from "@rabbit/shared";

/**
 * RPT-002 报告视图面板（详情页与免登分享页共用）：
 * 统计三卡 / 用例级 item 表 / 步骤钻取（itemFrames → 请求快照·响应·断言·提取值·日志）。
 */

export const REPORT_STATUS_META: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: "成功", color: "#52C41A" },
  FAILED: { label: "失败", color: "#FF4D4F" },
  RUNNING: { label: "执行中", color: "#1677FF" },
  PENDING: { label: "执行中", color: "#1677FF" },
  STOPPED: { label: "已停止", color: "#87888D" },
};

const ITEM_STATUS_META: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: "SUCCESS", color: "#52C41A" },
  FAILED: { label: "FAILED", color: "#FF4D4F" },
  SKIPPED: { label: "SKIPPED", color: "#87888D" },
  STOPPED: { label: "STOPPED", color: "#87888D" },
  PENDING: { label: "PENDING", color: "#1677FF" },
  RUNNING: { label: "RUNNING", color: "#1677FF" },
};

const ASSERT_KIND_TEXT: Record<string, string> = {
  status_code: "状态码",
  response_header: "响应头",
  body_jsonpath: "响应体 JSONPath",
  body_regex: "响应体正则",
  response_time: "响应时间",
  variable: "变量",
};
const OP_TEXT: Record<string, string> = {
  eq: "等于",
  contains: "包含",
  lt: "小于",
  le: "不大于",
  gt: "大于",
  ge: "不小于",
  regex: "匹配",
};

type StepResultFrame = Extract<EventFrame, { type: "step-result" }>;
type LogFrameView = Extract<EventFrame, { type: "log" }>;

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")}h`;
}

/** 统计三卡：通过 / 失败 / 总耗时（api_case 报告头部） */
export function ReportSummaryCards({
  summary,
  durationMs,
}: {
  summary?: { total?: number; passed?: number; failed?: number };
  durationMs?: number;
}) {
  return (
    <div className="grid grid-cols-3 gap-4" data-testid="report-summary-cards">
      <div className="rabbit-card p-4">
        <p className="text-xs text-[#A8ABB0] m-0">通过</p>
        <p className="text-2xl font-semibold mt-1 mb-0 text-[#52C41A]">
          {summary?.passed ?? 0}
          <span className="text-sm font-normal text-[#A8ABB0]"> / {summary?.total ?? 0}</span>
        </p>
      </div>
      <div className="rabbit-card p-4">
        <p className="text-xs text-[#A8ABB0] m-0">失败</p>
        <p className="text-2xl font-semibold mt-1 mb-0 text-[#FF4D4F]">{summary?.failed ?? 0}</p>
      </div>
      <div className="rabbit-card p-4">
        <p className="text-xs text-[#A8ABB0] m-0">总耗时</p>
        <p className="text-2xl font-semibold mt-1 mb-0">{fmtDuration(durationMs)}</p>
      </div>
    </div>
  );
}

/** 用例级 item 表 + 行点击钻取（drillEnabled=false 时只读，用于免登分享页） */
export function ReportItemsTable({
  projectId,
  taskId,
  items,
  drillEnabled = true,
}: {
  projectId?: string;
  taskId?: string;
  items: ReportItemView[];
  drillEnabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((i) => i.itemId === selectedId) ?? null;

  return (
    <div className="rabbit-card" data-testid="report-items">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#F0F1F3]">
        <p className="text-sm font-medium m-0">
          用例级结果
          <span className="text-xs text-[#A8ABB0] font-normal ml-2">
            （api_case 聚合 · {drillEnabled ? "点击行展开步骤钻取" : "只读"}）
          </span>
        </p>
        {!drillEnabled && (
          <p className="text-xs text-[#A8ABB0] m-0">步骤钻取需登录后在报告详情页查看</p>
        )}
      </div>
      <Table<ReportItemView>
        rowKey="itemId"
        size="small"
        pagination={false}
        dataSource={items}
        data-testid="report-items-table"
        rowClassName={(r) =>
          r.itemId === selectedId
            ? "bg-[#574BFF]/[.05] cursor-pointer"
            : drillEnabled
              ? "cursor-pointer"
              : ""
        }
        onRow={(r) =>
          ({
            onClick: () => {
              if (!drillEnabled) return;
              setSelectedId((cur) => (cur === r.itemId ? null : r.itemId));
            },
          }) as React.HTMLAttributes<HTMLTableRowElement>
        }
        columns={[
          {
            title: "用例名",
            dataIndex: "name",
            render: (v: string) => <span>{v}</span>,
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (v: string) => {
              const meta = ITEM_STATUS_META[v] ?? { label: v, color: "#87888D" };
              return (
                <span style={{ color: meta.color }} className={v === "FAILED" ? "font-medium" : ""}>
                  {meta.label}
                </span>
              );
            },
          },
          {
            title: "耗时",
            dataIndex: "durationMs",
            width: 100,
            render: (v: number | null) => fmtDuration(v),
          },
          {
            title: "断言",
            key: "asserts",
            width: 90,
            render: (_, r) => (
              <span
                style={{
                  color:
                    r.assertPassed === r.assertTotal ? "#52C41A" : r.assertTotal > 0 ? "#FF4D4F" : "#87888D",
                }}
              >
                {r.assertPassed}/{r.assertTotal}
              </span>
            ),
          },
          ...(drillEnabled
            ? [
                {
                  title: "",
                  key: "chevron",
                  width: 36,
                  render: (_: unknown, r: ReportItemView) => (
                    <span className={r.itemId === selectedId ? "text-[#574BFF]" : "text-[#A8ABB0]"}>
                      {r.itemId === selectedId ? "▾" : "▸"}
                    </span>
                  ),
                },
              ]
            : []),
        ]}
      />
      {drillEnabled && selected && projectId && taskId && (
        <ItemDrillPanel projectId={projectId} taskId={taskId} item={selected} />
      )}
    </div>
  );
}

/** 步骤钻取：itemFrames 全帧视图（请求快照 / 响应 / 断言 / 提取值 / 日志流） */
export function ItemDrillPanel({
  projectId,
  taskId,
  item,
}: {
  projectId: string;
  taskId: string;
  item: ReportItemView;
}) {
  const framesQ = useQuery({
    queryKey: ["report-item-frames", projectId, taskId, item.itemId],
    queryFn: () => reportV2Api.itemFrames(projectId, taskId, item.itemId),
  });
  const frames = (framesQ.data ?? []) as EventFrame[];
  const step = frames.find((f) => f.type === "step-result") as StepResultFrame | undefined;
  const logs = frames.filter((f): f is LogFrameView => f.type === "log");

  return (
    <div className="border-t border-[#F0F1F3]" data-testid="item-drilldown">
      <p className="px-4 py-2.5 border-b border-[#F0F1F3] text-sm font-medium m-0">
        步骤钻取
        <span className="text-xs text-[#A8ABB0] font-normal ml-2">
          {item.name} · {item.status} · {fmtDuration(item.durationMs)}
        </span>
      </p>
      <div className="p-4 space-y-4">
        {framesQ.isLoading && <p className="text-[13px] text-[#A8ABB0] m-0">帧加载中…</p>}
        {!framesQ.isLoading && !step && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无步骤帧（任务可能仍在执行）" />
        )}
        {step && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {/* 请求快照卡（渲染后实际值） */}
              <div className="border border-[#E5E6EB] rounded-md" data-testid="drill-request">
                <p className="px-3 py-2 border-b border-[#F0F1F3] text-[13px] font-medium m-0">
                  请求快照
                  <span className="text-xs text-[#A8ABB0] font-normal ml-1">（渲染后实际值）</span>
                </p>
                <div className="p-3 space-y-2 text-[13px]">
                  <p className="font-mono text-xs break-all m-0">
                    <span className="text-green-600 font-bold">{step.requestSnapshot.method}</span>{" "}
                    {step.requestSnapshot.url}
                  </p>
                  {step.requestSnapshot.headers.length > 0 && (
                    <table className="w-full text-xs">
                      <thead className="text-[#A8ABB0]">
                        <tr className="border-b border-[#F0F1F3]">
                          <th className="text-left font-normal py-1 w-32">Header</th>
                          <th className="text-left font-normal py-1">值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {step.requestSnapshot.headers.map((h) => (
                          <tr key={h.key} className="border-b border-[#F7F8FA] last:border-0">
                            <td className="py-1 font-mono break-all">{h.key}</td>
                            <td className="py-1 font-mono break-all">{h.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="text-xs text-[#A8ABB0] font-mono m-0">
                    {step.requestSnapshot.body ? step.requestSnapshot.body : "— 无 Body —"}
                  </p>
                </div>
              </div>
              {/* 响应卡 */}
              <div className="border border-[#E5E6EB] rounded-md" data-testid="drill-response">
                <p className="px-3 py-2 border-b border-[#F0F1F3] text-[13px] font-medium m-0 flex justify-between">
                  响应
                  <span className="text-xs font-normal">
                    <span
                      className={
                        step.responseSummary.status < 400
                          ? "text-green-600 font-semibold"
                          : "text-red-500 font-semibold"
                      }
                    >
                      {step.responseSummary.status}
                    </span>{" "}
                    · {step.durationMs}ms
                  </span>
                </p>
                <div className="p-3 space-y-2">
                  {step.responseSummary.headers.length > 0 && (
                    <table className="w-full text-xs">
                      <thead className="text-[#A8ABB0]">
                        <tr className="border-b border-[#F0F1F3]">
                          <th className="text-left font-normal py-1 w-32">Header</th>
                          <th className="text-left font-normal py-1">值</th>
                        </tr>
                      </thead>
                      <tbody>
                        {step.responseSummary.headers.map((h) => (
                          <tr key={h.key} className="border-b border-[#F7F8FA] last:border-0">
                            <td className="py-1 font-mono break-all">{h.key}</td>
                            <td className="py-1 font-mono break-all">{h.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <Input.TextArea
                    readOnly
                    autoSize={{ minRows: 4, maxRows: 14 }}
                    className="!font-mono !text-xs"
                    value={step.responseSummary.bodyText || "（空响应体）"}
                    data-testid="drill-response-body"
                  />
                  {step.responseSummary.truncated && (
                    <p className="text-[10px] text-amber-500 m-0">响应体已截断</p>
                  )}
                </div>
              </div>
            </div>

            {/* 断言表 */}
            <div className="border border-[#E5E6EB] rounded-md" data-testid="drill-asserts">
              <p className="px-3 py-2 border-b border-[#F0F1F3] text-[13px] font-medium m-0">
                断言
                <span className="text-xs text-[#A8ABB0] font-normal ml-1">
                  {step.asserts.length} 条
                  {step.asserts.some((a) => !a.passed)
                    ? ` · ${step.asserts.filter((a) => !a.passed).length} 失败`
                    : ""}
                </span>
              </p>
              <table className="w-full text-[13px]" data-testid="asserts-table">
                <thead className="text-[#A8ABB0] text-xs">
                  <tr className="border-b border-[#F0F1F3]">
                    <th className="text-left font-normal p-2">类型</th>
                    <th className="text-left font-normal p-2">期望</th>
                    <th className="text-left font-normal p-2">实际</th>
                    <th className="text-left font-normal p-2 w-20">结果</th>
                  </tr>
                </thead>
                <tbody>
                  {step.asserts.map((a, i) => (
                    <tr
                      key={i}
                      className={`border-b border-[#F7F8FA] last:border-0 ${a.passed ? "" : "bg-red-50"}`}
                    >
                      <td className="p-2">
                        {ASSERT_KIND_TEXT[a.kind] ?? a.kind}
                        {a.path && <span className="font-mono text-xs ml-1">{a.path}</span>}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {OP_TEXT[a.op] ?? a.op} {a.expected}
                      </td>
                      <td className={`p-2 font-mono text-xs ${a.passed ? "" : "text-[#FF4D4F]"}`}>
                        {a.actual}
                      </td>
                      <td className={`p-2 ${a.passed ? "text-[#52C41A]" : "text-[#FF4D4F] font-medium"}`}>
                        {a.passed ? "✓ 通过" : "✗ 失败"}
                      </td>
                    </tr>
                  ))}
                  {step.asserts.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-center text-[#A8ABB0]">
                        无断言
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* 提取值表 */}
            <div className="border border-[#E5E6EB] rounded-md" data-testid="drill-extracts">
              <p className="px-3 py-2 border-b border-[#F0F1F3] text-[13px] font-medium m-0">
                提取值
                <span className="text-xs text-[#A8ABB0] font-normal ml-1">
                  （与 API-004 后置提取结构一致）
                </span>
              </p>
              <table className="w-full text-[13px]" data-testid="extracts-table">
                <thead className="text-[#A8ABB0] text-xs">
                  <tr className="border-b border-[#F0F1F3]">
                    <th className="text-left font-normal p-2">变量</th>
                    <th className="text-left font-normal p-2">值</th>
                    <th className="text-left font-normal p-2 w-28">作用域</th>
                  </tr>
                </thead>
                <tbody>
                  {step.extracts.map((e, i) => (
                    <tr key={i} className="border-b border-[#F7F8FA] last:border-0">
                      <td className="p-2 font-mono text-xs">{e.variable}</td>
                      <td className="p-2 font-mono text-xs break-all">{e.value}</td>
                      <td className="p-2">{e.scope === "env" ? "环境" : "临时"}</td>
                    </tr>
                  ))}
                  {step.extracts.length === 0 && (
                    <tr>
                      <td colSpan={3} className="p-3 text-center text-[#A8ABB0]">
                        无提取
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* 日志流 */}
        <div className="border border-[#E5E6EB] rounded-md" data-testid="drill-logs">
          <p className="px-3 py-2 border-b border-[#F0F1F3] text-[13px] font-medium m-0">
            日志流
            <span className="text-xs text-[#A8ABB0] font-normal ml-1">（item 级）</span>
          </p>
          <div className="p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
            {logs.length === 0 && <p className="text-[#A8ABB0]">暂无日志</p>}
            {logs.map((l, i) => (
              <p
                key={i}
                className={`m-0 ${l.level === "error" ? "text-red-500" : l.level === "warn" ? "text-amber-500" : "text-gray-500"}`}
              >
                {new Date(l.ts).toLocaleTimeString("zh-CN", { hour12: false })} [{l.level}]{" "}
                {l.message}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** api_debug 单请求视图（RPT-001 布局保留；detail 页与分享页共用） */
export function DebugSingleView({
  detail,
  liveFrames,
}: {
  detail: ReportDetailV2;
  liveFrames: EventFrame[];
}) {
  const status = detail.status;
  const logs = (() => {
    const fromFrames = liveFrames
      .filter((f): f is LogFrameView => f.type === "log")
      .map((f) => ({ ts: f.ts, level: f.level, message: f.message }));
    const merged = [...(detail.logs ?? []), ...fromFrames];
    return merged.filter(
      (l, i, arr) => arr.findIndex((x) => x.ts === l.ts && x.message === l.message) === i,
    );
  })();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="rabbit-card" data-testid="report-request">
          <p className="rabbit-card-title">请求</p>
          <div className="p-3 text-sm font-mono space-y-1 break-all">
            {detail.request && (
              <>
                <p>
                  <span className="text-green-600 font-bold">{detail.request.method}</span>{" "}
                  {detail.request.url}
                </p>
                {detail.request.headers.map((h) => (
                  <p key={h.key} className="text-gray-500 text-xs m-0">
                    {h.key}: {h.value}
                  </p>
                ))}
                <p className="text-gray-500 text-xs m-0">
                  {detail.request.body ? detail.request.body : "— 无 Body —"}
                </p>
              </>
            )}
            {!detail.request && <p className="text-[#A8ABB0]">（无请求快照）</p>}
          </div>
        </div>
        <div className="rabbit-card" data-testid="report-response">
          <p className="rabbit-card-title flex justify-between">
            响应
            {detail.response && (
              <span className="text-xs">
                <span
                  className={
                    detail.response.status < 400
                      ? "text-green-600 font-semibold"
                      : "text-red-500 font-semibold"
                  }
                >
                  {detail.response.status}
                </span>{" "}
                · {detail.response.durationMs}ms
              </span>
            )}
          </p>
          <pre
            className="p-3 text-xs bg-gray-50 overflow-auto max-h-64 m-0 font-mono whitespace-pre-wrap break-all"
            data-testid="report-response-body"
          >
            {detail.response?.bodyText ||
              (status === "RUNNING" || status === "PENDING" ? "执行中…" : "（无响应）")}
          </pre>
          {detail.response?.truncated && (
            <p className="px-3 pb-2 text-[10px] text-amber-500 m-0">响应体已截断至 256KB</p>
          )}
        </div>
      </div>

      <div className="rabbit-card" data-testid="report-asserts">
        <p className="rabbit-card-title">
          断言{" "}
          <span className="text-xs text-gray-400">
            {detail.asserts.length} 条
            {detail.asserts.some((a) => !a.passed)
              ? ` · ${detail.asserts.filter((a) => !a.passed).length} 失败`
              : ""}
          </span>
        </p>
        <table className="w-full text-[13px]">
          <thead className="text-[#87888D] text-xs">
            <tr className="border-b border-[#F0F1F3]">
              <th className="text-left font-normal p-2">类型</th>
              <th className="text-left font-normal p-2">期望</th>
              <th className="text-left font-normal p-2">实际</th>
              <th className="text-left font-normal p-2 w-20">结果</th>
            </tr>
          </thead>
          <tbody>
            {detail.asserts.map((a, i) => (
              <tr
                key={i}
                className={`border-b border-[#F7F8FA] last:border-0 ${a.passed ? "" : "bg-red-50"}`}
              >
                <td className="p-2">
                  {ASSERT_KIND_TEXT[a.kind] ?? a.kind}
                  {a.path && <span className="font-mono text-xs ml-1">{a.path}</span>}
                </td>
                <td className="p-2 font-mono text-xs">
                  {OP_TEXT[a.op] ?? a.op} {a.expected}
                </td>
                <td className={`p-2 font-mono text-xs ${a.passed ? "" : "text-[#FF4D4F]"}`}>
                  {a.actual}
                </td>
                <td className={`p-2 ${a.passed ? "text-green-600" : "text-red-500 font-medium"}`}>
                  {a.passed ? (
                    <span data-testid="assert-pass">✓ 通过</span>
                  ) : (
                    <span data-testid="assert-fail">✗ 失败</span>
                  )}
                </td>
              </tr>
            ))}
            {detail.asserts.length === 0 && (
              <tr>
                <td colSpan={4} className="p-3 text-center text-[#A8ABB0]">
                  无断言
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rabbit-card" data-testid="report-logs">
        <p className="rabbit-card-title flex items-center gap-2">
          执行日志 <span className="text-[11px] font-normal text-[#A8ABB0]">SSE 实时</span>
        </p>
        <div className="p-3 font-mono text-xs space-y-1">
          {logs.length === 0 && <p className="text-gray-400">等待事件…</p>}
          {logs.map((l, i) => (
            <p
              key={i}
              className={`m-0 ${l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-500" : "text-gray-500"}`}
            >
              {new Date(l.ts).toLocaleTimeString("zh-CN", { hour12: false })} [{l.level}]{" "}
              {l.message}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
