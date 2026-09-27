"use client";

import { Badge, Button, Empty, InputNumber, Modal, Progress, Table, Tag, Tooltip } from "antd";
import { Lock, Pencil, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { poolApi, type PoolRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

/** EXEC-002：系统 › 资源池（系统级页面，无项目上下文；默认池并发编辑 + 节点心跳表 10s 轮询）。 */

const relTime = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "刚刚";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  return `${Math.floor(h / 24)} 天前`;
};

const NODE_STATE: Record<PoolRow["nodes"][number]["state"], { label: string; color: string; text: string }> = {
  ONLINE: { label: "在线", color: "green", text: "心跳正常，可调度" },
  OFFLINE: { label: "离线", color: "default", text: "心跳超 3 拍未上报，不可调度" },
  UNMATCHED: { label: "版本不匹配", color: "gold", text: "契约版本低于 v2，不下发新类型任务（仅展示）" },
};

export default function ResourcePoolsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canRead = canGlobal("SYSTEM_POOL:READ");
  const canUpdate = canGlobal("SYSTEM_POOL:UPDATE");

  const [editing, setEditing] = useState<PoolRow | null>(null);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(8);

  const poolsQ = useQuery({
    queryKey: ["system-pools"],
    queryFn: () => poolApi.list(),
    refetchInterval: 10_000,
    enabled: canRead,
  });

  const updatePool = useMutation({
    mutationFn: ({ id, value }: { id: string; value: number }) => poolApi.update(id, { maxConcurrency: value }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["system-pools"] });
      setEditing(null);
      message.success("已保存，约一个心跳周期后生效（节点表槽位将随之变化）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  if (!canRead) {
    return (
      <div>
        <PageHeader title="资源池" sub="系统 › 资源池" />
        <Empty className="py-24" description="无访问权限（SYSTEM_POOL:READ）" />
      </div>
    );
  }

  const pools = poolsQ.data?.items ?? [];
  const allNodes = pools.flatMap((p) => p.nodes.map((n) => ({ ...n, poolName: p.name })));

  return (
    <div>
      <PageHeader
        title="资源池"
        sub="系统 › 资源池 · 默认池并发经心跳响应下发（engine 动态调整 Worker 并发）· 10s 自动刷新"
        extra={
          <>
            <Tooltip title="企业版功能（License 未启用）">
              <Button disabled icon={<Lock size={13} />} data-testid="btn-new-pool">
                新建资源池
              </Button>
            </Tooltip>
            <Button
              icon={<RefreshCw size={13} />}
              onClick={() => void qc.invalidateQueries({ queryKey: ["system-pools"] })}
            >
              刷新
            </Button>
          </>
        }
      />

      {/* 池卡片 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-4">
        {pools.map((p) => {
          const online = p.nodes.filter((n) => n.state === "ONLINE").length;
          return (
            <div key={p.id} className="rabbit-card p-4" data-testid={`pool-card-${p.id}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium text-[15px]">{p.name}</span>
                <Tag bordered={false}>NODE</Tag>
                {p.isDefault && (
                  <Tag color="purple" bordered={false}>
                    默认 · 不可删
                  </Tag>
                )}
                <span className="ml-auto flex items-center gap-3 text-[13px] text-[#646A73]">
                  <span>
                    最大并发 <b className="text-[#3D4350]">{p.maxConcurrency}</b>
                  </span>
                  <span>
                    在线节点 <b className="text-[#3D4350]">{online}</b> / {p.nodes.length}
                  </span>
                  {canUpdate && (
                    <Button
                      size="small"
                      icon={<Pencil size={12} />}
                      onClick={() => {
                        setEditing(p);
                        setMaxConcurrency(p.maxConcurrency);
                      }}
                      data-testid={`btn-edit-pool-${p.id}`}
                    >
                      编辑
                    </Button>
                  )}
                </span>
              </div>
              <p className="text-xs text-[#A8ABB0] mt-2">
                社区版单默认池；调度 = 单队列自然负载均衡（扩容 = 起新 engine 进程节点）· 最近心跳：{relTime(p.lastBeatAt)}
              </p>
            </div>
          );
        })}
        {pools.length === 0 && !poolsQ.isLoading && (
          <div className="rabbit-card p-8 text-center text-[13px] text-[#A8ABB0]">
            暂无资源池 · engine 启动注册后自动出现默认池
          </div>
        )}
      </div>

      {/* 节点表 */}
      <div className="rabbit-card">
        <div className="flex items-center gap-3 p-3 border-b border-[#F0F1F3]">
          <span className="font-medium text-sm">节点</span>
          <span className="text-xs text-[#A8ABB0]">
            槽位 = busy（在执）÷ total（总并发）· 离线 3 拍标记不可调度 · 版本不匹配不下发新类型任务
          </span>
        </div>
        <Table
          rowKey={(n) => `${n.poolName}-${n.nodeId}`}
          loading={poolsQ.isLoading}
          dataSource={allNodes}
          data-testid="pool-nodes"
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无节点心跳 · 启动 engine 后自动注册" /> }}
          columns={[
            { title: "节点 ID", dataIndex: "nodeId", render: (v: string) => <span className="font-mono text-xs">{v}</span> },
            {
              title: "版本",
              dataIndex: "version",
              width: 110,
              render: (v: string) => <span className="font-mono text-xs text-[#646A73]">{v}</span>,
            },
            {
              title: "槽位（busy ÷ total）",
              key: "slots",
              width: 200,
              render: (_, n) => (
                <span className="flex items-center gap-2">
                  <Progress
                    percent={n.slots > 0 ? Math.round((n.busy / n.slots) * 100) : 0}
                    size="small"
                    status={n.busy >= n.slots && n.slots > 0 ? "exception" : "active"}
                    style={{ width: 90, margin: 0 }}
                  />
                  <span className="text-xs text-[#646A73] font-mono">
                    {n.busy}÷{n.slots}
                  </span>
                </span>
              ),
            },
            {
              title: "最近心跳",
              dataIndex: "lastBeatAt",
              width: 110,
              render: (v: string) => <span className="text-xs text-[#87888D]">{relTime(v)}</span>,
            },
            {
              title: "状态",
              dataIndex: "state",
              width: 150,
              render: (state: PoolRow["nodes"][number]["state"]) => (
                <Tooltip title={NODE_STATE[state].text}>
                  <Badge status={state === "ONLINE" ? "success" : state === "UNMATCHED" ? "warning" : "default"} text={NODE_STATE[state].label} />
                </Tooltip>
              ),
            },
            { title: "所属池", dataIndex: "poolName", width: 130 },
          ]}
        />
      </div>

      {/* 编辑并发弹窗 */}
      <Modal
        title={`编辑「${editing?.name ?? ""}」最大并发`}
        open={Boolean(editing)}
        onCancel={() => setEditing(null)}
        okText="保 存"
        confirmLoading={updatePool.isPending}
        okButtonProps={{ disabled: maxConcurrency < 2 || maxConcurrency > 64 }}
        onOk={() => editing && updatePool.mutate({ id: editing.id, value: maxConcurrency })}
      >
        <div className="flex items-center gap-3 py-2">
          <InputNumber
            min={2}
            max={64}
            value={maxConcurrency}
            onChange={(v) => setMaxConcurrency(v ?? 8)}
            data-testid="input-pool-concurrency"
          />
          <span className="text-[13px] text-[#646A73]">2–64</span>
        </div>
        <p className="text-xs text-[#A8ABB0]">
          经心跳响应下发，engine 动态调整 Worker 并发；约一个心跳周期后生效（下方节点表 total 随之变化验证）。
          默认池不可删除，类型与名称不可修改（企业版 License 门控）。
        </p>
      </Modal>
    </div>
  );
}
