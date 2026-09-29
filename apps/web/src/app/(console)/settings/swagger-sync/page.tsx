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
  Switch,
  Table,
  Tag,
} from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { swaggerSyncApi, type SwaggerSyncTask } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const fmt = (v: string | null) => (v ? v.replace("T", " ").slice(0, 16) : "—");
const MAX_TASKS = 10;

/** API-011：Swagger URL 定时同步（任务 CRUD + 立即同步 + 历史）。 */
export default function SwaggerSyncPage() {
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const canUpdate = can("PROJECT_API:UPDATE");
  const [editing, setEditing] = useState<SwaggerSyncTask | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["swagger-sync", projectId],
    queryFn: () => swaggerSyncApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const run = useMutation({
    mutationFn: (id: string) => swaggerSyncApi.run(projectId!, id),
    onSuccess: (r) => {
      if (r?.ok)
        message.success(`同步成功：${r.added} 新增 · ${r.updated} 覆盖 · ${r.skipped} 跳过`);
      else message.warning(`部分失败：${r?.error ?? `${r?.failed.length ?? 0} 行失败`}`);
      void qc.invalidateQueries({ queryKey: ["swagger-sync", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => swaggerSyncApi.remove(projectId!, id),
    onSuccess: () => {
      message.success("已删除");
      void qc.invalidateQueries({ queryKey: ["swagger-sync", projectId] });
    },
    onError: (e) => message.error(errText(e)),
  });

  const columns = [
    { title: "名称", dataIndex: "name" },
    {
      title: "文档 URL",
      dataIndex: "url",
      render: (v: string) => (
        <code className="text-xs text-gray-500 max-w-[280px] truncate inline-block align-middle">
          {v}
        </code>
      ),
    },
    {
      title: "覆盖",
      dataIndex: "cover",
      render: (v: boolean) => (v ? <Tag color="warning">覆盖</Tag> : <Tag>不覆盖</Tag>),
    },
    {
      title: "cron",
      dataIndex: "cron",
      render: (v: string) => <code className="text-xs">{v}</code>,
    },
    {
      title: "最近结果",
      dataIndex: "lastResult",
      render: (v: SwaggerSyncTask["lastResult"], r: SwaggerSyncTask) =>
        !v ? (
          <span className="text-xs text-gray-400">未执行</span>
        ) : v.ok ? (
          <span className="text-xs text-green-600" title={fmt(r.lastRunAt)}>
            {v.added} 新增 · {v.updated} 覆盖 · {v.skipped} 跳过
          </span>
        ) : (
          <span className="text-xs text-red-500" title={v.error ?? ""}>
            失败：{v.error ?? `${v.failed.length} 行错误`}
          </span>
        ),
    },
    {
      title: "启用",
      dataIndex: "enabled",
      render: (v: boolean, r: SwaggerSyncTask) =>
        v ? <Tag color="processing">定时中</Tag> : <Tag>停用</Tag>,
    },
    ...(canUpdate
      ? [
          {
            title: "操作",
            render: (_: unknown, r: SwaggerSyncTask) => (
              <Space size={4}>
                <Button
                  size="small"
                  type="link"
                  loading={run.isPending && run.variables === r.id}
                  onClick={() => run.mutate(r.id)}
                  data-testid={`swagger-run-${r.name}`}
                >
                  立即同步
                </Button>
                <Button size="small" type="link" onClick={() => setEditing(r)}>
                  编辑
                </Button>
                <Popconfirm
                  title="删除任务（不动已导入数据）"
                  onConfirm={() => remove.mutate(r.id)}
                >
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

  const modal = (open: boolean, onClose: () => void, initial?: SwaggerSyncTask) => (
    <TaskFormModal
      key={initial?.id ?? "new"}
      open={open}
      initial={initial}
      onClose={onClose}
      onSubmit={(v) => {
        const m = initial
          ? swaggerSyncApi.update(projectId!, initial.id, v)
          : swaggerSyncApi.create(projectId!, v);
        m.then(() => {
          message.success(initial ? "已保存" : "已创建（默认启用）");
          onClose();
          void qc.invalidateQueries({ queryKey: ["swagger-sync", projectId] });
        }).catch((e) => message.error(errText(e)));
      }}
    />
  );

  return (
    <div className="p-4" data-testid="page-settings-swagger-sync">
      <PageHeader
        title="Swagger 定时同步"
        sub="OpenAPI 3.0 文档 URL 定时导入（json/yaml；覆盖=同 method+path 更新并 version+1）· 复用接口定义导入管线与判重报告"
        extra={
          canUpdate ? (
            <Button
              type="primary"
              disabled={(data?.length ?? 0) >= MAX_TASKS}
              onClick={() => setCreateOpen(true)}
              data-testid="swagger-create-btn"
            >
              ＋ 新建同步任务
            </Button>
          ) : null
        }
      />
      {!projectId && (
        <Alert type="info" showIcon message="进入项目后配置该项目的同步任务" className="mb-3" />
      )}
      <Table
        rowKey="id"
        size="small"
        loading={isLoading}
        columns={columns}
        dataSource={data ?? []}
        pagination={false}
      />
      {createOpen && modal(true, () => setCreateOpen(false))}
      {editing && modal(true, () => setEditing(null), editing)}
    </div>
  );
}

function TaskFormModal({
  open,
  initial,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initial?: SwaggerSyncTask;
  onClose: () => void;
  onSubmit: (v: { name: string; url: string; cover: boolean; cron: string }) => void;
}) {
  const [form] = Form.useForm();
  return (
    <Modal
      title={initial ? "编辑同步任务" : "新建同步任务"}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="保存"
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          initial
            ? { name: initial.name, url: initial.url, cover: initial.cover, cron: initial.cron }
            : { cover: false, cron: "0 0 * * *" }
        }
        onFinish={onSubmit}
      >
        <Form.Item name="name" label="名称" rules={[{ required: true, message: "必填" }]}>
          <Input maxLength={128} data-testid="swagger-name-input" />
        </Form.Item>
        <Form.Item
          name="url"
          label="文档 URL（OpenAPI 3.0）"
          rules={[
            { required: true, message: "必填" },
            { type: "url", message: "URL 非法" },
          ]}
        >
          <Input
            placeholder="https://api.example.com/openapi.json"
            data-testid="swagger-url-input"
          />
        </Form.Item>
        <Form.Item name="cover" label="覆盖模式（同 method+path 判重）" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item
          name="cron"
          label="同步周期（5 段 cron，最短 5 分钟）"
          rules={[{ required: true, message: "必填" }]}
        >
          <Input className="font-mono text-xs" placeholder="0 0 * * *" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
