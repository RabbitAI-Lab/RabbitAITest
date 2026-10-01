"use client";

import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  integrationApi,
  scmAppApi,
  type IntegrationView,
  type SyncHistoryEntry,
} from "@rabbit/api-client";
import { PLATFORM_META, PLATFORMS, SCM_PROVIDER_LABEL } from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectInfo } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");

/** INTG-001/002：服务集成（组织级三平台配置+测试连接）+ 三方同步（项目关联/手动拉取/同步历史）+ 代码平台（SCM-001 组织覆盖）。 */
export default function IntegrationsPage() {
  const { canGlobal, can } = usePermissions();
  const canOrgUpdate = canGlobal("ORG_INTEGRATION:UPDATE");
  return (
    <div className="p-4" data-testid="page-settings-integrations">
      <PageHeader
        title="服务集成"
        sub="组织级三方平台对接（Jira / 禅道 / TAPD）：凭据加密存储不回显；平台交互经 plugin-runner 隔离执行"
      />
      <Tabs
        items={[
          {
            key: "org",
            label: "服务集成（组织）",
            children: (
              <div className="space-y-5">
                <OrgIntegrations canUpdate={canOrgUpdate} />
                <ScmAppsBlock canUpdate={canOrgUpdate} />
              </div>
            ),
          },
          {
            key: "project",
            label: "三方同步（项目）",
            children: <ProjectSync canUpdate={can("PROJECT_BUG:UPDATE")} />,
          },
        ]}
      />
    </div>
  );
}

function OrgIntegrations({ canUpdate }: { canUpdate: boolean }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const info = useProjectInfo();
  const orgId = info?.org.id;
  const [editing, setEditing] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["integrations", orgId],
    queryFn: () => integrationApi.list(orgId!),
    enabled: Boolean(orgId),
  });
  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const test = useMutation({
    mutationFn: (platform: string) => integrationApi.testConnection(orgId!, platform),
    onSuccess: (r) => message.success(`连接成功：${r.account ?? "ok"}`),
    onError: (e) => message.error(errText(e)),
  });

  return isLoading ? (
    <Spin />
  ) : (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {(data ?? []).map((it) => (
        <IntegrationCard
          key={it.platform}
          item={it}
          canUpdate={canUpdate}
          testing={test.isPending && test.variables === it.platform}
          onTest={() => test.mutate(it.platform)}
          onEdit={() => setEditing(it.platform)}
        />
      ))}
      {editing && orgId && (
        <IntegrationFormModal
          orgId={orgId}
          platform={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["integrations", orgId] });
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  item,
  canUpdate,
  testing,
  onTest,
  onEdit,
}: {
  item: IntegrationView;
  canUpdate: boolean;
  testing: boolean;
  onTest: () => void;
  onEdit: () => void;
}) {
  const meta = PLATFORM_META[item.platform as keyof typeof PLATFORM_META];
  const statusTag = !item.hasCredential ? (
    <Tag>未配置</Tag>
  ) : item.testStatus === "OK" ? (
    <Tag color="success">已配置 · 连接通过</Tag>
  ) : item.testStatus === "FAILED" ? (
    <Tag color="warning">凭据失效</Tag>
  ) : (
    <Tag color="processing">已配置</Tag>
  );
  return (
    <div className="border rounded-md p-3" data-testid={`integration-card-${item.platform}`}>
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium">{meta?.label ?? item.platform}</span>
        <span className="ml-auto">{statusTag}</span>
      </div>
      <div className="text-xs text-gray-400 mb-1 truncate">
        {item.hasCredential ? item.address : "配置后可在项目中关联，双向同步缺陷"}
      </div>
      {item.testMessage && (
        <div className="text-xs text-gray-400 mb-2 truncate">{item.testMessage}</div>
      )}
      {canUpdate && item.hasCredential && (
        <Space>
          <Button
            size="small"
            loading={testing}
            onClick={onTest}
            data-testid={`integration-test-${item.platform}`}
          >
            测试连接
          </Button>
          <Button size="small" onClick={onEdit}>
            编辑
          </Button>
        </Space>
      )}
      {canUpdate && !item.hasCredential && (
        <Button
          size="small"
          type="primary"
          onClick={onEdit}
          data-testid={`integration-config-${item.platform}`}
        >
          配置
        </Button>
      )}
    </div>
  );
}

