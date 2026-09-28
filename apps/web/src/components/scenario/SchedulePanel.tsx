"use client";

/** API-008 定时任务面板：任务中心「定时任务」Tab 数据源（替换 S2 空态）。 */
import { Button, Drawer, Empty, Input, Popconfirm, Select, Switch, Table } from "antd";
import { Plus, Zap } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { scheduleApi, scenarioApi } from "@rabbit/api-client";
import type { ScenarioScheduleRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import EnvSelect from "@/components/api/EnvSelect";

/** cron 简化人话（常见形态兜底原文展示）。 */
export function describeCron(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length === 5) {
    const [min = "*", hour = "*", , , dow = "*"] = parts;
    if (dow === "*" && hour !== "*" && min !== "*")
      return `每天 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (dow === "1-5" && hour !== "*" && min !== "*")
      return `工作日 ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
    if (min.startsWith("*/")) return `每 ${min.slice(2)} 分钟`;
    if (hour === "*") return "每小时";
  }
  return cron;
}

export default function SchedulePanel() {
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const canUpdate = can("PROJECT_SCENARIO:UPDATE");

  const [editing, setEditing] = useState<ScenarioScheduleRow | "new" | null>(null);
  const [form, setForm] = useState<{
    name: string;
    cron: string;
    scenarioIds: string[];
    envId?: string;
    enabled: boolean;
  }>({ name: "", cron: "0 9 * * *", scenarioIds: [], envId: undefined, enabled: true });

  const listQ = useQuery({
    queryKey: ["schedules", "list", projectId],
    queryFn: () => scheduleApi.list(projectId!),
    enabled: Boolean(projectId),
  });

  const scenQ = useQuery({
    queryKey: ["scenarios", "list", projectId, JSON.stringify({ page: 1, pageSize: 100 })],
    queryFn: () => scenarioApi.list(projectId!, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });

  const openEdit = (r: ScenarioScheduleRow | "new") => {
    setEditing(r);
    if (r === "new")
      setForm({ name: "", cron: "0 9 * * *", scenarioIds: [], envId: undefined, enabled: true });
    else
      setForm({
        name: r.name,
        cron: r.cron,
        scenarioIds: r.scenarioIds,
        envId: r.envId,
        enabled: r.enabled,
      });
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const body = {
        name: form.name.trim(),
        cron: form.cron.trim(),
        scenarioIds: form.scenarioIds,
        ...(form.envId ? { envId: form.envId } : {}),
        enabled: form.enabled,
        notify: false,
      };
      return editing === "new"
        ? scheduleApi.create(projectId!, body)
        : scheduleApi.update(projectId!, (editing as ScenarioScheduleRow).id, body);
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["schedules"] });
      message.success("定时任务已保存（最短间隔 5 分钟）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) =>
      scheduleApi.toggle(projectId!, v.id, v.enabled),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      message.success(r.enabled ? "已启用（到点触发）" : "已停用");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const runM = useMutation({
    mutationFn: (id: string) => scheduleApi.run(projectId!, id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      if (r.taskId) {
        message.success(`已触发（任务 ${r.taskId.slice(0, 8)}）`);
        router.push(`/tasks?focus=${r.taskId}`);
      } else {
        message.info(`本次未触发（${r.skipped ?? "条件不满足"}）`);
      }
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "触发失败"),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => scheduleApi.remove(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["schedules"] });
      message.success("已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const rows = listQ.data?.list ?? [];
  const scenName = (id?: string) => {
    const s = (scenQ.data?.items ?? []).find((x) => x.id === id);
    return s ? `${s.name} #${s.num}` : (id ?? "").slice(0, 8);
  };

  return (
    <div data-testid="schedule-panel">
      <div className="flex items-center gap-2 border-b border-[#F0F1F3] px-3 py-2">
        {canUpdate && (
          <Button
            size="small"
            type="primary"
            ghost
            icon={<Plus size={13} strokeWidth={1.8} />}
            data-testid="btn-new-schedule"
            onClick={() => openEdit("new")}
          >
            新建定时任务
          </Button>
        )}
        <span className="text-[11px] text-[#A8ABB0]">
          cron 最短间隔 5 分钟 · 单机部署口径（BullMQ repeatable）
        </span>
      </div>
      <Table<ScenarioScheduleRow>
        rowKey="id"
        size="middle"
        loading={listQ.isLoading}
        dataSource={rows}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无定时任务——新建后到点自动执行所选场景"
            />
          ),
        }}
        columns={[
          {
            title: "名称",
            dataIndex: "name",
            render: (v: string, r) => (
              <span
                className="font-medium text-[#1F2329]"
                data-testid={`schedule-name-${r.id.slice(0, 8)}`}
              >
                {v}
              </span>
            ),
          },
          {
            title: "cron",
            dataIndex: "cron",
            width: 110,
            render: (v: string) => <code className="font-mono text-xs text-[#3D4350]">{v}</code>,
          },
          {
            title: "说明",
            key: "desc",
            width: 110,
            render: (_: unknown, r) => (
              <span className="text-xs text-[#87888D]">{describeCron(r.cron)}</span>
            ),
          },
          {
            title: "场景",
            dataIndex: "scenarioIds",
            width: 170,
            render: (ids: string[]) =>
              ids.length <= 1 ? (
                <span className="text-xs">{ids.length ? scenName(ids[0]) : "—"}</span>
              ) : (
                <span className="text-xs">
                  {scenName(ids[0])} 等 {ids.length} 个
                </span>
              ),
          },
          {
            title: "状态",
            dataIndex: "enabled",
            width: 80,
            render: (v: boolean, r) =>
              canUpdate ? (
                <Switch
                  size="small"
                  checked={v}
                  data-testid={`schedule-toggle-${r.id.slice(0, 8)}`}
                  onChange={(en) => toggleM.mutate({ id: r.id, enabled: en })}
                />
              ) : (
                <span>{v ? "启用" : "停用"}</span>
              ),
          },
          {
            title: "最近触发",
            dataIndex: "lastRunAt",
            width: 140,
            render: (v: string | undefined, r) =>
              r.enabled ? (
                <span className="text-xs text-[#646A73]">
                  {v ? new Date(v).toLocaleString("zh-CN") : "未触发"}
                </span>
              ) : (
                <span className="text-xs text-[#A8ABB0]">已停用 · 不触发</span>
              ),
          },
          {
            title: "操作",
            key: "op",
            width: 190,
            render: (_: unknown, r) =>
              canUpdate && (
                <div className="flex items-center gap-1">
                  <Button type="link" size="small" className="!px-0" onClick={() => openEdit(r)}>
                    编辑
                  </Button>
                  <span className="text-[#E5E6EB]">|</span>
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    icon={<Zap size={11} strokeWidth={1.8} />}
                    onClick={() => runM.mutate(r.id)}
                    data-testid={`btn-run-schedule-${r.id.slice(0, 8)}`}
                  >
                    立即执行
                  </Button>
                  <span className="text-[#E5E6EB]">|</span>
                  <Popconfirm
                    title="删除该定时任务？"
                    okText="删除"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => removeM.mutate(r.id)}
                  >
                    <Button type="link" size="small" className="!px-0 !text-[#FF4D4F]">
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              ),
          },
        ]}
      />

      <Drawer
        title={editing === "new" ? "新建定时任务" : "编辑定时任务"}
        width={460}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              type="primary"
              loading={saveM.isPending}
              disabled={!form.name.trim() || !form.scenarioIds.length}
              data-testid="btn-save-schedule"
              onClick={() => saveM.mutate()}
            >
              保存
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs text-[#646A73]">名称</p>
            <Input
              placeholder="如：每日冒烟"
              value={form.name}
              data-testid="input-schedule-name"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-[#646A73]">cron 表达式（5 段：分 时 日 月 周）</p>
            <Input
              className="!font-mono"
              placeholder="0 9 * * *"
              value={form.cron}
              data-testid="input-schedule-cron"
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-[#52C41A]">
              {describeCron(form.cron)} · 最短间隔 5 分钟（更短会被拒绝 422）
            </p>
          </div>
          <div>
            <p className="mb-1 text-xs text-[#646A73]">执行场景（多选，上限 50）</p>
            <Select
              className="!w-full"
              mode="multiple"
              placeholder="选择场景"
              showSearch
              optionFilterProp="label"
              value={form.scenarioIds}
              onChange={(v) => setForm({ ...form, scenarioIds: v })}
              options={(scenQ.data?.items ?? []).map((s) => ({
                value: s.id,
                label: `${s.name} #${s.num}`,
              }))}
              data-testid="select-schedule-scenarios"
            />
          </div>
          <div>
            <p className="mb-1 text-xs text-[#646A73]">环境</p>
            <EnvSelect value={form.envId} onChange={(v) => setForm({ ...form, envId: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#646A73]">执行完成通知</span>
            <Switch size="small" disabled />
            <span className="text-[11px] text-[#A8ABB0]">随 S5 消息通知接入</span>
          </div>
        </div>
      </Drawer>
    </div>
  );
}
