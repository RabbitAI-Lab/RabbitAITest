"use client";

/** API-010 误报规则页（原型画板一）：项目级规则 CRUD + 启停；命中 → FAKE_ERROR。 */
import { Button, Drawer, Empty, Input, InputNumber, Popconfirm, Switch, Table } from "antd";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { falseAlarmApi } from "@rabbit/api-client";
import type { FalseAlarmRuleRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { PageHeader } from "@/components/PageHeader";

type Matcher = FalseAlarmRuleRow["matcher"];

function matcherText(m: Matcher): string {
  const parts: string[] = [];
  if (m.status !== undefined) parts.push(`状态码 = ${m.status}`);
  if (m.bodyContains) parts.push(`体包含 "${m.bodyContains}"`);
  if (m.headerContains) parts.push(`头包含 "${m.headerContains}"`);
  if (m.responseTimeGt !== undefined) parts.push(`耗时 > ${m.responseTimeGt}ms`);
  return parts.length ? parts.join(" · ") : "—";
}

export default function FalseAlarmPage() {
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const { message } = useApp();
  const qc = useQueryClient();
  const canUpdate = can("PROJECT_SCENARIO:UPDATE");

  const [editing, setEditing] = useState<FalseAlarmRuleRow | "new" | null>(null);
  const [form, setForm] = useState<{ name: string; status: number; statusOn: boolean; bodyContains: string; headerContains: string; timeOn: boolean; responseTimeGt: number; enabled: boolean; description: string }>({
    name: "",
    status: 502,
    statusOn: false,
    bodyContains: "",
    headerContains: "",
    timeOn: false,
    responseTimeGt: 5000,
    enabled: true,
    description: "",
  });

  const listQ = useQuery({
    queryKey: ["false-alarm", "list", projectId],
    queryFn: () => falseAlarmApi.list(projectId!),
    enabled: Boolean(projectId),
  });

  const openEdit = (r: FalseAlarmRuleRow | "new") => {
    setEditing(r);
    if (r === "new") {
      setForm({ name: "", status: 502, statusOn: false, bodyContains: "", headerContains: "", timeOn: false, responseTimeGt: 5000, enabled: true, description: "" });
    } else {
      setForm({
        name: r.name,
        status: r.matcher.status ?? 502,
        statusOn: r.matcher.status !== undefined,
        bodyContains: r.matcher.bodyContains ?? "",
        headerContains: r.matcher.headerContains ?? "",
        timeOn: r.matcher.responseTimeGt !== undefined,
        responseTimeGt: r.matcher.responseTimeGt ?? 5000,
        enabled: r.enabled,
        description: "",
      });
    }
  };

  const buildMatcher = (): Matcher | null => {
    const m: Matcher = {};
    if (form.statusOn) m.status = form.status;
    if (form.bodyContains.trim()) m.bodyContains = form.bodyContains.trim();
    if (form.headerContains.trim()) m.headerContains = form.headerContains.trim();
    if (form.timeOn) m.responseTimeGt = form.responseTimeGt;
    return Object.keys(m).length ? m : null;
  };

  const saveM = useMutation({
    mutationFn: async () => {
      const matcher = buildMatcher()!;
      const body = { name: form.name.trim(), matcher, enabled: form.enabled, description: form.description };
      return editing === "new" ? falseAlarmApi.create(projectId!, body) : falseAlarmApi.update(projectId!, (editing as FalseAlarmRuleRow).id, body);
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["false-alarm"] });
      message.success("规则已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const toggleM = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => falseAlarmApi.update(projectId!, v.id, { name: (listQ.data?.list ?? []).find((r) => r.id === v.id)!.name, matcher: (listQ.data?.list ?? []).find((r) => r.id === v.id)!.matcher, enabled: v.enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["false-alarm"] });
      message.success("已更新启用状态");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => falseAlarmApi.remove(projectId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["false-alarm"] });
      message.success("规则已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  if (!projectId) return <Empty description="请先选择项目" />;

  const rows = listQ.data?.list ?? [];
  const matcherValid = Boolean(buildMatcher());

  return (
    <div>
      <PageHeader
        title="误报规则"
        sub="项目级匹配（AND）：失败执行项命中即改判 FAKE_ERROR，不算任务失败、单列统计"
        extra={
          canUpdate && (
            <Button type="primary" icon={<Plus size={14} strokeWidth={1.8} />} disabled={rows.length >= 50} data-testid="btn-new-fa-rule" onClick={() => openEdit("new")}>
              新建规则
            </Button>
          )
        }
      />
      <div className="rabbit-card p-0" data-testid="fa-rules-table">
        <Table<FalseAlarmRuleRow>
          rowKey="id"
          size="middle"
          loading={listQ.isLoading}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无规则——新建后对新执行生效" /> }}
          columns={[
            { title: "名称", dataIndex: "name", render: (v: string, r) => <span className="font-medium text-[#1F2329]" data-testid={`fa-rule-name-${r.id.slice(0, 8)}`}>{v}</span> },
            { title: "匹配器（AND）", dataIndex: "matcher", render: (m: Matcher) => <span className="text-xs text-[#3D4350]">{matcherText(m)}</span> },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (v: boolean, r) => (canUpdate ? <Switch size="small" checked={v} data-testid={`fa-rule-toggle-${r.id.slice(0, 8)}`} onChange={(en) => toggleM.mutate({ id: r.id, enabled: en })} /> : <span>{v ? "是" : "否"}</span>),
            },
            { title: "更新时间", dataIndex: "updatedAt", width: 150, render: (v: string) => <span className="text-xs text-[#646A73]">{new Date(v).toLocaleString("zh-CN")}</span> },
            {
              title: "操作",
              key: "op",
              width: 130,
              render: (_: unknown, r) =>
                canUpdate && (
                  <div className="flex items-center gap-1">
                    <Button type="link" size="small" className="!px-0" onClick={() => openEdit(r)}>
                      编辑
                    </Button>
                    <span className="text-[#E5E6EB]">|</span>
                    <Popconfirm title="删除规则后新执行不再标记，确认？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => removeM.mutate(r.id)}>
                      <Button type="link" size="small" className="!px-0 !text-[#FF4D4F]">
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                ),
            },
          ]}
        />
      </div>
      <p className="mt-2 text-[11px] text-[#A8ABB0]">
        上限 50 条 · 仅对新执行报告生效（不回溯）· 命中需同时满足全部已填条件；停用/删除规则后新执行不再标记
      </p>

      <Drawer
        title={editing === "new" ? "新建误报规则" : "编辑误报规则"}
        width={480}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button type="primary" loading={saveM.isPending} disabled={!form.name.trim() || !matcherValid} data-testid="btn-save-fa-rule" onClick={() => saveM.mutate()}>
              保存
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-xs text-[#646A73]">规则名称</p>
            <Input placeholder="如：三方网关已知抖动" value={form.name} data-testid="input-fa-name" onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-2 rounded border border-[#F0F1F3] p-3">
            <p className="text-xs font-medium text-[#3D4350]">匹配条件（多选 AND · 至少一项）</p>
            <div className="flex items-center gap-2">
              <Switch size="small" checked={form.statusOn} onChange={(v) => setForm({ ...form, statusOn: v })} data-testid="switch-fa-status" />
              <span className="w-20 text-xs text-[#646A73]">状态码</span>
              <InputNumber min={100} max={599} disabled={!form.statusOn} value={form.status} onChange={(v) => setForm({ ...form, status: Number(v ?? 502) })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[26px]" />
              <span className="w-20 text-xs text-[#646A73]">体包含</span>
              <Input placeholder="known-issue" value={form.bodyContains} data-testid="input-fa-body" onChange={(e) => setForm({ ...form, bodyContains: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-[26px]" />
              <span className="w-20 text-xs text-[#646A73]">头包含</span>
              <Input placeholder="X-Upstream: flaky" value={form.headerContains} data-testid="input-fa-header" onChange={(e) => setForm({ ...form, headerContains: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <Switch size="small" checked={form.timeOn} onChange={(v) => setForm({ ...form, timeOn: v })} data-testid="switch-fa-time" />
              <span className="w-20 text-xs text-[#646A73]">耗时大于</span>
              <InputNumber min={1} max={600000} disabled={!form.timeOn} addonAfter="ms" value={form.responseTimeGt} onChange={(v) => setForm({ ...form, responseTimeGt: Number(v ?? 5000) })} />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-16 text-xs text-[#646A73]">启用</span>
            <Switch checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
          </div>
        </div>
      </Drawer>
    </div>
  );
}
