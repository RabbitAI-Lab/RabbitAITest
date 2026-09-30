"use client";

import { Empty, Modal, Spin, Table, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { uitApi, ApiError, licenseApi, type UiCaseRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { UitPlaceholder } from "./placeholder";

/** S11 UIT-002：UI 用例列表（三重门控：modules.uit ∧ PROJECT_UIT:READ ∧ License UI_TEST）。 */

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: "success",
  FAILED: "error",
  RUNNING: "processing",
  PENDING: "default",
  STOPPED: "warning",
};

export default function UiTestPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId } = useProjectStore();
  const { canGlobal } = usePermissions();
  const licQ = useQuery({
    queryKey: ["uit-gate-license"],
    queryFn: () => licenseApi.publicStatus(),
    refetchInterval: (q) => (q.state.data?.features?.includes("UI_TEST") ? false : 2000),
    staleTime: 0,
  });
  const entp = {
    can: (f: string) =>
      licQ.data?.edition === "ENTERPRISE" && (licQ.data?.features ?? []).includes(f),
    loading: licQ.isLoading,
  };
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, msgCtx] = message.useMessage();

  const entitled = entp.can("UI_TEST");
  const permitted = canGlobal("PROJECT_UIT:READ");

  const { data, isLoading } = useQuery({
    queryKey: ["ui-cases", currentProjectId, page, name],
    queryFn: () => uitApi.cases(currentProjectId!, { page, name: name || undefined }),
    enabled: Boolean(currentProjectId) && entitled && permitted,
  });

  const runMut = useMutation({
    mutationFn: (id: string) => uitApi.runCase(currentProjectId!, id),
    onSuccess: (r) => {
      msg.success("UI 用例执行已触发");
      router.push(`/ui-test/tasks/${r.taskId}`);
    },
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "触发失败"),
  });

  const batchMut = useMutation({
    mutationFn: () => uitApi.runBatch(currentProjectId!, selected),
    onSuccess: (r) => {
      msg.success(`批量执行已触发（${selected.length} 条）`);
      setSelected([]);
      router.push(`/ui-test/tasks/${r.taskId}`);
    },
    onError: (e) => msg.error(e instanceof ApiError ? e.message : "批量执行失败"),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => uitApi.removeCase(currentProjectId!, id),
    onSuccess: () => {
      msg.success("已删除");
      void qc.invalidateQueries({ queryKey: ["ui-cases"] });
    },
  });

  if (!currentProjectId) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px]">
        <PageHeader title="UI 测试" sub="企业版 · License 门控" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }
  if (entp.loading) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px]">
        <PageHeader title="UI 测试" sub="企业版 · License 门控" />
        <div className="py-24 text-center text-slate-400 text-sm">授权状态加载中…</div>
      </div>
    );
  }
  if (!entitled) return <UitPlaceholder reason="license" />;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="uit-page">
      {msgCtx}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            UI 测试
            <Tag color="purple">企业版</Tag>
          </span>
        }
        sub="元素库 · 步骤用例编排 · chromium 执行 · 逐步截图报告"
        extra={
          <span className="space-x-2">
            <button
              className="border rounded px-3 py-1.5 text-sm"
              data-testid="uit-elements-entry"
              onClick={() => router.push("/ui-test/elements")}
            >
              元素库
            </button>
            <button
              className="border rounded px-3 py-1.5 text-sm disabled:opacity-40"
              disabled={selected.length === 0}
              data-testid="uit-batch-run-btn"
              onClick={() => batchMut.mutate()}
            >
              批量执行{selected.length > 0 ? `（${selected.length}）` : ""}
            </button>
            <button
              className="bg-[#574BFF] text-white rounded px-3 py-1.5 text-sm"
              data-testid="uit-create-btn"
              onClick={() => router.push("/ui-test/cases/new")}
            >
              新建 UI 用例
            </button>
          </span>
        }
      />
      <div className="flex items-center gap-2">
        <input
          className="border rounded px-2 py-1 text-sm w-56"
          placeholder="搜索用例名"
          data-testid="uit-search"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <Spin spinning={isLoading}>
        {data && data.list.length === 0 ? (
          <Empty
            className="py-20 bg-white border rounded"
            description="还没有 UI 用例——先建元素库，再编排步骤"
          />
        ) : (
          <Table<UiCaseRow>
            rowKey="id"
            size="small"
            data-testid="uit-cases-table"
            dataSource={data?.list ?? []}
            rowSelection={{
              selectedRowKeys: selected,
              onChange: (keys) => setSelected(keys as string[]),
            }}
            pagination={{
              current: page,
              pageSize: 20,
              total: data?.total ?? 0,
              onChange: setPage,
              showSizeChanger: false,
            }}
            columns={[
              {
                title: "名称",
                dataIndex: "name",
                render: (v: string, r) => (
                  <a className="text-[#574BFF]" onClick={() => router.push(`/ui-test/cases/${r.id}`)}>
                    {v}
                  </a>
                ),
              },
              { title: "步骤数", dataIndex: "stepCount", width: 90 },
              {
                title: "步骤摘要",
                key: "summary",
                render: (_, r) => (
                  <span className="text-xs text-slate-500">
                    {r.steps
                      .slice(0, 4)
                      .map((s) => s.op)
                      .join(" → ")}
                    {r.steps.length > 4 ? " → …" : ""}
                  </span>
                ),
              },
              {
                title: "最近结果",
                key: "lastTask",
                width: 110,
                render: (_, r) =>
                  r.lastTask ? (
                    <Tag
                      color={STATUS_COLOR[r.lastTask.status] ?? "default"}
                      data-testid={`uit-last-status-${r.id}`}
                    >
                      {r.lastTask.status}
                    </Tag>
                  ) : (
                    <span className="text-xs text-slate-400">未执行</span>
                  ),
              },
              {
                title: "操作",
                key: "ops",
                width: 170,
                render: (_, r) => (
                  <span className="space-x-3">
                    <a
                      className="text-[#574BFF]"
                      data-testid={`uit-run-${r.id}`}
                      onClick={() => runMut.mutate(r.id)}
                    >
                      执行
                    </a>
                    <a
                      className="text-slate-500"
                      onClick={() => router.push(`/ui-test/cases/${r.id}`)}
                    >
                      编辑
                    </a>
                    <a
                      className="text-red-400"
                      onClick={() =>
                        Modal.confirm({
                          title: `删除用例「${r.name}」？`,
                          onOk: () => delMut.mutateAsync(r.id),
                        })
                      }
                    >
                      删除
                    </a>
                  </span>
                ),
              },
            ]}
          />
        )}
      </Spin>
    </div>
  );
}
