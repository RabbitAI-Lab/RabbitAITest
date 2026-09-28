"use client";

import { Alert, Button, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { publicScriptApi, type PublicScriptParam, type PublicScriptRow, type PublicScriptUpsertInput } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** PROJ-005：公共脚本（列表二态 + 编辑抽屉 + 在线调试抽屉）。 */
export default function PublicScriptsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canCreate = can("PROJECT_SCRIPT:CREATE");
  const canUpdate = can("PROJECT_SCRIPT:UPDATE");
  const [editing, setEditing] = useState<PublicScriptRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [debugging, setDebugging] = useState<PublicScriptRow | null>(null);
  const [keyword, setKeyword] = useState("");

  const scripts = useQuery({
    queryKey: ["public-scripts", projectId, keyword],
    queryFn: () => publicScriptApi.list(projectId!, keyword || undefined),
    enabled: Boolean(projectId),
  });

  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const save = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: PublicScriptUpsertInput }) =>
      id ? publicScriptApi.update(projectId!, id, body) : publicScriptApi.create(projectId!, body),
    onSuccess: () => {
      message.success("已保存");
      setEditing(null);
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["public-scripts", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "DRAFT" | "ENABLED" }) =>
      publicScriptApi.setStatus(projectId!, id, status),
    onSuccess: (_r, v) => {
      message.success(v.status === "ENABLED" ? "已发布" : "已停用");
      void qc.invalidateQueries({ queryKey: ["public-scripts", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const remove = useMutation({
    mutationFn: (r: PublicScriptRow) => {
      // 被引用先探测：409 → 弹引用清单确认
      return publicScriptApi.remove(projectId!, r.id).catch(async (e) => {
        const refs = await publicScriptApi.references(projectId!, r.id);
        if (refs.references.length > 0) {
          const labels = refs.references.map((x) => `${x.type === "api_case" ? "接口用例" : x.type === "scenario" ? "场景" : "环境"}：${x.name}`);
          Modal.confirm({
            title: `「${r.name}」正被以下对象引用：`,
            content: (
              <ul className="text-xs text-gray-500 list-disc pl-4">
                {labels.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            ),
            okText: "仍要删除（force）",
            okButtonProps: { danger: true },
            onOk: () => publicScriptApi.remove(projectId!, r.id, true),
          });
          throw new Error("已弹出引用确认");
        }
        throw e;
      });
    },
    onSuccess: () => {
      message.success("已删除");
      void qc.invalidateQueries({ queryKey: ["public-scripts", projectId] });
    },
    onError: (e) => {
      if (!String((e as Error)?.message).includes("引用确认")) message.error(errText(e));
    },
  });

  const columns = [
    { title: "名称", dataIndex: "name", render: (v: string, r: PublicScriptRow) => (
      <span className={r.status === "DRAFT" ? "opacity-70" : ""} title={r.tags.join(",")}>{v}</span>
    ) },
    { title: "标签", dataIndex: "tags", render: (v: string[]) =>
      v.length ? v.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-xs text-gray-400">—</span> },
    { title: "参数", dataIndex: "params", render: (v: PublicScriptParam[]) =>
      v.length ? <span className="text-xs">{v.map((p) => p.name).join(" · ")}</span> : <span className="text-xs text-gray-400">—</span> },
    { title: "状态", dataIndex: "status", render: (v: string) =>
      v === "ENABLED" ? <Tag color="success" data-testid="script-status-enabled">已发布</Tag> : <Tag data-testid="script-status-draft">草稿</Tag> },
    {
      title: "操作",
      render: (_: unknown, r: PublicScriptRow) => (
        <Space size={4}>
          {canUpdate && <Button size="small" type="link" onClick={() => setEditing(r)}>编辑</Button>}
          <Button size="small" type="link" onClick={() => setDebugging(r)} data-testid={`script-debug-${r.name}`}>
            调试
          </Button>
          {canUpdate && (
            <Button size="small" type="link" onClick={() => setStatus.mutate({ id: r.id, status: r.status === "ENABLED" ? "DRAFT" : "ENABLED" })}>
              {r.status === "ENABLED" ? "停用" : "发布"}
            </Button>
          )}
          {can("PROJECT_SCRIPT:DELETE") && (
            <Popconfirm title="删除该脚本？" onConfirm={() => remove.mutate(r)}>
              <Button size="small" type="link" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div data-testid="page-settings-public-scripts" className="p-4 bg-white border rounded-md">
      <PageHeader
        title="公共脚本"
        sub="项目级脚本库：参数定义 + 在线调试；仅「已发布」可被前后置引用（javascript / quickjs 沙箱）"
        extra={
          canCreate && (
            <Button type="primary" size="small" onClick={() => setCreateOpen(true)} data-testid="btn-new-script">
              ＋ 新建脚本
            </Button>
          )
        }
      />
      <div className="mb-2 flex items-center gap-2">
        <Input.Search
          placeholder="搜索名称"
          size="small"
          className="w-56"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
        />
        <span className="text-xs text-gray-400">停用/草稿脚本不可被引用；删除被引用脚本会列出引用清单（可强制删除）</span>
      </div>
      <Table rowKey="id" size="small" loading={scripts.isLoading} columns={columns} dataSource={scripts.data?.items ?? []} pagination={false} />
      {(createOpen || editing) && (
        <ScriptEditDrawer
          key={editing?.id ?? "new"}
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreateOpen(false);
          }}
          onSubmit={(v) => save.mutate({ id: editing?.id, body: v })}
        />
      )}
      {debugging && (
        <ScriptDebugDrawer
          key={`debug-${debugging.id}`}
          script={debugging}
          projectId={projectId!}
          onClose={() => setDebugging(null)}
        />
      )}
    </div>
  );
}

function ScriptEditDrawer({
  initial,
  onClose,
  onSubmit,
}: {
  initial: PublicScriptRow | null;
  onClose: () => void;
  onSubmit: (v: PublicScriptUpsertInput) => void;
}) {
  const [form] = Form.useForm();
  const params = Form.useWatch("params", form) ?? [];
  return (
    <Drawer title={initial ? `编辑脚本 · ${initial.name}` : "新建脚本"} width={520} open onClose={onClose} destroyOnClose>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: initial?.name ?? "",
          tags: initial?.tags ?? [],
          params: initial?.params ?? [],
          content: initial?.content ?? 'log("hello");\nsetVar("k", "v");',
        }}
        onFinish={onSubmit}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "必填" }]}>
          <Input data-testid="script-name-input" />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" open={false} placeholder="回车添加" />
        </Form.Item>
        <Form.Item label={<span>参数定义<span className="text-gray-400 ml-1 text-xs">（引用处可覆盖默认值）</span></span>} required={false}>
          <div className="space-y-2" data-testid="script-params-editor">
            {(params as PublicScriptParam[]).map((p, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Form.Item name={["params", i, "name"]} noStyle rules={[{ required: true, message: "参数名" }]}>
                  <Input placeholder="参数名" className="w-32" />
                </Form.Item>
                <Form.Item name={["params", i, "defaultValue"]} noStyle>
                  <Input placeholder="默认值" className="flex-1 font-mono text-xs" />
                </Form.Item>
                <Form.Item name={["params", i, "required"]} noStyle valuePropName="checked">
                  <span className="text-xs flex items-center gap-1">
                    必填 <input type="checkbox" checked={Boolean((params as PublicScriptParam[])[i]?.required)} onChange={(e) => form.setFieldValue(["params", i, "required"], e.target.checked)} />
                  </span>
                </Form.Item>
                <Button size="small" type="link" danger onClick={() => form.setFieldValue("params", (params as PublicScriptParam[]).filter((_, j) => j !== i))}>
                  删
                </Button>
              </div>
            ))}
            <Button size="small" type="dashed" onClick={() => form.setFieldValue("params", [...(params as PublicScriptParam[]), { name: "", defaultValue: "", required: false }])}>
              ＋ 添加参数
            </Button>
          </div>
        </Form.Item>
        <Form.Item
          name="content"
          label={
            <span>
              脚本内容
              <span className="text-gray-400 ml-1 text-xs">（可用：log / getVar / setVar / envGet / randomInt / now）</span>
            </span>
          }
        >
          <Input.TextArea rows={10} className="font-mono text-xs" data-testid="script-content-input" />
        </Form.Item>
        <Space>
          <Button type="primary" htmlType="submit" data-testid="script-save-btn">
            保存
          </Button>
          <Button onClick={onClose}>取消</Button>
        </Space>
      </Form>
    </Drawer>
  );
}

function ScriptDebugDrawer({
  script,
  projectId,
  onClose,
}: {
  script: PublicScriptRow;
  projectId: string;
  onClose: () => void;
}) {
  const { message } = useApp();
  const [varsText, setVarsText] = useState("{}");
  const [paramsText, setParamsText] = useState("{}");
  const [result, setResult] = useState<{ logs: string[]; vars: Record<string, string>; durationMs: number } | null>(null);
  const run = useMutation({
    mutationFn: () => {
      const vars = JSON.parse(varsText || "{}");
      const params = JSON.parse(paramsText || "{}");
      return publicScriptApi.debug(projectId, script.id, { vars, params });
    },
    onSuccess: (r) => setResult(r),
    onError: (e) => message.error(e instanceof Error ? e.message : "调试失败"),
  });
  return (
    <Drawer title={`在线调试 · ${script.name}`} width={560} open onClose={onClose} destroyOnClose>
      <div className="space-y-3">
        <Alert type="info" showIcon message="注入变量 vars 与参数值 params（JSON，覆盖默认）；5s 超时强杀" />
        <div>
          <p className="text-xs text-gray-500 mb-1">vars（JSON）</p>
          <Input.TextArea rows={2} value={varsText} onChange={(e) => setVarsText(e.target.value)} className="font-mono text-xs" />
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">params（JSON，覆盖默认）</p>
          <Input.TextArea rows={2} value={paramsText} onChange={(e) => setParamsText(e.target.value)} className="font-mono text-xs" />
        </div>
        <Button type="primary" loading={run.isPending} onClick={() => run.mutate()} data-testid="script-debug-run">
          ▶ 运行
        </Button>
        {result && (
          <div data-testid="script-debug-console">
            <div className="border rounded bg-slate-900 text-green-400 font-mono text-[11px] p-2 space-y-0.5 max-h-64 overflow-auto">
              {result.logs.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
              <p className="text-slate-400">vars: {JSON.stringify(result.vars)}</p>
              <p className="text-slate-400">耗时 {result.durationMs}ms · 成功</p>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
