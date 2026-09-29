"use client";

/** S4 PLAN-003 执行入口：执行按钮（全部/当前点）+ 执行配置抽屉（生效来源）+ 进行态轮询 + 执行历史。 */
import { Button, Drawer, Progress, Select, Switch, Table, Tag } from "antd";
import { Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { envApi, planExecApi } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const TASK_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: "排队中", color: "#87888D" },
  RUNNING: { label: "执行中", color: "#1677FF" },
  SUCCESS: { label: "成功", color: "#52C41A" },
  FAILED: { label: "失败", color: "#FF4D4F" },
  STOPPED: { label: "已停止", color: "#FA8C16" },
};

export function PlanExecBar({
  projectId,
  planId,
  writable,
  pointOptions,
  defaultPointId,
}: {
  projectId: string;
  planId: string;
  writable: boolean;
  /** 测试点选项（名称来自规划 Tab） */
  pointOptions: { id: string; name: string }[];
  defaultPointId?: string;
}) {
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const canUpdate = usePermissions().can("PROJECT_PLAN:UPDATE") && writable;
  const [configOpen, setConfigOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runningTask, setRunningTask] = useState<string | null>(null);
  const [cfg, setCfg] = useState<{
    envId?: string | null;
    mode: "serial" | "parallel";
    stopOnFail: boolean;
  }>({
    mode: "serial",
    stopOnFail: false,
  });

  const envsQ = useQuery({ queryKey: ["envs", projectId], queryFn: () => envApi.list(projectId) });

  const execute = useMutation({
    mutationFn: (pointId?: string) =>
      planExecApi.execute(projectId, planId, {
        pointId,
        envId: cfg.envId ?? undefined,
        mode: cfg.mode,
        stopOnFail: cfg.stopOnFail,
      }),
    onSuccess: (r) => {
      message.success(`已发起执行（${r.itemCount} 项），任务 ${r.taskId.slice(0, 8)}`);
      setRunningTask(r.taskId);
      qc.invalidateQueries({ queryKey: ["plan-executions", planId] });
    },
    onError: (e: Error) => message.error(e.message),
  });

  // 进行态：轮询执行历史首条直至终态
  const executionsQ = useQuery({
    queryKey: ["plan-executions", planId],
    queryFn: () => planExecApi.executions(projectId, planId, 1, 10),
    refetchInterval: runningTask ? 2000 : false,
  });
  const first = executionsQ.data?.items?.[0];
  if (
    runningTask &&
    first &&
    ["SUCCESS", "FAILED", "STOPPED"].includes(first.status) &&
    first.taskId === runningTask
  ) {
    setRunningTask(null);
    message.success(`执行完成（${TASK_META[first.status]?.label ?? first.status}），正在打开报告…`);
    router.push(`/reports/${first.taskId}`);
  }
  const executing = runningTask !== null;

  return (
    <div className="flex items-center gap-2">
      {executing && (
        <span
          className="flex items-center gap-2 text-[13px] text-[#1677FF]"
          data-testid="plan-exec-running"
        >
          <Loader2 size={14} className="animate-spin" /> 执行中…
          <Button
            size="small"
            danger
            onClick={async () => {
              const { taskApi } = await import("@rabbit/api-client");
              try {
                await taskApi.stop(projectId, runningTask!);
                message.success("已发送停止信号");
              } catch (e) {
                message.error((e as Error).message);
              }
            }}
          >
            ■ 停止
          </Button>
        </span>
      )}
      <Button onClick={() => setHistoryOpen(true)} data-testid="btn-plan-executions">
        执行历史
      </Button>
      {canUpdate && (
        <>
          <Button onClick={() => setConfigOpen(true)} data-testid="btn-exec-config">
            执行配置
          </Button>
          <Button
            type="primary"
            loading={execute.isPending}
            disabled={executing}
            onClick={() => execute.mutate(undefined)}
            data-testid="btn-execute-plan"
          >
            ▶ 执行全部
          </Button>
          {defaultPointId && (
            <Button
              disabled={executing}
              onClick={() => execute.mutate(defaultPointId)}
              data-testid="btn-execute-point-bar"
            >
              执行当前点
            </Button>
          )}
        </>
      )}

      <Drawer
        title="执行配置（计划默认，可被点配置覆盖）"
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        width={380}
      >
        <div className="space-y-3 text-[13px]">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-16">环境</span>
            <Select
              className="flex-1"
              allowClear
              placeholder="无"
              value={cfg.envId ?? undefined}
              onChange={(v) => setCfg((c) => ({ ...c, envId: v ?? null }))}
              options={(envsQ.data?.items ?? []).map((e: { id: string; name: string }) => ({
                value: e.id,
                label: e.name,
              }))}
              data-testid="exec-config-env"
            />
          </div>
          <label className="flex items-center gap-2">
            <Switch
              size="small"
              checked={cfg.mode === "parallel"}
              onChange={(v) => setCfg((c) => ({ ...c, mode: v ? "parallel" : "serial" }))}
            />
            并行执行（关闭=串行）
          </label>
          <label className="flex items-center gap-2">
            <Switch
              size="small"
              checked={cfg.stopOnFail}
              onChange={(v) => setCfg((c) => ({ ...c, stopOnFail: v }))}
            />
            失败停止（余项 SKIPPED）
          </label>
          <p className="text-[11px] text-[#A8ABB0]">
            生效优先级：本次显式 &gt; 测试点显式（继承链）&gt; 计划默认；点级环境在「测试规划」Tab
            配置
          </p>
          {pointOptions.length > 0 && (
            <div className="border rounded p-2 text-xs text-slate-500">
              可按点执行：{pointOptions.map((p) => p.name).join("、")}
            </div>
          )}
        </div>
      </Drawer>

      <Drawer title="执行历史" open={historyOpen} onClose={() => setHistoryOpen(false)} width={560}>
        <Table<{
          taskId: string;
          status: string;
          itemCount: number;
          durationMs: number | null;
          createdAt: string;
          finishedAt: string | null;
          createdBy: string;
        }>
          rowKey="taskId"
          size="small"
          dataSource={executionsQ.data?.items ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            {
              title: "状态",
              width: 90,
              render: (_, r: { status: string }) => {
                const m = TASK_META[r.status] ?? TASK_META.PENDING!;
                return (
                  <span style={{ color: m.color }} className="font-medium">
                    {m.label}
                  </span>
                );
              },
            },
            { title: "用例数", dataIndex: "itemCount", width: 70 },
            {
              title: "耗时",
              width: 90,
              render: (_, r: { durationMs: number | null }) =>
                r.durationMs == null ? "—" : `${(r.durationMs / 1000).toFixed(1)}s`,
            },
            {
              title: "发起时间",
              width: 150,
              render: (_, r: { createdAt: string }) =>
                new Date(r.createdAt).toLocaleString("zh-CN"),
            },
            {
              title: "",
              render: (_, r: { taskId: string; status: string }) =>
                ["SUCCESS", "FAILED", "STOPPED"].includes(r.status) ? (
                  <a className="text-[#574BFF]" onClick={() => router.push(`/reports/${r.taskId}`)}>
                    报告 ↗
                  </a>
                ) : null,
            },
          ]}
        />
      </Drawer>
    </div>
  );
}

