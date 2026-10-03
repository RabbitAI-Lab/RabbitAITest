"use client";

import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Slider,
  Space,
  Spin,
  Switch,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  agentApi,
  agentSkillApi,
  type AgentKeyView,
  type AgentSkillView,
  type AgentView,
} from "@rabbit/api-client";
import { AGENT_ROLE_LABELS, AGENT_ROLES, AGENT_TOOLS } from "@rabbit/shared";
import { useApp } from "@/hooks/useApp";
import { useProjectStore } from "@/stores/project";

const TOOL_GROUPS = ["case", "api", "plan", "report", "repo"] as const;
const TOOL_GROUP_LABEL: Record<(typeof TOOL_GROUPS)[number], string> = {
  case: "用例",
  api: "接口",
  plan: "计划与执行",
  report: "报告与缺陷",
  repo: "仓库",
};

interface AgentFormValue {
  name: string;
  description?: string;
  role: (typeof AGENT_ROLES)[number];
  mode: "chat" | "pipeline";
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxIterations: number;
  timeoutMs: number;
  toolKeys: string[];
  skillIds: string[];
  enabled: boolean;
}

export default function AgentsPage() {
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const { currentProjectId: projectId } = useProjectStore();
  const [editing, setEditing] = useState<AgentView | "new" | null>(null);
  const [keyModal, setKeyModal] = useState<AgentKeyView | null>(null);
  const [form] = Form.useForm<AgentFormValue>();

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => agentApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const skills = useQuery({
    queryKey: ["agent-skills", projectId],
    queryFn: () => agentSkillApi.list(projectId!),
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["agents", projectId] });
    void qc.invalidateQueries({ queryKey: ["agent-skills", projectId] });
    void qc.invalidateQueries({ queryKey: ["agent-runs", projectId] });
  };

  const createMut = useMutation({
    mutationFn: (v: AgentFormValue & { fromTemplate?: string }) =>
      agentApi.create(projectId!, {
        name: v.name,
        description: v.description,
        role: v.role,
        mode: v.mode,
        modelId: v.modelId,
        systemPrompt: v.systemPrompt,
        modelParams: { temperature: v.temperature, maxTokens: v.maxTokens },
        maxIterations: v.maxIterations,
        timeoutMs: v.timeoutMs,
        repoIds: [],
        toolKeys: v.toolKeys,
        skillIds: v.skillIds,
        enabled: v.enabled,
        fromTemplate: v.fromTemplate,
      }),
    onSuccess: () => {
      message.success("Agent 已创建");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const updateMut = useMutation({
    mutationFn: (v: { id: string } & AgentFormValue) =>
      agentApi.update(projectId!, v.id, {
        name: v.name,
        description: v.description,
        role: v.role,
        modelId: v.modelId,
        systemPrompt: v.systemPrompt,
        modelParams: { temperature: v.temperature, maxTokens: v.maxTokens },
        maxIterations: v.maxIterations,
        timeoutMs: v.timeoutMs,
        repoIds: [],
        toolKeys: v.toolKeys,
        skillIds: v.skillIds,
        enabled: v.enabled,
      }),
    onSuccess: () => {
      message.success("已保存");
      setEditing(null);
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => agentApi.remove(projectId!, id),
    onSuccess: () => {
      message.success("已删除");
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const rotateKeyMut = useMutation({
    mutationFn: (id: string) => agentApi.rotateKey(projectId!, id),
    onSuccess: (r) => {
      setKeyModal(r);
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const revokeKeyMut = useMutation({
    mutationFn: (id: string) => agentApi.revokeKey(projectId!, id),
    onSuccess: () => {
      message.success("密钥已吊销");
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const openEdit = (a: AgentView | "new") => {
    setEditing(a);
    if (a === "new") {
      form.setFieldsValue({
        role: "CUSTOM",
        mode: "chat",
        systemPrompt: "你是本项目的测试专家。",
        temperature: 0.3,
        maxTokens: 4096,
        maxIterations: 12,
        timeoutMs: 300000,
        toolKeys: [],
        skillIds: [],
        enabled: true,
      });
    } else {
      form.setFieldsValue({
        name: a.name,
        description: a.description ?? undefined,
        role: a.role,
        mode: a.mode,
        modelId: a.modelId,
        systemPrompt: a.systemPrompt,
        temperature: a.modelParams.temperature ?? 0.3,
        maxTokens: a.modelParams.maxTokens ?? 4096,
        maxIterations: a.maxIterations,
        timeoutMs: a.timeoutMs,
        toolKeys: a.toolKeys,
        skillIds: a.skillIds,
        enabled: a.enabled,
      });
    }
  };

  return (
    <div className="p-6" data-testid="agents-page">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            项目 Agent
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            为项目配置专属智能体（对话/生成管线）；开启 A2A 后外部 AI 可按协议调用
          </Typography.Text>
        </div>
        <div className="ml-auto flex gap-2">
          <Button type="primary" onClick={() => openEdit("new")} data-testid="agent-create">
            新建 Agent
          </Button>
        </div>
      </div>

      {agents.isLoading ? (
        <div className="py-20 text-center">
          <Spin />
        </div>
      ) : !agents.data?.items.length ? (
        <Empty description="还没有项目 Agent" className="py-16" data-testid="agents-empty" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {agents.data.items.map((a) => (
            <Card key={a.id} size="small" className="!bg-white" data-testid={`agent-card-${a.id}`}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <Space size={6} wrap>
                    <span className="font-medium">{a.name}</span>
                    <Tag color={a.mode === "pipeline" ? "green" : "blue"}>{a.mode}</Tag>
                    <Tag>{AGENT_ROLE_LABELS[a.role]}</Tag>
                    {a.a2aEnabled && <Tag color="geekblue">A2A 已开启</Tag>}
                    {!a.enabled && <Tag color="red">已停用</Tag>}
                  </Space>
                  <div className="mt-1 text-xs text-gray-500">
                    {a.modelName ?? "默认模型"} · 工具 {a.toolKeys.length} · Skills {a.skillIds.length}
                    {a.lastCalledAt ? ` · 最近调用 ${a.lastCalledAt.slice(5, 16).replace("T", " ")}` : ""}
                  </div>
                </div>
                <Switch
                  checked={a.enabled}
                  size="small"
                  onChange={(checked) =>
                    updateMut.mutate({
                      id: a.id,
                      name: a.name,
                      description: a.description ?? undefined,
                      role: a.role,
                      mode: a.mode,
                      modelId: a.modelId,
                      systemPrompt: a.systemPrompt,
                      temperature: a.modelParams.temperature ?? 0.3,
                      maxTokens: a.modelParams.maxTokens ?? 4096,
                      maxIterations: a.maxIterations,
                      timeoutMs: a.timeoutMs,
                      toolKeys: a.toolKeys,
                      skillIds: a.skillIds,
                      enabled: checked,
                    })
                  }
                />
              </div>
              <div className="mt-3 flex items-center gap-1 border-t border-gray-100 pt-3">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {a.apiKeyPrefix ? `密钥 ${a.apiKeyPrefix}…` : "A2A 未开启"}
                </Typography.Text>
                <div className="ml-auto flex gap-1">
                  {a.mode === "chat" && (
                    <Button
                      size="small"
                      type="link"
                      data-testid={`agent-debug-${a.id}`}
                      onClick={() => router.push(`/agents/${a.id}/debug`)}
                    >
                      调试
                    </Button>
                  )}
                  <Button size="small" type="link" onClick={() => openEdit(a)}>
                    编辑
                  </Button>
                  <Popconfirm title="确认删除该 Agent？" onConfirm={() => deleteMut.mutate(a.id)}>
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* 编辑抽屉 */}
      <Drawer
        title={editing && editing !== "new" ? `编辑 Agent · ${editing.name}` : "新建 Agent"}
        width={680}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        data-testid="agent-edit-drawer"
        footer={
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(null)}>取消</Button>
            <Button
              type="primary"
              data-testid="agent-edit-save"
              onClick={async () => {
                const v = await form.validateFields();
                if (editing && editing !== "new") updateMut.mutate({ id: editing.id, ...v });
                else createMut.mutate(v);
              }}
            >
              保存
            </Button>
          </div>
        }
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true, max: 64 }]}>
            <Input data-testid="agent-form-name" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="role" label="角色分类" initialValue="CUSTOM">
              <Select
                style={{ width: 140 }}
                options={Object.entries(AGENT_ROLE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="mode" label="运行模式" initialValue="chat">
              <Select
                style={{ width: 200 }}
                disabled={editing !== "new"}
                options={[
                  { value: "chat", label: "对话循环（chat）" },
                  { value: "pipeline", label: "生成管线（pipeline）" },
                ]}
              />
            </Form.Item>
          </Space>
          <Form.Item name="modelId" label="模型 ID（UUID；留空=系统默认模型）">
            <Input placeholder="默认模型" allowClear />
          </Form.Item>
          <Form.Item name="systemPrompt" label="系统提示词" rules={[{ required: true }]}>
            <Input.TextArea rows={8} showCount maxLength={16384} />
          </Form.Item>
          <Form.Item name="temperature" label="温度" initialValue={0.3}>
            <Slider min={0} max={2} step={0.1} style={{ width: 240 }} />
          </Form.Item>
          <Space size="large">
            <Form.Item name="maxTokens" label="maxTokens" initialValue={4096}>
              <InputNumber min={256} max={32768} />
            </Form.Item>
            <Form.Item name="maxIterations" label="迭代上限（≤30）" initialValue={12}>
              <InputNumber min={1} max={30} />
            </Form.Item>
            <Form.Item name="timeoutMs" label="超时（ms，≤600000）" initialValue={300000}>
              <InputNumber min={10000} max={600000} step={10000} />
            </Form.Item>
          </Space>
          <Form.Item name="toolKeys" label="工具目录">
            <Select
              mode="multiple"
              placeholder="勾选该 Agent 可用的平台工具"
              options={TOOL_GROUPS.flatMap((g) =>
                AGENT_TOOLS.filter((t) => t.group === g).map((t) => ({
                  value: t.key,
                  label: `${TOOL_GROUP_LABEL[g]} · ${t.key}${t.write ? "（写）" : ""}`,
                })),
              )}
            />
          </Form.Item>
          <Form.Item name="skillIds" label="Skills（≤5）">
            <Select
              mode="multiple"
              maxCount={5}
              placeholder="引用项目技能库"
              options={(skills.data?.items ?? []).map((s) => ({ value: s.id, label: s.name }))}
            />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked" initialValue={true}>
            <Switch />
          </Form.Item>
        </Form>
      </Drawer>

      {/* 密钥一次显示 */}
      <Modal
        title="新密钥已生成（仅此一次显示）"
        open={Boolean(keyModal)}
        onCancel={() => setKeyModal(null)}
        footer={
          <Button
            type="primary"
            onClick={() => {
              if (keyModal) void navigator.clipboard?.writeText(keyModal.apiKey);
              message.success("已复制");
              setKeyModal(null);
            }}
          >
            复制并关闭
          </Button>
        }
      >
        <Alert
          type="warning"
          showIcon
          className="!mb-3"
          message="请立即复制保存；关闭后无法再次查看"
        />
        <Typography.Paragraph copyable code data-testid="agent-key-plaintext">
          {keyModal?.apiKey}
        </Typography.Paragraph>
      </Modal>
    </div>
  );
}
