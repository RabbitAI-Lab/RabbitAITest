"use client";

/**
 * RPT-003 场景报告视图（详情页与免登分享页共用）：
 * 五卡（含误报单列）/ item 表（误报徽标）/ 步骤树（迭代分组 + Tab 步骤|变量）/ 步骤级钻取。
 */
import { Empty, Input, Table, Tabs } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { reportV2Api, scenarioTreeApi } from "@rabbit/api-client";
import type { ReportDetailV2, ReportItemView } from "@rabbit/api-client";
import type { EventFrame } from "@rabbit/shared";
import type { TreeNode } from "@rabbit/shared/execution";
import { fmtDuration } from "./ReportViewPanels";

type StepResultFrame = Extract<EventFrame, { type: "step-result" }>;

const ITEM_STATUS_META: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: "SUCCESS", color: "#52C41A" },
  FAILED: { label: "FAILED", color: "#FF4D4F" },
  FAKE_ERROR: { label: "误报", color: "#FA8C16" },
  SKIPPED: { label: "SKIPPED", color: "#87888D" },
  STOPPED: { label: "STOPPED", color: "#87888D" },
  PENDING: { label: "PENDING", color: "#1677FF" },
  RUNNING: { label: "RUNNING", color: "#1677FF" },
};

/** 统计五卡：执行项 / 通过 / 失败 / 误报（单列）/ 总耗时。 */
export function ScenarioSummaryCards({
  summary,
  durationMs,
}: {
  summary?: { total?: number; passed?: number; failed?: number; fakeError?: number; durationMs?: number };
  durationMs?: number | null;
}) {
  const cards: { label: string; value: string; color?: string; testid: string }[] = [
    { label: "执行项", value: String(summary?.total ?? 0), testid: "card-total" },
    { label: "通过", value: String(summary?.passed ?? 0), color: "#52C41A", testid: "card-passed" },
    { label: "失败", value: String(summary?.failed ?? 0), color: "#FF4D4F", testid: "card-failed" },
    { label: "误报", value: String(summary?.fakeError ?? 0), color: "#FA8C16", testid: "card-fake" },
    { label: "总耗时", value: fmtDuration(durationMs ?? summary?.durationMs), testid: "card-duration" },
  ];
  return (
    <div className="grid grid-cols-5 gap-4" data-testid="scenario-summary-cards">
      {cards.map((c) => (
        <div key={c.label} className="rabbit-card p-4" data-testid={c.testid}>
          <p className="m-0 text-xs text-[#A8ABB0]">{c.label}</p>
          <p className="m-0 mt-1 text-2xl font-semibold" style={{ color: c.color }}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}

/** scenario 分支主视图：item 表 + 选中项的步骤树/变量。 */
export function ScenarioReportView({
  projectId,
  detail,
  drillEnabled = true,
}: {
  projectId?: string;
  detail: ReportDetailV2;
  drillEnabled?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(detail.items[0]?.itemId ?? null);
  const selected = detail.items.find((i) => i.itemId === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="rabbit-card p-0" data-testid="scenario-items-table">
        <div className="border-b border-[#F0F1F3] px-4 py-2.5">
          <p className="m-0 text-sm font-medium">
            场景级结果
            <span className="ml-2 text-xs font-normal text-[#A8ABB0]">（{detail.items.length} 项 · FAKE_ERROR 不计失败）</span>
          </p>
        </div>
        <Table<ReportItemView>
          rowKey="itemId"
          size="small"
          pagination={false}
          dataSource={detail.items}
          rowClassName={(r) => (r.itemId === selectedId ? "bg-[#574BFF]/[.05] cursor-pointer" : "cursor-pointer")}
          onRow={(r) => ({ onClick: () => setSelectedId(r.itemId) }) }
          columns={[
            { title: "场景", dataIndex: "name" },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (v: string) => {
                const m = ITEM_STATUS_META[v] ?? { label: v, color: "#87888D" };
                return (
                  <span style={{ color: m.color }} className={v !== "SUCCESS" ? "font-medium" : ""}>
                    {m.label}
                  </span>
                );
              },
            },
            {
              title: "误报",
              key: "fake",
              width: 150,
              render: (_: unknown, r) =>
                r.fakeAlarmHits?.length ? (
                  <Tooltipish text={`命中规则：${[...new Set(r.fakeAlarmHits.map((h) => h.ruleName))].join("、")}`}>
                    <span className="rounded bg-[#FA8C16]/10 px-1.5 py-0.5 text-[11px] text-[#FA8C16]" data-testid={`fake-badge-${r.itemId.slice(0, 8)}`}>
                      误报 {[...new Set(r.fakeAlarmHits.map((h) => h.ruleName))][0]}
                      {r.fakeAlarmHits.length > 1 ? ` 等 ${r.fakeAlarmHits.length} 次` : ""}
                    </span>
                  </Tooltipish>
                ) : (
                  <span className="text-[#A8ABB0]">—</span>
                ),
            },
            { title: "步骤", key: "steps", width: 110, render: (_: unknown, r) => <span className="text-xs text-[#3D4350]">{r.stepCount ?? 0} 步</span> },
            { title: "断言", key: "asserts", width: 80, render: (_: unknown, r) => <span className="text-xs" style={{ color: r.assertPassed === r.assertTotal && r.assertTotal > 0 ? "#52C41A" : r.assertTotal > 0 ? "#FF4D4F" : "#87888D" }}>{r.assertPassed}/{r.assertTotal}</span> },
            { title: "耗时", dataIndex: "durationMs", width: 90, render: (v: number | null) => <span className="text-xs">{fmtDuration(v)}</span> },
          ]}
        />
      </div>
      {selected ? (
        projectId ? (
          <ScenarioTreeCard projectId={projectId} taskId={detail.taskId} item={selected} drillEnabled={drillEnabled} />
        ) : (
          <div className="rabbit-card p-6 text-center text-xs text-[#A8ABB0]">步骤树与变量视图需登录后在报告详情页查看</div>
        )
      ) : null}
    </div>
  );
}

function Tooltipish({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <span title={text} className="cursor-help border-b border-dashed border-[#FA8C16]/50">
      {children}
    </span>
  );
}

/** 步骤树卡：Tab 步骤|变量；树按 stepPath 分组、loop 迭代分组；request 节点可钻取。 */
export function ScenarioTreeCard({
  projectId,
  taskId,
  item,
  drillEnabled = true,
}: {
  projectId: string;
  taskId: string;
  item: ReportItemView;
  drillEnabled?: boolean;
}) {
  const [tab, setTab] = useState("steps");
  const [sel, setSel] = useState<{ stepPath: string; iteration?: number } | null>(null);

  const treeQ = useQuery({
    queryKey: ["scenario-tree", projectId, taskId, item.itemId],
    queryFn: () => scenarioTreeApi.get(projectId, taskId, item.itemId),
  });

  const view = treeQ.data;

  return (
    <div className="rabbit-card p-0" data-testid="scenario-tree-card">
      <div className="flex items-center justify-between border-b border-[#F0F1F3] px-4 py-2.5">
        <p className="m-0 text-sm font-medium">
          步骤树 · {item.name}
          {view && <span className="ml-2 text-xs font-normal text-[#87888D]">{view.stats.total} 节点 · {view.stats.success}/{view.stats.total} 通过 · {fmtDuration(view.stats.durationMs)}</span>}
        </p>
        <Tabs
          size="small"
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: "steps", label: <span data-testid="tree-tab-steps">步骤</span> },
            { key: "vars", label: <span data-testid="tree-tab-vars">变量</span> },
          ]}
        />
      </div>
      {treeQ.isLoading && <p className="px-4 py-3 text-xs text-[#A8ABB0]">树加载中…</p>}
      {treeQ.isError && <p className="px-4 py-3 text-xs text-[#FF4D4F]">树加载失败（{(treeQ.error as Error).message}）</p>}
      {view && tab === "steps" && (
        <div className="flex items-start gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-0.5" data-testid="scenario-tree-nodes">
            {view.tree.map((n) => (
              <TreeNodeRow key={n.stepPath} node={n} depth={0} drillEnabled={drillEnabled} selected={sel} onSelect={setSel} />
            ))}
            {view.tree.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无步骤帧（任务可能仍在执行）" />}
          </div>
          {drillEnabled && sel && (
            <div className="w-[420px] shrink-0" data-testid="step-drill-wrap">
              <StepDrillPanel projectId={projectId} taskId={taskId} itemId={item.itemId} stepPath={sel.stepPath} iteration={sel.iteration} />
            </div>
          )}
        </div>
      )}
      {view && tab === "vars" && (
        <div className="p-4" data-testid="scenario-vars-final">
          {view.varsFinal && Object.keys(view.varsFinal).length > 0 ? (
            <Table
              size="small"
              rowKey={(k) => String(k)}
              pagination={false}
              dataSource={Object.entries(view.varsFinal).map(([name, value]) => ({ name, value }))}
              columns={[
                { title: "变量", dataIndex: "name", render: (v: string) => <code className="font-mono text-xs text-[#574BFF]">{v}</code> },
                { title: "终值", dataIndex: "value", ellipsis: true, render: (v: string) => <code className="font-mono text-xs break-all">{v}</code> },
              ]}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无变量终值（vars-final 帧缺失或场景无变量）" />
          )}
        </div>
      )}
    </div>
  );
}

const KIND_META: Record<TreeNode["kind"], { label: string; color: string }> = {
  request: { label: "请求", color: "#1677FF" },
  loop: { label: "循环", color: "#722ED1" },
  condition: { label: "条件", color: "#9254DE" },
  once: { label: "仅一次", color: "#597EF7" },
  script: { label: "脚本", color: "#FA8C16" },
  wait: { label: "等待", color: "#87888D" },
};
const STATUS_COLOR: Record<TreeNode["status"], string> = { SUCCESS: "#52C41A", FAILED: "#FF4D4F", SKIPPED: "#87888D" };
const SKIP_TEXT: Record<string, string> = { disabled: "已禁用", condition: "条件不满足", once: "重复触发跳过", abort: "失败停止" };

function TreeNodeRow({
  node,
  depth,
  drillEnabled,
  selected,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  drillEnabled: boolean;
  selected: { stepPath: string; iteration?: number } | null;
  onSelect: (v: { stepPath: string; iteration?: number } | null) => void;
}) {
  const meta = KIND_META[node.kind];
  const isSelected = drillEnabled && selected?.stepPath === node.stepPath && selected?.iteration === undefined;
  const failed = node.status === "FAILED";
  const requestDrill = drillEnabled && node.kind === "request" && node.status !== "SKIPPED";
  return (
    <div>
      <div
        data-testid={`tree-node-${node.stepPath}`}
        className={`flex cursor-pointer items-center gap-1.5 rounded border px-2 py-1 ${
          failed ? "border-red-100 bg-red-50" : isSelected ? "border-[#574BFF]/30 bg-[#574BFF]/5" : "border-transparent hover:bg-[#F7F8FA]"
        } ${node.status === "SKIPPED" ? "opacity-60" : ""}`}
        style={{ marginLeft: depth * 16 }}
        onClick={() => onSelect(requestDrill ? { stepPath: node.stepPath } : null)}
      >
        <span className="h-4 w-[3px] shrink-0 rounded-sm" style={{ background: STATUS_COLOR[node.status] }} />
        <span className="shrink-0 rounded-sm px-1 py-px text-[10px] leading-4" style={{ color: meta.color, background: `${meta.color}14` }}>
          {meta.label}
        </span>
        <span className={`min-w-0 flex-1 truncate text-xs ${node.status === "SKIPPED" ? "text-[#87888D]" : "text-[#1F2329]"}`}>{node.name}</span>
        {node.status === "SKIPPED" && node.skipReason && <span className="shrink-0 text-[10px] text-[#87888D]">{SKIP_TEXT[node.skipReason] ?? "跳过"}</span>}
        {node.kind === "request" && node.statusCode !== undefined && (
          <span className="shrink-0 text-[10px]" style={{ color: node.status === "SUCCESS" ? "#52C41A" : "#FF4D4F" }}>
            {node.statusCode} · {node.durationMs ?? 0}ms
          </span>
        )}
        {node.kind !== "request" && node.durationMs !== undefined && <span className="shrink-0 text-[10px] text-[#87888D]">{node.durationMs}ms</span>}
      </div>
      {/* 迭代分组（loop 子级） */}
      {node.iterations?.map((g) => (
        <div key={g.iteration} style={{ marginLeft: (depth + 1) * 16 }}>
          <div className="mt-0.5 rounded bg-[#F7F8FA] px-2 py-1 text-[11px] text-[#646A73]" data-testid={`tree-iter-${node.stepPath}-${g.iteration}`}>
            ▸ 迭代 #{g.iteration}
            <span className="ml-1" style={{ color: STATUS_COLOR[g.children.every((c) => c.status === "SUCCESS") ? "SUCCESS" : g.children.some((c) => c.status === "FAILED") ? "FAILED" : "SKIPPED"] }}>
              {g.children.filter((c) => c.status === "SUCCESS").length}/{g.children.length} 通过
            </span>
          </div>
          {g.children.map((c) => (
            <TreeNodeRow
              key={`${node.stepPath}.i${g.iteration}.${c.stepPath}`}
              node={{ ...c, stepPath: `${node.stepPath}#${g.iteration}.${c.stepPath}` }}
              depth={0}
              drillEnabled={drillEnabled}
              selected={selected?.iteration === g.iteration && selected.stepPath.endsWith(c.stepPath) ? selected : selected}
              onSelect={(v) => onSelect(v ? { stepPath: c.stepPath, iteration: g.iteration } : null)}
            />
          ))}
        </div>
      ))}
      {node.children.map((c) => (
        <TreeNodeRow key={c.stepPath} node={c} depth={depth + 1} drillEnabled={drillEnabled} selected={selected} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** 步骤级钻取：按 stepPath（+ 迭代序）过滤 itemFrames 中的 step-result 帧。 */
function StepDrillPanel({
  projectId,
  taskId,
  itemId,
  stepPath,
  iteration,
}: {
  projectId: string;
  taskId: string;
  itemId: string;
  stepPath: string;
  iteration?: number;
}) {
  const framesQ = useQuery({
    queryKey: ["report-item-frames", projectId, taskId, itemId],
    queryFn: () => reportV2Api.itemFrames(projectId, taskId, itemId),
  });
  const frames = (framesQ.data ?? []) as EventFrame[];
  const results = frames.filter((f): f is StepResultFrame => f.type === "step-result");
  const step = iteration === undefined ? results.find((f) => f.stepPath === stepPath) : results.filter((f) => f.stepPath === stepPath)[iteration - 1] ?? results.find((f) => f.stepPath === stepPath && f.iteration === iteration);

  return (
    <div className="space-y-3 rounded border border-[#E5E6EB] p-3" data-testid="step-drill-panel">
      <p className="m-0 text-xs font-medium text-[#1F2329]">
        步骤钻取
        <span className="ml-1 font-normal text-[#87888D]">
          {step ? `${step.requestSnapshot.method} ${step.requestSnapshot.url}` : stepPath}
          {iteration !== undefined ? `（迭代 #${iteration}）` : ""}
        </span>
      </p>
      {framesQ.isLoading && <p className="m-0 text-xs text-[#A8ABB0]">帧加载中…</p>}
      {!framesQ.isLoading && !step && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该步骤无请求帧（script/wait/跳过）" />}
      {step && (
        <>
          <div className="space-y-1 text-[11px]">
            <p className="m-0 font-mono break-all">
              <span className="font-bold text-green-600">{step.requestSnapshot.method}</span> {step.requestSnapshot.url}
            </p>
            {step.requestSnapshot.body && <p className="m-0 font-mono break-all text-[#646A73]">{step.requestSnapshot.body}</p>}
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className={step.responseSummary.status < 400 ? "font-semibold text-green-600" : "font-semibold text-red-500"}>{step.responseSummary.status}</span>
            <span className="text-[#87888D]">{step.durationMs}ms</span>
            {step.asserts.length > 0 && (
              <span style={{ color: step.asserts.every((a) => a.passed) ? "#52C41A" : "#FF4D4F" }}>
                断言 {step.asserts.filter((a) => a.passed).length}/{step.asserts.length}
              </span>
            )}
          </div>
          <Input.TextArea
            readOnly
            autoSize={{ minRows: 3, maxRows: 10 }}
            className="!font-mono !text-[11px]"
            value={step.responseSummary.bodyText || "（空响应体）"}
            data-testid="step-drill-body"
          />
          {step.asserts.length > 0 && (
            <table className="w-full text-[11px]">
              <thead className="text-[#A8ABB0]">
                <tr className="border-b border-[#F0F1F3]">
                  <th className="py-1 text-left font-normal">断言</th>
                  <th className="py-1 text-left font-normal">期望</th>
                  <th className="py-1 text-left font-normal">实际</th>
                  <th className="py-1 text-left font-normal">结果</th>
                </tr>
              </thead>
              <tbody>
                {step.asserts.map((a, i) => (
                  <tr key={i} className={`border-b border-[#F7F8FA] ${a.passed ? "" : "bg-red-50"}`}>
                    <td className="py-1">{a.kind}</td>
                    <td className="py-1 font-mono">{a.op} {a.expected}</td>
                    <td className={`py-1 font-mono ${a.passed ? "" : "text-[#FF4D4F]"}`}>{a.actual}</td>
                    <td className={`py-1 ${a.passed ? "text-[#52C41A]" : "text-[#FF4D4F]"}`}>{a.passed ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
