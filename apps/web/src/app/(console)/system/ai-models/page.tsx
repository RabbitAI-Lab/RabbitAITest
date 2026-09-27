"use client";

import { Button, Empty, Form, Input, Modal, Popconfirm, Select, Skeleton, Switch, Tag, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AI_PROVIDER_DEFAULT_BASEURL,
  AI_PROVIDERS,
  type AiProvider,
} from "@rabbit/shared";
import {
  createAiModel,
  deleteAiModel,
  listAiModels,
  setDefaultAiModel,
  testAiModel,
  updateAiModel,
  type AiModelRow,
} from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { usePermissions } from "@/hooks/usePermissions";

const PROVIDER_LABEL: Record<string, string> = { deepseek: "DeepSeek", openai: "OpenAI", zhipu: "智谱 AI" };
const PROVIDER_COLOR: Record<string, string> = { deepseek: "purple", openai: "emerald", zhipu: "blue" };

interface FormValues {
  name: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  enabled: boolean;
}

/** AI-001 模型设置：卡片列表 + 新建/编辑 Modal + 连接测试 + 设默认（apiKey 不回显，编辑留空=不改）。 */
export default function AiModelsPage() {
  const qc = useQueryClient();
  const { canGlobal } = usePermissions();
  const canCreate = canGlobal("SYSTEM_AI:CREATE");
  const canUpdate = canGlobal("SYSTEM_AI:UPDATE");
  const canDelete = canGlobal("SYSTEM_AI:DELETE");

  const { data, isLoading } = useQuery({ queryKey: ["ai-models"], queryFn: listAiModels });
  const [editing, setEditing] = useState<AiModelRow | null>(null);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [testingId, setTestingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ provider: "zhipu", baseUrl: AI_PROVIDER_DEFAULT_BASEURL.zhipu, enabled: true });
    setOpen(true);
  };
  const openEdit = (row: AiModelRow) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({ name: row.name, provider: row.provider as AiProvider, baseUrl: row.baseUrl, model: row.model, enabled: row.enabled });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: async (v: FormValues) => {
      if (editing) return updateAiModel(editing.id, v);
      return createAiModel({ ...v, apiKey: v.apiKey ?? "" });
    },
    onSuccess: () => {
      message.success(editing ? "模型已更新" : "模型已创建");
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["ai-models"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const test = useMutation({
    mutationFn: testAiModel,
    onMutate: (id) => setTestingId(id),
    onSettled: () => setTestingId(null),
    onSuccess: (r) => message.success(`连接测试通过 · ${r.latencyMs}ms · ${r.echo || "—"}`),
    onError: (e) => message.error(e instanceof Error ? e.message : "连接失败"),
  });

  const setDefault = useMutation({
    mutationFn: setDefaultAiModel,
    onSuccess: () => {
      message.success("已设为默认");
      void qc.invalidateQueries({ queryKey: ["ai-models"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const remove = useMutation({
    mutationFn: deleteAiModel,
    onSuccess: () => {
      message.success("已删除");
      void qc.invalidateQueries({ queryKey: ["ai-models"] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  return (
    <div>
      <PageHeader
        title="模型设置（AI）"
        sub="接入 DeepSeek / OpenAI / 智谱 AI（OpenAI 兼容协议）；API Key 加密存储且不回显；BaseUrl 禁内网/元数据"
        extra={
          canCreate && (
            <Button type="primary" onClick={openCreate} data-testid="ai-model-create">
              ＋ 新建模型
            </Button>
          )
        }
      />
      {isLoading ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : !data || data.list.length === 0 ? (
        <Empty description="尚无模型——用例生成与 AI 助手需至少一台启用模型" data-testid="ai-model-empty" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="ai-model-list">
          {data.list.map((m) => (
            <div key={m.id} data-testid={`ai-model-card-${m.name}`} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Tag color={PROVIDER_COLOR[m.provider]}>{PROVIDER_LABEL[m.provider] ?? m.provider}</Tag>
                <span className="font-medium">{m.name}</span>
                {m.isDefault && (
                  <span className="text-amber-500 text-xs" title="默认模型">
                    ★ 默认
                  </span>
                )}
                <span className="ml-auto">
                  <Switch
                    size="small"
                    checked={m.enabled}
                    disabled={!canUpdate}
                    onChange={(checked) => save.mutate({ name: m.name, provider: m.provider as AiProvider, baseUrl: m.baseUrl, model: m.model, apiKey: undefined, enabled: checked })}
                  />
                </span>
              </div>
              <p className="font-mono text-xs text-slate-500 break-all">
                {m.model} · {m.baseUrl}
              </p>
              <p className="text-xs text-slate-400">
                API Key：{m.apiKeyMasked}（AES-GCM 加密）
              </p>
              <div className="flex items-center gap-3 text-xs pt-1">
                {canUpdate && (
                  <>
                    <a onClick={() => test.mutate(m.id)} data-testid={`ai-model-test-${m.name}`}>
                      {testingId === m.id ? "测试中…" : "测试"}
                    </a>
                    {!m.isDefault && (
                      <a onClick={() => setDefault.mutate(m.id)} data-testid={`ai-model-default-${m.name}`}>
                        设为默认
                      </a>
                    )}
                    <a onClick={() => openEdit(m)}>编辑</a>
                  </>
                )}
                {canDelete && (
                  <Popconfirm title="确认删除该模型？" okText="删除" okButtonProps={{ danger: true }} onConfirm={() => remove.mutate(m.id)}>
                    <a className="text-red-500">删除</a>
                  </Popconfirm>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal
        title={editing ? "编辑模型" : "新建模型"}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => form.validateFields().then((v) => save.mutate(v))}
        confirmLoading={save.isPending}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="pt-2">
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "名称必填" }, { max: 64 }]}>
            <Input placeholder="如：主力生成模型" data-testid="ai-model-form-name" />
          </Form.Item>
          <Form.Item name="provider" label="供应商" rules={[{ required: true }]}>
            <Select
              options={AI_PROVIDERS.map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))}
              onChange={(p: AiProvider) => form.setFieldValue("baseUrl", AI_PROVIDER_DEFAULT_BASEURL[p])}
              data-testid="ai-model-form-provider"
            />
          </Form.Item>
          <Form.Item name="baseUrl" label="BaseUrl" rules={[{ required: true, message: "BaseUrl 必填" }, { type: "url", message: "合法 URL" }]}>
            <Input placeholder="https://…" data-testid="ai-model-form-baseurl" />
          </Form.Item>
          <Form.Item name="model" label="模型名" rules={[{ required: true, message: "模型名必填" }]}>
            <Input placeholder="glm-4.6 / deepseek-chat / gpt-4o" data-testid="ai-model-form-model" />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            rules={editing ? [] : [{ required: true, message: "API Key 必填" }]}
            extra={editing ? "留空=不修改（密文不回显）" : "AES-256-GCM 加密存储；任何响应只回显掩码"}
          >
            <Input.Password placeholder={editing ? "sk-****（留空不改）" : "sk-…"} autoComplete="new-password" data-testid="ai-model-form-apikey" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
