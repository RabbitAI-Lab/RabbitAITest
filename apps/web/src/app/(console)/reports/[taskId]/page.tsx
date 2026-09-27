"use client";

import { Button, Input, Modal, Popconfirm, Radio, Tag, Tooltip } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ApiError,
  reportV2Api,
  streamExecFrames,
  taskApi,
} from "@rabbit/api-client";
import type { EventFrame } from "@rabbit/shared";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { DebugSingleView, REPORT_STATUS_META, ReportItemsTable, ReportSummaryCards } from "@/components/report/ReportViewPanels";
import { ScenarioReportView, ScenarioSummaryCards } from "@/components/report/ScenarioReportPanels";

/** RPT-002/RPT-003：报告详情——api_case（统计三卡 + item 表 + 步骤钻取）/ scenario（五卡含误报 + 步骤树 + 变量）/ api_debug（S0 单请求布局保留）。
 *  运行中任务保留 SSE + 轮询刷新；重跑/分享/删除操作在头部。 */

const TYPE_TEXT: Record<string, { label: string; cls: string }> = {
  api_case: { label: "接口用例", cls: "bg-[#574BFF]/10 text-[#574BFF]" },
  api_debug: { label: "调 试", cls: "bg-[#F2F3F5] text-[#646A73]" },
  scenario: { label: "场 景", cls: "bg-[#1677FF]/10 text-[#1677FF]" },
};

