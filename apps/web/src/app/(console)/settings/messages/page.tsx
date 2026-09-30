"use client";

import {
  Alert,
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { MESSAGE_EVENTS } from "@rabbit/shared";
import {
  memberApi,
  messageConfigApi,
  robotApi,
  type MessageEventConfig,
  type MessageEventsConfig,
  type RobotRow,
} from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { useEntp } from "@/hooks/useEntp";
import { TemplateTab } from "./TemplateTab";

const CHANNEL_LABEL: Record<string, string> = {
  inapp: "站内信",
  email: "邮件",
  wecom: "企微",
  dingtalk: "钉钉",
  feishu: "飞书",
};
const CHANNEL_COLOR: Record<string, string> = {
  inapp: "default",
  email: "warning",
  wecom: "success",
  dingtalk: "processing",
  feishu: "purple",
};
const WEBHOOK_CHANNELS = ["wecom", "dingtalk", "feishu"];

/** MSG-001 消息管理（机器人 + 事件配置）+ ENTP-005 模板 Tab。 */
export default function MessagesPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_MESSAGE:UPDATE");
  const entp = useEntp();
  const [editing, setEditing] = useState<RobotRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [config, setConfig] = useState<MessageEventsConfig>({});
  const [configDirty, setConfigDirty] = useState(false);

  const robots = useQuery({
    queryKey: ["robots", projectId],
    queryFn: () => robotApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const cfgView = useQuery({
    queryKey: ["message-config", projectId],
    queryFn: () => messageConfigApi.view(projectId!),
    enabled: Boolean(projectId),
  });
  const members = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
  });

  // 配置载入（避免每次渲染覆盖编辑态）
  const loadedRef = useState({ done: false });
  if (cfgView.data && !loadedRef[0].done) {
    loadedRef[0].done = true;
    setConfig(cfgView.data.config ?? {});
  }

  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const save = useMutation({
    mutationFn: (body: {
      name: string;
      channel: RobotRow["channel"];
      webhook?: string;
      enabled: boolean;
    }) =>
      editing ? robotApi.update(projectId!, editing.id, body) : robotApi.create(projectId!, body),
    onSuccess: () => {
      message.success(editing ? "已保存" : "已创建");
      setEditing(null);
      setCreateOpen(false);
      void qc.invalidateQueries({ queryKey: ["robots", projectId] });
      void qc.invalidateQueries({ queryKey: ["message-config", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => robotApi.remove(projectId!, id),
    onSuccess: () => {
      message.success("已删除");
      void qc.invalidateQueries({ queryKey: ["robots", projectId] });
      void qc.invalidateQueries({ queryKey: ["message-config", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const test = useMutation({
    mutationFn: (id: string) => robotApi.test(projectId!, id),
    onSuccess: (r) => message.success(`测试消息已送达（${r.detail}）`),
    onError: (e) => message.error(errText(e)),
  });

  const saveConfig = useMutation({
    mutationFn: () => messageConfigApi.save(projectId!, config),
    onSuccess: () => {
      message.success("事件配置已保存");
      setConfigDirty(false);
      void qc.invalidateQueries({ queryKey: ["message-config", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const robotColumns = [
    { title: "名称", dataIndex: "name" },
    {
      title: "渠道",
      dataIndex: "channel",
      render: (v: string) => (
        <Tag color={CHANNEL_COLOR[v] ?? "default"}>{CHANNEL_LABEL[v] ?? v}</Tag>
      ),
    },
    {
      title: "Webhook / 说明",
      dataIndex: "webhook",
      render: (v: string | null, r: RobotRow) =>
        v ? (
          <code className="text-xs text-gray-500 max-w-[280px] truncate inline-block align-middle">
            {v}
          </code>
        ) : (
          <span className="text-xs text-gray-400">
            {r.channel === "inapp" ? "—（投递给事件接收人）" : "经系统 SMTP 投递"}
          </span>
        ),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      render: (v: boolean, r: RobotRow) => (
        <Switch
          size="small"
          checked={v}
          disabled={!canUpdate}
          onChange={(checked) =>
            save.mutate({
              name: r.name,
              channel: r.channel,
              webhook: r.webhook ?? undefined,
              enabled: checked,
            })
          }
        />
      ),
    },
    ...(canUpdate
      ? [
          {
            title: "操作",
            render: (_: unknown, r: RobotRow) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="link"
                  loading={test.isPending && test.variables === r.id}
                  onClick={() => test.mutate(r.id)}
                  data-testid={`robot-test-${r.name}`}
                >
                  测试
                </Button>
                <Button size="small" type="link" onClick={() => setEditing(r)}>
                  编辑
                </Button>
                <Popconfirm title="删除该机器人？" onConfirm={() => remove.mutate(r.id)}>
                  <Button size="small" type="link" danger>
                    删除
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  const enabledRobots = (cfgView.data?.robots ?? []).filter((r) => r.enabled);
  const memberOptions = (members.data?.items ?? []).map((m) => ({
    value: m.id,
    label: m.name || m.email,
  }));

  const updateEvent = (key: string, patch: Partial<MessageEventConfig>) => {
    const prev = config[key] ?? { enabled: false, robotIds: [], receiverUserIds: [] };
    setConfig({ ...config, [key]: { ...prev, ...patch } });
    setConfigDirty(true);
  };

  const groups = [...new Set(MESSAGE_EVENTS.map((e) => e.group))];
  const eventsTab = (
    <div className="space-y-3" data-testid="message-events-panel">
      <Alert
        type="info"
        showIcon
        message="接收人 = 配置接收人 ∪ @提及人 ∪ 关注者 − 操作人（同人去重）；提及/关注为接收人扩展，事件总闸关闭则全不发。消息内容默认模板可在「模板」页签按事件定制。"
      />
      {groups.map((g) => (
        <div key={g} className="border rounded-md">
          <div className="px-3 py-1.5 bg-slate-50 border-b text-xs text-gray-500 font-medium">
            {g}
          </div>
          {MESSAGE_EVENTS.filter((e) => e.group === g).map((e) => {
            const cfg = config[e.key] ?? { enabled: false, robotIds: [], receiverUserIds: [] };
            return (
              <div
                key={e.key}
                className="flex items-center gap-3 px-3 py-2 border-b last:border-b-0"
                data-testid={`event-row-${e.key}`}
              >
                <span className="w-44 text-[13px] shrink-0">{e.label}</span>
                <Switch
                  size="small"
                  checked={cfg.enabled}
                  disabled={!canUpdate}
                  onChange={(v) => updateEvent(e.key, { enabled: v })}
                  data-testid={`event-switch-${e.key}`}
                />
                <Select
                  mode="multiple"
                  allowClear
                  className="flex-1"
                  placeholder="接收人（站内信/邮件渠道）"
                  value={cfg.receiverUserIds}
                  disabled={!canUpdate || !cfg.enabled}
                  options={memberOptions}
                  onChange={(v) => updateEvent(e.key, { receiverUserIds: v })}
                />
                <Select
                  mode="multiple"
                  allowClear
                  className="w-80"
                  placeholder="机器人"
                  value={cfg.robotIds}
                  disabled={!canUpdate || !cfg.enabled}
                  options={enabledRobots.map((r) => ({
                    value: r.id,
                    label: `${r.name}（${CHANNEL_LABEL[r.channel] ?? r.channel}）`,
                  }))}
                  onChange={(v) => updateEvent(e.key, { robotIds: v })}
                />
              </div>
            );
          })}
        </div>
      ))}
      <Button
        type="primary"
        disabled={!canUpdate || !configDirty}
        loading={saveConfig.isPending}
        onClick={() => saveConfig.mutate()}
      >
        保存事件配置
      </Button>
    </div>
  );

  return (
    <div data-testid="page-settings-messages" className="p-4 bg-white border rounded-md">
      <PageHeader
        title="消息管理"
        sub="通知机器人（5 渠道）与事件配置；操作人本人不发（同人去重）"
      />
      <Tabs
        defaultActiveKey="robots"
        items={[
          {
            key: "robots",
            label: "机器人",
            children: (
              <>
                <div className="mb-2 flex items-center">
                  <span className="text-xs text-gray-400">
                    渠道：站内信 / 邮件 / 企业微信 / 钉钉 / 飞书 —— 上限 10 个/项目
                  </span>
                  {canUpdate && (
                    <Button
                      className="ml-auto"
                      type="primary"
                      size="small"
                      onClick={() => setCreateOpen(true)}
                      data-testid="btn-new-robot"
                    >
                      ＋ 新建机器人
                    </Button>
                  )}
                </div>
                <Table
                  rowKey="id"
                  size="small"
                  loading={robots.isLoading}
                  columns={robotColumns}
                  dataSource={robots.data?.items ?? []}
                  pagination={false}
                />
              </>
            ),
          },
          { key: "events", label: "事件配置", children: eventsTab },
          {
            key: "templates",
            label: "模板",
            forceRender: true,
            children: projectId ? (
              <TemplateTab projectId={projectId} enabled={entp.can("MSG_TEMPLATE")} />
            ) : null,
          },
        ]}
      />
      {(createOpen || editing) && (
        <RobotFormModal
          key={editing?.id ?? "new"}
          initial={editing}
          onClose={() => {
            setEditing(null);
            setCreateOpen(false);
          }}
          onSubmit={(v) => save.mutate(v)}
        />
      )}
    </div>
  );
}

function RobotFormModal({
  initial,
  onClose,
  onSubmit,
}: {
  initial: RobotRow | null;
  onClose: () => void;
  onSubmit: (v: {
    name: string;
    channel: RobotRow["channel"];
    webhook?: string;
    enabled: boolean;
  }) => void;
}) {
  const [form] = Form.useForm();
  const channel = Form.useWatch("channel", form);
  return (
    <Modal
      title={initial ? "编辑机器人" : "新建机器人"}
      open
      onCancel={onClose}
      onOk={() => form.submit()}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: initial?.name ?? "",
          channel: initial?.channel ?? "inapp",
          webhook: initial?.webhook ?? "",
          enabled: initial?.enabled ?? true,
        }}
        onFinish={(v) => onSubmit({ ...v, webhook: v.webhook || undefined })}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "必填" }]}>
          <Input placeholder="如：项目群机器人" data-testid="robot-name-input" />
        </Form.Item>
        <Form.Item name="channel" label="渠道">
          <Select
            options={Object.entries(CHANNEL_LABEL).map(([value, label]) => ({ value, label }))}
            data-testid="robot-channel-select"
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.channel !== b.channel}>
          {() =>
            WEBHOOK_CHANNELS.includes(String(channel)) ? (
              <Form.Item
                name="webhook"
                label="Webhook"
                rules={[
                  { required: true, message: "机器人渠道（企微/钉钉/飞书）必须填写 Webhook" },
                  {
                    validator: (_, v) => {
                      if (!v) return Promise.resolve();
                      try {
                        const u = new URL(v);
                        return u.protocol === "http:" || u.protocol === "https:"
                          ? Promise.resolve()
                          : Promise.reject(new Error("仅允许 http(s)"));
                      } catch {
                        return Promise.reject(new Error("Webhook 不是合法 URL"));
                      }
                    },
                  },
                ]}
              >
                <Input
                  placeholder="https://oapi.dingtalk.com/robot_send?access_token=..."
                  data-testid="robot-webhook-input"
                />
              </Form.Item>
            ) : (
              <Form.Item label="Webhook" tooltip="站内信/邮件渠道无需 Webhook">
                <Input disabled placeholder="—（该渠道无需 Webhook）" />
              </Form.Item>
            )
          }
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
