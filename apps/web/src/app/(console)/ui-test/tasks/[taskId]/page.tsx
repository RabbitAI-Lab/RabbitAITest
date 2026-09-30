"use client";

/** S11 UIT-002：执行报告（/ui-test/tasks/{taskId}）——步骤时间线 + 截图网格（fileId→files download）。 */
import { Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { execTaskDetailApi, type UiTaskDetail } from "@rabbit/api-client";
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

export default function UiTaskReportPage() {
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const params = useParams<{ taskId: string }>();
  const taskId = params.taskId;

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

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="uit-report-page">
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            执行报告
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
        sub={data ? `任务 ${taskId.slice(0, 8)} · ${data.items.length} 条用例 · chromium` : ""}
        extra={
          <a className="text-[#574BFF] text-sm" onClick={() => router.push("/ui-test")}>
            返回列表
          </a>
        }
      />
      <Spin spinning={isLoading}>
        {data?.items.map((item) => (
          <div key={item.itemId} className="border rounded bg-white" data-testid={`uit-report-item-${item.itemId}`}>
            <div className="px-3 py-2 border-b flex items-center gap-2">
              <span className="font-medium text-sm">{item.name}</span>
              <Tag
                color={item.status === "SUCCESS" ? "success" : item.status === "FAILED" ? "error" : "default"}
                data-testid={`uit-report-item-status-${item.itemId}`}
              >
                {item.status}
              </Tag>
            </div>
            <div className="divide-y text-sm">
              {item.steps.map((s) => (
                <div
                  key={s.seq}
                  className={`flex items-center gap-3 px-3 py-2 ${s.status === "FAILED" ? "bg-red-50/60" : ""}`}
                  data-testid={`uit-report-step-${item.itemId}-${s.seq}`}
                >
                  <span className={`font-bold ${STEP_COLOR[s.status]}`}>{STEP_ICON[s.status]}</span>
                  <span className="w-24 text-slate-500">{s.op}</span>
                  <span className="flex-1 font-mono text-xs">{s.name}</span>
                  {s.status === "FAILED" && s.expected !== undefined && (
                    <span className="text-xs text-red-400">
                      期望「{s.expected}」实际「{s.actual}」
                    </span>
                  )}
                  <span className="text-xs text-slate-400">{(s.durationMs / 1000).toFixed(1)}s</span>
                </div>
              ))}
            </div>
          </div>
        ))}
        {shots && shots.length > 0 && (
          <div>
            <div className="text-xs text-slate-500 mb-1">
              截图（{shots.length} 张；screenshot 指令 + 失败自动截图）
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
