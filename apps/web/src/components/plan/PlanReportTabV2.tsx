"use client";

/** S4 PLAN-005 计划报告 Tab 升级：概览六卡 + 阈值横幅 + 测试点维度明细 + 一键总结 + 分享 + 导出 PDF/CSV。 */
import { Button, Collapse, Empty, Input, Modal, Select, Table, Tag, Tooltip } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { planApi, planReportApi } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";

const REF_TYPE_TAG: Record<string, string> = { 功能: "green", 接口: "blue", 场景: "purple" };
const STATUS_COLOR: Record<string, string> = {
  通过: "#52C41A",
  失败: "#FF4D4F",
  阻塞: "#FA8C16",
  跳过: "#C9CDD4",
  未执行: "#87888D",
};

export function PlanReportTabV2({
  projectId,
  planId,
  planName,
}: {
  projectId: string;
  planId: string;
  planName: string;
}) {
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const canUpdate = usePermissions().can("PROJECT_PLAN:UPDATE");
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [expireHours, setExpireHours] = useState<1 | 24 | 168 | 720>(24);

  const viewQ = useQuery({
    queryKey: ["plan-report-view", planId],
    queryFn: () => planReportApi.view(projectId, planId),
  });
  const sharesQ = useQuery({
    queryKey: ["plan-report-shares", planId],
    queryFn: () => planReportApi.listShares(projectId, planId),
    enabled: shareOpen,
  });
  const view = viewQ.data;
  if (view && !editing && summary === "" && view.summary) setSummary(view.summary);

  const refresh = useMutation({
    mutationFn: () => planReportApi.refresh(projectId, planId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plan-report-view", planId] });
      message.success("报告已刷新");
    },
  });
  const draft = useMutation({
    mutationFn: () => planReportApi.draft(projectId, planId),
    onSuccess: (r) => {
      if (view?.summary) {
        Modal.confirm({
          title: "一键生成总结草稿？",
          content: "已有保存的总结将被覆盖（可先复制留存）",
          okText: "生成并覆盖",
          onOk: () => {
            setSummary(r.draft);
            setEditing(true);
          },
        });
      } else {
        setSummary(r.draft);
        setEditing(true);
      }
    },
  });
  const saveSummary = useMutation({
    mutationFn: () => planApi.saveSummary(projectId, planId, summary),
    onSuccess: () => {
      message.success("总结已保存");
      setEditing(false);
      qc.invalidateQueries({ queryKey: ["plan-report-view", planId] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const createShare = useMutation({
    mutationFn: () => planReportApi.createShare(projectId, planId, expireHours),
    onSuccess: () => {
      message.success("分享链接已创建");
      qc.invalidateQueries({ queryKey: ["plan-report-shares", planId] });
    },
    onError: (e: Error) => message.error(e.message),
  });
  const revokeShare = useMutation({
    mutationFn: (token: string) => planReportApi.revokeShare(projectId, planId, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plan-report-shares", planId] }),
  });

  const exportCsv = async () => {
    try {
      const { blob, filename } = await planReportApi.exportCsv(projectId, planId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      message.success("CSV 已下载（Excel 兼容）");
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  if (viewQ.isLoading) return <div className="rabbit-card p-8 text-center text-[#A8ABB0] text-[13px]">报告加载中…</div>;
  if (!view) return <Empty description="报告不可用" />;

  const cards: { label: string; value: string | number; color?: string }[] = [
    { label: "用例总数", value: view.overview.total },
    { label: "已执行", value: view.overview.executed },
    { label: "通过", value: view.overview.pass, color: "#52C41A" },
    { label: "失败", value: view.overview.fail, color: "#FF4D4F" },
    { label: "阻塞", value: view.overview.blocked, color: "#FA8C16" },
    { label: "误报", value: view.overview.fakeError, color: "#FAAD14" },
  ];

  return (
    <div className="space-y-3" data-testid="plan-report-v2">
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={() => refresh.mutate()} loading={refresh.isPending} data-testid="btn-report-refresh">
          ↻ 刷新
        </Button>
        <Button onClick={() => draft.mutate()} loading={draft.isPending} data-testid="btn-report-draft">
          ✨ 一键总结
        </Button>
        <Button onClick={() => setShareOpen(true)} data-testid="btn-report-share">
          🔗 分享
        </Button>
        <Tooltip title="打印页（浏览器打印为 PDF）">
          <Button onClick={() => router.push(`/plans/${planId}/report/print`)} data-testid="btn-report-pdf">
            🖨 导出 PDF
          </Button>
        </Tooltip>
        <Button type="primary" onClick={exportCsv} data-testid="btn-report-csv">
          ⬇ 导出 CSV
        </Button>
        <span className="text-xs text-[#A8ABB0] ml-auto">
          生成于 {new Date(view.generatedAt).toLocaleString("zh-CN")}
        </span>
      </div>

      {view.overview.thresholdMet !== null && (
        <div
          className={`rounded-md border px-3 py-1.5 text-xs ${
            view.overview.thresholdMet
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-600"
          }`}
          data-testid="report-threshold-banner"
        >
          {view.overview.thresholdMet ? "✓" : "✗"} 通过率 {view.overview.passRate ?? "—"}%{" "}
          {view.overview.thresholdMet ? "≥" : "<"} 阈值 {view.threshold}% —— {view.overview.thresholdMet ? "达标" : "未达标"}
        </div>
      )}

      <div className="flex gap-3">
        {cards.map((c) => (
          <div key={c.label} className="rabbit-card flex-1 px-4 py-3">
            <p className="text-xs text-[#A8ABB0]">{c.label}</p>
            <p className="text-xl font-semibold" style={c.color ? { color: c.color } : undefined}>
              {c.value}
            </p>
          </div>
        ))}
      </div>

      {/* 测试点维度 */}
      <div className="rabbit-card p-0 overflow-hidden">
        <Collapse
          defaultActiveKey={view.points.filter((p) => p.rows.length > 0).map((p) => p.pointId ?? "__ungrouped__")}
          items={view.points.map((p) => ({
            key: p.pointId ?? "__ungrouped__",
            label: (
              <span className="flex items-center gap-2 text-[13px]">
                测试点：{p.name}
                <span className="text-[10px] border rounded px-1 py-0.5 bg-slate-100 text-slate-500">{p.rows.length} 条</span>
                {p.passRate !== null && (
                  <span
                    className={`text-[10px] border rounded px-1 py-0.5 ${p.passRate >= view.threshold ? "bg-green-50 text-green-600 border-green-200" : "bg-red-50 text-red-600 border-red-200"}`}
                  >
                    通过率 {p.passRate}%
                  </span>
                )}
              </span>
            ),
            children:
              p.rows.length === 0 ? (
                <p className="text-xs text-[#A8ABB0] py-2">暂无用例</p>
              ) : (
                <Table
                  rowKey="refId"
                  size="small"
                  dataSource={p.rows}
                  pagination={false}
                  columns={[
                    {
                      title: "类型",
                      width: 70,
                      render: (_, r) => <Tag color={REF_TYPE_TAG[r.refType === "functional_case" ? "功能" : r.refType === "api_case" ? "接口" : "场景"]}>{r.refType === "functional_case" ? "功能" : r.refType === "api_case" ? "接口" : "场景"}</Tag>,
                    },
                    { title: "名称", dataIndex: "name", ellipsis: true },
                    { title: "执行人", dataIndex: "executor", width: 90, render: (v: string | null) => v ?? "—" },
                    {
                      title: "状态",
                      width: 80,
                      render: (_, r: { status: string }) => (
                        <span style={{ color: STATUS_COLOR[r.status] ?? "#87888D" }} className="font-medium">
                          {r.status}
                        </span>
                      ),
                    },
                    { title: "实际结果", dataIndex: "actualResult", ellipsis: true },
                    {
                      title: "最近执行",
                      width: 140,
                      render: (_, r: { lastRunAt: string | null }) =>
                        r.lastRunAt ? new Date(r.lastRunAt).toLocaleString("zh-CN") : "—",
                    },
                    {
                      title: "",
                      width: 90,
                      render: (_, r: { reportTaskId: string | null }) =>
                        r.reportTaskId ? (
                          <a className="text-[#574BFF] text-xs" onClick={() => router.push(`/reports/${r.reportTaskId}`)}>
                            执行报告 ↗
                          </a>
                        ) : null,
                    },
                  ]}
                />
              ),
          }))}
        />
      </div>

      {/* 总结 */}
      <div className="rabbit-card p-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium">报告总结</p>
          {canUpdate && (
            <Button size="small" className="ml-auto" onClick={() => setEditing(!editing)}>
              {editing ? "取消" : "编辑"}
            </Button>
          )}
          {editing && (
            <Button size="small" type="primary" loading={saveSummary.isPending} onClick={() => saveSummary.mutate()} data-testid="btn-save-summary">
              保存
            </Button>
          )}
        </div>
        {editing ? (
          <Input.TextArea className="mt-2" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={4000} data-testid="summary-editor" />
        ) : (
          <p className="text-[13px] pt-1 text-slate-600" data-testid="summary-text">
            {view.summary || "（暂无总结——可一键生成草稿后编辑保存）"}
          </p>
        )}
      </div>

      {/* 分享管理 */}
      <Modal
        open={shareOpen}
        title={`分享 · ${planName} 计划报告`}
        footer={null}
        onCancel={() => setShareOpen(false)}
        data-testid="share-modal"
      >
        <div className="space-y-2">
          {(sharesQ.data?.items ?? []).map((s) => (
            <div key={s.token} className="flex items-center gap-2 text-xs border rounded px-2 py-1.5">
              <a
                href={`/share/plan/${s.token}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[#574BFF] truncate"
              >
                /share/plan/{s.token.slice(0, 10)}…
              </a>
              <span className="text-slate-400">{s.expired ? "已过期" : new Date(s.expireAt).toLocaleString("zh-CN")}</span>
              <Button size="small" danger className="ml-auto" onClick={() => revokeShare.mutate(s.token)}>
                吊销
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Select
              className="w-28"
              value={expireHours}
              onChange={(v) => setExpireHours(v)}
              options={[
                { value: 1, label: "1 小时" },
                { value: 24, label: "1 天" },
                { value: 168, label: "7 天" },
                { value: 720, label: "30 天" },
              ]}
            />
            <Button type="primary" loading={createShare.isPending} onClick={() => createShare.mutate()} data-testid="btn-create-share">
              新建分享链接
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
