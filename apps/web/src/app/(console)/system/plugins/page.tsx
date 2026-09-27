"use client";

import { Button, Modal, Popconfirm, Space, Spin, Switch, Table, Tag, Upload, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { pluginApi, type PluginRow } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const KIND_COLOR: Record<string, string> = { protocol: "cyan", platform: "purple", driver: "gold" };
const KIND_LABEL: Record<string, string> = { protocol: "协议", platform: "平台", driver: "驱动" };
const fmt = (v: string) => v.replace("T", " ").slice(0, 16);

/** PLUG-001：插件管理（上传 tarball → 清单预览确认 → 启停/删除）。 */
export default function PluginsPage() {
  const qc = useQueryClient();
  const { message: msg } = useApp();
  const { canGlobal } = usePermissions();
  const canUpdate = canGlobal("SYSTEM_PLUGIN:UPDATE");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["plugins"], queryFn: pluginApi.list });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["plugins"] });
  const errText = (e: unknown) => (e instanceof Error ? e.message : "操作失败");

  const upload = useMutation({
    mutationFn: (file: File) => pluginApi.upload(file, "ALL"),
    onSuccess: (r) => {
      msg.success(`已登记 ${r.id.slice(0, 8)}（默认停用，启用后热加载）`);
      setUploadOpen(false);
      setPendingFile(null);
      invalidate();
    },
    onError: (e) => msg.error(errText(e)),
  });

  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => pluginApi.update(id, { enabled }),
    onSuccess: (_r, v) => {
      msg.success(v.enabled ? "已启用（plugin-runner 热加载）" : "已停用（配置保留）");
      invalidate();
    },
    onError: (e) => msg.error(errText(e)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => pluginApi.remove(id),
    onSuccess: () => {
      msg.success("已删除");
      invalidate();
    },
    onError: (e) => msg.error(errText(e)),
  });

  const columns = [
    { title: "名称", dataIndex: "name", render: (v: string, r: PluginRow) => (
      <div>
        <span className="font-medium">{v}</span>
        {r.runtimeStatus === "ERROR" && (
          <div className="text-[11px] text-red-500 mt-0.5">↳ {r.runtimeError ?? "worker 异常"}</div>
        )}
      </div>
    ) },
    { title: "类型", dataIndex: "kind", render: (v: string) => (
      <Tag color={KIND_COLOR[v]}>{KIND_LABEL[v] ?? v}</Tag>
    ) },
    { title: "版本", dataIndex: "version", render: (v: string) => <code className="text-xs">{v}</code> },
    { title: "SPI", dataIndex: "spiVersion", render: (v: string) => <code className="text-xs">{v}</code> },
    { title: "组织范围", dataIndex: "orgScope", render: (v: PluginRow["orgScope"]) =>
      v === "ALL" ? "全部组织" : `${v.length} 个组织` },
    { title: "状态", dataIndex: "runtimeStatus", render: (v: string) =>
      v === "RUNNING" ? <Tag color="success">● 运行中</Tag> : v === "ERROR" ? <Tag color="error">● 异常</Tag> : <Tag>已停用</Tag> },
    { title: "更新时间", dataIndex: "updatedAt", render: (v: string) => <span className="text-xs text-gray-400">{fmt(v)}</span> },
    ...(canUpdate
      ? [{
          title: "操作",
          render: (_: unknown, r: PluginRow) => (
            <Space size={4}>
              <Switch
                size="small"
                checked={r.enabled}
                disabled={toggle.isPending}
                onChange={(enabled) => toggle.mutate({ id: r.id, enabled })}
                data-testid={`plugin-toggle-${r.name}`}
              />
              <Popconfirm
                title="删除插件"
                description="需先停用且无项目同步关联引用"
                onConfirm={() => remove.mutate(r.id)}
                disabled={r.enabled}
              >
                <Button size="small" type="link" danger disabled={r.enabled}>
                  删除
                </Button>
              </Popconfirm>
            </Space>
          ),
        }]
      : []),
  ];

  return (
    <div className="p-4" data-testid="page-system-plugins">
      <PageHeader
        title="插件管理"
        extra={
          canUpdate ? (
            <Button type="primary" onClick={() => setUploadOpen(true)} data-testid="plugin-upload-btn">
              上传插件
            </Button>
          ) : null
        }
        sub="协议 / 平台 / 驱动三类插件（tarball）；上传经清单与 SPI 版本校验，启用后由 plugin-runner 热加载（worker_threads 隔离）"
      />
      {isLoading ? (
        <Spin />
      ) : (
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={(data as { list?: PluginRow[] } | undefined)?.list ?? []}
          pagination={false}
        />
      )}

      <Modal
        title="上传插件包"
        open={uploadOpen}
        onCancel={() => setUploadOpen(false)}
        onOk={() => pendingFile && upload.mutate(pendingFile)}
        okButtonProps={{ disabled: !pendingFile }}
        confirmLoading={upload.isPending}
        okText="确认上传"
      >
        <Upload.Dragger
          maxCount={1}
          accept=".tgz,.tar.gz"
          beforeUpload={(file) => {
            setPendingFile(file);
            return false;
          }}
          onRemove={() => setPendingFile(null)}
          fileList={pendingFile ? [{ uid: "-1", name: pendingFile.name }] : []}
        >
          <p className="ant-upload-drag-icon">📦</p>
          <p className="ant-upload-text">点击或拖入插件包（.tgz，≤32MB）</p>
          <p className="ant-upload-hint">包内含 package.json（rabbitPlugin 清单）与入口 js；同名插件版本需递增</p>
        </Upload.Dragger>
        {upload.isPending && <div className="mt-3 text-xs text-gray-400">清单校验 → 存储 → 解包 → 登记…</div>}
      </Modal>
    </div>
  );
}
