"use client";

import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ssoApi, type AuthSourceRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useEntp } from "@/hooks/useEntp";
import { Lock } from "lucide-react";

/** ENTP-002 认证配置：认证源 CRUD（分类型表单）+ 测试连接；SSO 特性门控。 */

type SourceType = AuthSourceRow["type"];

const TYPE_META: Record<
  Exclude<SourceType, "SAML">,
  { label: string; color: string; form: "oidc" | "ldap" | "cas" | "scan" }
> = {
  OIDC: { label: "OIDC", color: "geekblue", form: "oidc" },
  OAUTH2: { label: "OAuth2", color: "blue", form: "oidc" },
  CAS: { label: "CAS", color: "cyan", form: "cas" },
  LDAP: { label: "LDAP", color: "gold", form: "ldap" },
  WECOM: { label: "企微扫码", color: "green", form: "scan" },
  DINGTALK: { label: "钉钉扫码", color: "blue", form: "scan" },
  FEISHU: { label: "飞书扫码", color: "cyan", form: "scan" },
};

const TYPE_OPTIONS: { value: SourceType; label: string; disabled?: boolean }[] = [
  { value: "LDAP", label: "LDAP（目录）" },
  { value: "CAS", label: "CAS" },
  { value: "OIDC", label: "OIDC" },
  { value: "OAUTH2", label: "OAuth2" },
  { value: "SAML", label: "SAML（未实现）", disabled: true },
  { value: "WECOM", label: "企微（扫码）" },
  { value: "DINGTALK", label: "钉钉（扫码）" },
  { value: "FEISHU", label: "飞书（扫码）" },
];

interface FormState {
  type: SourceType;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

const emptyForm = (type: SourceType): FormState => ({
  type,
  name: "",
  enabled: true,
  config:
    type === "LDAP"
      ? {
          host: "",
          port: 389,
          bindDn: "",
          bindPassword: "",
          userOu: "",
          filterKey: "uid",
          propMapping: { username: "uid", name: "cn", email: "mail" },
        }
      : type === "CAS"
        ? { serverUrl: "", propMapping: { username: "username", name: "name", email: "email" } }
        : type === "WECOM"
          ? { corpId: "", agentId: "", secret: "", redirectDomain: "" }
          : type === "DINGTALK"
            ? { clientId: "", agentId: "", clientSecret: "", callbackDomain: "" }
            : type === "FEISHU"
              ? { appId: "", appSecret: "", redirectUrl: "" }
              : {
                  authEndpoint: "",
                  tokenEndpoint: "",
                  userinfoEndpoint: "",
                  clientId: "",
                  clientSecret: "",
                  scope: "openid profile email",
                  propMapping: { username: "preferred_username", name: "name", email: "email" },
                },
});

export default function SsoPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { canGlobal } = usePermissions();
  const canRead = canGlobal("ENTP_SSO:READ");
  const canWrite = canGlobal("ENTP_SSO:UPDATE");
  const entp = useEntp();
  const enabled = entp.can("SSO");

