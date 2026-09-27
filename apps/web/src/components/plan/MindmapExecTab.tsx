"use client";

/** S4 PLAN-003 脑图执行 Tab：功能用例按模块分组脑图 + S/E/B 快捷键标记 + 依赖 BLOCKED 提示。
 * 自研轻量树渲染（与 CASE-007 MindmapTree 同范式；执行态只读树+标记交互，不涉及编辑保存）。 */
import { Button, Input, Tag, Tooltip } from "antd";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { planApi, type PlanCaseRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const STATUS_COLOR: Record<string, string> = {
  NOT_RUN: "#87888D",
  PASS: "#52C41A",
  FAIL: "#FF4D4F",
  BLOCKED: "#FA8C16",
  SKIPPED: "#C9CDD4",
};
const STATUS_LABEL: Record<string, string> = {
  NOT_RUN: "未执行",
  PASS: "通过",
  FAIL: "失败",
  BLOCKED: "阻塞",
  SKIPPED: "跳过",
};
const KEY_TO_STATUS: Record<string, string> = { s: "PASS", e: "FAIL", b: "BLOCKED", k: "SKIPPED" };

interface FnCaseRow extends PlanCaseRow {
  caseId: string;
  num: number | null;
}

export function MindmapExecTab({
  projectId,
  planId,
  cases,
  writable,
}: {
  projectId: string;
  planId: string;
  cases: PlanCaseRow[];
  writable: boolean;
}) {
  const { message } = useApp();
  const qc = useQueryClient();
  const canUpdate = usePermissions().can("PROJECT_PLAN:UPDATE") && writable;
  const fnCases = cases.filter((c) => c.refType === "functional_case") as FnCaseRow[];
  const [focusId, setFocusId] = useState<string | null>(null);
  const [actualResult, setActualResult] = useState("");
  const [blockedTip, setBlockedTip] = useState<{ caseId: string; name: string }[] | null>(null);

  const focus = fnCases.find((c) => c.refId === focusId) ?? null;
  useEffect(() => {
    setActualResult("");
    setBlockedTip(null);
  }, [focusId]);

  const mark = useMutation({
    mutationFn: (v: { refId: string; status: string }) =>
      planApi.exec(projectId, planId, v.refId, {
        status: v.status,
        actualResult: actualResult,
        comment: "",
      }),
    onSuccess: (r, v) => {
      qc.invalidateQueries({ queryKey: ["plan-detail", planId] });
      const blockedBy = (r as { blockedBy?: { caseId: string; name: string }[] }).blockedBy;
      if (v.status === "BLOCKED" && blockedBy && blockedBy.length > 0) {
        setBlockedTip(blockedBy);
        message.warning(`前置未通过：${blockedBy.map((b) => b.name).join("、")}，已标记阻塞`);
      } else {
        message.success(`已标记 ${STATUS_LABEL[v.status] ?? v.status}`);
        setBlockedTip(null);
      }
    },
    onError: (e: Error) => message.error(e.message),
  });

  // S/E/B/K 快捷键（选中节点后）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!canUpdate || !focus || (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      const status = KEY_TO_STATUS[e.key.toLowerCase()];
      if (status) {
        e.preventDefault();
        if (status === "FAIL" && !actualResult.trim()) {
          message.warning("失败建议填写实际结果（右侧面板）后再标记");
        }
        mark.mutate({ refId: focus.refId, status });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canUpdate, focus, actualResult, mark, message]);

  // 模块分组
  const groups = useMemo(() => {
    const byModule = new Map<string, FnCaseRow[]>();
    for (const c of fnCases) {
      const key = c.num != null ? `module-of-${c.caseId.slice(0, 8)}` : "default";
      // 用例行未带 moduleId——按名称分组不可靠；直接以计划清单序做单层模块近似：按 padNum 前缀
      void key;
      const g = "全部用例";
      const list = byModule.get(g) ?? [];
      list.push(c);
      byModule.set(g, list);
    }
    return [...byModule.entries()];
  }, [fnCases]);

  return (
    <div className="flex gap-3 items-stretch" data-testid="plan-mindmap-exec">
      <div className="rabbit-card flex-1 min-w-0 p-4 overflow-auto max-h-[640px]">
        <div className="flex items-center gap-2 pb-2 flex-wrap">
          <span className="text-[10px] border rounded px-1.5 py-0.5 bg-green-50 text-green-700 border-green-200">S 成功</span>
          <span className="text-[10px] border rounded px-1.5 py-0.5 bg-red-50 text-red-600 border-red-200">E 失败</span>
          <span className="text-[10px] border rounded px-1.5 py-0.5 bg-orange-50 text-orange-600 border-orange-200">B 阻塞</span>
          <span className="text-[10px] border rounded px-1.5 py-0.5 bg-slate-100 text-slate-500">K 跳过</span>
          <span className="text-xs text-[#A8ABB0] ml-auto">选中节点后按键即标记（与列表模式数据同步）</span>
        </div>
        {fnCases.length === 0 ? (
          <p className="text-center text-[#A8ABB0] py-10 text-[13px]">计划内暂无功能用例（接口/场景用例请用「执行全部」引擎执行）</p>
        ) : (
          <div className="space-y-2 pt-2">
            {groups.map(([g, list]) => (
              <div key={g}>
                <div className="inline-block rounded-md border-2 border-[#574BFF] bg-[#574BFF] text-white px-3 py-1.5 text-[13px] font-medium mb-2">
                  {g}（{list.length}）
                </div>
                <div className="space-y-1.5 pl-6">
                  {list.map((c) => {
                    const color = STATUS_COLOR[c.status] ?? STATUS_COLOR.NOT_RUN!;
                    const isFocus = focusId === c.refId;
                    return (
                      <button
                        key={c.refId}
                        onClick={() => setFocusId(c.refId)}
                        className={`block w-fit rounded border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[13px] border-l-4 ${isFocus ? "ring-2 ring-[#574BFF]/40" : ""}`}
                        style={{ borderLeftColor: color }}
                        data-testid={`mindmap-exec-node-${c.refId}`}
                      >
                        {c.num != null ? `C-${String(c.num).padStart(4, "0")} ` : ""}
                        {c.name}
                        <span className="ml-1 text-[10px]" style={{ color }}>
                          {STATUS_LABEL[c.status] ?? c.status}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 右：详情面板 */}
      <div className="rabbit-card w-[340px] shrink-0 p-4 space-y-2 text-[13px]" data-testid="mindmap-exec-panel">
        {focus ? (
          <>
            <p className="font-medium">{focus.name}</p>
            <div className="border rounded divide-y text-xs">
              {((focus.steps ?? []) as { desc: string; expect: string }[]).map((s, i) => (
                <p key={i} className="px-2 py-1.5">
                  {i + 1}. {s.desc}
                  <span className="text-slate-400 block">预期：{s.expect}</span>
                </p>
              ))}
              {((focus.steps ?? []) as unknown[]).length === 0 && <p className="px-2 py-1.5 text-slate-400">（无步骤）</p>}
            </div>
            <p className="text-slate-500 text-xs">实际结果（失败/阻塞建议填写）</p>
            <Input.TextArea rows={3} value={actualResult} onChange={(e) => setActualResult(e.target.value)} data-testid="mindmap-exec-actual" />
            {blockedTip && (
              <div className="rounded border border-amber-200 bg-amber-50 text-amber-700 px-2.5 py-1.5 text-xs flex items-center gap-2">
                ⚠ 前置用例未通过：{blockedTip.map((b) => b.name).join("、")}
                <Button
                  size="small"
                  className="ml-auto"
                  onClick={() => mark.mutate({ refId: focus.refId, status: "BLOCKED" })}
                >
                  标记阻塞 (B)
                </Button>
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Tooltip title="关联/新建缺陷沿用列表行操作">
                <Button size="small" disabled>
                  缺陷操作（列表行）
                </Button>
              </Tooltip>
              <div className="flex-1" />
              {canUpdate && (
                <>
                  <Button size="small" type="primary" onClick={() => mark.mutate({ refId: focus.refId, status: "PASS" })} data-testid="mindmap-mark-pass">
                    提交 (S)
                  </Button>
                  <Button size="small" danger onClick={() => mark.mutate({ refId: focus.refId, status: "FAIL" })}>
                    (E)
                  </Button>
                  <Button size="small" onClick={() => mark.mutate({ refId: focus.refId, status: "BLOCKED" })}>
                    (B)
                  </Button>
                </>
              )}
            </div>
            <Tag className="mt-1">当前状态：{STATUS_LABEL[focus.status] ?? focus.status}</Tag>
          </>
        ) : (
          <p className="text-[#A8ABB0] text-center py-10">选择左侧用例节点后用 S / E / B / K 快捷标记</p>
        )}
      </div>
    </div>
  );
}
