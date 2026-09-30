"use client";

import { Alert, Button, Popconfirm, Space, Table, Tag } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authorizationApi, type AuthorizationRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";

const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");

/** SYS-009：授权会话管理（Device Flow 登录产生的令牌会话；吊销即终端 401）。 */
export default function AuthorizationsPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const { data, isLoading } = useQuery({
    queryKey: ["oauth-authorizations"],
    queryFn: authorizationApi.list,
  });
  const rows = data ?? [];
  const active = rows.filter((r) => r.status === "ACTIVE");

  const revoke = useMutation({
    mutationFn: (id: string) => authorizationApi.revoke(id),
    onSuccess: () => {
      message.success("已吊销（该终端的请求将立即 401）");
      void qc.invalidateQueries({ queryKey: ["oauth-authorizations"] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const revokeAll = useMutation({
    mutationFn: authorizationApi.revokeAll,
    onSuccess: (d) => {
      message.success(`已吊销 ${d.revoked} 个授权会话`);
      void qc.invalidateQueries({ queryKey: ["oauth-authorizations"] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const columns = [
    {
      title: "设备",
      render: (_: unknown, r: AuthorizationRow) => (
        <Space direction="vertical" size={0}>
          <code className="text-xs">{r.clientId}</code>
          <span className="text-xs text-gray-400">{r.deviceName ?? "—"}</span>
        </Space>
      ),
    },
    {
      title: "Scope",
      dataIndex: "scope",
      render: (scopes: string[]) => (
        <Space size={4} wrap>
          {scopes.map((s) => (
            <Tag key={s}>{s}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: "来源 IP",
      dataIndex: "ip",
      render: (v: string | null) => <code className="text-xs">{v ?? "—"}</code>,
    },
    {
      title: "最近使用",
      dataIndex: "lastUsedAt",
      render: (v: string | null) => <span className="text-xs text-gray-400">{fmt(v)}</span>,
    },
    {
      title: "Access 过期",
      dataIndex: "accessExpiresAt",
      render: (v: string, r: AuthorizationRow) => (
        <span className="text-xs text-gray-400">
          {r.status === "ACTIVE" ? fmt(v) : r.revokedAt ? "已吊销" : "已过期"}
        </span>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      render: (v: string, r: AuthorizationRow) =>
        v === "ACTIVE" && !r.revokedAt ? (
          <Tag color="success">生效中</Tag>
        ) : (
          <Tag>已吊销</Tag>
        ),
    },
    {
      title: "操作",
      render: (_: unknown, r: AuthorizationRow) =>
        r.status === "ACTIVE" && !r.revokedAt ? (
          <Popconfirm title="吊销后该终端立即 401，不可恢复" onConfirm={() => revoke.mutate(r.id)}>
            <Button size="small" type="link" danger data-testid="authz-revoke-btn">
              吊销
            </Button>
          </Popconfirm>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        ),
    },
  ];

  return (
    <div className="p-4" data-testid="page-personal-authorizations">
      <PageHeader
        title="授权会话"
        sub="CLI / 终端经 Device Flow 登录产生的令牌会话 · access 2 小时 · refresh 30 天（旋转）"
        extra={
          <Popconfirm
            title={`吊销全部 ${active.length} 个生效中会话？`}
            disabled={active.length === 0}
            onConfirm={() => revokeAll.mutate()}
          >
            <Button danger disabled={active.length === 0} data-testid="authz-revoke-all-btn">
              全部吊销
            </Button>
          </Popconfirm>
        }
      />
      {rows.length === 0 && !isLoading ? (
        <Alert
          type="info"
          showIcon
          message="暂无终端授权"
          description={
            <>
              在终端运行{" "}
              <code className="font-mono bg-gray-100 px-1">
                rabbit auth login --server &lt;平台地址&gt;
              </code>{" "}
              后，此处会出现授权会话
            </>
          }
          data-testid="authz-empty"
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          columns={columns}
          dataSource={rows}
          pagination={false}
        />
      )}
    </div>
  );
}
