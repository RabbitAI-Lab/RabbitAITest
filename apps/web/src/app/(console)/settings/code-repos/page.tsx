"use client";

import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Radio,
  Select,
  Spin,
  Table,
  Tabs,
  Tag,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  scmAccountApi,
  scmAppApi,
  scmRepoApi,
  type ScmAccountRepoView,
  type ScmAccountView,
  type ScmRepoView,
} from "@rabbit/api-client";
import {
  SCM_PROVIDER_LABEL,
  type ScmAuthType,
  type ScmOauthProvider,
  type ScmProvider,
} from "@rabbit/shared";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const OAUTH_PROVIDERS: ScmOauthProvider[] = ["github", "gitee", "gitlab"];
const URL_PROVIDERS: ScmProvider[] = ["github", "gitee", "gitlab", "gitea", "custom"];
const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");

/** 平台徽标色（对齐原型：GH 黑 / Gitee 红 / GL 橙 / Gitea 绿 / 自建灰） */
const PROVIDER_TAG: Record<ScmProvider, { bg: string; abbr: string }> = {
  github: { bg: "#1F2329", abbr: "GH" },
  gitee: { bg: "#C71D23", abbr: "G" },
  gitlab: { bg: "#FC6D26", abbr: "GL" },
  gitea: { bg: "#609926", abbr: "GT" },
  custom: { bg: "#8F959E", abbr: "其" },
};

function ProviderBadge({ provider }: { provider: ScmProvider }) {
  const t = PROVIDER_TAG[provider];
  return (
    <span
      className="w-6 h-6 rounded text-white text-[10px] font-bold inline-flex items-center justify-center shrink-0"
      style={{ background: t.bg }}
      data-testid={`provider-badge-${provider}`}
    >
      {t.abbr}
    </span>
  );
}

function VerifyStatusTag({ row }: { row: ScmRepoView }) {
  if (row.verifyStatus === "OK") return <Tag color="success">已连接</Tag>;
  if (row.verifyStatus === "INVALID_CRED") return <Tag color="error">凭据失效</Tag>;
  if (row.verifyStatus === "FAILED") return <Tag color="error">验证失败</Tag>;
  return <Tag>未验证</Tag>;
}

function authTypeText(row: ScmRepoView): string {
  if (row.authType === "oauth") return `OAuth · ${row.accountLogin ?? "已授权账号"}`;
  if (row.authType === "token") return `Token${row.hasSecret ? " · 已配置" : ""}`;
  if (row.authType === "password") return `账密 · ${row.username ?? ""}`;
  return "公开（无凭据）";
}

