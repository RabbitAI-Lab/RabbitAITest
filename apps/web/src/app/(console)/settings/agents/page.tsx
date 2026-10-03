"use client";

import { UploadOutlined } from "@ant-design/icons";
import { Upload } from "antd";
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
  Table,
  Tabs,
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
  type AgentRunView,
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
  role: string;
  customRoleName?: string;
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
  const [tab, setTab] = useState("agents");
  const [editing, setEditing] = useState<AgentView | "new" | null>(null);
  const [keyModal, setKeyModal] = useState<AgentKeyView | null>(null);
  const [skillModal, setSkillModal] = useState<AgentSkillView | "new" | null>(null);
  const [customRole, setCustomRole] = useState(false);
  const [form] = Form.useForm<AgentFormValue>();
  const [skillForm] = Form.useForm<{
    name: string;
    description: string;
    content: string;
    enabled?: boolean;
  }>();

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => agentApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const skills = useQuery({
    queryKey: ["agent-skills", projectId],
    queryFn: () => agentSkillApi.list(projectId!),
    enabled: Boolean(projectId) && tab === "skills",
  });
  const runs = useQuery({
    queryKey: ["agent-runs", projectId],
    queryFn: () =>
      agentApi.runs(projectId!, agents.data?.items[0]?.id ?? "", { page: 1, pageSize: 20 }),
    enabled: Boolean(projectId) && tab === "runs" && Boolean(agents.data?.items.length),
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
      setCustomRole(true);
      form.setFieldsValue({
        role: "CUSTOM",
        customRoleName: undefined,
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
      // 已有 Agent：已知角色显示原始枚举，未知角色（自定义）→ Select 置 CUSTOM + 输入框预填
      const isKnownRole = a.role in AGENT_ROLE_LABELS;
      setCustomRole(!isKnownRole);
      form.setFieldsValue({
        name: a.name,
        description: a.description ?? undefined,
        role: isKnownRole ? a.role : "CUSTOM",
        customRoleName: isKnownRole ? undefined : a.role,
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
          <Button onClick={() => setSkillModal("new")} data-testid="agent-skill-create">
            技能库
          </Button>
          <a
            href={`/api/v1/projects/${projectId}/agent-skills/template`}
            download="skill-template.zip"
            data-testid="agent-skill-template"
            className="ant-btn"
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <UploadOutlined /> 模板下载
          </a>
          <Upload
            accept=".zip"
            showUploadList={false}
            beforeUpload={async (file: File) => {
              if (!projectId) return false;
              const formData = new FormData();
              formData.append("file", file);
              try {
                const res = await fetch(`/api/v1/projects/${projectId}/agent-skills/upload`, {
                  method: "POST",
                  body: formData,
                  credentials: "same-origin",
                });
                const body = (await res.json()) as { code: number; message?: string };
                if (body.code === 0) {
                  message.success(`目录技能「${file.name.replace(/\.zip$/i, "")}」上传成功`);
                  invalidate();
                } else {
                  message.error(body.message ?? "上传失败");
                }
              } catch (e) {
                message.error((e as Error).message);
              }
              return false; // 阻止 antd 自动上传
            }}
          >
            <Button icon={<UploadOutlined />} data-testid="agent-skill-upload">
              上传技能包
            </Button>
          </Upload>
          <Button type="primary" onClick={() => openEdit("new")} data-testid="agent-create">
            新建 Agent
          </Button>
        </div>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "agents", label: "Agent", children: null },
          { key: "skills", label: "技能", children: null },
          { key: "runs", label: "运行记录", children: null },
        ]}
      />

      {tab === "agents" &&
        (agents.isLoading ? (
          <div className="py-20 text-center">
            <Spin />
          </div>
        ) : !agents.data?.items.length ? (
          <Empty description="还没有项目 Agent" className="py-16" data-testid="agents-empty" />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {agents.data.items.map((a) => (
              <Card
                key={a.id}
                size="small"
                className="!bg-white"
                data-testid={`agent-card-${a.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <Space size={6} wrap>
                      <span className="font-medium">{a.name}</span>
                      <Tag color={a.mode === "pipeline" ? "green" : "blue"}>{a.mode}</Tag>
                      <Tag>{AGENT_ROLE_LABELS[a.role] ?? a.role}</Tag>
                      {a.a2aEnabled && <Tag color="geekblue">A2A 已开启</Tag>}
                      {!a.enabled && <Tag color="red">已停用</Tag>}
                    </Space>
                    <div className="mt-1 text-xs text-gray-500">
                      {a.modelName ?? "默认模型"} · 工具 {a.toolKeys.length} · Skills{" "}
                      {a.skillIds.length}
                      {a.lastCalledAt
                        ? ` · 最近调用 ${a.lastCalledAt.slice(5, 16).replace("T", " ")}`
                        : ""}
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
                        onClick={() => router.push(`/settings/agents/${a.id}/debug`)}
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
        ))}

      {tab === "skills" && (
        <Table
          rowKey="id"
          size="small"
          loading={skills.isLoading}
          dataSource={skills.data?.items ?? []}
          columns={[
            { title: "名称", dataIndex: "name" },
            { title: "触发说明", dataIndex: "description", ellipsis: true },
            {
              title: "引用 Agent",
              dataIndex: "refCount",
              width: 100,
              render: (v: number) => v ?? 0,
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 80,
              render: (v: boolean) => (v ? "是" : "否"),
            },
            {
              title: "操作",
              width: 140,
              render: (_: unknown, r: AgentSkillView) => (
                <>
                  <Button size="small" type="link" onClick={() => setSkillModal(r)}>
                    编辑
                  </Button>
                  <Popconfirm
                    title="确认删除该技能？"
                    onConfirm={() =>
                      void agentSkillApi
                        .remove(projectId!, r.id)
                        .then(invalidate)
                        .catch((e: Error) => message.error(e.message))
                    }
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>
                </>
              ),
            },
          ]}
        />
      )}

      {tab === "runs" &&
        (!agents.data?.items.length ? (
          <Empty description="尚无 Agent 运行记录" className="py-16" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            loading={runs.isLoading}
            dataSource={runs.data?.items ?? []}
            columns={[
              {
                title: "时间",
                dataIndex: "createdAt",
                width: 160,
                render: (v: string) => v.replace("T", " ").slice(0, 19),
              },
              { title: "Agent", dataIndex: "agentName" },
              {
                title: "来源",
                dataIndex: "source",
                width: 70,
                render: (v: string) => <Tag>{v}</Tag>,
              },
              {
                title: "状态",
                dataIndex: "status",
                width: 100,
                render: (v: AgentRunView["status"]) => (
                  <Tag
                    color={
                      v === "COMPLETED"
                        ? "green"
                        : v === "FAILED"
                          ? "red"
                          : v === "RUNNING"
                            ? "processing"
                            : "default"
                    }
                  >
                    {v}
                  </Tag>
                ),
              },
              {
                title: "耗时",
                dataIndex: "durationMs",
                width: 90,
                render: (v: number | null) => (v != null ? `${(v / 1000).toFixed(1)}s` : "—"),
              },
              {
                title: "Token(入/出)",
                width: 130,
                render: (_: unknown, r: AgentRunView) => `${r.promptTokens}/${r.completionTokens}`,
              },
              { title: "错误", dataIndex: "error", ellipsis: true },
            ]}
          />
        ))}

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
                // 自定义角色：用输入的自定义名替代 "CUSTOM"
                const role = v.role === "CUSTOM" && v.customRoleName?.trim() ? v.customRoleName.trim() : v.role;
                const payload = { ...v, role };
                delete (payload as { customRoleName?: string }).customRoleName;
                if (editing && editing !== "new") updateMut.mutate({ id: editing.id, ...payload });
                else createMut.mutate(payload);
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
                onChange={(v: string) => setCustomRole(v === "CUSTOM")}
                options={Object.entries(AGENT_ROLE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            {customRole && (
              <Form.Item name="customRoleName" label="自定义角色名（留空=通用自定义）">
                <Input placeholder="如：安全测试专家" style={{ width: 200 }} data-testid="agent-custom-role-input" />
              </Form.Item>
            )}
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
      {/* 技能编辑弹窗 */}
      <Modal
        title={skillModal && skillModal !== "new" ? `编辑技能 · ${skillModal.name}` : "新建技能"}
        open={Boolean(skillModal)}
        onCancel={() => setSkillModal(null)}
        data-testid="agent-skill-modal"
        onOk={async () => {
          const v = await skillForm.validateFields();
          const p = skillModal && skillModal !== "new" ? skillModal.id : null;
          const action = p
            ? agentSkillApi.update(projectId!, p, {
                name: v.name,
                description: v.description,
                content: v.content,
                enabled: skillModal && skillModal !== "new" ? skillModal.enabled : true,
              })
            : agentSkillApi.create(projectId!, {
                name: v.name,
                description: v.description,
                content: v.content,
                enabled: true,
              });
          await action
            .then(invalidate)
            .then(() => {
              message.success("已保存");
              setSkillModal(null);
            })
            .catch((e: Error) => message.error(e.message));
        }}
      >
        <Form
          form={skillForm}
          layout="vertical"
          initialValues={
            skillModal && skillModal !== "new"
              ? {
                  name: skillModal.name,
                  description: skillModal.description,
                  content: skillModal.content,
                }
              : undefined
          }
        >
          <Form.Item name="name" label="名称（项目内唯一）" rules={[{ required: true, max: 64 }]}>
            <Input data-testid="agent-skill-name" />
          </Form.Item>
          <Form.Item
            name="description"
            label="触发说明（何时使用）"
            rules={[{ required: true, max: 512 }]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="content" label="指令内容（markdown ≤16KB）" rules={[{ required: true }]}>
            <Input.TextArea rows={8} showCount maxLength={16384} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