  const [editingId, setEditingId] = useState<string | null>(null); // null=新建
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm("OIDC"));
  const [testResult, setTestResult] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["system-sso"],
    queryFn: () => ssoApi.list(),
    enabled: canRead && enabled,
  });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["system-sso"] });

  const saveMut = useMutation({
    mutationFn: () => (editingId ? ssoApi.update(editingId, form) : ssoApi.create(form)),
    onSuccess: () => {
      message.success("认证源已保存");
      setOpen(false);
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => ssoApi.remove(id),
    onSuccess: () => {
      message.success("已删除（登录页入口即时消失）");
      refresh();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const testMut = useMutation({
    mutationFn: (id: string) => ssoApi.testConnection(id),
    onSuccess: (r) => {
      setTestResult(`${r.ok ? "✓" : "✗"} ${r.message}`);
      r.ok ? message.success(r.message) : message.error(r.message);
    },
    onError: (e) => setTestResult(`✗ ${e instanceof Error ? e.message : "测试失败"}`),
  });

  const setCfg = (patch: Record<string, unknown>) =>
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } }));
  const setMapping = (key: string, value: string) =>
    setCfg({ propMapping: { ...((form.config.propMapping as object) ?? {}), [key]: value } });

  if (!canRead || !enabled) {
    return (
      <div>
        <PageHeader title="认证配置" sub="系统 › 认证配置" />
        <Empty
          className="py-24"
          description={
            canRead ? "单点认证（SSO）为企业版能力（License · SSO）" : "无访问权限（ENTP_SSO:READ）"
          }
        />
      </div>
    );
  }

  const meta = TYPE_META[form.type as Exclude<SourceType, "SAML">];
  const cfg = form.config as Record<string, string>;
  const callback =
    form.type === "OIDC" || form.type === "OAUTH2"
      ? `/api/v1/auth/sso/{authId}/${form.type.toLowerCase()}/callback`
      : form.type === "CAS"
        ? "/api/v1/auth/sso/{authId}/cas/callback"
        : `/api/v1/auth/sso/{authId}/${meta.form === "scan" ? form.type.toLowerCase() : "{type}"}/callback`;

  return (
    <div>
      <PageHeader
        title="认证配置"
        sub="系统 › 认证配置 · 启用后登录页呈现「更多登录方式」"
        extra={
          canWrite && (
            <Button
              type="primary"
              onClick={() => {
                setEditingId(null);
                setForm(emptyForm("OIDC"));
                setTestResult(null);
                setOpen(true);
              }}
              data-testid="btn-new-sso"
            >
              ＋ 新建认证源
            </Button>
          )
        }
      />

      <div className="rabbit-card">
        <Table
          rowKey="id"
          loading={listQ.isLoading}
          dataSource={listQ.data?.items ?? []}
          data-testid="sso-sources-table"
          pagination={false}
          columns={[
            { title: "名称", dataIndex: "name" },
            {
              title: "类型",
              dataIndex: "type",
              width: 110,
              render: (v: SourceType) =>
                v === "SAML" ? (
                  <Tag bordered={false}>SAML</Tag>
                ) : (
                  <Tag color={TYPE_META[v].color} bordered={false}>
                    {TYPE_META[v].label}
                  </Tag>
                ),
            },
            {
              title: "配置摘要",
              key: "summary",
              render: (_, r) => (
                <span className="font-mono text-xs text-[#87888D]">
                  {r.type === "LDAP"
                    ? `${r.config.host}:${r.config.port}`
                    : r.type === "CAS"
                      ? String(r.config.serverUrl ?? "")
                      : r.type === "OIDC" || r.type === "OAUTH2"
                        ? String(r.config.authEndpoint ?? "")
                        : String(r.config.corpId ?? r.config.clientId ?? r.config.appId ?? "")}
                </span>
              ),
            },
            {
              title: "启用",
              dataIndex: "enabled",
              width: 90,
              render: (v: boolean, r) => (
                <Switch
                  size="small"
                  checked={v}
                  disabled={!canWrite}
                  onChange={(checked) =>
                    ssoApi
                      .update(r.id, { ...r, enabled: checked })
                      .then(refresh)
                      .catch((e) => message.error(String(e)))
                  }
                />
              ),
            },
            {
              title: "操作",
              key: "ops",
              width: 200,
              render: (_, r) => (
                <Space size={4}>
                  <a
                    className="text-[13px] text-[#574BFF]"
                    onClick={() => {
                      setEditingId(r.id);
                      setForm({ type: r.type, name: r.name, enabled: r.enabled, config: r.config });
                      setTestResult(null);
                      setOpen(true);
                    }}
                    data-testid={`btn-edit-sso-${r.id}`}
                  >
                    编辑
                  </a>
                  <a
                    className="text-[13px] text-[#574BFF]"
                    onClick={() => testMut.mutate(r.id)}
                    data-testid={`btn-test-sso-${r.id}`}
                  >
                    测试连接
                  </a>
                  <Popconfirm title="删除该认证源？" onConfirm={() => removeMut.mutate(r.id)}>
                    <a className="text-[13px] text-red-500">删除</a>
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </div>
      {testResult && (
        <Alert
          className="mt-3"
          type={testResult.startsWith("✓") ? "success" : "error"}
          message={testResult}
          closable
          onClose={() => setTestResult(null)}
        />
      )}

      {/* 新建/编辑弹窗 */}
      <Modal
        title={editingId ? "编辑认证源" : "新建认证源"}
        open={open}
        width={640}
        onCancel={() => setOpen(false)}
        okText="保 存"
        confirmLoading={saveMut.isPending}
        okButtonProps={{ disabled: !form.name.trim() }}
        onOk={() => saveMut.mutate()}
      >
        <div className="space-y-3 py-1 text-[13px]">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[#646A73] text-xs mb-1">类型</p>
              <Select
                className="w-full"
                value={form.type}
                disabled={Boolean(editingId)}
                options={TYPE_OPTIONS}
                onChange={(v) => setForm(emptyForm(v))}
                data-testid="select-sso-type"
              />
            </div>
            <div>
              <p className="text-[#646A73] text-xs mb-1">名称</p>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="如：公司 Keycloak"
                data-testid="input-sso-name"
              />
            </div>
          </div>

          {meta.form === "oidc" && (
            <>
              <div>
                <p className="text-[#646A73] text-xs mb-1">授权端点</p>
                <Input
                  className="font-mono text-xs"
                  value={cfg.authEndpoint ?? ""}
                  onChange={(e) => setCfg({ authEndpoint: e.target.value })}
                  data-testid="input-sso-auth-endpoint"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[#646A73] text-xs mb-1">Token 端点</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.tokenEndpoint ?? ""}
                    onChange={(e) => setCfg({ tokenEndpoint: e.target.value })}
                  />
                </div>
                <div>
                  <p className="text-[#646A73] text-xs mb-1">用户信息端点</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.userinfoEndpoint ?? ""}
                    onChange={(e) => setCfg({ userinfoEndpoint: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[#646A73] text-xs mb-1">Client ID</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.clientId ?? ""}
                    onChange={(e) => setCfg({ clientId: e.target.value })}
                  />
                </div>
                <div>
                  <p className="text-[#646A73] text-xs mb-1">Client Secret</p>
                  <Input.Password
                    className="font-mono text-xs"
                    value={cfg.clientSecret ?? ""}
                    onChange={(e) => setCfg({ clientSecret: e.target.value })}
                    data-testid="input-sso-client-secret"
                  />
                </div>
              </div>
            </>
          )}
          {meta.form === "cas" && (
            <div>
              <p className="text-[#646A73] text-xs mb-1">CAS 服务端地址</p>
              <Input
                className="font-mono text-xs"
                value={cfg.serverUrl ?? ""}
                onChange={(e) => setCfg({ serverUrl: e.target.value })}
              />
            </div>
          )}
          {meta.form === "ldap" && (
            <>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <p className="text-[#646A73] text-xs mb-1">地址</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.host ?? ""}
                    onChange={(e) => setCfg({ host: e.target.value })}
                  />
                </div>
                <div>
                  <p className="text-[#646A73] text-xs mb-1">端口</p>
                  <Input
                    className="font-mono text-xs"
                    value={String(cfg.port ?? 389)}
                    onChange={(e) => setCfg({ port: Number(e.target.value) || 389 })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[#646A73] text-xs mb-1">绑定 DN</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.bindDn ?? ""}
                    onChange={(e) => setCfg({ bindDn: e.target.value })}
                  />
                </div>
                <div>
                  <p className="text-[#646A73] text-xs mb-1">绑定密码</p>
                  <Input.Password
                    className="font-mono text-xs"
                    value={cfg.bindPassword ?? ""}
                    onChange={(e) => setCfg({ bindPassword: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[#646A73] text-xs mb-1">用户 OU</p>
                  <Input
                    className="font-mono text-xs"
                    value={cfg.userOu ?? ""}
                    onChange={(e) => setCfg({ userOu: e.target.value })}
                  />
                </div>
                <div>
                  <p className="text-[#646A73] text-xs mb-1">过滤器键</p>
                  <Select
                    className="w-full"
                    value={String(cfg.filterKey ?? "uid")}
                    onChange={(v) => setCfg({ filterKey: v })}
                    options={[
                      { value: "uid", label: "uid" },
                      { value: "sAMAccountName", label: "sAMAccountName" },
                      { value: "cn", label: "cn" },
                    ]}
                  />
                </div>
              </div>
            </>
          )}
          {meta.form === "scan" && (
            <>
              {form.type === "WECOM" && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">企业 ID</p>
                    <Input
                      className="font-mono text-xs"
                      value={cfg.corpId ?? ""}
                      onChange={(e) => setCfg({ corpId: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">AgentId</p>
                    <Input
                      className="font-mono text-xs"
                      value={cfg.agentId ?? ""}
                      onChange={(e) => setCfg({ agentId: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">Secret</p>
                    <Input.Password
                      className="font-mono text-xs"
                      value={cfg.secret ?? ""}
                      onChange={(e) => setCfg({ secret: e.target.value })}
                    />
                  </div>
                </div>
              )}
              {form.type === "DINGTALK" && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">Client ID</p>
                    <Input
                      className="font-mono text-xs"
                      value={cfg.clientId ?? ""}
                      onChange={(e) => setCfg({ clientId: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">AgentId</p>
                    <Input
                      className="font-mono text-xs"
                      value={cfg.agentId ?? ""}
                      onChange={(e) => setCfg({ agentId: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">Client Secret</p>
                    <Input.Password
                      className="font-mono text-xs"
                      value={cfg.clientSecret ?? ""}
                      onChange={(e) => setCfg({ clientSecret: e.target.value })}
                    />
                  </div>
                </div>
              )}
              {form.type === "FEISHU" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">App ID</p>
                    <Input
                      className="font-mono text-xs"
                      value={cfg.appId ?? ""}
                      onChange={(e) => setCfg({ appId: e.target.value })}
                    />
                  </div>
                  <div>
                    <p className="text-[#646A73] text-xs mb-1">App Secret</p>
                    <Input.Password
                      className="font-mono text-xs"
                      value={cfg.appSecret ?? ""}
                      onChange={(e) => setCfg({ appSecret: e.target.value })}
                    />
                  </div>
                </div>
              )}
              <p className="text-xs text-[#A8ABB0]">
                凭据在登录链路验证（测试连接只做配置完整性检查）；可信 IP/通讯录权限为平台侧配置
              </p>
            </>
          )}

          {(meta.form === "oidc" || meta.form === "cas" || meta.form === "ldap") && (
            <div className="border rounded p-2 bg-slate-50 space-y-2">
              <p className="text-[#646A73] text-xs">
                属性映射（IdP 属性 → 本站字段；username/email 必填）
              </p>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  用户名
                  <br />
                  <Input
                    className="font-mono text-xs mt-1"
                    value={(form.config.propMapping as Record<string, string>)?.username ?? ""}
                    onChange={(e) => setMapping("username", e.target.value)}
                  />
                </div>
                <div>
                  姓名
                  <br />
                  <Input
                    className="font-mono text-xs mt-1"
                    value={(form.config.propMapping as Record<string, string>)?.name ?? ""}
                    onChange={(e) => setMapping("name", e.target.value)}
                  />
                </div>
                <div>
                  邮箱
                  <br />
                  <Input
                    className="font-mono text-xs mt-1"
                    value={(form.config.propMapping as Record<string, string>)?.email ?? ""}
                    onChange={(e) => setMapping("email", e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="border rounded p-2 text-[11px] text-[#646A73] bg-slate-50">
            回调地址（配置到 IdP/平台）：
            <Typography.Text
              copyable={{ text: `{站点URL}${callback}` }}
              className="font-mono text-[11px] text-[#574BFF]"
            >
              {callback}
            </Typography.Text>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#646A73] text-xs">启用</span>
            <Switch
              size="small"
              checked={form.enabled}
              onChange={(v) => setForm({ ...form, enabled: v })}
            />
            <span className="text-[11px] text-[#A8ABB0]">禁用源即时从登录页消失</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