/** 按官方域自动识别平台（识别不出返回 null=用户手选）。 */
function detectProvider(url: string): ScmProvider | null {
  const u = url.trim();
  if (/^(https?:\/\/)?(www\.)?github\.com\//i.test(u) || /^git@github\.com:/i.test(u))
    return "github";
  if (/^(https?:\/\/)?(www\.)?gitee\.com\//i.test(u) || /^git@gitee\.com:/i.test(u)) return "gitee";
  if (/^(https?:\/\/)?(www\.)?gitlab\.com\//i.test(u) || /^git@gitlab\.com:/i.test(u))
    return "gitlab";
  return null;
}

/** SCM-001：项目设置 › 代码仓库（OAuth 选仓 + URL 直填 + 验证 + 默认互斥 + 授权账号管理）。 */
export default function CodeReposPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const info = useProjectInfo();
  const orgId = info?.org.id;
  const canUpdate = can("PROJECT_REPO:CREATE");
  const canDelete = can("PROJECT_REPO:DELETE");

  const [addOpen, setAddOpen] = useState(false);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [editing, setEditing] = useState<ScmRepoView | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["scm-repos", projectId],
    queryFn: () => scmRepoApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const repos = data?.items ?? [];

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["scm-repos", projectId] });
  };

  // OAuth 回跳结果（/settings/code-repos?oauth={provider}&result=ok|fail&message=…）
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const provider = q.get("oauth");
    const result = q.get("result");
    if (!provider || !result) return;
    if (result === "ok") message.success(`${SCM_PROVIDER_LABEL[provider as ScmProvider]} 授权成功`);
    else message.error(`授权失败：${q.get("message") ?? "未知错误"}`);
    window.history.replaceState(null, "", "/settings/code-repos");
    void qc.invalidateQueries({ queryKey: ["scm-accounts", orgId] });
  }, [message, qc, orgId]);

  const verify = useMutation({
    mutationFn: (repoId: string) => scmRepoApi.verify(projectId!, repoId),
    onSuccess: (r) => {
      invalidate();
      if (r.status === "OK") {
        message.success(
          `验证成功${r.defaultBranch ? `（默认分支 ${r.defaultBranch}）` : ""}${
            r.latestCommit ? `· 最近提交：${r.latestCommit.message}` : ""
          }`,
        );
      }
    },
    onError: (e) => {
      invalidate();
      message.error(e instanceof Error ? e.message : "验证失败");
    },
  });

  const setDefault = useMutation({
    mutationFn: (repoId: string) => scmRepoApi.update(projectId!, repoId, { isDefault: true }),
    onSuccess: () => {
      invalidate();
      message.success("已设为默认仓库");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });

  const remove = useMutation({
    mutationFn: (repoId: string) => scmRepoApi.remove(projectId!, repoId),
    onSuccess: () => {
      invalidate();
      message.success("已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  if (!projectId) {
    return (
      <div>
        <PageHeader title="代码仓库" sub="项目设置" />
        <Empty className="py-24" description="请先选择项目" />
      </div>
    );
  }

  return (
    <div className="p-4" data-testid="page-settings-code-repos">
      <PageHeader
        title="代码仓库"
        sub="绑定项目对应的代码仓库：平台授权直接选择，或填写 https / ssh 地址；支持 Token、账号密码与匿名访问"
        extra={
          <div className="flex items-center gap-2">
            {canUpdate && (
              <Button onClick={() => setAccountsOpen(true)} data-testid="btn-manage-accounts">
                授权账号
              </Button>
            )}
            {canUpdate && (
              <Button type="primary" onClick={() => setAddOpen(true)} data-testid="btn-add-repo">
                添加仓库
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Spin />
        </div>
      ) : repos.length === 0 ? (
        <div
          className="border border-dashed border-[#DEE0E3] rounded-lg py-16 text-center"
          data-testid="empty-code-repos"
        >
          <p className="font-medium">还没有绑定代码仓库</p>
          <p className="text-xs text-[#8F959E] mt-1">
            通过平台授权直接选择仓库，或填写 https / ssh 地址绑定
          </p>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))" }}
        >
          {repos.map((row) => (
            <div
              key={row.id}
              className="border border-[#E5E6EB] rounded-lg p-4 bg-white"
              data-testid={`repo-card-${row.owner}-${row.repo}`}
            >
              <div className="flex items-center gap-2">
                <ProviderBadge provider={row.provider} />
                <span className="font-medium">{row.name ?? row.repo}</span>
                <span className="text-[#8F959E] truncate">
                  {row.owner}/{row.repo}
                </span>
                {row.isDefault && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-[#574BFF]/10 text-[#574BFF] font-medium border border-[#574BFF]/25">
                    默认
                  </span>
                )}
              </div>
              <div className="mt-2 text-xs text-[#646A73] truncate" title={row.repoUrl}>
                {row.repoUrl}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-[#F2F3F5] text-[#3D4350]">
                  {authTypeText(row)}
                </span>
                {row.visibility && (
                  <span className="px-1.5 py-0.5 rounded bg-[#F2F3F5] text-[#3D4350]">
                    {row.visibility === "private"
                      ? "私有"
                      : row.visibility === "internal"
                        ? "内部"
                        : "公开"}
                  </span>
                )}
                {row.defaultBranch && (
                  <span className="px-1.5 py-0.5 rounded bg-[#F2F3F5] text-[#3D4350]">
                    默认分支 {row.defaultBranch}
                  </span>
                )}
                <span className="ml-auto">
                  <VerifyStatusTag row={row} />
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-[#F0F1F5] flex items-center text-xs text-[#8F959E]">
                <span>
                  {row.lastVerifiedAt ? `验证于 ${fmt(row.lastVerifiedAt)}` : "尚未验证"}
                  {row.verifyMessage && row.verifyStatus !== "OK" ? ` · ${row.verifyMessage}` : ""}
                </span>
                {canUpdate && (
                  <span className="ml-auto flex gap-1">
                    <Button
                      size="small"
                      loading={verify.isPending && verify.variables === row.id}
                      onClick={() => verify.mutate(row.id)}
                      data-testid={`btn-verify-${row.repo}`}
                    >
                      验证
                    </Button>
                    {!row.isDefault && (
                      <Button
                        size="small"
                        onClick={() => setDefault.mutate(row.id)}
                        data-testid={`btn-set-default-${row.repo}`}
                      >
                        设为默认
                      </Button>
                    )}
                    <Button
                      size="small"
                      onClick={() => setEditing(row)}
                      data-testid={`btn-edit-${row.repo}`}
                    >
                      编辑
                    </Button>
                    {canDelete && (
                      <Popconfirm
                        title={`删除仓库 ${row.owner}/${row.repo}？`}
                        description="仅解除绑定（软删），不影响平台仓库"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutate(row.id)}
                      >
                        <Button size="small" danger data-testid={`btn-delete-${row.repo}`}>
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {addOpen && orgId && (
        <AddRepoDrawer
          orgId={orgId}
          projectId={projectId}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            invalidate();
          }}
        />
      )}
      {accountsOpen && orgId && (
        <AccountsModal orgId={orgId} onClose={() => setAccountsOpen(false)} />
      )}
      {editing && (
        <EditRepoModal
          row={editing}
          projectId={projectId}
          orgId={orgId ?? ""}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

// ── 添加仓库抽屉（平台授权 | 仓库地址） ──

function AddRepoDrawer({
  orgId,
  projectId,
  onClose,
  onSaved,
}: {
  orgId: string;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const [mode, setMode] = useState<"oauth" | "url">("oauth");

  // 平台授权 tab
  const { data: accountsData, isLoading: accountsLoading } = useQuery({
    queryKey: ["scm-accounts", orgId],
    queryFn: () => scmAccountApi.list(orgId),
  });
  const accounts = (accountsData?.items ?? []).filter((a) => a.status === "ACTIVE");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<ScmAccountRepoView | null>(null);
  const { data: reposData, isFetching: reposLoading } = useQuery({
    queryKey: ["scm-account-repos", orgId, accountId, keyword],
    queryFn: () =>
      scmAccountApi.repos(orgId, accountId!, { keyword: keyword || undefined, pageSize: 50 }),
    enabled: Boolean(accountId),
  });
  const accountRepos = reposData?.items ?? [];

  // 仓库地址 tab
  const [repoUrl, setRepoUrl] = useState("");
  const [provider, setProvider] = useState<ScmProvider>("github");
  const [authType, setAuthType] = useState<ScmAuthType>("token");
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    if (accounts.length > 0 && !accountId && mode === "oauth") setAccountId(accounts[0]!.id);
  }, [accounts, accountId, mode]);

  useEffect(() => {
    if (mode !== "url") return;
    const detected = detectProvider(repoUrl);
    if (detected && detected !== provider) setProvider(detected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl]);

  const create = useMutation({
    mutationFn: () => {
      if (mode === "oauth") {
        if (!accountId || !selected) throw new Error("请先选择授权账号与仓库");
        return scmRepoApi.create(projectId, {
          source: "oauth",
          accountId,
          owner: selected.owner,
          repo: selected.repo,
          name: name || undefined,
        });
      }
      return scmRepoApi.create(projectId, {
        source: "url",
        provider,
        repoUrl: repoUrl.trim(),
        authType,
        ...(authType === "token" && token ? { token } : {}),
        ...(authType === "password" && username ? { username } : {}),
        ...(authType === "password" && password ? { password } : {}),
        name: name || undefined,
      });
    },
    onSuccess: () => {
      message.success("仓库已绑定");
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "绑定失败"),
  });

  const startAuthorize = (p: ScmOauthProvider) => {
    window.location.href = scmAppApi.oauthStartUrl(orgId, p);
  };

  return (
    <Drawer
      title="添加仓库"
      open
      width={560}
      onClose={onClose}
      destroyOnClose
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={create.isPending}
            disabled={mode === "oauth" ? !selected : !repoUrl.trim()}
            onClick={() => create.mutate()}
            data-testid="btn-confirm-add-repo"
          >
            确定
          </Button>
        </div>
      }
      data-testid="drawer-add-repo"
    >
      <Tabs
        activeKey={mode}
        onChange={(k) => setMode(k as "oauth" | "url")}
        items={[
          {
            key: "oauth",
            label: "平台授权",
            forceRender: true,
            children: (
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] mb-1">授权账号</label>
                  {accountsLoading ? (
                    <Spin />
                  ) : accounts.length === 0 ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-[#8F959E]">组织内暂无授权账号，先授权：</span>
                      {OAUTH_PROVIDERS.map((p) => (
                        <Button
                          key={p}
                          size="small"
                          onClick={() => startAuthorize(p)}
                          data-testid={`btn-authorize-${p}`}
                        >
                          {SCM_PROVIDER_LABEL[p]}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Select
                        className="flex-1"
                        value={accountId ?? undefined}
                        onChange={(v) => {
                          setAccountId(v);
                          setSelected(null);
                        }}
                        options={accounts.map((a) => ({
                          value: a.id,
                          label: `${SCM_PROVIDER_LABEL[a.provider]} · ${a.login}（由 ${a.createdByName ?? "成员"} 授权）`,
                        }))}
                        data-testid="select-oauth-account"
                      />
                      {OAUTH_PROVIDERS.map((p) => (
                        <Button
                          key={p}
                          size="small"
                          onClick={() => startAuthorize(p)}
                          title={`授权新的 ${SCM_PROVIDER_LABEL[p]} 账号`}
                        >
                          {SCM_PROVIDER_LABEL[p]}
                        </Button>
                      ))}
                    </div>
                  )}
                </div>
                {accountId && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <Input
                        className="w-64"
                        allowClear
                        placeholder="搜索仓库（owner / 名称）"
                        value={keyword}
                        onChange={(e) => setKeyword(e.target.value)}
                        data-testid="input-repo-search"
                      />
                      <span className="text-xs text-[#8F959E]">
                        共 {reposData?.total ?? 0} 个可访问仓库
                      </span>
                    </div>
                    <Table
                      size="small"
                      rowKey={(r) => `${r.owner}/${r.repo}`}
                      loading={reposLoading}
                      dataSource={accountRepos}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      rowClassName={(r) =>
                        selected && `${r.owner}/${r.repo}` === `${selected.owner}/${selected.repo}`
                          ? "bg-[#574BFF]/[0.04]"
                          : ""
                      }
                      onRow={(r) => ({
                        onClick: () => setSelected(r),
                        style: { cursor: "pointer" },
                      })}
                      columns={[
                        {
                          title: "仓库",
                          render: (_, r: ScmAccountRepoView) => (
                            <span
                              className={
                                selected &&
                                `${r.owner}/${r.repo}` === `${selected.owner}/${selected.repo}`
                                  ? "font-medium text-[#574BFF]"
                                  : ""
                              }
                              data-testid={`oauth-repo-${r.owner}-${r.repo}`}
                            >
                              {r.owner}/{r.repo}
                            </span>
                          ),
                        },
                        {
                          title: "可见性",
                          dataIndex: "visibility",
                          width: 72,
                          render: (v: string) =>
                            v === "private" ? (
                              <span className="text-xs">私有</span>
                            ) : v === "internal" ? (
                              <span className="text-xs">内部</span>
                            ) : (
                              <span className="text-xs text-[#34C724]">公开</span>
                            ),
                        },
                        {
                          title: "默认分支",
                          dataIndex: "defaultBranch",
                          width: 96,
                          render: (v: string | null) => <span className="text-xs">{v ?? "—"}</span>,
                        },
                      ]}
                    />
                  </div>
                )}
                <div>
                  <label className="block text-[13px] mb-1">备注名（可选）</label>
                  <Input
                    className="w-64"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={128}
                    placeholder="展示在仓库卡片，默认 owner/repo"
                  />
                </div>
              </div>
            ),
          },
          {
            key: "url",
            label: "仓库地址",
            forceRender: true,
            children: (
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] mb-1">
                    仓库地址（https 或 ssh） <span className="text-[#FF4D4F]">*</span>
                  </label>
                  <Input
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo.git 或 git@github.com:owner/repo.git"
                    data-testid="input-repo-url"
                  />
                  <div className="mt-1 text-xs text-[#8F959E]">
                    {repoUrl.trim()
                      ? detectProvider(repoUrl)
                        ? `已识别平台：${SCM_PROVIDER_LABEL[detectProvider(repoUrl)!]}`
                        : "未识别出官方平台，请确认下方平台选择（自建/其他＝仅保存不验证）"
                      : "按官方域名自动识别平台"}
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] mb-1">平台</label>
                  <Select
                    className="w-64"
                    value={provider}
                    onChange={(v) => setProvider(v)}
                    options={URL_PROVIDERS.map((p) => ({ value: p, label: SCM_PROVIDER_LABEL[p] }))}
                    data-testid="select-scm-provider"
                  />
                </div>
                <div>
                  <label className="block text-[13px] mb-1">认证方式</label>
                  <Radio.Group
                    value={authType}
                    onChange={(e) => setAuthType(e.target.value as ScmAuthType)}
                    options={[
                      { value: "none", label: "无凭据（公开仓库）" },
                      { value: "token", label: "Token" },
                      { value: "password", label: "账号密码" },
                    ]}
                    data-testid="radio-auth-type"
                  />
                </div>
                {authType === "token" && (
                  <div>
                    <label className="block text-[13px] mb-1">
                      访问令牌（PAT） <span className="text-[#FF4D4F]">*</span>
                    </label>
                    <Input.Password
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      autoComplete="new-password"
                      data-testid="input-scm-token"
                    />
                    <div className="mt-1 text-xs text-[#8F959E]">加密存储 · 永不回显</div>
                  </div>
                )}
                {authType === "password" && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[13px] mb-1">
                        用户名 <span className="text-[#FF4D4F]">*</span>
                      </label>
                      <Input
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        data-testid="input-scm-username"
                      />
                    </div>
                    <div>
                      <label className="block text-[13px] mb-1">
                        密码 <span className="text-[#FF4D4F]">*</span>
                      </label>
                      <Input.Password
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        data-testid="input-scm-password"
                      />
                    </div>
                    <div className="col-span-2 text-xs text-[#8F959E]">
                      账密验证支持：Gitea、Gitee；GitHub / GitLab 的 API
                      不支持账密——可保存，验证时将提示改用 Token。
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[13px] mb-1">备注名（可选）</label>
                  <Input
                    className="w-64"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={128}
                    placeholder="展示在仓库卡片，默认 owner/repo"
                    data-testid="input-repo-name"
                  />
                </div>
              </div>
            ),
          },
        ]}
      />
    </Drawer>
  );
}

// ── 授权账号管理弹窗 ──

function AccountsModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { message } = useApp();
  const { data, isLoading } = useQuery({
    queryKey: ["scm-accounts", orgId],
    queryFn: () => scmAccountApi.list(orgId),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => scmAccountApi.revoke(orgId, id),
    onSuccess: () => {
      message.success("已撤销");
      void qc.invalidateQueries({ queryKey: ["scm-accounts", orgId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "撤销失败"),
  });
  return (
    <Modal
      title="授权账号"
      open
      onCancel={onClose}
      footer={null}
      width={680}
      data-testid="modal-scm-accounts"
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-[#8F959E]">授权新账号（跳转平台授权页）：</span>
        {OAUTH_PROVIDERS.map((p) => (
          <Button
            key={p}
            size="small"
            onClick={() => {
              window.location.href = scmAppApi.oauthStartUrl(orgId, p);
            }}
            data-testid={`btn-authorize-new-${p}`}
          >
            {SCM_PROVIDER_LABEL[p]}
          </Button>
        ))}
      </div>
      {isLoading ? (
        <Spin />
      ) : (
        <Table
          size="small"
          rowKey="id"
          dataSource={data?.items ?? []}
          pagination={false}
          columns={[
            {
              title: "平台",
              dataIndex: "provider",
              render: (v: ScmOauthProvider) => <ProviderBadge provider={v} />,
            },
            {
              title: "账号",
              render: (_, r: ScmAccountView) => `${r.login}${r.name ? `（${r.name}）` : ""}`,
            },
            { title: "授权人", dataIndex: "createdByName" },
            {
              title: "授权时间",
              dataIndex: "createdAt",
              render: (v: string) => <span className="text-xs text-[#8F959E]">{fmt(v)}</span>,
            },
            {
              title: "状态",
              dataIndex: "status",
              render: (v: string) =>
                v === "ACTIVE" ? (
                  <Tag color="success">有效</Tag>
                ) : v === "EXPIRED" ? (
                  <Tag>已过期</Tag>
                ) : (
                  <Tag color="default">已撤销</Tag>
                ),
            },
            {
              title: "操作",
              render: (_, r: ScmAccountView) =>
                r.status !== "REVOKED" ? (
                  <Popconfirm
                    title={`撤销 ${r.login} 的授权？`}
                    description="撤销后引用该账号的仓库绑定将变为凭据失效"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => revoke.mutate(r.id)}
                  >
                    <Button size="small" danger data-testid={`btn-revoke-account-${r.login}`}>
                      撤销
                    </Button>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      )}
      <div className="mt-3 text-xs text-[#8F959E]">
        授权账号在组织内共享；撤销权限：授权人本人或组织管理员。GitLab 访问令牌 2
        小时过期将自动续期。
      </div>
    </Modal>
  );
}

// ── 编辑弹窗（改名 / 换认证；凭据留空=不更新） ──

function EditRepoModal({
  row,
  projectId,
  orgId,
  onClose,
  onSaved,
}: {
  row: ScmRepoView;
  projectId: string;
  orgId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const [name, setName] = useState(row.name ?? "");
  const [authType, setAuthType] = useState<ScmAuthType>(row.authType);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState(row.username ?? "");
  const [password, setPassword] = useState("");
  const [accountId, setAccountId] = useState<string | null>(row.accountId);

  const { data: accountsData } = useQuery({
    queryKey: ["scm-accounts", orgId],
    queryFn: () => scmAccountApi.list(orgId),
    enabled: authType === "oauth",
  });
  const oauthAccounts = useMemo(
    () => (accountsData?.items ?? []).filter((a) => a.status === "ACTIVE"),
    [accountsData],
  );

  const save = useMutation({
    mutationFn: () => {
      const typeChanged = authType !== row.authType;
      return scmRepoApi.update(projectId, row.id, {
        name: name.trim() || null,
        ...(typeChanged ? { authType } : {}),
        ...(authType === "token" && token ? { token } : {}),
        ...(authType === "password" && username && password ? { username, password } : {}),
        ...(authType === "oauth" && accountId ? { accountId } : {}),
      });
    },
    onSuccess: () => {
      message.success("已保存");
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <Modal
      title={`编辑 · ${row.owner}/${row.repo}`}
      open
      onCancel={onClose}
      onOk={() => save.mutate()}
      confirmLoading={save.isPending}
      okText="保存"
      data-testid="modal-edit-repo"
    >
      <div className="space-y-4">
        <Alert
          type="info"
          showIcon
          message={`地址 ${row.repoUrl}（不可修改；如需更换请删除后重新绑定）`}
        />
        <div>
          <label className="block text-[13px] mb-1">备注名</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            data-testid="input-edit-name"
          />
        </div>
        <div>
          <label className="block text-[13px] mb-1">认证方式（切换后按新方式全量生效）</label>
          <Radio.Group
            value={authType}
            onChange={(e) => setAuthType(e.target.value as ScmAuthType)}
            options={[
              { value: "none", label: "无凭据" },
              { value: "oauth", label: "OAuth" },
              { value: "token", label: "Token" },
              { value: "password", label: "账号密码" },
            ]}
            data-testid="radio-edit-auth-type"
          />
        </div>
        {authType === "oauth" && (
          <div>
            <label className="block text-[13px] mb-1">授权账号</label>
            <Select
              className="w-full"
              value={accountId ?? undefined}
              onChange={setAccountId}
              options={oauthAccounts.map((a) => ({
                value: a.id,
                label: `${SCM_PROVIDER_LABEL[a.provider]} · ${a.login}`,
              }))}
            />
          </div>
        )}
        {authType === "token" && (
          <div>
            <label className="block text-[13px] mb-1">访问令牌（留空且未切换方式=不更新）</label>
            <Input.Password
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="new-password"
              data-testid="input-edit-token"
            />
          </div>
        )}
        {authType === "password" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[13px] mb-1">用户名</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div>
              <label className="block text-[13px] mb-1">密码</label>
              <Input.Password
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
