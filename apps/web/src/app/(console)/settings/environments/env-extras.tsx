"use client";

import { Alert, Button, Empty, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { envApi, envGroupApi, globalParamApi, type EnvGroupRow, type GlobalParamRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** PROJ-006：环境组 Tab（有序环境集 + 调序）。 */
export function EnvGroupsTab() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canCreate = can("PROJECT_ENV:CREATE");
  const canUpdate = can("PROJECT_ENV:UPDATE");
  const [editing, setEditing] = useState<EnvGroupRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const groups = useQuery({
    queryKey: ["env-groups", projectId],
    queryFn: () => envGroupApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const envs = useQuery({
    queryKey: ["environments", projectId],
    queryFn: () => envApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const envName = (id: string) => envs.data?.items.find((e) => e.id === id)?.name ?? "（已删除）";
  const invalidate = () => qc.invalidateQueries({ queryKey: ["env-groups", projectId] });

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: { name: string; environmentIds: string[] } }) =>
      id ? envGroupApi.update(projectId!, id, body) : envGroupApi.create(projectId!, body),
    onSuccess: () => {
      message.success("已保存");
      setEditing(null);
      setCreateOpen(false);
      void invalidate();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => envGroupApi.remove(projectId!, id),
    onSuccess: () => {
      message.success("已删除");
      void invalidate();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const columns = [
    { title: "组名", dataIndex: "name" },
    { title: "包含环境（有序）", dataIndex: "environmentIds", render: (ids: string[]) =>
      ids.length ? (
        <span>
          {ids.map((id, i) => (
            <span key={id}>
              {i > 0 && <span className="text-gray-300 mx-1">→</span>}
              <Tag color={envName(id) === "（已删除）" ? "default" : "blue"}>
                {i + 1}. {envName(id)}
              </Tag>
            </span>
          ))}
        </span>
      ) : (
        <span className="text-xs text-gray-400">—</span>
      ) },
    { title: "可用环境数", render: (_: unknown, r: EnvGroupRow) => r.environmentIds.filter((id) => envName(id) !== "（已删除）").length },
    ...(canUpdate
      ? [{
          title: "操作",
          render: (_: unknown, r: EnvGroupRow) => (
            <Space size={4}>
              <Button size="small" type="link" onClick={() => setEditing(r)}>
                编辑
              </Button>
              <Popconfirm title="删除该环境组？（不影响环境本身）" onConfirm={() => remove.mutate(r.id)}>
                <Button size="small" type="link" danger>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ),
        }]
      : []),
  ];

  return (
    <div data-testid="env-groups-panel">
      <div className="mb-2 flex items-center">
        <span className="text-xs text-gray-400">组=有序环境集（≤10）：按组执行时按顺序逐环境各建一个任务；组内环境被删时执行自动跳过</span>
        {canCreate && (
          <Button className="ml-auto" size="small" type="primary" onClick={() => setCreateOpen(true)} data-testid="btn-new-env-group">
            ＋ 新建环境组
          </Button>
        )}
      </div>
      <Table rowKey="id" size="small" loading={groups.isLoading} columns={columns} dataSource={groups.data?.items ?? []} pagination={false} />
      {(createOpen || editing) && (
        <EnvGroupFormModal
          key={editing?.id ?? "new"}
          initial={editing}
          envOptions={(envs.data?.items ?? []).map((e) => ({ value: e.id, label: e.name }))}
          onClose={() => {
            setEditing(null);
            setCreateOpen(false);
          }}
          onSubmit={(body) => save.mutate({ id: editing?.id, body })}
        />
      )}
    </div>
  );
}

function EnvGroupFormModal({
  initial,
  envOptions,
  onClose,
  onSubmit,
}: {
  initial: EnvGroupRow | null;
  envOptions: { value: string; label: string }[];
  onClose: () => void;
  onSubmit: (body: { name: string; environmentIds: string[] }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [ids, setIds] = useState<string[]>(initial?.environmentIds ?? []);
  const move = (i: number, dir: -1 | 1) => {
    const next = [...ids];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    setIds(next);
  };
  return (
    <Modal
      title={initial ? "编辑环境组" : "新建环境组"}
      open
      onCancel={onClose}
      onOk={() => onSubmit({ name, environmentIds: ids })}
      okButtonProps={{ disabled: !name || ids.length === 0 }}
      destroyOnClose
    >
      <div className="space-y-3">
        <div>
          <p className="text-xs text-gray-500 mb-1">组名</p>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="env-group-name-input" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">可选环境（未删除）</p>
          <Select
            mode="multiple"
            className="w-full"
            placeholder="勾选环境"
            value={ids}
            options={envOptions}
            onChange={setIds}
            data-testid="env-group-envs-select"
          />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">已选（执行顺序）</p>
          <div className="border rounded divide-y text-[13px]" data-testid="env-group-order">
            {ids.length === 0 && <p className="px-2 py-2 text-xs text-gray-400 text-center">未选择</p>}
            {ids.map((id, i) => (
              <div key={id} className="px-2 py-1.5 flex items-center gap-2">
                <span className="text-gray-400">↕</span>
                {envOptions.find((o) => o.value === id)?.label ?? id}
                <span className="ml-auto flex gap-1">
                  <Button size="small" type="text" icon={<ArrowUp size={12} />} onClick={() => move(i, -1)} />
                  <Button size="small" type="text" icon={<ArrowDown size={12} />} onClick={() => move(i, 1)} />
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** PROJ-006：全局参数 Tab（项目级单例 KV；作用域链=临时>环境变量>全局参数）。 */
export function GlobalParamsTab() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_ENV:UPDATE");

  const q = useQuery({
    queryKey: ["global-params", projectId],
    queryFn: () => globalParamApi.get(projectId!),
    enabled: Boolean(projectId),
  });
  const [rows, setRows] = useState<GlobalParamRow[] | null>(null);
  if (q.data && rows === null) setRows(q.data.params);
  const current = rows ?? [];

  const update = (i: number, patch: Partial<GlobalParamRow>) =>
    setRows(current.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: () => globalParamApi.save(projectId!, current),
    onSuccess: () => {
      message.success("全局参数已保存");
      void qc.invalidateQueries({ queryKey: ["global-params", projectId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const dup = current.length !== new Set(current.map((r) => r.key)).size;

  return (
    <div data-testid="global-params-panel">
      <Alert
        className="mb-2"
        type="info"
        showIcon
        message="全局参数=环境变量之下的项目级兜底变量域：同名时环境变量覆盖全局参数；未选环境执行时仅注入全局参数"
      />
      <Table<GlobalParamRow>
        rowKey={(_r, index) => String(index)}
        size="small"
        dataSource={current}
        pagination={false}
        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无全局参数" /> }}
        columns={[
          { title: "Key", render: (_: unknown, r: GlobalParamRow, i: number) => (
            <input className="border-0 outline-none font-mono w-full text-[13px]" value={r.key} disabled={!canUpdate} onChange={(e) => update(i, { key: e.target.value })} />
          ) },
          { title: "Value", render: (_: unknown, r: GlobalParamRow, i: number) => (
            <input className="border-0 outline-none font-mono w-full text-[13px]" value={r.value} disabled={!canUpdate} onChange={(e) => update(i, { value: e.target.value })} />
          ) },
          { title: "描述", render: (_: unknown, r: GlobalParamRow, i: number) => (
            <input className="border-0 outline-none w-full text-[13px] text-gray-500" value={r.description} disabled={!canUpdate} onChange={(e) => update(i, { description: e.target.value })} />
          ) },
          ...(canUpdate
            ? [{
                title: "",
                width: 60,
                render: (_: unknown, __: GlobalParamRow, i: number) => (
                  <Button size="small" type="link" danger onClick={() => setRows(current.filter((_, j) => j !== i))}>
                    删
                  </Button>
                ),
              }]
            : []),
        ]}
      />
      {canUpdate && (
        <div className="flex items-center mt-2">
          <Button size="small" type="dashed" onClick={() => setRows([...current, { key: "", value: "", description: "" }])} data-testid="btn-add-global-param">
            ＋ 添加参数
          </Button>
          <span className="text-xs text-gray-400 ml-2">（{current.length}/100）{dup && <span className="text-red-500 ml-1">存在重复 key</span>}</span>
          <Button className="ml-auto" type="primary" size="small" disabled={dup} loading={save.isPending} onClick={() => save.mutate()} data-testid="btn-save-global-params">
            保存（全量提交）
          </Button>
        </div>
      )}
    </div>
  );
}
