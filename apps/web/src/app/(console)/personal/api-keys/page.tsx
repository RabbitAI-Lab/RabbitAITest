"use client";

import { Alert, Button, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { apiKeyApi, type ApiKeyRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";

const MAX_KEYS = 5;
const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");

/** INTG-003：个人 APIKEY（CI/脚本接入凭证；sk 仅创建时一次展示）。 */
export default function ApiKeysPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [created, setCreated] = useState<(ApiKeyRow & { accessKey: string; secretKey: string }) | null>(null);
  const [copied, setCopied] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["api-keys"], queryFn: apiKeyApi.list });
  const active = (data ?? []).filter((k) => !k.revokedAt);
  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const create = useMutation({
    mutationFn: () => apiKeyApi.create(name.trim()),
    onSuccess: (row) => {
      setCreated(row);
      setName("");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => apiKeyApi.revoke(id),
    onSuccess: () => {
      message.success("已吊销（用该 key 的调用将立即 401）");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      message.success("已复制");
    } catch {
      message.warning("复制失败，请手动选择复制");
    }
  };

  const columns = [
    { title: "名称", dataIndex: "name" },
    { title: "Access Key", dataIndex: "prefix", render: (v: string, r: ApiKeyRow) => (
      <Space size={4}>
        <code className="text-xs">{v}…</code>
        {!r.revokedAt && (
          <Button size="small" type="link" onClick={() => copy(v, r.id)}>
            复制前缀
          </Button>
        )}
      </Space>
    ) },
    { title: "最近使用", dataIndex: "lastUsedAt", render: (v: string | null) => <span className="text-xs text-gray-400">{fmt(v)}</span> },
    { title: "创建时间", dataIndex: "createdAt", render: (v: string) => <span className="text-xs text-gray-400">{fmt(v)}</span> },
    { title: "状态", dataIndex: "revokedAt", render: (v: string | null) =>
      v ? <Tag>已吊销</Tag> : <Tag color="success">生效中</Tag> },
    {
      title: "操作",
      render: (_: unknown, r: ApiKeyRow) =>
        r.revokedAt ? (
          <span className="text-gray-300 text-xs">—</span>
        ) : (
          <Popconfirm title="吊销后不可恢复" onConfirm={() => revoke.mutate(r.id)}>
            <Button size="small" type="link" danger>
              吊销
            </Button>
          </Popconfirm>
        ),
    },
  ];

  return (
    <div className="p-4" data-testid="page-personal-api-keys">
      <PageHeader
        title="APIKEY"
        sub={`第三方 API 调用 / Jenkins 等持续集成接入凭证（Basic ak:sk 或 Bearer ak.sk）· 上限 ${MAX_KEYS} 条 · Secret Key 仅创建时展示一次`}
        extra={
          <Button
            type="primary"
            disabled={active.length >= MAX_KEYS}
            onClick={() => {
              setCreateOpen(true);
              setCreated(null);
            }}
            data-testid="apikey-create-btn"
          >
            ＋ 新建 APIKEY
          </Button>
        }
      />
      <Table rowKey="id" size="small" loading={isLoading} columns={columns} dataSource={data ?? []} pagination={false} />

      <Modal
        title={created ? "创建成功" : "新建 APIKEY"}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        footer={
          created ? (
            <Button type="primary" onClick={() => setCreateOpen(false)}>
              我已保存，关闭
            </Button>
          ) : (
            [
              <Button key="cancel" onClick={() => setCreateOpen(false)}>
                取消
              </Button>,
              <Button key="ok" type="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
                创建
              </Button>,
            ]
          )
        }
      >
        {created ? (
          <div className="space-y-3">
            <Alert type="warning" showIcon message="Secret Key 仅此一次展示，关闭后不可再查看，请立即复制保存。" />
            <div>
              <Typography.Text type="secondary" className="text-xs">
                Access Key
              </Typography.Text>
              <div className="flex items-center gap-2 border rounded px-2 py-1.5 bg-gray-50 font-mono text-xs">
                <span data-testid="apikey-ak">{created.accessKey}</span>
                <Button size="small" type="link" onClick={() => copy(created.accessKey, "ak")}>
                  复制
                </Button>
              </div>
            </div>
            <div>
              <Typography.Text type="secondary" className="text-xs">
                Secret Key
              </Typography.Text>
              <div className="flex items-center gap-2 border rounded px-2 py-1.5 bg-gray-50 font-mono text-xs">
                <span data-testid="apikey-sk">{created.secretKey}</span>
                <Button size="small" type="link" onClick={() => copy(created.secretKey, "sk")}>
                  复制
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <Input
            placeholder="名称（如 Jenkins 流水线）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={128}
            data-testid="apikey-name-input"
          />
        )}
      </Modal>
    </div>
  );
}
