"use client";

import { Badge, Button, Empty, Input, Popconfirm, Progress, Select, Table, Tag, Tooltip } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { taskApi, type ExecTaskRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** SYS-006：任务中心——范围 Tabs（本项目/全部项目）+ 实时任务（动态轮询）/ 定时任务（空态）。 */

const TYPE_META: Record<string, { label: string; cls: string }> = {
  api_case: { label: "接口用例", cls: "bg-[#574BFF]/10 text-[#574BFF]" },
  api_debug: { label: "接口调试", cls: "bg-amber-50 text-amber-600" },
};

/** 耗时人性化：ms → 842ms / 1.2s / 45s / 3min / 1.5h */
function humanDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min`;
  return `${(ms / 3_600_000).toFixed(1).replace(/\.0$/, "")}h`;
}

/** 状态列：PENDING/RUNNING=进行中蓝点（RUNNING 用 processing 动效）· SUCCESS 绿 · FAILED 红 · STOPPED 灰 · stuck 黄标 */
function StatusCell({ row }: { row: ExecTaskRow }) {
  if (row.status === "RUNNING")
    return (
      <span className="flex items-center gap-1">
        <Badge status="processing" text={<span className="text-[#1677FF]">RUNNING</span>} />
        {row.stuck && (
          <Tooltip title="判定：status=RUNNING 且心跳（updatedAt）超 10 分钟未续写">
            <Tag color="warning" className="!m-0">
              疑似卡死
            </Tag>
          </Tooltip>
        )}
      </span>
    );
  if (row.status === "PENDING") return <Badge color="#1677FF" text={<span className="text-[#1677FF]">PENDING</span>} />;
  if (row.status === "SUCCESS") return <Badge status="success" text="SUCCESS" />;
  if (row.status === "FAILED") return <Badge status="error" text="FAILED" />;
  return <Badge status="default" text="STOPPED" />;
}

export default function TaskCenterPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();

  const [scope, setScope] = useState<"project" | "all">("project");
  const [subTab, setSubTab] = useState<"realtime" | "cron">("realtime");
  const [typeFilter, setTypeFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<string>();
  const [creator, setCreator] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const canUpdate = can("PROJECT_EXEC_TASK:UPDATE");

  // 「进行中」(PENDING∪RUNNING) 与「疑似卡死」(stuck) 无服务端单值参数，取回当页后客户端过滤
  const serverStatus =
    statusFilter === "SUCCESS" || statusFilter === "FAILED" || statusFilter === "STOPPED"
      ? statusFilter
      : undefined;
  const clientFilter = (row: ExecTaskRow) => {
    if (statusFilter === "RUNNING_GROUP") return row.status === "PENDING" || row.status === "RUNNING";
    if (statusFilter === "STUCK") return row.stuck;
    return true;
  };

  const { data, isLoading } = useQuery({
    queryKey: ["exec-tasks", scope, projectId, typeFilter, serverStatus, creator, from, to, page],
    queryFn: () => {
      const q = {
        type: typeFilter,
        status: serverStatus,
        page,
        pageSize: 20,
        ...(scope === "project"
          ? {
              creator: creator || undefined,
              ...(from ? { from: new Date(from).toISOString() } : {}),
              ...(to ? { to: new Date(`${to}T23:59:59`).toISOString() } : {}),
            }
          : {}),
      };
      return scope === "project"
        ? taskApi.listProject(projectId!, q)
        : taskApi.listAll(q);
    },
    enabled: Boolean(scope === "all" || projectId),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const active = items.some((t) => t.status === "PENDING" || t.status === "RUNNING");
      return active ? 3000 : 30000; // 存在进行中 → 3s，否则 30s 兜底
    },
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["exec-tasks", scope, projectId] });
  const stop = useMutation({
    mutationFn: (taskId: string) => taskApi.stop(projectId!, taskId),
    onSuccess: () => {
      invalidate();
      message.success("停止指令已下发，状态稍后更新");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "停止失败"),
  });
  const rerun = useMutation({
    mutationFn: (taskId: string) => taskApi.rerun(projectId!, taskId),
    onSuccess: (r) => {
      invalidate();
      message.success(`已发起重跑，新任务 ${r.taskId.slice(0, 8)} 稍后出现在列表`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "重跑失败"),
  });

  if (scope === "project" && !projectId) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="请先选择项目" />
      </div>
    );
  }

  const rows = (data?.items ?? []).filter(clientFilter);
  const resetFilters = () => {
    setTypeFilter(undefined);
    setStatusFilter(undefined);
    setCreator("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        title="任务中心"
        sub="实时任务（接口调试 / 接口用例批量执行）与定时任务统一入口；停止与重跑即时生效"
      />
      <div className="rabbit-card flex flex-col" data-testid="task-center">
        {/* 范围 Tabs：本项目 / 全部项目（服务端按我可见项目过滤） */}
        <div className="flex items-end px-3 border-b border-[#F0F1F3]" data-testid="scope-tabs">
          {(
            [
              ["project", `本项目`],
              ["all", "全部项目"],
            ] as const
          ).map(([key, label]) => (
            <span
              key={key}
              data-testid={`scope-tab-${key}`}
              className={`py-2.5 px-3 border-b-2 -mb-px cursor-pointer text-[13px] transition-colors ${scope === key ? "border-[#574BFF] text-[#574BFF] font-medium" : "border-transparent text-[#646A73] hover:text-[#3D4350]"}`}
              onClick={() => {
                setScope(key);
                setPage(1);
              }}
            >
              {label}
            </span>
          ))}
          <span className="ml-auto pb-2 text-xs text-[#A8ABB0]">
            自动刷新：存在进行中 → 3s · 否则 30s
          </span>
        </div>

        {/* 次级 Tabs：实时任务 / 定时任务 */}
        <div className="px-3 flex gap-5 text-[13px] border-b border-[#F0F1F3]" data-testid="task-tabs">
          {(
            [
              ["realtime", "实时任务"],
              ["cron", "定时任务"],
            ] as const
          ).map(([key, label]) => (
            <span
              key={key}
              data-testid={`task-tab-${key}`}
              className={`py-2 border-b-2 -mb-px cursor-pointer transition-colors ${subTab === key ? "border-[#574BFF] text-[#574BFF] font-medium" : "border-transparent text-[#646A73] hover:text-[#3D4350]"}`}
              onClick={() => setSubTab(key)}
            >
              {label}
            </span>
          ))}
        </div>

        {subTab === "cron" ? (
          /* 定时任务：S3 场景定时 / S4 计划定时 / S6 Swagger 同步接入前为空态 */
          <div
            className="flex flex-col items-center justify-center py-14 text-center gap-2"
            data-testid="cron-empty"
          >
            <span className="text-4xl">⏰</span>
            <p className="text-[#3D4350]">暂无定时任务</p>
            <p className="text-[13px] text-[#A8ABB0] max-w-md leading-6">
              定时任务将随 <b>场景定时执行（Sprint 3）</b> / <b>计划定时（Sprint 4）</b> /{" "}
              <b>Swagger 同步（Sprint 6）</b> 逐步接入
            </p>
          </div>
        ) : (
          <>
            {/* 筛选条：类型 / 状态 / 创建人 / 时间区间（全部项目口径不支持创建人与时间，禁用） */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3] flex-wrap text-[13px]">
              <Select
                className="w-32"
                allowClear
                placeholder="类型：全部"
                value={typeFilter}
                onChange={(v) => {
                  setTypeFilter(v);
                  setPage(1);
                }}
                options={[
                  { value: "api_debug", label: "接口调试" },
                  { value: "api_case", label: "接口用例" },
                ]}
                data-testid="task-filter-type"
              />
              <Select
                className="w-32"
                allowClear
                placeholder="状态：全部"
                value={statusFilter}
                onChange={(v) => {
                  setStatusFilter(v);
                  setPage(1);
                }}
                options={[
                  { value: "RUNNING_GROUP", label: "进行中" },
                  { value: "SUCCESS", label: "成功" },
                  { value: "FAILED", label: "失败" },
                  { value: "STOPPED", label: "已停止" },
                  { value: "STUCK", label: "疑似卡死" },
                ]}
                data-testid="task-filter-status"
              />
              <Input
                className="w-36"
                allowClear
                placeholder="创建人"
                disabled={scope === "all"}
                value={creator}
                onChange={(e) => {
                  setCreator(e.target.value);
                  setPage(1);
                }}
                data-testid="task-filter-creator"
              />
              <span className="flex items-center gap-1">
                <Input
                  className="w-36"
                  type="date"
                  disabled={scope === "all"}
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                  data-testid="task-filter-from"
                />
                <span className="text-[#A8ABB0]">~</span>
                <Input
                  className="w-36"
                  type="date"
                  disabled={scope === "all"}
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                  data-testid="task-filter-to"
                />
              </span>
              <Button size="small" onClick={() => invalidate()}>
                查 询
              </Button>
              <Button size="small" onClick={resetFilters}>
                重 置
              </Button>
              {scope === "all" && (
                <span className="text-xs text-[#A8ABB0]">
                  全部项目口径暂不支持创建人 / 时间筛选（仅类型与状态）
                </span>
              )}
            </div>

            <Table<ExecTaskRow>
              rowKey="id"
              size="middle"
              loading={isLoading}
              dataSource={rows}
              data-testid="task-list-table"
              locale={{
                emptyText: (
                  <div className="flex flex-col items-center gap-2 py-10 text-[#A8ABB0]">
                    <span className="text-3xl">📭</span>
                    <p className="m-0">暂无任务</p>
                    <p className="m-0 text-xs">
                      从「接口调试 / 接口用例」发起执行后，任务将实时出现在此处
                    </p>
                  </div>
                ),
              }}
              onRow={(_, i) =>
                ({
                  "data-testid": `task-row-${i}`,
                }) as React.HTMLAttributes<HTMLTableRowElement>
              }
              pagination={{
                current: page,
                pageSize: 20,
                total: data?.total ?? 0,
                onChange: setPage,
                showTotal: (t) => `共 ${t} 条`,
              }}
              columns={[
                {
                  title: "任务",
                  dataIndex: "id",
                  render: (id: string, row) => (
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-mono text-xs">{id.slice(0, 8)}</span>
                      <span
                        className={`border rounded px-1.5 py-0.5 text-xs ${TYPE_META[row.type]?.cls ?? ""}`}
                      >
                        {TYPE_META[row.type]?.label ?? row.type}
                      </span>
                    </span>
                  ),
                },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 150,
                  render: (_, row) => <StatusCell row={row} />,
                },
                {
                  title: "进度",
                  dataIndex: "passed",
                  width: 150,
                  render: (_v: number, row) =>
                    row.total > 0 ? (
                      <span className="flex items-center gap-2">
                        <Progress
                          percent={Math.round((row.passed / row.total) * 100)}
                          size="small"
                          showInfo={false}
                          className="!m-0 w-16"
                          strokeColor={
                            row.status === "FAILED"
                              ? "#FF4D4F"
                              : row.status === "RUNNING" || row.status === "PENDING"
                                ? "#1677FF"
                                : row.stuck
                                  ? "#FAAD14"
                                  : "#52C41A"
                          }
                        />
                        <span className="text-xs text-[#87888D]">
                          {row.passed}/{row.total}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[#C0C4CC]">—</span>
                    ),
                },
                { title: "创建人", dataIndex: "creator", width: 90, ellipsis: true },
                {
                  title: "开始时间",
                  dataIndex: "createdAt",
                  width: 100,
                  render: (v: string) => (
                    <span className="text-xs text-[#87888D]">{v.replace("T", " ").slice(11, 19)}</span>
                  ),
                },
                {
                  title: "耗时",
                  dataIndex: "durationMs",
                  width: 90,
                  render: (v: number | null, row) => (
                    <span className={row.stuck ? "text-[#FA8C16]" : ""}>{humanDuration(v)}</span>
                  ),
                },
                {
                  title: "重跑自",
                  dataIndex: "rerunOf",
                  width: 110,
                  render: (v: string | null) =>
                    v ? (
                      <span className="text-xs text-[#87888D]">
                        ← <span className="font-mono">{v.slice(0, 8)}</span>
                      </span>
                    ) : (
                      <span className="text-[#C0C4CC]">—</span>
                    ),
                },
                {
                  title: "操作",
                  key: "op",
                  width: 200,
                  render: (_, row, i) => {
                    const running = row.status === "PENDING" || row.status === "RUNNING";
                    const rerunnable = row.status === "FAILED" || row.status === "STOPPED";
                    return (
                      <span className="flex gap-1 whitespace-nowrap">
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          onClick={() => router.push(`/reports/${row.id}`)}
                          data-testid={`btn-view-report-${i}`}
                        >
                          查看报告
                        </Button>
                        {running && (
                          <Popconfirm
                            title="停止该任务？"
                            description="进行中的条目将被终止（STOPPED），可稍后重跑。"
                            okText="停止"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => stop.mutate(row.id)}
                            disabled={!canUpdate}
                          >
                            <Button
                              type="link"
                              size="small"
                              danger
                              className="!px-0"
                              disabled={!canUpdate}
                              data-testid={`btn-stop-${i}`}
                            >
                              停止
                            </Button>
                          </Popconfirm>
                        )}
                        {rerunnable && (
                          <Tooltip title={canUpdate ? undefined : "缺少 PROJECT_EXEC_TASK:UPDATE 权限"}>
                            <Button
                              type="link"
                              size="small"
                              className="!px-0"
                              disabled={!canUpdate}
                              loading={rerun.isPending && rerun.variables === row.id}
                              onClick={() => rerun.mutate(row.id)}
                              data-testid={`btn-rerun-${i}`}
                            >
                              重跑
                            </Button>
                          </Tooltip>
                        )}
                      </span>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
