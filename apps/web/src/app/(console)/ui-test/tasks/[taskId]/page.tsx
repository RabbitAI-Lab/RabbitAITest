"use client";

/**
 * S11 UIT-002：执行报告（/ui-test/tasks/{taskId}）——步骤时间线 + 截图网格（fileId→files download）。
 * S13 UIT-003：脚本模式报告——测试树（每 test 一行：状态/耗时）+ 失败行展开错误代码帧（message 多行）+
 * trace 卡（trace.zip 下载 + show-trace 回放指引；内嵌 viewer=P2 登记）；ui_validate 校验任务同视图。
 */
import { Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { execTaskDetailApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";

const STEP_ICON: Record<string, string> = {
  SUCCESS: "✓",
  FAILED: "✗",
  SKIPPED: "–",
};
const STEP_COLOR: Record<string, string> = {
  SUCCESS: "text-emerald-500",
  FAILED: "text-red-500",
  SKIPPED: "text-slate-300",
};
const CHECK_ICON: Record<string, string> = { ok: "✓", warn: "⚠", fail: "✗" };
const CHECK_COLOR: Record<string, string> = {
  ok: "text-emerald-500",
  warn: "text-amber-500",
  fail: "text-red-500",
};

export default function UiTaskReportPage() {
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ui-task", currentProjectId, taskId],
    queryFn: () => execTaskDetailApi.uiDetail(currentProjectId!, taskId),
    enabled: Boolean(currentProjectId) && Boolean(taskId),
    refetchInterval: (q) =>
      q.state.data?.status === "RUNNING" || q.state.data?.status === "PENDING" ? 2000 : false,
  });

  const shots = data?.items.flatMap((it) =>
    it.frames
      .filter((f) => f.type === "ui-screenshot")
      .map((f) => ({
        fileId: f.fileId,
        name: f.name,
        stepSeq: f.stepSeq,
        itemName: it.name,
        failed: it.steps.find((s) => s.seq === f.stepSeq)?.status === "FAILED",
      })),
  );

  const isValidate = data?.type === "ui_validate";

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="uit-report-page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {isValidate ? "脚本校验结果" : "执行报告"}
            {data && (
              <Tag
                color={
                  data.status === "SUCCESS"
                    ? "success"
                    : data.status === "FAILED"
                      ? "error"
                      : data.status === "RUNNING" || data.status === "PENDING"
                        ? "processing"
                        : "warning"
                }
                data-testid="uit-report-status"
              >
                {data.status}
              </Tag>
            )}
          </span>
        }
        sub={
          data
            ? `任务 ${taskId.slice(0, 8)} · ${data.items.length} 条${isValidate ? "脚本" : "用例"} · chromium`
            : ""
        }
        extra={
          <a className="text-[#574BFF] text-sm" onClick={() => router.push("/ui-test")}>
            返回列表
          </a>
        }
      />
      <Spin spinning={isLoading}>
        {data?.items.map((item) => {
          const isScript = item.mode === "script";
          const passed = item.steps.filter((s) => s.status === "SUCCESS").length;
          const runnerCheck = item.runnerChecks?.[0];
          return (
            <div
              key={item.itemId}
              className="border rounded bg-white mb-3"
              data-testid={`uit-report-item-${item.itemId}`}
            >
              {/* S14 UIT-004：环境预检阻断帧（fail 项 checklist；正常执行无此卡） */}
              {runnerCheck && (
                <div
                  className="m-3 border rounded p-3 space-y-2 border-orange-200 bg-orange-50/50"
                  data-testid={`uit4-report-frame-${item.itemId}`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-orange-700 flex-wrap">
                    ⛔ Runner 环境预检未通过 ·{" "}
                    {runnerCheck.items.filter((i) => i.status === "fail").length} 项失败
                    <span className="text-xs font-normal text-slate-500">
                      runner = {runnerCheck.runner}
                    </span>
                    <a
                      className="ml-auto text-xs text-[#574BFF]"
                      onClick={() => router.push("/ui-test")}
                      data-testid={`uit4-report-goto-${item.itemId}`}
                    >
                      去处理（Runner 管理）
                    </a>
                  </div>
                  <div className="border rounded divide-y bg-white text-sm">
                    {runnerCheck.items.map((c) => (
                      <div key={c.key} className="flex items-center gap-3 px-3 py-1.5 flex-wrap">
                        <span className={`font-bold ${CHECK_COLOR[c.status]}`}>
                          {CHECK_ICON[c.status]}
                        </span>
                        <span className="text-slate-600">{c.label}</span>
                        <span
                          className={`text-xs ${
                            c.status === "fail"
                              ? "text-red-600"
                              : c.status === "warn"
                                ? "text-amber-600"
                                : "text-slate-500"
                          }`}
                        >
                          {c.detail}
                        </span>
                        {c.hint && <span className="ml-auto text-xs text-slate-400">{c.hint}</span>}
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-slate-500">
                    环境恢复后可直接重跑本任务；warn 项不阻断执行。
                  </div>
                </div>
              )}
              <div className="px-3 py-2 border-b flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{item.name}</span>
                {isScript && <Tag color="purple">脚本</Tag>}
                <Tag
                  color={
                    item.status === "SUCCESS"
                      ? "success"
                      : item.status === "FAILED"
                        ? "error"
                        : "default"
                  }
                  data-testid={`uit-report-item-status-${item.itemId}`}
                >
                  {item.status}
                </Tag>
                {isScript && item.steps.length > 0 && (
                  <span className="text-xs text-slate-400">
                    {passed}/{item.steps.length} 测试通过
                  </span>
                )}
                {!isScript && (
                  <span className="text-xs text-slate-400">{item.steps.length} 步</span>
                )}
              </div>
              <div className="divide-y text-sm">
                {item.steps.map((s) => {
                  const rowKey = `${item.itemId}-${s.seq}`;
                  const open = expanded === rowKey;
                  return (
                    <div key={rowKey}>
                      <div
                        className={`flex items-center gap-3 px-3 py-2 ${s.status === "FAILED" ? "bg-red-50/60" : ""}`}
                        data-testid={`uit-report-step-${item.itemId}-${s.seq}`}
                      >
                        <span className={`font-bold ${STEP_COLOR[s.status]}`}>
                          {STEP_ICON[s.status]}
                        </span>
                        {!isScript && <span className="w-24 text-slate-500">{s.op}</span>}
                        <span className={`flex-1 ${isScript ? "" : "font-mono text-xs"}`}>
                          {s.name}
                        </span>
                        {!isScript && s.status === "FAILED" && s.expected !== undefined && (
                          <span className="text-xs text-red-400">
                            期望「{s.expected}」实际「{s.actual}」
                          </span>
                        )}
                        <span className="text-xs text-slate-400">
                          {(s.durationMs / 1000).toFixed(1)}s
                        </span>
                        {isScript && s.status === "FAILED" && (
                          <a
                            className="text-xs text-[#574BFF]"
                            data-testid={`uit3-expand-error-${s.seq}`}
                            onClick={() => setExpanded(open ? null : rowKey)}
                          >
                            {open ? "收起错误 ▴" : "展开错误 ▾"}
                          </a>
                        )}
                      </div>
                      {isScript && s.status === "FAILED" && open && (
                        <pre
                          className="px-3 py-2 bg-red-50/40 border-t border-red-100 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-auto"
                          data-testid={`uit3-error-frame-${s.seq}`}
                        >
                          {s.message}
                        </pre>
                      )}
                    </div>
                  );
                })}
                {item.steps.length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">
                    {item.status === "PENDING" || item.status === "RUNNING"
                      ? "执行中…"
                      : "无测试行"}
                  </div>
                )}
              </div>
              {/* trace 卡（脚本模式执行任务；校验干跑无 trace） */}
              {isScript && !isValidate && item.traces.length > 0 && (
                <div
                  className="px-3 py-2 border-t flex items-center gap-3 flex-wrap"
                  data-testid={`uit3-trace-${item.itemId}`}
                >
                  <span className="text-xs text-slate-500">执行追踪（trace=on）</span>
                  {item.traces.slice(0, 5).map((t) => (
                    <a
                      key={t.fileId}
                      className="text-xs text-[#574BFF]"
                      href={`/api/v1/projects/${currentProjectId}/files/${t.fileId}/download`}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`uit3-trace-dl-${t.fileId.slice(0, 8)}`}
                    >
                      ⬇ {t.name || "trace.zip"}
                    </a>
                  ))}
                  <span className="text-xs text-slate-400">
                    本地回放：npx playwright show-trace trace.zip（内嵌 viewer=P2 登记）
                  </span>
                </div>
              )}
            </div>
          );
        })}
        {shots && shots.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 mb-1">
              截图（{shots.length} 张；失败自动截图，点击放大）
            </div>
            <div className="grid grid-cols-3 gap-3" data-testid="uit-report-shots">
              {shots.map((shot) => (
                <a
                  key={shot.fileId}
                  href={`/api/v1/projects/${currentProjectId}/files/${shot.fileId}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className={`border rounded p-2 space-y-1 block ${shot.failed ? "border-red-300" : ""}`}
                  data-testid={`uit-report-shot-${shot.fileId}`}
                >
                  {/* 截图经 download 端点（会话 cookie 鉴权）；缩略图直接复用该 URL（浏览器缓存） */}
                  <img
                    src={`/api/v1/projects/${currentProjectId}/files/${shot.fileId}/download`}
                    alt={shot.name}
                    className="h-28 w-full object-cover rounded bg-slate-100"
                  />
                  <div className="text-xs text-slate-400">
                    {shot.itemName} · 步骤 {shot.stepSeq} · {shot.name}
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </Spin>
    </div>
  );
}
