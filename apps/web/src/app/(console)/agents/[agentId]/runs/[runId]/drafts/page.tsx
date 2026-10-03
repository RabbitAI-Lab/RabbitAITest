"use client";

import { Alert, Button, Checkbox, Space, Spin, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useState } from "react";
import { agentApi, type AgentRunDetailView } from "@rabbit/api-client";
const ASSET_TYPE_LABELS: Record<string, string> = { test_point: "测试点", functional_case: "功能用例", api_definition: "接口定义", api_case: "API 用例", scenario: "场景", ui_case: "UI 用例", playwright_script: "脚本" };
import { useApp } from "@/hooks/useApp";
import { useProjectStore } from "@/stores/project";

interface DraftRow {
  id: string;
  stage: string;
  assetType: string;
  name: string;
  conflictStatus: string;
  importStatus: string;
  selected: boolean;
}

/** AGENT-002 产物预览页：草稿列表（三态徽标）+ 勾选 + 批量导入。 */
export default function DraftsPage() {
  const { message } = useApp();
  const params = useParams<{ agentId: string; runId: string }>();
  const { currentProjectId: projectId } = useProjectStore();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const drafts = useQuery({
    queryKey: ["agent-drafts", projectId, params.runId],
    queryFn: () => fetch(`/api/v1/projects/${projectId}/agent-runs/${params.runId}/drafts`).then((r) => r.json()),
    enabled: Boolean(projectId && params.runId),
  });

  const handleImport = async () => {
    if (!projectId || selectedIds.length === 0) return;
    try {
      const res = await fetch(
        `/api/v1/projects/${projectId}/agent-runs/${params.runId}/drafts/select`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "import", draftIds: selectedIds, importMode: "review" }),
        },
      );
      const body = (await res.json()) as { data: { imported: number; failed: number } };
      message.success(`导入完成：成功 ${body.data.imported} / 失败 ${body.data.failed}`);
      void drafts.refetch();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const items = ((drafts.data as { data?: { items?: DraftRow[] } })?.data?.items ?? []) as DraftRow[];
  const pendingItems = items.filter((d) => d.importStatus === "PENDING");

  return (
    <div className="p-6" data-testid="drafts-page">
      <div className="mb-4 flex items-center gap-3">
        <Typography.Title level={5} style={{ margin: 0 }}>产物预览 · run {params.runId?.slice(0, 8)}…</Typography.Title>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          草稿保留 30 天 · 导入前不落生产库
        </Typography.Text>
        <div className="ml-auto flex gap-2">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            已选 <span style={{ color: "#574BFF", fontWeight: 600 }}>{selectedIds.length}</span> / {pendingItems.length}
          </Typography.Text>
          <Button
            type="primary"
            disabled={selectedIds.length === 0}
            onClick={handleImport}
            data-testid="drafts-import-btn"
          >
            导入所选 ({selectedIds.length})
          </Button>
        </div>
      </div>

      {drafts.isLoading ? (
        <div className="py-20 text-center"><Spin /></div>
      ) : items.length === 0 ? (
        <Alert type="info" message="无草稿" description="该运行未产出草稿或草稿已清理。" />
      ) : (
        <Table<DraftRow>
          rowKey="id"
          size="small"
          dataSource={items}
          data-testid="drafts-table"
          columns={[
            {
              title: "",
              width: 40,
              render: (_: unknown, r: DraftRow) =>
                r.importStatus === "PENDING" ? (
                  <Checkbox
                    checked={selectedIds.includes(r.id)}
                    onChange={(e) => {
                      setSelectedIds((prev) =>
                        e.target.checked ? [...prev, r.id] : prev.filter((id) => id !== r.id),
                      );
                    }}
                    data-testid={`draft-check-${r.id}`}
                  />
                ) : null,
            },
            { title: "阶段", dataIndex: "stage", width: 60, render: (v: string) => <Tag>{v}</Tag> },
            {
              title: "类型",
              dataIndex: "assetType",
              width: 100,
              render: (v: string) => <Tag color="blue">{ASSET_TYPE_LABELS[v] ?? v}</Tag>,
            },
            { title: "名称", dataIndex: "name", ellipsis: true },
            {
              title: "冲突",
              dataIndex: "conflictStatus",
              width: 80,
              render: (v: string) =>
                v === "CONFLICT" ? <Tag color="orange">冲突</Tag> : v === "INVALID" ? <Tag color="red">无效</Tag> : <Tag color="green">新增</Tag>,
            },
            {
              title: "状态",
              dataIndex: "importStatus",
              width: 90,
              render: (v: string) => {
                const map: Record<string, { color: string; label: string }> = {
                  PENDING: { color: "default", label: "待处理" },
                  IMPORTED: { color: "green", label: "已导入" },
                  FAILED: { color: "red", label: "失败" },
                  DISCARDED: { color: "default", label: "已废弃" },
                  SKIPPED: { color: "default", label: "跳过" },
                };
                const m = map[v] ?? { color: "default", label: v };
                return <Tag color={m.color}>{m.label}</Tag>;
              },
            },
          ]}
        />
      )}
    </div>
  );
}
