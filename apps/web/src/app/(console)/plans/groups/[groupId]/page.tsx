"use client";

import { Button, Empty, Input, Progress, Spin, Table, Tag } from "antd";
import { ArrowLeft } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { planGroupApi } from "@rabbit/api-client";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

/** PLAN-004：计划组报告页——汇总五卡 + 成员明细（进度/通过率/阈值判定/报告链接）+ 总结编辑。 */
export default function PlanGroupReportPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [summary, setSummary] = useState("");
  const [editing, setEditing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["plan-group-report", projectId, groupId],
    queryFn: () => planGroupApi.report(projectId!, groupId),
    enabled: Boolean(projectId && groupId),
  });

  useEffect(() => {
    if (data && !editing) setSummary(data.summary);
  }, [data, editing]);

  const saveSummary = useMutation({
    mutationFn: () => planGroupApi.saveReportSummary(projectId!, groupId, summary),
    onSuccess: () => {
      message.success("组报告总结已保存");
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["plan-group-report", projectId, groupId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  if (!projectId) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="请先选择项目" />
      </div>
    );
  }
  if (isLoading) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Spin />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="分组不存在或已删除" />
      </div>
    );
  }

  const agg = data.aggregate;
  const progress =
    agg.totalRefs > 0 ? Math.round((agg.executed / agg.totalRefs) * 100) : 0;
  const canUpdate = can("PROJECT_PLAN:UPDATE");
  const members = data.members;
  type MemberRow = (typeof members)[number];

  const cards: { key: string; label: string; value: React.ReactNode; sub?: string }[] = [
    { key: "members", label: "成员计划", value: agg.memberCount },
    { key: "refs", label: "用例总数", value: agg.totalRefs },
    {
      key: "progress",
      label: "总进度",
      value: (
        <span className="flex items-center gap-2">
          <Progress percent={progress} size="small" showInfo={false} className="!m-0 w-20" />
          <span className="text-sm text-[#646A73]">
            {progress}%（{agg.executed}/{agg.totalRefs}）
          </span>
        </span>
      ),
    },
    {
      key: "passRate",
      label: "通过率",
      value: agg.passRate === null ? "—" : `${agg.passRate}%`,
    },
    {
      key: "threshold",
      label: "阈值达标",
      value: `${agg.thresholdMetCount}/${agg.memberCount}`,
      sub: "达标成员数 / 成员总数",
    },
  ];

  return (
    <div data-testid="group-report-page">
      <PageHeader
        title={
          <span>
            📁 {data.name} · 组报告
            {data.archivedAt && (
              <Tag className="!ml-2 !align-middle" data-testid="group-report-archived">
                已归档
              </Tag>
            )}
          </span>
        }
        sub={`${data.description ? `${data.description} · ` : ""}报告生成于 ${data.generatedAt.replace("T", " ").slice(0, 16)}`}
        extra={
          <div className="flex items-center gap-2">
            <Button icon={<ArrowLeft size={14} />} onClick={() => router.push("/plans")}>
              返回计划列表
            </Button>
            {canUpdate && !editing && (
              <Button type="primary" onClick={() => setEditing(true)} data-testid="group-summary-edit">
                编辑总结
              </Button>
            )}
          </div>
        }
      />

      {/* 汇总五卡 */}
      <div className="grid grid-cols-5 gap-4 mb-4" data-testid="group-report-cards">
        {cards.map((c) => (
          <div key={c.key} className="rabbit-card p-4" data-testid={`group-report-card-${c.key}`}>
            <p className="text-xs text-[#A8ABB0] m-0">{c.label}</p>
            <p className="text-2xl font-semibold mt-1 mb-0 flex items-center">{c.value}</p>
            {c.sub && <p className="text-xs text-[#A8ABB0] mt-1 mb-0">{c.sub}</p>}
          </div>
        ))}
      </div>

      {/* 成员明细 */}
      <div className="rabbit-card mb-4">
        <p className="rabbit-card-title">
          成员计划明细 <span className="text-xs text-[#A8ABB0] font-normal">共 {members.length} 个</span>
        </p>
        <Table<MemberRow>
          rowKey="id"
          size="small"
          dataSource={members}
          pagination={false}
          onRow={(record) =>
            ({
              "data-testid": `group-member-row-${record.id}`,
            }) as React.HTMLAttributes<HTMLTableRowElement>
          }
          columns={[
            {
              title: "计划名称",
              dataIndex: "name",
              render: (v: string, row) => (
                <a
                  className="text-[#574BFF] font-medium"
                  href={`/plans/${row.id}?tab=report`}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/plans/${row.id}?tab=report`);
                  }}
                >
                  {v}
                </a>
              ),
            },
            { title: "用例数", dataIndex: "caseCount", width: 90 },
            {
              title: "执行进度",
              key: "progress",
              width: 180,
              render: (_, row) => (
                <div className="flex items-center gap-2">
                  <Progress percent={row.progress} size="small" showInfo={false} className="!m-0 w-24" />
                  <span className="text-xs text-[#87888D]">
                    {row.executed}/{row.caseCount}
                  </span>
                </div>
              ),
            },
            {
              title: "通过率",
              dataIndex: "passRate",
              width: 100,
              render: (v: number | null) =>
                v === null ? <span className="text-[#C0C4CC]">—</span> : `${v}%`,
            },
            {
              title: "阈值判定",
              dataIndex: "thresholdMet",
              width: 100,
              render: (v: boolean | null) =>
                v === null ? (
                  <span className="text-[#C0C4CC]">—</span>
                ) : v ? (
                  <Tag color="success">达标</Tag>
                ) : (
                  <Tag color="error">未达标</Tag>
                ),
            },
            {
              title: "报告",
              key: "report",
              width: 90,
              render: (_, row) => (
                <Button
                  type="link"
                  size="small"
                  className="!px-0"
                  onClick={() => router.push(`/plans/${row.id}?tab=report`)}
                  data-testid={`group-member-report-${row.id}`}
                >
                  查看报告
                </Button>
              ),
            },
          ]}
        />
      </div>

      {/* 总结 */}
      <div className="rabbit-card p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="rabbit-card-title !mb-0">组报告总结</p>
        </div>
        {editing ? (
          <div className="space-y-2">
            <Input.TextArea
              rows={5}
              maxLength={8000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="组级结论与风险说明（AI 草稿可在各成员计划报告中生成）"
              data-testid="group-summary-textarea"
            />
            <div className="flex justify-end gap-2">
              <Button
                onClick={() => {
                  setEditing(false);
                  setSummary(data.summary);
                }}
              >
                取消
              </Button>
              <Button
                type="primary"
                loading={saveSummary.isPending}
                onClick={() => saveSummary.mutate()}
                data-testid="group-summary-save"
              >
                保存总结
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[13px] whitespace-pre-wrap m-0" data-testid="group-summary-text">
            {summary || "（暂无总结）"}
          </p>
        )}
      </div>
    </div>
  );
}