function IntegrationFormModal({
  orgId,
  platform,
  open,
  onClose,
  onSaved,
}: {
  orgId: string;
  platform: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const meta = PLATFORM_META[platform as keyof typeof PLATFORM_META];
  const [form] = Form.useForm();
  const [bearer, setBearer] = useState(false);

  const save = useMutation({
    mutationFn: (v: { address: string; username?: string; password?: string; token?: string }) =>
      integrationApi.save(orgId, {
        platform,
        address: v.address,
        authType: bearer || !meta?.authTypeFixed ? (bearer ? "BEARER" : "BASIC") : "BASIC",
        ...(v.username !== undefined ? { username: v.username } : {}),
        ...(v.password !== undefined ? { password: v.password } : {}),
        ...(v.token !== undefined ? { token: v.token } : {}),
      }),
    onSuccess: () => {
      message.success("已保存（凭据加密存储）");
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <Modal
      title={`配置 · ${meta?.label ?? platform}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={save.isPending}
      okText="保存"
    >
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <Form.Item
          name="address"
          label="服务地址"
          rules={[
            { required: true, message: "必填" },
            { type: "url", message: "URL 非法" },
          ]}
        >
          <Input placeholder="https://jira.example.com" />
        </Form.Item>
        {platform === "jira" && (
          <Form.Item label="认证方式">
            <Select
              value={bearer ? "bearer" : "basic"}
              onChange={(v) => setBearer(v === "bearer")}
              options={[
                { value: "basic", label: "Basic Auth（用户名 + 密码）" },
                { value: "bearer", label: "Bearer Token" },
              ]}
            />
          </Form.Item>
        )}
        {!bearer && (
          <>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: "必填" }]}>
              <Input autoComplete="new-password" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "必填" }]}>
              <Input.Password autoComplete="new-password" />
            </Form.Item>
          </>
        )}
        {bearer && (
          <Form.Item name="token" label="Token" rules={[{ required: true, message: "必填" }]}>
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        )}
        <Alert
          type="info"
          showIcon
          message="保存后凭据加密落库且不再回显；可点「测试连接」验证（需对应平台插件已启用）"
        />
      </Form>
    </Modal>
  );
}

function ProjectSync({ canUpdate }: { canUpdate: boolean }) {
  const { message } = useApp();
  const { currentProjectId: projectId } = useProjectStore();
  const info = useProjectInfo();
  const orgConfigured = (info?.org.id ?? "") !== "";
  const [form] = Form.useForm();
  const [platform, setPlatform] = useState<string>("jira");

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["sync-config", projectId],
    queryFn: () => integrationApi.getSyncConfig(projectId!),
    enabled: Boolean(projectId),
  });
  const { data: history } = useQuery({
    queryKey: ["sync-history", projectId],
    queryFn: () => integrationApi.syncHistory(projectId!),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!cfg?.platform) return;
    setPlatform(cfg.platform);
    form.setFieldsValue({
      platform: cfg.platform,
      projectKey: cfg.projectKey,
      mode: cfg.mode ?? "INCREMENT",
      cron: cfg.cron ?? "",
      enabled: cfg.enabled,
    });
  }, [cfg, form]);

  const save = useMutation({
    mutationFn: (v: {
      platform: string;
      projectKey: string;
      mode: string;
      cron?: string;
      enabled: boolean;
    }) =>
      integrationApi.saveSyncConfig(projectId!, {
        platform: v.platform,
        projectKey: v.projectKey,
        bugTypes: [{ local: "功能缺陷", platform: platform === "jira" ? "Bug" : "codeerror" }],
        statusMapping: [],
        mode: v.mode === "FULL" ? "FULL" : "INCREMENT",
        cron: v.cron || null,
        enabled: v.enabled,
      }),
    onSuccess: () => message.success("项目关联已保存"),
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const pull = useMutation({
    mutationFn: () => integrationApi.pullBugs(projectId!),
    onSuccess: (r) => message.success(`拉取完成：${r.pulled} 条平台缺陷，回写 ${r.updated} 条`),
    onError: (e) => message.error(e instanceof Error ? e.message : "拉取失败"),
  });

  if (!orgConfigured)
    return <Alert type="info" showIcon message="进入任一项目后配置项目级三方同步" />;
  if (isLoading) return <Spin />;
  const meta = PLATFORM_META[platform as keyof typeof PLATFORM_META];

  return (
    <div className="space-y-4 max-w-[720px]">
      <Form form={form} layout="vertical" onFinish={(v) => save.mutate(v)}>
        <div className="grid grid-cols-2 gap-3">
          <Form.Item name="platform" label="平台" initialValue="jira">
            <Select
              options={PLATFORMS.map((p) => ({ value: p, label: PLATFORM_META[p].label }))}
              onChange={(v) => setPlatform(v)}
              disabled={!canUpdate}
            />
          </Form.Item>
          <Form.Item
            name="projectKey"
            label={meta?.projectKeyLabel ?? "项目 Key"}
            rules={[{ required: true, message: "必填" }]}
          >
            <Input placeholder={meta?.projectKeyHint} disabled={!canUpdate} />
          </Form.Item>
          <Form.Item name="mode" label="同步模式" initialValue="INCREMENT">
            <Select
              options={[
                { value: "INCREMENT", label: "增量（按平台更新时间）" },
                { value: "FULL", label: "全量（FULL）" },
              ]}
              disabled={!canUpdate}
            />
          </Form.Item>
          <Form.Item name="cron" label="定时 cron（可选，最短 5 分钟）">
            <Input placeholder="0 */30 * * * ?" disabled={!canUpdate} />
          </Form.Item>
        </div>
        <Form.Item
          name="enabled"
          label="启用同步（含定时拉取）"
          valuePropName="checked"
          initialValue={false}
        >
          <Switch disabled={!canUpdate} />
        </Form.Item>
        {canUpdate && (
          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              保存关联
            </Button>
            <Button
              loading={pull.isPending}
              onClick={() => pull.mutate()}
              data-testid="integration-pull-btn"
            >
              ⟳ 手动拉取
            </Button>
          </Space>
        )}
      </Form>
      <div>
        <p className="text-sm font-medium mb-2">同步历史（最近 20 次）</p>
        <Table
          rowKey={(r: SyncHistoryEntry) => r.at}
          size="small"
          pagination={false}
          dataSource={history?.list ?? []}
          columns={[
            {
              title: "时间",
              dataIndex: "at",
              render: (v: string) => <span className="text-xs text-gray-400">{fmt(v)}</span>,
            },
            {
              title: "方向",
              dataIndex: "direction",
              render: (v: string) =>
                v === "push" ? <Tag color="blue">推送</Tag> : <Tag>拉取</Tag>,
            },
            {
              title: "来源",
              dataIndex: "trigger",
              render: (v?: string) => <Tag>{v ?? "手动"}</Tag>,
            },
            {
              title: "结果",
              dataIndex: "ok",
              render: (v: boolean, r: SyncHistoryEntry) =>
                v ? (
                  <span className="text-green-600 text-xs">{r.detail}</span>
                ) : (
                  <span className="text-red-500 text-xs">{r.detail}</span>
                ),
            },
            {
              title: "耗时",
              dataIndex: "ms",
              render: (v: number) => <span className="text-xs text-gray-400">{v}ms</span>,
            },
          ]}
        />
      </div>
      <p className="text-xs text-gray-400">
        单条缺陷推送：缺陷列表行「同步」操作（推送创建/更新，platformKey 回写）
      </p>
    </div>
  );
}

// ── SCM-001：代码平台（OAuth 应用）组织覆盖区块 ──

function ScmAppsBlock({ canUpdate }: { canUpdate: boolean }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const info = useProjectInfo();
  const orgId = info?.org.id;
  const [editing, setEditing] = useState<"github" | "gitee" | "gitlab" | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["scm-apps", orgId],
    queryFn: () => scmAppApi.list(orgId!),
    enabled: Boolean(orgId),
  });
  const items = data?.items ?? [];

  const removeOverride = useMutation({
    mutationFn: (provider: "github" | "gitee" | "gitlab") => scmAppApi.remove(orgId!, provider),
    onSuccess: () => {
      message.success("已撤销覆盖（回落继承系统级）");
      void qc.invalidateQueries({ queryKey: ["scm-apps", orgId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  return (
    <div className="border border-[#E5E6EB] rounded-lg p-4 bg-white" data-testid="scm-apps-block">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-medium">代码平台（OAuth 应用）</span>
        <span className="text-xs text-[#8F959E]">
          覆盖后使用组织自己的 OAuth 应用；撤销覆盖回落继承系统级
        </span>
      </div>
      {isLoading ? (
        <Spin />
      ) : (
        <Table
          size="small"
          rowKey="provider"
          pagination={false}
          dataSource={items}
          columns={[
            {
              title: "平台",
              dataIndex: "provider",
              render: (v: string) => SCM_PROVIDER_LABEL[v as "github"] ?? v,
            },
            {
              title: "配置来源",
              dataIndex: "source",
              render: (v: "org" | "system" | "none") =>
                v === "org" ? (
                  <Tag color="purple">组织自定义</Tag>
                ) : v === "system" ? (
                  <Tag color="blue">继承系统级</Tag>
                ) : (
                  <Tag>未配置</Tag>
                ),
            },
            {
              title: "Client ID",
              dataIndex: "clientId",
              render: (v: string) => <span className="text-xs">{v || "—"}</span>,
            },
            {
              title: "实例",
              dataIndex: "baseUrl",
              render: (v: string | null) => <span className="text-xs">{v || "—"}</span>,
            },
            {
              title: "操作",
              render: (_, r: (typeof items)[number]) =>
                canUpdate ? (
                  <Space>
                    {r.source === "org" ? (
                      <>
                        <Button
                          size="small"
                          onClick={() => setEditing(r.provider)}
                          data-testid={`btn-scm-app-edit-${r.provider}`}
                        >
                          编辑
                        </Button>
                        <Popconfirm
                          title="撤销组织覆盖？"
                          description="撤销后本组织授权走系统级应用"
                          onConfirm={() => removeOverride.mutate(r.provider)}
                        >
                          <Button size="small" data-testid={`btn-scm-app-revoke-${r.provider}`}>
                            撤销覆盖
                          </Button>
                        </Popconfirm>
                      </>
                    ) : (
                      <Button
                        size="small"
                        onClick={() => setEditing(r.provider)}
                        data-testid={`btn-scm-app-config-${r.provider}`}
                      >
                        配置覆盖
                      </Button>
                    )}
                  </Space>
                ) : null,
            },
          ]}
        />
      )}
      {editing && orgId && (
        <ScmOrgAppModal
          orgId={orgId}
          provider={editing}
          open
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void qc.invalidateQueries({ queryKey: ["scm-apps", orgId] });
          }}
        />
      )}
    </div>
  );
}

function ScmOrgAppModal({
  orgId,
  provider,
  open,
  onClose,
  onSaved,
}: {
  orgId: string;
  provider: "github" | "gitee" | "gitlab";
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider === "gitlab" ? "https://gitlab.com" : "");

  const save = useMutation({
    mutationFn: () =>
      scmAppApi.save(orgId, provider, {
        clientId: clientId.trim(),
        ...(clientSecret ? { clientSecret } : {}),
        ...(provider === "gitlab" ? { baseUrl: baseUrl.trim() || "https://gitlab.com" } : {}),
        enabled: true,
      }),
    onSuccess: () => {
      message.success("组织覆盖已保存");
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <Modal
      title={`配置覆盖 · ${SCM_PROVIDER_LABEL[provider]}`}
      open={open}
      onCancel={onClose}
      onOk={() => save.mutate()}
      confirmLoading={save.isPending}
      okText="保存"
      okButtonProps={{ disabled: !clientId.trim() }}
      data-testid={`modal-scm-app-${provider}`}
    >
      <Form layout="vertical">
        <Form.Item label="Client ID" required>
          <Input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            data-testid={`input-org-client-id-${provider}`}
          />
        </Form.Item>
        <Form.Item label="Client Secret">
          <Input.Password
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="留空＝不修改"
            autoComplete="new-password"
          />
        </Form.Item>
        {provider === "gitlab" && (
          <Form.Item label="实例地址">
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://gitlab.com 或自建地址"
            />
          </Form.Item>
        )}
        <Alert
          type="info"
          showIcon
          message="覆盖后本组织授权走该应用；「撤销覆盖」恢复继承系统级配置。"
        />
      </Form>
    </Modal>
  );
}