/** 计划/点级执行 mutation（PointsPanel「执行本点」复用；发起后跳执行报告）。 */
export function usePlanExecute(projectId: string, planId: string) {
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pointId: string | undefined) =>
      planExecApi.execute(projectId, planId, {
        pointId,
        mode: "serial",
      }),
    onSuccess: (r) => {
      message.success(`已发起执行（${r.itemCount} 项），正在打开报告…`);
      qc.invalidateQueries({ queryKey: ["plan-executions", planId] });
      router.push(`/reports/${r.taskId}`);
    },
    onError: (e: Error) => message.error(e.message),
  });
}

/** 单条引擎执行按钮（用例清单行内：api_case/scenario）。 */
export function RunRefButton({
  projectId,
  planId,
  refId,
  disabled,
}: {
  projectId: string;
  planId: string;
  refId: string;
  disabled: boolean;
}) {
  const { message } = useApp();
  const router = useRouter();
  const run = useMutation({
    mutationFn: () => planExecApi.runRef(projectId, planId, refId),
    onSuccess: (r) => {
      message.success(`已发起单条执行，任务 ${r.taskId.slice(0, 8)}`);
      router.push(`/reports/${r.taskId}`);
    },
    onError: (e: Error) => message.error(e.message),
  });
  return (
    <Button
      size="small"
      loading={run.isPending}
      disabled={disabled}
      onClick={() => run.mutate()}
      data-testid={`btn-run-ref-${refId}`}
    >
      ▶
    </Button>
  );
}

export function PlanRunProgress({ done, total }: { done: number; total: number }) {
  if (total === 0) return null;
  return (
    <span className="flex items-center gap-2" data-testid="plan-run-progress">
      <Progress percent={Math.round((done / total) * 100)} size="small" className="w-28 mb-0" />
      <span className="text-xs text-[#A8ABB0]">
        {done}/{total}
      </span>
    </span>
  );
}
