"use client";

import { Button, Empty, Input, Popconfirm, Segmented, Select, Table } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { reportV2Api, type ReportRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** RPT-002：报告列表——类型/关键字筛选 + 状态徽标 + 统计列 + 详情/删除（分享入口在详情页）。 */

const TYPE_META: Record<string, { label: string; cls: string }> = {
  api_case: { label: "接口用例", cls: "bg-[#574BFF]/10 text-[#574BFF]" },
  api_debug: { label: "调 试", cls: "bg-[#F2F3F5] text-[#646A73]" },
};
const STATUS_META: Record<string, { label: string; color: string }> = {
  SUCCESS: { label: "成功", color: "#52C41A" },
  FAILED: { label: "失败", color: "#FF4D4F" },
  RUNNING: { label: "执行中", color: "#1677FF" },
  PENDING: { label: "执行中", color: "#1677FF" },
  STOPPED: { label: "已停止", color: "#87888D" },
};

export default function ReportListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [typeFilter, setTypeFilter] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ["reports", projectId, typeFilter, keyword, page],
    queryFn: () =>
      reportV2Api.list(projectId!, {
        reportType: typeFilter,
        keyword: keyword || undefined,
        page,
        pageSize: 20,
      }),
    enabled: Boolean(projectId),
  });

  // 删除端点权限口径 = PROJECT_REPORT:READ + 项目可写（服务端复验，此处按页面读权限放行展示）
  const canDelete = can("PROJECT_REPORT:READ");
  const remove = useMutation({
    mutationFn: (taskId: string) => reportV2Api.remove(projectId!, taskId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reports", projectId] });
      message.success("报告已删除（级联清理报告+分享+任务+条目+帧）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  if (!projectId) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="请先选择项目" />
      </div>
    );
  }

  const rows = data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="接口报告"
        sub="调试与接口用例批量执行的报告统一列表；删除将级联清理任务与帧（任务中心同步消失）"
        extra={
          <Segmented
            value="list"
            onChange={(v) => v === "stats" && router.push("/reports/stats")}
            options={[
              { label: "列表", value: "list" },
              { label: "统计", value: "stats" },
            ]}
            data-testid="report-tab"
          />
        }
      />
      <div className="rabbit-card">
        {/* 筛选条：类型 + 关键字（名称/创建人） */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3] flex-wrap">
          <Select
            className="w-32"
            allowClear
            placeholder="全部类型"
            value={typeFilter}
            onChange={(v) => {
              setTypeFilter(v);
              setPage(1);
            }}
            options={[
              { value: "api_debug", label: "调试" },
              { value: "api_case", label: "接口用例" },
            ]}
            data-testid="report-filter-type"
          />
          <Input.Search
            className="w-64"
            allowClear
            placeholder="关键字：报告名称"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            data-testid="report-filter-keyword"
          />
          <span className="ml-auto text-xs text-[#A8ABB0]">
            分享入口在报告详情页头部「分享」操作
          </span>
        </div>

        <Table<ReportRow>
          rowKey="taskId"
          size="middle"
          loading={isLoading}
          dataSource={rows}
          data-testid="report-list-table"
          locale={{
            emptyText: (
              <div className="flex flex-col items-center gap-2 py-12 text-[#A8ABB0]">
                <span className="text-3xl">📄</span>
                <p className="m-0">暂无报告</p>
                <p className="m-0 text-xs">
                  在
                  <a className="text-[#574BFF]" href="/debug">
                    接口调试
                  </a>
                  发起调试，或在接口定义 CASE 批量执行后自动生成
                </p>
              </div>
            ),
          }}
          onRow={(_, i) =>
            ({
              "data-testid": `report-row-${i}`,
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
              title: "名称",
              dataIndex: "name",
              render: (v: string, row) => (
                <span className="flex items-center gap-2 min-w-0">
                  <a
                    className="text-[#574BFF] font-medium truncate"
                    onClick={(e) => {
                      e.preventDefault();
                      router.push(`/reports/${row.taskId}`);
                    }}
                    data-testid="report-name-link"
                  >
                    {v}
                  </a>
                  <span className="text-[#A8ABB0] text-xs shrink-0">#{row.taskId.slice(0, 8)}</span>
                </span>
              ),
            },
            {
              title: "类型",
              dataIndex: "reportType",
              width: 90,
              render: (v: string) => (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${TYPE_META[v]?.cls ?? "bg-[#F2F3F5] text-[#646A73]"}`}
                >
                  {TYPE_META[v]?.label ?? v}
                </span>
              ),
            },
            {
              title: "状态",
              dataIndex: "taskStatus",
              width: 90,
              render: (v: string) => {
                const meta = STATUS_META[v] ?? { label: v, color: "#87888D" };
                return <span style={{ color: meta.color }}>● {meta.label}</span>;
              },
            },
            {
              title: "统计",
              key: "summary",
              width: 110,
              render: (_, row) =>
                row.summary && typeof row.summary.total === "number" ? (
                  <span className="whitespace-nowrap">
                    <span className="text-[#52C41A]">通过</span> {row.summary.passed ?? 0}/
                    {row.summary.total}
                  </span>
                ) : (
                  <span className="text-[#C0C4CC]">—</span>
                ),
            },
            {
              title: "耗时",
              key: "duration",
              width: 80,
              render: () => <span className="text-[#C0C4CC]">—</span>,
            },
            { title: "创建人", dataIndex: "creator", width: 90, ellipsis: true },
            {
              title: "时间",
              dataIndex: "createdAt",
              width: 140,
              render: (v: string) => (
                <span className="text-xs text-[#87888D]">{v.replace("T", " ").slice(0, 16)}</span>
              ),
            },
            {
              title: "操作",
              key: "op",
              width: 130,
              render: (_, row, i) => {
                const running = row.taskStatus === "RUNNING" || row.taskStatus === "PENDING";
                return (
                  <span className="flex gap-1 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/reports/${row.taskId}`)}
                      data-testid={`btn-report-detail-${i}`}
                    >
                      详情
                    </Button>
                    {!running && canDelete && (
                      <Popconfirm
                        title="删除该报告？"
                        description="将级联清理报告+分享+任务+条目+帧，任务中心同步消失，不可恢复。"
                        okText="删除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutate(row.taskId)}
                      >
                        <Button
                          type="link"
                          size="small"
                          danger
                          className="!px-0"
                          data-testid={`btn-report-delete-${i}`}
                        >
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                );
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
