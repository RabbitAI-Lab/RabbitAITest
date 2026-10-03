"use client";

import { Empty, Select, Table, Tag, Typography } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { agentApi, type AgentRunView } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";

export default function AgentRunsPage() {
  const { currentProjectId: projectId } = useProjectStore();
  const [agentId, setAgentId] = useState<string | null>(null);

  const agents = useQuery({
    queryKey: ["agents", projectId],
    queryFn: () => agentApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const runs = useQuery({
    queryKey: ["agent-runs", projectId, agentId],
    queryFn: () => agentApi.runs(projectId!, agentId!, { page: 1, pageSize: 20 }),
    enabled: Boolean(projectId) && Boolean(agentId),
  });

  // 接口按 Agent 维度查询：缺省选中第一个 Agent
  useEffect(() => {
    const first = agents.data?.items[0];
    if (!agentId && first) setAgentId(first.id);
  }, [agentId, agents.data]);

  return (
    <div className="p-6" data-testid="agents-runs-page">
      <div className="mb-4 flex items-center gap-3">
        <div>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Agent 运行记录
          </Typography.Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            UI 调试与 A2A 调用的运行台账（状态/耗时/token 用量）
          </Typography.Text>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Agent
          </Typography.Text>
          <Select
            style={{ width: 240 }}
            placeholder="选择 Agent"
            value={agentId ?? undefined}
            onChange={setAgentId}
            loading={agents.isLoading}
            data-testid="agent-runs-agent-select"
            options={(agents.data?.items ?? []).map((a) => ({ value: a.id, label: a.name }))}
          />
        </div>
      </div>

      {!agents.isLoading && !agents.data?.items.length ? (
        <Empty description="尚无 Agent，先到「Agent」菜单创建" className="py-16" />
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
      )}
    </div>
  );
}
