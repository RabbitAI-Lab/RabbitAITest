"use client";

import {
  Button,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Tree,
} from "antd";
import { Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useMemo, useState } from "react";
import type { DataNode } from "antd/es/tree";
import {
  bugApi,
  caseApiV2,
  memberApi,
  moduleApi,
  planApi,
  type PlanCaseRow,
} from "@rabbit/api-client";
import { MemberSelect } from "@/components/crosscut";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const STATUS_META: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "未开始", color: "default" },
  UNDERWAY: { label: "进行中", color: "processing" },
  COMPLETED: { label: "已完成", color: "success" },
  ARCHIVED: { label: "已归档", color: "default" },
};
const EXEC_META: Record<string, { label: string; color: string }> = {
  NOT_RUN: { label: "未执行", color: "#87888D" },
  PASS: { label: "通过", color: "#52C41A" },
  FAIL: { label: "失败", color: "#FF4D4F" },
  BLOCKED: { label: "阻塞", color: "#FA8C16" },
  SKIPPED: { label: "跳过", color: "#C9CDD4" },
};
const levelColor: Record<string, string> = { P0: "red", P1: "orange", P2: "blue", P3: "default" };
const padNum = (n: number) => `C-${String(n).padStart(4, "0")}`;

/** PLAN-001：计划详情——用例清单（列表模式执行 + 步骤级面板 + 缺陷联动）/ 报告。 */
export default function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [tab, setTab] = useState<"cases" | "report">("cases");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [executorFilter, setExecutorFilter] = useState<string | undefined>();
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchUser, setBatchUser] = useState<string | undefined>();
  const [linkOpen, setLinkOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bugTarget, setBugTarget] = useState<PlanCaseRow | null>(null);

  const { data: plan, isLoading } = useQuery({
    queryKey: ["plan", projectId, id],
    queryFn: () => planApi.detail(projectId!, id),
    enabled: Boolean(projectId),
  });
  const { data: members } = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });
  const nameOf = (uid: string) => members?.items.find((m) => m.id === uid)?.name ?? "成员";

  const archived = Boolean(plan?.archivedAt);
  const canUpdate = can("PROJECT_PLAN:UPDATE");
  const writable = canUpdate && !archived;
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["plan", projectId, id] });
    void qc.invalidateQueries({ queryKey: ["plan-report", projectId, id] });
  };

  const exec = useMutation({
    mutationFn: (p: { refId: string; body: Record<string, unknown> }) =>
      planApi.exec(projectId!, id, p.refId, p.body),
    onSuccess: () => {
      invalidate();
      message.success("执行结果已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const batchExecutor = useMutation({
    mutationFn: (p: { refIds: string[]; execUserId: string }) =>
      planApi.batchExecutor(projectId!, id, p.refIds, p.execUserId),
    onSuccess: (r) => {
      invalidate();
      message.success(`已更新 ${r.affected} 条执行人`);
      setBatchOpen(false);
      setBatchUser(undefined);
      setSelectedRefs([]);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const removeCase = useMutation({
    mutationFn: (refId: string) => planApi.removeCase(projectId!, id, refId),
    onSuccess: () => {
      invalidate();
      message.success("已取消关联");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const archive = useMutation({
    mutationFn: (toArchived: boolean) => planApi.archive(projectId!, id, toArchived),
    onSuccess: (_r, toArchived) => {
      invalidate();
      message.success(toArchived ? "计划已归档（只读）" : "已取消归档");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const saveSettings = useMutation({
    mutationFn: (settings: {
      allowDuplicate: boolean;
      autoUpdateStatus: boolean;
      threshold: number;
    }) => planApi.update(projectId!, id, { settings }),
    onSuccess: () => {
      invalidate();
      setSettingsOpen(false);
      message.success("设置已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  const cases = plan?.cases ?? [];
  const filtered = useMemo(
    () =>
      cases.filter(
        (c) =>
          (!statusFilter || c.status === statusFilter) &&
          (!executorFilter || c.execUserId === executorFilter),
      ),
    [cases, statusFilter, executorFilter],
  );
  const stats = plan?.stats;

  if (!projectId)
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="请先选择项目" />
      </div>
    );
  if (isLoading || !plan)
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="加载中…" />
      </div>
    );

  const total = cases.length;
  const threshold = typeof plan.settings.threshold === "number" ? plan.settings.threshold : 100;
  const statusMeta = STATUS_META[archived ? "ARCHIVED" : plan.status] ?? {
    label: plan.status,
    color: "default",
  };

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center gap-3 flex-wrap mb-4">
        <a href="/plans" className="text-[13px] text-[#87888D] hover:text-[#574BFF] no-underline">
          ‹ 测试计划
        </a>
        <h1 className="text-lg font-medium m-0">{plan.name}</h1>
        <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
        <span className="text-xs text-[#A8ABB0]">
          {plan.startAt ? plan.startAt.slice(0, 10) : "—"} ~{" "}
          {plan.endAt ? plan.endAt.slice(0, 10) : "—"} · {total} 条用例
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div
            className="flex items-center gap-2.5 border border-[#ECEEF1] rounded-md px-3 py-1.5 bg-white"
            data-testid="plan-pass-rate-box"
          >
            <Progress
              type="circle"
              size={44}
              percent={plan.passRate ?? 0}
              strokeColor={(plan.passRate ?? 0) >= threshold ? "#52C41A" : "#FF4D4F"}
              format={() => (plan.passRate === null ? "—" : `${plan.passRate}%`)}
              data-testid="plan-circle"
            />
            <div className="text-xs leading-4">
              <p className="m-0">
                通过率<span className="text-[#A8ABB0]">（已执行口径）</span>
              </p>
              <p className="text-[#A8ABB0] m-0">
                阈值 {threshold}% ·{" "}
                {plan.thresholdMet === null ? (
                  "—"
                ) : plan.thresholdMet ? (
                  <span className="text-[#52C41A]">达标</span>
                ) : (
                  <span className="text-[#FF4D4F]">未达标</span>
                )}
              </p>
            </div>
          </div>
          <Button onClick={() => setSettingsOpen(true)} disabled={!canUpdate}>
            更多设置
          </Button>
          {archived
            ? canUpdate && (
                <Button onClick={() => archive.mutate(false)} data-testid="btn-unarchive">
                  取消归档
                </Button>
              )
            : canUpdate && (
                <Popconfirm
                  title="归档后计划只读"
                  description="归档后全部写操作将被拒绝（code 10008 PLAN_ARCHIVED），报告只读，确认归档？"
                  okText="确认归档"
                  okButtonProps={{
                    danger: true,
                    ...({ "data-testid": "btn-archive-confirm" } as Record<string, unknown>),
                  }}
                  onConfirm={() => archive.mutate(true)}
                >
                  <Button danger data-testid="btn-archive">
                    归档
                  </Button>
                </Popconfirm>
              )}
        </div>
      </div>

      {/* 已归档横幅 */}
      {archived && (
        <div
          className="mb-4 rounded-md border border-[#FDE2C8] bg-[#FFF7E8] px-4 py-2.5 flex items-center gap-3 text-[13px] text-[#D46B08]"
          data-testid="archived-banner"
        >
          <span>计划已归档，只读——执行、关联与设置修改均不可用（code 10008 PLAN_ARCHIVED）。</span>
          {canUpdate && (
            <Button size="small" onClick={() => archive.mutate(false)}>
              取消归档
            </Button>
          )}
        </div>
      )}

      {/* Tab：用例清单 / 报告 */}
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as "cases" | "report")}
        items={[
          { key: "cases", label: <span data-testid="plan-cases-tab">用例清单（{total}）</span> },
          { key: "report", label: <span data-testid="plan-report-tab">报告</span> },
        ]}
      />

      {tab === "cases" ? (
        <div className="rabbit-card" data-testid="plan-cases-table">
          {/* 工具条 */}
          <div className="flex gap-2 items-center p-3 border-b border-[#F0F1F3] flex-wrap">
            <Button
              type="primary"
              icon={<Plus size={14} />}
              disabled={!writable}
              onClick={() => setLinkOpen(true)}
              data-testid="btn-link-cases"
            >
              关联用例
            </Button>
            <Button
              disabled={!writable || selectedRefs.length === 0}
              onClick={() => setBatchOpen(true)}
              data-testid="btn-batch-executor"
            >
              批量改执行人{selectedRefs.length > 0 ? `（${selectedRefs.length}）` : ""}
            </Button>
            <span className="w-px h-5 bg-[#E5E6EB]" />
            <Select
              allowClear
              className="w-28"
              placeholder="状态"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v)}
              options={Object.entries(EXEC_META).map(([v, m]) => ({ value: v, label: m.label }))}
              data-testid="plan-filter-status"
            />
            <MemberSelect
              projectId={projectId}
              value={executorFilter}
              onChange={(v) =>
                setExecutorFilter(Array.isArray(v) ? undefined : (v as string | undefined))
              }
              placeholder="执行人"
            />
            {stats && (
              <span className="ml-auto text-xs text-[#A8ABB0]">
                已执行 {stats.executed}/{total} · 通过 {stats.pass} · 失败 {stats.fail} · 阻塞{" "}
                {stats.blocked} · 跳过 {stats.skipped} · 未执行 {stats.pending}
              </span>
            )}
          </div>
          <Table<PlanCaseRow>
            rowKey="refId"
            size="middle"
            dataSource={filtered}
            pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
            rowSelection={{
              selectedRowKeys: selectedRefs,
              onChange: (keys) => setSelectedRefs(keys.map(String)),
              getCheckboxProps: () => ({ disabled: !writable }),
            }}
            expandable={{
              expandedRowKeys: expandedKeys,
              onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
              expandedRowRender: (row) => (
                <StepExecPanel
                  projectId={projectId}
                  planId={id}
                  row={row}
                  disabled={!writable}
                  onSaved={invalidate}
                />
              ),
            }}
            columns={[
              {
                title: "编号",
                dataIndex: "num",
                width: 88,
                render: (n: number) => <span className="text-[#87888D]">{padNum(n)}</span>,
              },
              {
                title: "用例名称",
                dataIndex: "name",
                ellipsis: true,
                render: (v: string, row) => (
                  <a className="text-[#574BFF]" href={`/cases/${row.caseId}`}>
                    {v}
                  </a>
                ),
              },
              {
                title: "等级",
                dataIndex: "level",
                width: 64,
                render: (l: string) => <Tag color={levelColor[l] ?? "default"}>{l}</Tag>,
              },
              {
                title: "执行人",
                dataIndex: "execUserId",
                width: 180,
                render: (v: string | null, row) => (
                  <MemberSelect
                    projectId={projectId}
                    value={v ?? undefined}
                    onChange={(nv) => {
                      const uid = Array.isArray(nv) ? undefined : (nv as string | undefined);
                      if (uid) batchExecutor.mutate({ refIds: [row.refId], execUserId: uid });
                    }}
                  />
                ),
              },
              {
                title: "我的执行状态",
                dataIndex: "status",
                width: 120,
                render: (v: string, row) => (
                  <Select
                    className="w-full"
                    value={v}
                    disabled={!writable}
                    onChange={(nv) =>
                      exec.mutate({
                        refId: row.refId,
                        body: {
                          status: nv,
                          actualResult: row.result.actualResult ?? "",
                          comment: row.result.comment ?? "",
                        },
                      })
                    }
                    options={Object.entries(EXEC_META).map(([val, m]) => ({
                      value: val,
                      label: <span style={{ color: m.color }}>● {m.label}</span>,
                    }))}
                    data-testid={`exec-select-${row.refId}`}
                  />
                ),
              },
              {
                title: "实际结果",
                key: "actual",
                width: 200,
                render: (_, row) => (
                  <Tooltip title={row.status === "NOT_RUN" ? "先标记执行状态后可填写" : "回车保存"}>
                    <Input
                      key={`${row.refId}-${row.status}`}
                      size="small"
                      defaultValue={row.result.actualResult ?? ""}
                      disabled={!writable || row.status === "NOT_RUN"}
                      placeholder={row.status === "NOT_RUN" ? "—" : "实际结果（回车保存）"}
                      onPressEnter={(e) =>
                        exec.mutate({
                          refId: row.refId,
                          body: {
                            status: row.status,
                            actualResult: (e.target as HTMLInputElement).value,
                            comment: row.result.comment ?? "",
                          },
                        })
                      }
                      data-testid={`actual-input-${row.refId}`}
                    />
                  </Tooltip>
                ),
              },
              {
                title: "操作",
                key: "op",
                width: 220,
                render: (_, row) => (
                  <span className="flex gap-1 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      disabled={!writable}
                      onClick={() =>
                        setExpandedKeys((prev) =>
                          prev.includes(row.refId)
                            ? prev.filter((k) => k !== row.refId)
                            : [...prev, row.refId],
                        )
                      }
                      data-testid={`btn-step-exec-${row.refId}`}
                    >
                      步骤执行
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      disabled={!can("PROJECT_BUG:CREATE")}
                      onClick={() => setBugTarget(row)}
                      data-testid={`btn-new-bug-from-exec-${row.refId}`}
                    >
                      缺陷
                    </Button>
                    <Popconfirm
                      title="取消关联该用例？"
                      description="仅从计划移除，不删除用例与其执行记录之外的用例数据。"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => removeCase.mutate(row.refId)}
                      disabled={!writable}
                    >
                      <Button
                        type="link"
                        size="small"
                        danger
                        className="!px-0"
                        disabled={!writable}
                      >
                        取消关联
                      </Button>
                    </Popconfirm>
                  </span>
                ),
              },
            ]}
          />
        </div>
      ) : (
        <PlanReportTab
          projectId={projectId}
          planId={id}
          archived={archived}
          canUpdate={canUpdate}
          nameOf={nameOf}
        />
      )}

      {/* 批量改执行人 */}
      <Modal
        title={`批量改执行人（已选 ${selectedRefs.length} 条）`}
        open={batchOpen}
        onCancel={() => setBatchOpen(false)}
        onOk={() =>
          batchUser && batchExecutor.mutate({ refIds: selectedRefs, execUserId: batchUser })
        }
        okButtonProps={{ disabled: !batchUser }}
        confirmLoading={batchExecutor.isPending}
        destroyOnHidden
      >
        <div className="py-2">
          <MemberSelect
            projectId={projectId}
            value={batchUser}
            onChange={(v) => setBatchUser(Array.isArray(v) ? undefined : (v as string | undefined))}
            placeholder="选择执行人"
          />
          <p className="text-xs text-[#A8ABB0] mt-2 mb-0">
            将为已勾选的 {selectedRefs.length} 条用例统一指派执行人。
          </p>
        </div>
      </Modal>

      {/* 更多设置抽屉 */}
      <SettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        plan={plan}
        saving={saveSettings.isPending}
        onSave={(s) => saveSettings.mutate(s)}
      />

      {/* 关联用例 */}
      <LinkCasesModal
        projectId={projectId}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        onConfirm={async (caseIds) => {
          const r = await planApi.addCases(projectId, id, caseIds);
          invalidate();
          message.success(`已关联 ${r.added} 条用例`);
        }}
      />

      {/* 缺陷弹窗 */}
      {bugTarget && (
        <BugModal
          key={bugTarget.refId}
          projectId={projectId}
          row={bugTarget}
          onClose={() => setBugTarget(null)}
        />
      )}
    </div>
  );
}

/* ── Tab1：步骤级执行面板（展开行） ── */
function StepExecPanel({
  projectId,
  planId,
  row,
  disabled,
  onSaved,
}: {
  projectId: string;
  planId: string;
  row: PlanCaseRow;
  disabled: boolean;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const qc = useQueryClient();
  const initSteps = () =>
    row.result.steps && row.result.steps.length === row.steps.length
      ? row.result.steps.map((s) => ({ ...s }))
      : row.steps.map(() => ({ status: "NOT_RUN", result: "" }));
  const [steps, setSteps] = useState<{ status: string; result: string }[]>(initSteps);
  const derive = (ss: { status: string }[]) =>
    ss.some((s) => s.status === "FAIL")
      ? "FAIL"
      : ss.some((s) => s.status === "BLOCKED")
        ? "BLOCKED"
        : ss.length > 0 && ss.every((s) => s.status === "PASS")
          ? "PASS"
          : "NOT_RUN";
  const [status, setStatus] = useState(row.status !== "NOT_RUN" ? row.status : derive(initSteps()));
  const [actual, setActual] = useState(row.result.actualResult ?? "");
  const [execComment, setExecComment] = useState(row.result.comment ?? "");

  const save = useMutation({
    mutationFn: () =>
      planApi.exec(projectId, planId, row.refId, {
        status,
        actualResult: actual,
        comment: execComment,
        steps: steps.map((s) => ({ status: s.status, result: s.result })),
      }),
    onSuccess: () => {
      message.success("执行结果已保存");
      void qc.invalidateQueries({ queryKey: ["plan", projectId, planId] });
      onSaved();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });

  return (
    <div className="bg-[#F7F8FA] p-4 space-y-3" data-testid="step-exec-panel">
      <p className="text-xs text-[#A8ABB0] m-0">
        步骤级执行（与用例 steps 逐条对位；失败步骤标红，将作为「新建缺陷」带出内容）
      </p>
      {row.steps.length === 0 && (
        <p className="text-[13px] text-[#A8ABB0] m-0">该用例无步骤，可直接标记整体状态后保存。</p>
      )}
      {row.steps.map((s, i) => {
        const st = steps[i];
        const fail = st?.status === "FAIL";
        return (
          <div
            key={i}
            className={`bg-white border rounded-md p-3 flex items-center gap-3 flex-wrap ${fail ? "border-[#FF4D4F]/40" : "border-[#E5E6EB]"}`}
            data-testid={`step-row-${i + 1}`}
          >
            <span
              className={`w-6 h-6 rounded grid place-items-center text-xs shrink-0 ${fail ? "bg-[#FF4D4F]/10 text-[#FF4D4F]" : "bg-[#F2F3F5] text-[#87888D]"}`}
            >
              {i + 1}
            </span>
            <div className="flex-1 min-w-48 text-xs text-[#646A73] leading-5">
              <p className="m-0">步骤：{s.desc}</p>
              <p className="m-0">期望：{s.expect}</p>
            </div>
            <div className="flex gap-1 shrink-0" data-testid={`step-status-${i + 1}`}>
              {(["PASS", "FAIL", "BLOCKED"] as const).map((r) => {
                const meta = EXEC_META[r] ?? { label: r, color: "#87888D" };
                const active = st?.status === r;
                return (
                  <Button
                    key={r}
                    size="small"
                    disabled={disabled}
                    style={{
                      borderColor: meta.color,
                      color: active ? "#fff" : meta.color,
                      background: active ? meta.color : "transparent",
                    }}
                    onClick={() => {
                      const next = steps.map((x, idx) => (idx === i ? { ...x, status: r } : x));
                      setSteps(next);
                      setStatus(derive(next));
                    }}
                    data-testid={`step-btn-${r}-${i + 1}`}
                  >
                    {r === "PASS" ? "✓ 通过" : r === "FAIL" ? "✗ 失败" : "⊘ 阻塞"}
                  </Button>
                );
              })}
            </div>
            <Input
              size="small"
              className="w-52 shrink-0"
              placeholder="实际结果（选填）"
              value={st?.result ?? ""}
              disabled={disabled}
              onChange={(e) =>
                setSteps((prev) =>
                  prev.map((x, idx) => (idx === i ? { ...x, result: e.target.value } : x)),
                )
              }
              data-testid={`step-actual-${i + 1}`}
            />
          </div>
        );
      })}
      <div className="flex items-center gap-2 justify-end flex-wrap">
        <Select
          className="w-32"
          value={status}
          disabled={disabled}
          onChange={setStatus}
          options={Object.entries(EXEC_META).map(([v, m]) => ({
            value: v,
            label: <span style={{ color: m.color }}>{m.label}</span>,
          }))}
          data-testid={`panel-status-${row.refId}`}
        />
        <Input
          size="small"
          className="w-52"
          placeholder="实际结果（整体，选填）"
          value={actual}
          disabled={disabled}
          onChange={(e) => setActual(e.target.value)}
          data-testid={`panel-actual-${row.refId}`}
        />
        <Input
          size="small"
          className="w-52"
          placeholder="执行评论（选填）"
          value={execComment}
          disabled={disabled}
          onChange={(e) => setExecComment(e.target.value)}
        />
        <Button
          type="primary"
          loading={save.isPending}
          disabled={disabled}
          onClick={() => save.mutate()}
          data-testid={`btn-save-exec-${row.refId}`}
        >
          保存执行结果
        </Button>
      </div>
      {row.execHistory.length > 0 && (
        <p className="text-xs text-[#A8ABB0] m-0">
          执行历史：
          {row.execHistory
            .slice(-3)
            .reverse()
            .map((h) => `${h.ts.slice(5, 16).replace("T", " ")} ${EXEC_META[h.to]?.label ?? h.to}`)
            .join("；")}
        </p>
      )}
    </div>
  );
}

/* ── Tab2：报告 ── */
function PlanReportTab({
  projectId,
  planId,
  archived,
  canUpdate,
  nameOf,
}: {
  projectId: string;
  planId: string;
  archived: boolean;
  canUpdate: boolean;
  nameOf: (uid: string) => string;
}) {
  const { message } = useApp();
  const qc = useQueryClient();
  const { data: report, isLoading } = useQuery({
    queryKey: ["plan-report", projectId, planId],
    queryFn: () => planApi.report(projectId, planId),
  });
  const [summary, setSummary] = useState("");
  useEffect(() => {
    if (report) setSummary(report.summary);
  }, [report]);
  const save = useMutation({
    mutationFn: () => planApi.saveSummary(projectId, planId, summary),
    onSuccess: () => {
      message.success("总结已保存");
      void qc.invalidateQueries({ queryKey: ["plan-report", projectId, planId] });
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  if (isLoading || !report)
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="报告生成中…" />
      </div>
    );

  const threshold = typeof report.settings.threshold === "number" ? report.settings.threshold : 100;
  const s = report.stats;
  return (
    <div>
      <div className="grid grid-cols-4 gap-4 text-sm" data-testid="plan-report-cards">
        <div className="rabbit-card p-4">
          <p className="text-xs text-[#A8ABB0] m-0">通过率（阈值 {threshold}%）</p>
          <p
            className="text-2xl font-semibold mt-1 mb-0"
            style={{ color: report.thresholdMet === false ? "#FF4D4F" : "#52C41A" }}
          >
            {report.passRate === null ? "—" : `${report.passRate}%`}{" "}
            <span className="text-xs">
              {report.thresholdMet === null ? "" : report.thresholdMet ? "达标" : "未达标"}
            </span>
          </p>
        </div>
        <div className="rabbit-card p-4">
          <p className="text-xs text-[#A8ABB0] m-0">已执行 / 总数</p>
          <p className="text-2xl font-semibold mt-1 mb-0">
            {s.executed} <span className="text-sm text-[#A8ABB0]">/ {report.cases.length}</span>
          </p>
        </div>
        <div className="rabbit-card p-4">
          <p className="text-xs text-[#A8ABB0] m-0">通过 / 失败</p>
          <p className="text-2xl font-semibold mt-1 mb-0">
            <span className="text-[#52C41A]">{s.pass}</span>{" "}
            <span className="text-sm text-[#A8ABB0]">/</span>{" "}
            <span className="text-[#FF4D4F]">{s.fail}</span>
          </p>
        </div>
        <div className="rabbit-card p-4">
          <p className="text-xs text-[#A8ABB0] m-0">阻塞 / 跳过</p>
          <p className="text-2xl font-semibold mt-1 mb-0">
            <span className="text-[#FA8C16]">{s.blocked}</span>{" "}
            <span className="text-sm text-[#A8ABB0]">/</span> {s.skipped}
          </p>
        </div>
      </div>
      <div className="rabbit-card mt-4">
        <p className="rabbit-card-title">
          用例结果汇总{" "}
          <span className="text-xs text-[#A8ABB0] font-normal">共 {report.cases.length} 条</span>
        </p>
        <Table<PlanCaseRow>
          rowKey="refId"
          size="small"
          dataSource={report.cases}
          pagination={false}
          columns={[
            {
              title: "编号",
              dataIndex: "num",
              width: 90,
              render: (n: number) => <span className="text-[#87888D]">{padNum(n)}</span>,
            },
            { title: "用例名称", dataIndex: "name", ellipsis: true },
            {
              title: "执行人",
              dataIndex: "execUserId",
              width: 110,
              render: (v: string | null) => (v ? nameOf(v) : "—"),
            },
            {
              title: "结果",
              dataIndex: "status",
              width: 90,
              render: (v: string) => {
                const meta = EXEC_META[v] ?? { label: v, color: "#87888D" };
                return <span style={{ color: meta.color }}>{meta.label}</span>;
              },
            },
            {
              title: "实际结果摘要",
              key: "actual",
              ellipsis: true,
              render: (_, row) => {
                const failed = (row.result.steps ?? []).findIndex((x) => x.status === "FAIL");
                const text =
                  row.result.actualResult ||
                  (failed >= 0
                    ? `步骤 ${failed + 1}：${row.result.steps?.[failed]?.result || "失败"}`
                    : "") ||
                  "—";
                return <span className="text-xs text-[#87888D]">{text}</span>;
              },
            },
            {
              title: "执行时间",
              key: "ts",
              width: 150,
              render: (_, row) => {
                const last = row.execHistory[row.execHistory.length - 1];
                return last ? (
                  <span className="text-xs text-[#87888D]">
                    {last.ts.replace("T", " ").slice(5, 16)} {nameOf(last.userId)}
                  </span>
                ) : (
                  <span className="text-[#C0C4CC]">—</span>
                );
              },
            },
          ]}
        />
      </div>
      <div className="rabbit-card mt-4 p-4">
        <div className="flex items-center gap-2 mb-2">
          <p className="text-sm font-medium m-0">总结</p>
          <span className="text-xs text-[#A8ABB0]">Markdown</span>
          <Button
            type="primary"
            size="small"
            className="!ml-auto"
            loading={save.isPending}
            disabled={archived || !canUpdate}
            onClick={() => save.mutate()}
            data-testid="btn-save-summary"
          >
            保存
          </Button>
        </div>
        <Input.TextArea
          rows={4}
          maxLength={4000}
          value={summary}
          disabled={archived}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="报告总结（Markdown，≤ 4000 字）"
          data-testid="report-summary-input"
        />
        {archived && <p className="text-xs text-[#D46B08] mt-2 mb-0">计划已归档，报告只读。</p>}
      </div>
    </div>
  );
}

/* ── 更多设置抽屉 ── */
function SettingsDrawer({
  open,
  onClose,
  plan,
  saving,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  plan: { settings: { allowDuplicate?: boolean; autoUpdateStatus?: boolean; threshold?: number } };
  saving: boolean;
  onSave: (s: { allowDuplicate: boolean; autoUpdateStatus: boolean; threshold: number }) => void;
}) {
  const [allowDuplicate, setAllowDuplicate] = useState(Boolean(plan.settings.allowDuplicate));
  const [autoUpdateStatus, setAutoUpdateStatus] = useState(Boolean(plan.settings.autoUpdateStatus));
  const [threshold, setThreshold] = useState(
    typeof plan.settings.threshold === "number" ? plan.settings.threshold : 100,
  );
  return (
    <Drawer title="更多设置" open={open} onClose={onClose} width={380} destroyOnHidden>
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium m-0">允许重复关联用例</p>
            <p className="text-xs text-[#A8ABB0] m-0">
              关闭时同一用例二次关联将被拒绝（422 code 10009 DUP_ASSOC）。
            </p>
          </div>
          <Switch
            checked={allowDuplicate}
            onChange={setAllowDuplicate}
            data-testid="drawer-switch-duplicate"
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium m-0">自动更新用例状态</p>
            <Tooltip title="接口域联动后生效（CASE-006），本迭代仅保存配置">
              <p className="text-xs text-[#A8ABB0] m-0 cursor-help">
                关联接口场景执行成功后更新功能用例状态 ⓘ
              </p>
            </Tooltip>
          </div>
          <Switch
            checked={autoUpdateStatus}
            onChange={setAutoUpdateStatus}
            data-testid="drawer-switch-auto-update"
          />
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium m-0">通过阈值（%）</p>
            <p className="text-xs text-[#A8ABB0] m-0">
              通过率 ≥ 阈值 → 达标（通过率口径：pass/(pass+fail+blocked)，跳过不计分母）。
            </p>
          </div>
          <InputNumber
            min={0}
            max={100}
            value={threshold}
            onChange={(v) => setThreshold(v ?? 100)}
            data-testid="drawer-input-threshold"
          />
        </div>
        <Button
          type="primary"
          block
          loading={saving}
          onClick={() => onSave({ allowDuplicate, autoUpdateStatus, threshold })}
          data-testid="btn-save-plan-settings"
        >
          保存设置
        </Button>
      </div>
    </Drawer>
  );
}

/* ── 关联用例弹窗（模块树 + 多选） ── */
function LinkCasesModal({
  projectId,
  open,
  onClose,
  onConfirm,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: (caseIds: string[]) => Promise<void>;
}) {
  const { message } = useApp();
  const [keyword, setKeyword] = useState("");
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (open) {
      setSelectedKeys([]);
      setKeyword("");
      setModuleId(null);
      setPage(1);
    }
  }, [open]);

  const { data: mods } = useQuery({
    queryKey: ["modules", projectId, "case"],
    queryFn: () => moduleApi.list(projectId, "case"),
    enabled: open,
  });
  const { data: cases, isLoading } = useQuery({
    queryKey: ["link-cases", projectId, keyword, moduleId, page, open],
    queryFn: () =>
      caseApiV2.list(projectId, {
        keyword: keyword || undefined,
        moduleId: moduleId ?? undefined,
        includeChildren: moduleId ? "1" : undefined,
        page,
        pageSize: 10,
      }),
    enabled: open,
  });

  type ModuleLike = { id: string; name: string; subtreeCount: number; children: ModuleLike[] };
  const toTree = (nodes: ModuleLike[]): DataNode[] =>
    nodes.map((n) => ({
      key: n.id,
      title: (
        <span className="flex items-center gap-1.5">
          <span className="truncate max-w-32">{n.name}</span>
          <span className="text-[10px] text-[#A8ABB0]">{n.subtreeCount}</span>
        </span>
      ),
      children: n.children.length ? toTree(n.children) : undefined,
    }));
  const findNode = (nodes: ModuleLike[] | undefined, mid: string | null): ModuleLike | null => {
    if (!mid) return null;
    for (const n of nodes ?? []) {
      if (n.id === mid) return n;
      const hit = findNode(n.children, mid);
      if (hit) return hit;
    }
    return null;
  };
  const selectedNode = findNode(mods?.items as ModuleLike[] | undefined, moduleId);
  const isParent = Boolean(selectedNode && selectedNode.children.length > 0);

  const submit = useMutation({
    mutationFn: () => onConfirm(selectedKeys),
    onSuccess: () => onClose(),
    onError: (e) => message.error(e instanceof Error ? e.message : "关联失败"),
  });

  return (
    <Modal
      title="关联用例"
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      <div className="flex gap-3 mt-1" data-testid="link-cases-modal">
        <div className="w-52 shrink-0 border border-[#F0F1F3] rounded-md p-2 max-h-96 overflow-y-auto">
          <p className="text-xs text-[#87888D] px-1 pb-1">模块（scene=case）</p>
          <Tree
            blockNode
            defaultExpandAll
            selectedKeys={moduleId ? [moduleId] : []}
            treeData={toTree((mods?.items ?? []) as ModuleLike[])}
            onSelect={(keys) => {
              setModuleId(keys[0] ? String(keys[0]) : null);
              setPage(1);
            }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <Input.Search
            className="mb-2"
            allowClear
            placeholder="搜索用例名称"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            data-testid="link-cases-keyword"
          />
          {isParent && (
            <p className="text-xs text-[#FA8C16] mb-2">
              已选择父模块：按当前筛选列出其与全部子模块用例（含子级）。
            </p>
          )}
          <Table
            rowKey="id"
            size="small"
            loading={isLoading}
            dataSource={cases?.items ?? []}
            pagination={{
              current: page,
              pageSize: 10,
              total: cases?.total ?? 0,
              onChange: setPage,
              size: "small",
              showTotal: (t) => `共 ${t} 条`,
            }}
            rowSelection={{
              selectedRowKeys: selectedKeys,
              onChange: (keys) => setSelectedKeys(keys.map(String)),
              preserveSelectedRowKeys: true,
            }}
            columns={[
              {
                title: "编号",
                dataIndex: "num",
                width: 84,
                render: (n: number) => <span className="text-[#87888D]">{padNum(n)}</span>,
              },
              { title: "用例名称", dataIndex: "name", ellipsis: true },
              {
                title: "等级",
                dataIndex: "level",
                width: 60,
                render: (l: string) => <Tag color={levelColor[l] ?? "default"}>{l}</Tag>,
              },
            ]}
          />
          <div className="flex justify-end items-center gap-2 mt-3">
            <span className="text-xs text-[#87888D] mr-auto">已选 {selectedKeys.length} 项</span>
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={submit.isPending}
              disabled={selectedKeys.length === 0}
              onClick={() => submit.mutate()}
              data-testid="btn-confirm-link-cases"
            >
              关联 {selectedKeys.length} 条
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ── 缺陷弹窗：新建（预填失败步骤）/ 关联已有 ── */
function BugModal({
  projectId,
  row,
  onClose,
}: {
  projectId: string;
  row: PlanCaseRow;
  onClose: () => void;
}) {
  const { message } = useApp();
  const [tab, setTab] = useState<"new" | "exist">("new");
  const failed = row.steps
    .map((s, i) => ({ ...s, sr: row.result.steps?.[i] }))
    .filter((x) => x.sr && x.sr.status === "FAIL");
  const preDesc = failed.length
    ? `**失败步骤（${padNum(row.num)} ${row.name}）**\n${failed.map((s, i) => `${i + 1}. 步骤：${s.desc}\n   期望：${s.expect}\n   实际：${s.sr!.result || "（未填写）"}`).join("\n")}`
    : "";
  const [title, setTitle] = useState(row.name);
  const [desc, setDesc] = useState(preDesc);
  const [existKeyword, setExistKeyword] = useState("");

  const { data: existBugs } = useQuery({
    queryKey: ["link-bugs", projectId, existKeyword],
    queryFn: () => bugApi.list(projectId, { keyword: existKeyword || undefined, pageSize: 20 }),
  });

  const createAndLink = useMutation({
    mutationFn: async () => {
      const bug = await bugApi.create(projectId, { title: title.trim(), description: desc });
      await bugApi.linkCase(projectId, bug.id, row.caseId);
      return bug;
    },
    onSuccess: (bug) => {
      message.success(`已创建 BUG-${String(bug.num).padStart(4, "0")} 并关联用例`);
      onClose();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });
  const linkExisting = useMutation({
    mutationFn: (bugId: string) => bugApi.linkCase(projectId, bugId, row.caseId),
    onSuccess: () => {
      message.success("已关联缺陷");
      onClose();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "关联失败"),
  });

  return (
    <Modal
      title={`缺陷 · ${padNum(row.num)} ${row.name}`}
      open
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnHidden
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setTab(k as "new" | "exist")}
        items={[
          { key: "new", label: "新建缺陷" },
          { key: "exist", label: "关联已有" },
        ]}
      />
      {tab === "new" ? (
        <div className="space-y-3" data-testid="new-bug-form">
          <div>
            <label className="block text-[13px] mb-1">
              标题 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={title}
              maxLength={512}
              onChange={(e) => setTitle(e.target.value)}
              data-testid="input-bug-title"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述（已预填失败步骤）</label>
            <Input.TextArea
              rows={6}
              maxLength={8000}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              data-testid="input-bug-desc"
            />
            {!preDesc && (
              <p className="text-xs text-[#A8ABB0] mt-1 mb-0">该用例暂无失败步骤，未预填。</p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>取消</Button>
            <Button
              type="primary"
              loading={createAndLink.isPending}
              disabled={!title.trim()}
              onClick={() => createAndLink.mutate()}
              data-testid="btn-submit-new-bug"
            >
              创建并关联
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Input.Search
            className="mb-2"
            allowClear
            placeholder="搜索缺陷标题"
            value={existKeyword}
            onChange={(e) => setExistKeyword(e.target.value)}
            data-testid="input-bug-search"
          />
          <Table
            rowKey="id"
            size="small"
            dataSource={existBugs?.items ?? []}
            pagination={false}
            columns={[
              {
                title: "编号",
                dataIndex: "num",
                width: 90,
                render: (n: number) => (
                  <span className="text-[#87888D]">BUG-{String(n).padStart(4, "0")}</span>
                ),
              },
              { title: "标题", dataIndex: "title", ellipsis: true },
              {
                title: "状态",
                dataIndex: "status",
                width: 90,
                render: (v: string) => <Tag>{v}</Tag>,
              },
              {
                title: "操作",
                key: "op",
                width: 80,
                render: (_, bug) => (
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    loading={linkExisting.isPending}
                    onClick={() => linkExisting.mutate(bug.id)}
                  >
                    关联
                  </Button>
                ),
              },
            ]}
          />
        </div>
      )}
    </Modal>
  );
}
