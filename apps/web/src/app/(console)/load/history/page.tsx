"use client";

/** S11 LOAD-003：执行历史（/load/history，任务列表跨计划）。 */
import { Spin, Table, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { loadApi, type LoadTaskRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useProjectStore } from "@/stores/project";

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: "success",
  FAILED: "error",
  RUNNING: "processing",
  PENDING: "default",
  STOPPED: "warning",
};

export default function LoadHistoryPage() {
  const router = useRouter();
  const { currentProjectId } = useProjectStore();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["load-tasks", currentProjectId, page],
    queryFn: () => loadApi.tasks(currentProjectId!, { page }),
    enabled: Boolean(currentProjectId),
  });

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="load-history-page">
      <PageHeader title="执行历史" sub="性能测试 · 全部施压任务" />
      <Spin spinning={isLoading}>
        <Table<LoadTaskRow>
          rowKey="taskId"
          size="small"
          dataSource={data?.list ?? []}
          data-testid="load-tasks-table"
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
          }}
          columns={[
            {
              title: "任务",
              dataIndex: "taskId",
              render: (v: string) => <span className="font-mono text-xs">{v.slice(0, 8)}</span>,
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 110,
              render: (v: string) => <Tag color={STATUS_COLOR[v] ?? "default"}>{v}</Tag>,
            },
            {
              title: "耗时",
              dataIndex: "durationMs",
              width: 100,
              render: (v: number | null) => (v ? `${(v / 1000).toFixed(1)}s` : "—"),
            },
            {
              title: "消息",
              dataIndex: "message",
              render: (v: string | null) => (
                <span className="text-xs text-slate-500">{v || "—"}</span>
              ),
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              width: 170,
              render: (v: string) => new Date(v).toLocaleString("zh-CN"),
            },
            {
              title: "操作",
              key: "ops",
              width: 130,
              render: (_, r) => (
                <span className="space-x-3">
                  {r.status === "RUNNING" || r.status === "PENDING" ? (
                    <a
                      className="text-[#574BFF]"
                      onClick={() => router.push(`/load/tasks/${r.taskId}`)}
                    >
                      监控
                    </a>
                  ) : (
                    <a
                      className="text-[#574BFF]"
                      onClick={() => router.push(`/load/reports/${r.taskId}`)}
                    >
                      报告
                    </a>
                  )}
                </span>
              ),
            },
          ]}
        />
      </Spin>
    </div>
  );
}