export default function ReportPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [frames, setFrames] = useState<EventFrame[]>([]);
  const [shareOpen, setShareOpen] = useState(false);
  const [expireHours, setExpireHours] = useState<1 | 24 | 168 | 720>(24);

  const { data, refetch, isLoading } = useQuery({
    queryKey: ["report", projectId, taskId],
    queryFn: () => reportV2Api.detail(projectId!, taskId),
    enabled: Boolean(projectId && taskId),
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "SUCCESS" || s === "FAILED" || s === "STOPPED" ? false : 2000; // RUNNING 轮询兜底（SSE 断开时仍能收敛）
    },
  });

  // SSE 实时流：收到帧即累积，终态后拉一次详情并刷新 item 钻取帧
  useEffect(() => {
    if (!projectId || !taskId) return;
    const ac = new AbortController();
    void streamExecFrames(
      taskId,
      (frame) => {
        setFrames((fs) => [...fs, frame]);
        if (frame.type === "task-final") {
          void refetch();
          void qc.invalidateQueries({ queryKey: ["report-item-frames", projectId, taskId] });
        }
      },
      ac.signal,
    );
    return () => ac.abort();
  }, [projectId, taskId, refetch, qc]);

  const status = data?.status ?? "PENDING";
  const running = status === "PENDING" || status === "RUNNING";
  const rerunnable = status === "FAILED" || status === "STOPPED";
  const canRerun = can("PROJECT_EXEC_TASK:UPDATE");
  const canShare = can("PROJECT_REPORT:SHARE");
  const canDelete = can("PROJECT_REPORT:READ");
  const statusMeta = REPORT_STATUS_META[status] ?? { label: status, color: "#87888D" };

  const rerun = useMutation({
    mutationFn: () => taskApi.rerun(projectId!, taskId),
    onSuccess: (r) => {
      message.success(`已发起重跑，跳转新报告（${r.taskId.slice(0, 8)}）`);
      router.push(`/reports/${r.taskId}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "重跑失败"),
  });
  const remove = useMutation({
    mutationFn: () => reportV2Api.remove(projectId!, taskId),
    onSuccess: () => {
      message.success("报告已删除");
      router.push("/reports");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  if (!projectId) {
    return <div className="rabbit-card p-16 text-center text-[#A8ABB0]">请先选择项目</div>;
  }
  if (isLoading || !data) {
    return <div className="rabbit-card p-16 text-center text-[#A8ABB0]">报告加载中…</div>;
  }

  return (
    <div className="max-w-5xl">
      {/* 头部：返回链接 + 名称 + 状态徽标 + 类型 + 操作（重跑/分享/返回列表/删除） */}
      <div className="rabbit-card p-3 flex items-center gap-3 flex-wrap">
        {data.type === "api_debug" ? (
          <a
            className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline"
            href="/debug"
          >
            ‹ 返回调试
          </a>
        ) : (
          <a
            className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline"
            href="/reports"
          >
            ‹ 返回列表
          </a>
        )}
        <h1 className="text-base font-medium m-0 truncate max-w-72" data-testid="report-name">
          {data.name}
        </h1>
        <span
          className="rounded-full px-2 py-0.5 text-xs font-medium"
          data-testid="report-status"
          style={{ background: `${statusMeta.color}18`, color: statusMeta.color }}
        >
          {status}
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs ${TYPE_TEXT[data.type]?.cls ?? "bg-[#F2F3F5] text-[#646A73]"}`}
        >
          {TYPE_TEXT[data.type]?.label ?? data.type}
        </span>
        <span className="text-xs text-[#A8ABB0]">
          T-{taskId.slice(0, 8)} · {data.createdAt.replace("T", " ").slice(0, 16)}
        </span>
        {data.failureKind && status === "FAILED" && (
          <Tag color="error" bordered={false}>
            {data.failureKind}
          </Tag>
        )}
        <span className="ml-auto flex items-center gap-2">
          {rerunnable && (
            <Tooltip title={canRerun ? "复用原任务配置发起新执行，跳转新报告" : "缺少 PROJECT_EXEC_TASK:UPDATE 权限"}>
              <Button
                loading={rerun.isPending}
                disabled={!canRerun}
                onClick={() => rerun.mutate()}
                data-testid="btn-rerun-report"
              >
                重 跑
              </Button>
            </Tooltip>
          )}
          {!running && canShare && (
            <Button onClick={() => setShareOpen(true)} data-testid="btn-share-report">
              分 享
            </Button>
          )}
          <Button onClick={() => router.push("/reports")} data-testid="btn-back-reports">
            返回列表
          </Button>
          {!running && canDelete && (
            <Popconfirm
              title="删除该报告？"
              description="将级联清理报告+分享+任务+条目+帧，任务中心同步消失，不可恢复。"
              okText="删除"
              okButtonProps={{ danger: true }}
              onConfirm={() => remove.mutate()}
            >
              <Button danger loading={remove.isPending} data-testid="btn-delete-report">
                删除
              </Button>
            </Popconfirm>
          )}
        </span>
      </div>

      {data.type === "api_case" ? (
        <div className="mt-4 space-y-4">
          {/* 统计三卡 */}
          <ReportSummaryCards summary={data.summary} durationMs={data.durationMs} />
          {/* item 表 + 步骤钻取 */}
          <ReportItemsTable projectId={projectId} taskId={taskId} items={data.items} />
          {data.message && status === "FAILED" && (
            <div className="rabbit-card p-3 text-[13px] text-[#FF4D4F]" data-testid="report-failure-message">
              失败信息：{data.message}
            </div>
          )}
        </div>
      ) : data.type === "scenario" ? (
        <div className="mt-4 space-y-4" data-testid="report-scenario-view">
          {/* RPT-003 五卡（含误报单列） + 场景 item 表 + 步骤树/变量 */}
          <ScenarioSummaryCards summary={data.summary} durationMs={data.durationMs} />
          <ScenarioReportView projectId={projectId} detail={data} />
          {data.message && status === "FAILED" && (
            <div className="rabbit-card p-3 text-[13px] text-[#FF4D4F]" data-testid="report-failure-message">
              失败信息：{data.message}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-4">
          {/* api_debug：S0 单请求布局（testid 与旧版一致） */}
          <DebugSingleView detail={data} liveFrames={frames} />
        </div>
      )}

      <ShareModal
        projectId={projectId}
        taskId={taskId}
        open={shareOpen}
        expireHours={expireHours}
        onExpireChange={setExpireHours}
        onClose={() => setShareOpen(false)}
      />
    </div>
  );
}

/* ── 分享弹窗：有效期单选 + 生成链接 + 已存在链接列表（复制/过期标记/撤销） ── */
function ShareModal({
  projectId,
  taskId,
  open,
  expireHours,
  onExpireChange,
  onClose,
}: {
  projectId: string;
  taskId: string;
  open: boolean;
  expireHours: 1 | 24 | 168 | 720;
  onExpireChange: (v: 1 | 24 | 168 | 720) => void;
  onClose: () => void;
}) {
  const { message } = useApp();
  const qc = useQueryClient();
  const sharesQ = useQuery({
    queryKey: ["report-shares", projectId, taskId],
    queryFn: () => reportV2Api.shares(projectId, taskId),
    enabled: open,
  });
  const create = useMutation({
    mutationFn: () => reportV2Api.createShare(projectId, taskId, expireHours),
    onSuccess: async (r) => {
      void qc.invalidateQueries({ queryKey: ["report-shares", projectId, taskId] });
      const url = `${window.location.origin}/share/report/${r.token}`;
      try {
        await navigator.clipboard.writeText(url);
        message.success("链接已生成并复制到剪贴板");
      } catch {
        message.success("链接已生成");
      }
    },
    onError: (e) =>
      message.error(e instanceof ApiError || e instanceof Error ? e.message : "生成失败"),
  });
  const revoke = useMutation({
    mutationFn: (token: string) => reportV2Api.revokeShare(projectId, taskId, token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["report-shares", projectId, taskId] });
      message.success("链接已撤销");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "撤销失败"),
  });

  const shareUrl = (token: string) =>
    typeof window === "undefined" ? "" : `${window.location.origin}/share/report/${token}`;

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(shareUrl(token));
      message.success("链接已复制");
    } catch {
      message.error("复制失败，请手动复制");
    }
  };

  return (
    <Modal title="分享报告" open={open} onCancel={onClose} footer={null} width={680} destroyOnHidden>
      <div className="space-y-3" data-testid="share-report-modal">
        <div className="flex items-center gap-3">
          <span className="text-[13px] text-[#646A73]">有效期</span>
          <Radio.Group
            value={expireHours}
            onChange={(e) => onExpireChange(e.target.value as 1 | 24 | 168 | 720)}
            options={[
              { value: 1, label: "1 小时" },
              { value: 24, label: "1 天" },
              { value: 168, label: "7 天" },
              { value: 720, label: "30 天" },
            ]}
            optionType="button"
            buttonStyle="solid"
            data-testid="share-expire-radio"
          />
          <Button
            type="primary"
            className="!ml-auto"
            loading={create.isPending}
            onClick={() => create.mutate()}
            data-testid="btn-create-share"
          >
            生成链接
          </Button>
        </div>

        <div className="border border-[#F0F1F3] rounded-md" data-testid="share-links">
          <p className="px-3 py-2 border-b border-[#F0F1F3] text-xs text-[#87888D] m-0">
            已存在链接（同报告多链接并存，重复创建=新 token；免登只读）
          </p>
          {(sharesQ.data?.items ?? []).map((s) => (
            <div
              key={s.token}
              className="flex items-center gap-2 px-3 py-2 border-b border-[#F7F8FA] last:border-0"
              data-testid="share-link-row"
            >
              <Input
                readOnly
                className="flex-1 !font-mono !text-xs"
                value={shareUrl(s.token)}
                data-testid="share-link-url"
              />
              <Button size="small" onClick={() => void copy(s.token)}>
                复制
              </Button>
              <span className="text-xs text-[#87888D] whitespace-nowrap">
                至 {s.expireAt.replace("T", " ").slice(0, 16)}
              </span>
              {s.expired ? (
                <span className="text-xs text-[#A8ABB0]">已过期</span>
              ) : (
                <span className="text-xs text-[#52C41A]">有效</span>
              )}
              <Button
                size="small"
                danger
                disabled={s.expired}
                loading={revoke.isPending && revoke.variables === s.token}
                onClick={() => revoke.mutate(s.token)}
                data-testid="btn-revoke-share"
              >
                撤销
              </Button>
            </div>
          ))}
          {(sharesQ.data?.items ?? []).length === 0 && (
            <p className="px-3 py-3 text-xs text-[#A8ABB0] m-0">
              暂无分享链接；选择有效期后点击「生成链接」。
            </p>
          )}
        </div>
        <p className="text-xs text-[#A8ABB0] m-0">
          撤销 / 过期 / 不存在的 token 访问免登页统一呈现「分享链接已过期或不存在」空态；密码保护与可导出为 S3 RPT-003 范围。
        </p>
      </div>
    </Modal>
  );
}
