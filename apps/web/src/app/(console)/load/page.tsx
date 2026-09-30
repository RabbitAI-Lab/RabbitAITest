"use client";

import { Empty, Modal, Spin, Table, Tag, message } from "antd";
import { Gauge } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { loadApi, ApiError, licenseApi, type LoadTestRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { LoadPlaceholder } from "./placeholder";

/** S11 LOAD-003：性能测试列表（三重门控：modules.load ∧ PROJECT_LOAD:READ ∧ License LOAD_TEST）。
 *  License 不满足→占位页（LOAD-001 社区版口径保持，placeholder.tsx 复刻原 LOAD-001 页）。 */

const STATUS_COLOR: Record<string, string> = {
  SUCCESS: "success",
  FAILED: "error",
  RUNNING: "processing",
  PENDING: "default",
  STOPPED: "warning",
};

export default function LoadListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId } = useProjectStore();
  const { canGlobal } = usePermissions();
  // 门控直读（不经共享 useEntp 缓存——License 写后首读一致性窗口用 2s 轮询吸收；S11 教训）
  const licQ = useQuery({
    queryKey: ["load-gate-license"],
    queryFn: () => licenseApi.publicStatus(),
    refetchInterval: (q) => (q.state.data?.features?.includes("LOAD_TEST") ? false : 2000),
    staleTime: 0,
  });
  // ENTP-009 开源全功能：featureGateEnabled=false（默认）恒放行；状态未载亦放行（占位不闪现）
  const entp = {
    can: (f: string) =>
      !licQ.data || !licQ.data.featureGateEnabled
        ? true
        : licQ.data.edition === "ENTERPRISE" && (licQ.data.features ?? []).includes(f),
    loading: licQ.isLoading,
  };
  const [name, setName] = useState("");
  const [page, setPage] = useState(1);
  const [msg, msgCtx] = message.useMessage();

  const entitled = entp.can("LOAD_TEST");
  const permitted = canGlobal("PROJECT_LOAD:READ");
  // 未授权时限流轮询（2s × 15 次≈30s）：License 刚激活（同页/他处）自动转正，无需手动刷新（S11 教训）

  const { data, isLoading } = useQuery({
    queryKey: ["load-tests", currentProjectId, page, name],
    queryFn: () => loadApi.list(currentProjectId!, { page, name: name || undefined }),
    enabled: Boolean(currentProjectId) && entitled && permitted,
  });

  const runMut = useMutation({
    mutationFn: (id: string) => loadApi.run(currentProjectId!, id),
    onSuccess: (r) => {
      msg.success("施压任务已触发");
      void qc.invalidateQueries({ queryKey: ["load-tests"] });
      router.push(`/load/tasks/${r.taskId}`);
    },
    onError: (e) => {
      msg.error(
        e instanceof ApiError && e.code === 90071
          ? "项目内已有运行中的施压任务"
          : `触发失败：${e instanceof Error ? e.message : e}`,
      );
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => loadApi.remove(currentProjectId!, id),
    onSuccess: () => {
      msg.success("已删除");
      void qc.invalidateQueries({ queryKey: ["load-tests"] });
    },
  });

  if (!currentProjectId) {
    return (
      <div className="p-4 md:p-6 max-w-[1100px]">
        <PageHeader title="性能测试" sub="企业版 · License 门控" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }
  if (!entitled) return <LoadPlaceholder reason="license" />;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1100px]" data-testid="load-page">
      {msgCtx}
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            性能测试
            <Tag color="purple">企业版</Tag>
          </span>
        }
        sub="施压计划 · 执行监控 · 压测报告（秒级时间线）"
        extra={
          <button
            className="bg-[#574BFF] text-white rounded px-3 py-1.5 text-sm"
            data-testid="load-create-btn"
            onClick={() => router.push("/load/new")}
          >
            新建施压计划
          </button>
        }
      />
      <div className="flex items-center gap-2">
        <input
          className="border rounded px-2 py-1 text-sm w-56"
          placeholder="搜索名称"
          data-testid="load-search"
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
            description="还没有施压计划——点击右上「新建施压计划」开始"
          />
        ) : (
          <Table<LoadTestRow>
            rowKey="id"
            data-testid="load-tests-table"
            size="small"
            dataSource={data?.list ?? []}
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
                  <a className="text-[#574BFF]" onClick={() => router.push(`/load/${r.id}`)}>
                    {v}
                  </a>
                ),
              },
              {
                title: "目标",
                key: "target",
                render: (_, r) => (
                  <span className="font-mono text-xs text-slate-500">
                    {r.target.method} {r.target.url}
                  </span>
                ),
              },
              {
                title: "压力模型",
                key: "pressure",
                render: (_, r) =>
                  r.pressure.mode === "concurrency"
                    ? `并发阶梯 · ${r.pressure.durationSec}s · ≤${r.pressure.maxConcurrency} 并发`
                    : `目标 TPS ${r.pressure.targetTps} · ${r.pressure.durationSec}s`,
              },
              {
                title: "最近任务",
                key: "lastTask",
                width: 130,
                render: (_, r) =>
                  r.lastTask ? (
                    <Tag
                      color={STATUS_COLOR[r.lastTask.status] ?? "default"}
                      data-testid={`load-last-status-${r.id}`}
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
                width: 200,
                render: (_, r) => (
                  <span className="space-x-3">
                    <a
                      className="text-[#574BFF]"
                      data-testid={`load-run-${r.id}`}
                      onClick={() => runMut.mutate(r.id)}
                    >
                      {r.lastTask?.status === "RUNNING" ? "监控" : "执行"}
                    </a>
                    <a className="text-slate-500" onClick={() => router.push(`/load/${r.id}`)}>
                      编辑
                    </a>
                    <a
                      className="text-red-400"
                      onClick={() =>
                        Modal.confirm({
                          title: `删除施压计划「${r.name}」？`,
                          content: "软删除，历史任务与报告保留",
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
      <div className="text-xs text-slate-400">
        <Gauge size={12} className="inline mr-1 -mt-0.5" />
        全部执行记录见{" "}
        <a className="text-[#574BFF]" onClick={() => router.push("/load/history")}>
          执行历史
        </a>
      </div>
    </div>
  );
}
