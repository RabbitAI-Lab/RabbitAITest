"use client";

import {
  Button,
  DatePicker,
  Empty,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { FolderPlus, Plus, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  followApi,
  planApi,
  planGroupApi,
  type PlanGroupMember,
  type PlanGroupRow,
  type PlanRow,
} from "@rabbit/api-client";
import { FollowStar } from "@/components/FollowStar";
import { PageHeader } from "@/components/PageHeader";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";

const STATUS_META: Record<string, { label: string; color: string }> = {
  NOT_STARTED: { label: "未开始", color: "default" },
  UNDERWAY: { label: "进行中", color: "processing" },
  COMPLETED: { label: "已完成", color: "success" },
  ARCHIVED: { label: "已归档", color: "default" },
};
type DayjsLike = { toISOString(): string };

interface PlanForm {
  name: string;
  description: string;
  range: [DayjsLike, DayjsLike] | null;
  tags: string[];
  allowDuplicate: boolean;
  autoUpdateStatus: boolean;
  threshold: number;
}
const EMPTY_FORM: PlanForm = {
  name: "",
  description: "",
  range: null,
  tags: [],
  allowDuplicate: false,
  autoUpdateStatus: false,
  threshold: 100,
};

/** 编辑弹窗回填所需字段（planGroupApi.list 成员行无 settings/tags，编辑时按 id 拉 planApi.detail 补全）。 */
type EditablePlan = Pick<
  PlanRow,
  "id" | "name" | "description" | "tags" | "settings" | "startAt" | "endAt"
>;

function SettingsFields({ form, setForm }: { form: PlanForm; setForm: (f: PlanForm) => void }) {
  return (
    <div
      className="rounded-md border border-[#F0F1F3] p-3 space-y-3 bg-[#FAFBFC]"
      data-testid="plan-settings-fields"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px]">允许重复关联用例</span>
        <Tooltip title="关闭时同一用例二次关联将被拒绝（code 10009）">
          <Switch
            size="small"
            checked={form.allowDuplicate}
            onChange={(v) => setForm({ ...form, allowDuplicate: v })}
            data-testid="switch-allow-duplicate"
          />
        </Tooltip>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px]">自动更新用例状态</span>
        <Tooltip title="接口域联动后生效（CASE-006），本迭代仅保存配置">
          <Switch
            size="small"
            checked={form.autoUpdateStatus}
            onChange={(v) => setForm({ ...form, autoUpdateStatus: v })}
            data-testid="switch-auto-update"
          />
        </Tooltip>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px]">通过阈值（%）</span>
        <InputNumber
          min={0}
          max={100}
          value={form.threshold}
          onChange={(v) => setForm({ ...form, threshold: v ?? 100 })}
          data-testid="input-threshold"
        />
      </div>
    </div>
  );
}

/** 计划行关注星：planGroupApi.list 暂未回传 followed——首帧 false，点击乐观翻转后与服务端同步（followed 回显待列表接口扩展）。 */
function PlanFollowStar({ projectId, planId }: { projectId: string; planId: string }) {
  const { message } = useApp();
  const { can } = usePermissions();
  const [followed, setFollowed] = useState(false);
  const followM = useMutation({
    mutationFn: (on: boolean) => followApi.plan(projectId, planId, on),
    onMutate: (on) => setFollowed(on),
    onSuccess: (r) => setFollowed(r.followed),
    onError: (e, on) => {
      setFollowed(!on);
      message.error(e instanceof Error ? e.message : "关注操作失败");
    },
  });
  if (!can("PROJECT_PLAN:READ")) return null;
  return (
    <FollowStar
      entityType="test_plan"
      entityId={planId}
      followed={followed}
      onToggle={(on) => followM.mutateAsync(on).catch(() => undefined)}
      testid={`plan-follow-${planId}`}
    />
  );
}

/** 计划名链接（成员行/未分组行共用）。 */
function PlanNameLink({ m, indent = false }: { m: PlanGroupMember; indent?: boolean }) {
  const router = useRouter();
  return (
    <a
      className={`text-[#574BFF] font-medium ${indent ? "pl-6" : ""}`}
      href={`/plans/${m.id}`}
      onClick={(e) => {
        e.preventDefault();
        router.push(`/plans/${m.id}`);
      }}
    >
      {m.name}
    </a>
  );
}

function ProgressCell({ m }: { m: PlanGroupMember }) {
  return (
    <div className="flex items-center gap-2" data-testid="plan-progress">
      <Progress percent={m.progress} size="small" showInfo={false} className="!m-0 w-24" />
      <span className="text-xs text-[#87888D]">
        {m.executed}/{m.caseCount}
      </span>
    </div>
  );
}

function PassRateCell({ m }: { m: PlanGroupMember }) {
  if (m.passRate === null) return <span className="text-[#C0C4CC]">—</span>;
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium">{m.passRate}%</span>{" "}
      {m.thresholdMet === null ? null : m.thresholdMet ? (
        <span
          className="text-[10px] rounded px-1 py-0.5 bg-[#52C41A]/10 text-[#52C41A]"
          data-testid="plan-threshold-badge"
        >
          达标
        </span>
      ) : (
        <span
          className="text-[10px] rounded px-1 py-0.5 bg-[#FF4D4F]/10 text-[#FF4D4F]"
          data-testid="plan-threshold-badge"
        >
          未达标
        </span>
      )}
    </span>
  );
}

function StatusCell({ m }: { m: PlanGroupMember }) {
  const meta = STATUS_META[m.archivedAt ? "ARCHIVED" : m.status] ?? {
    label: m.status,
    color: "default",
  };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

/** 组成员内嵌表（缩进成员行：进入 · 移出组 · 关注星）。 */
function GroupMembersTable({
  members,
  projectId,
  canUpdate,
  onMoveOut,
}: {
  members: PlanGroupMember[];
  projectId: string;
  canUpdate: boolean;
  onMoveOut: (m: PlanGroupMember) => void;
}) {
  const router = useRouter();
  return (
    <Table<PlanGroupMember>
      rowKey="id"
      size="small"
      pagination={false}
      dataSource={members}
      columns={[
        {
          title: "名称",
          key: "name",
          render: (_, m) => <PlanNameLink m={m} indent />,
        },
        { title: "用例数", dataIndex: "caseCount", width: 80 },
        {
          title: "执行进度",
          key: "progress",
          width: 180,
          render: (_, m) => <ProgressCell m={m} />,
        },
        {
          title: "通过率",
          key: "passRate",
          width: 130,
          render: (_, m) => <PassRateCell m={m} />,
        },
        {
          title: "状态",
          key: "status",
          width: 90,
          render: (_, m) => <StatusCell m={m} />,
        },
        {
          title: "操作",
          key: "op",
          width: 200,
          render: (_, m) => (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() => router.push(`/plans/${m.id}`)}
              >
                进入
              </Button>
              {canUpdate && !m.archivedAt && (
                <Popconfirm
                  title={`将「${m.name}」移出分组？`}
                  description="移出后该计划回到未分组平铺展示。"
                  onConfirm={() => onMoveOut(m)}
                >
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    data-testid={`plan-move-out-${m.id}`}
                  >
                    移出组
                  </Button>
                </Popconfirm>
              )}
              <PlanFollowStar projectId={projectId} planId={m.id} />
            </span>
          ),
        },
      ]}
    />
  );
}

/** PLAN-001/PLAN-004：测试计划列表（组视图：组行聚合 + 成员行 + 未分组平铺；进度/通过率/阈值/归档/批量归档/关注）。 */
export default function PlanListPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [archivedView, setArchivedView] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EditablePlan | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  // 计划组
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<PlanGroupRow | null>(null);
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  // 移入分组弹窗
  const [moveTarget, setMoveTarget] = useState<PlanGroupMember | null>(null);
  const [moveValue, setMoveValue] = useState<string>("");
  const [newGroupName, setNewGroupName] = useState("");
  // 勾选与展开
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [expandedInited, setExpandedInited] = useState(false);

  // PLAN-004：数据源改用 planGroupApi.list（组 + 成员聚合 + 未分组；服务端不分页，关键字前端过滤）
  const { data, isLoading } = useQuery({
    queryKey: ["plan-groups", projectId, archivedView],
    queryFn: () => planGroupApi.list(projectId!, archivedView),
    enabled: Boolean(projectId),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["plan-groups", projectId] });
    // 详情/报告等其他以 ["plans"] 为前缀的缓存一并失效（含编辑回填）
    void qc.invalidateQueries({ queryKey: ["plans", projectId] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: form.name.trim(),
        description: form.description || undefined,
        tags: form.tags,
        settings: {
          allowDuplicate: form.allowDuplicate,
          autoUpdateStatus: form.autoUpdateStatus,
          threshold: form.threshold,
        },
        ...(form.range
          ? { startAt: form.range[0].toISOString(), endAt: form.range[1].toISOString() }
          : {}),
      };
      return editing
        ? planApi.update(projectId!, editing.id, body)
        : planApi.create(projectId!, {
            ...body,
            startAt: body.startAt ?? null,
            endAt: body.endAt ?? null,
          });
    },
    onSuccess: () => {
      invalidate();
      setModalOpen(false);
      message.success(editing ? "计划已更新" : "计划已创建，进入详情关联用例");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  const archive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      planApi.archive(projectId!, id, archived),
    onSuccess: (_r, p) => {
      invalidate();
      message.success(p.archived ? "计划已归档（只读）" : "已取消归档");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const remove = useMutation({
    mutationFn: (id: string) => planApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("计划已删除（仅解除关联与执行记录，不删除用例本身）");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  // 组 CRUD / 归档 / 移入移出 / 批量归档（PLAN-004）
  const groupSave = useMutation({
    mutationFn: () => {
      const body = { name: groupForm.name.trim(), description: groupForm.description || undefined };
      return editingGroup
        ? planGroupApi.update(projectId!, editingGroup.id, body)
        : planGroupApi.create(projectId!, body);
    },
    onSuccess: () => {
      invalidate();
      setGroupModalOpen(false);
      message.success(editingGroup ? "分组已更新" : "分组已创建");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存失败"),
  });
  const groupArchive = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      archived ? planGroupApi.archive(projectId!, id) : planGroupApi.unarchive(projectId!, id),
    onSuccess: (_r, p) => {
      invalidate();
      message.success(p.archived ? "分组已归档" : "分组已恢复");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const groupRemove = useMutation({
    mutationFn: (id: string) => planGroupApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("分组已删除，成员计划已移回未分组");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const movePlan = useMutation({
    mutationFn: async (p: { planId: string; groupId: string | null; newGroupName?: string }) => {
      let gid = p.groupId;
      if (p.newGroupName) {
        const g = await planGroupApi.create(projectId!, { name: p.newGroupName.trim() });
        gid = g.id;
      }
      return planGroupApi.movePlan(projectId!, p.planId, gid);
    },
    onSuccess: (r) => {
      invalidate();
      setMoveTarget(null);
      message.success(r.groupId ? "已移入分组" : "已移出分组");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "移动失败"),
  });
  const batchArchive = useMutation({
    mutationFn: (p: { ids: string[]; archived: boolean }) =>
      planGroupApi.batchArchive(projectId!, p.ids, p.archived),
    onSuccess: (r, p) => {
      invalidate();
      setSelectedKeys([]);
      message.success(
        `${p.archived ? "已归档" : "已恢复"} ${r.affected} 个计划${
          r.cascadedGroups > 0
            ? `，${r.cascadedGroups} 个分组级联${p.archived ? "归档" : "恢复"}`
            : ""
        }`,
      );
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量操作失败"),
  });

  if (!projectId) {
    return (
      <div className="rabbit-card p-16 flex justify-center">
        <Empty description="请先选择项目" />
      </div>
    );
  }
  const canUpdate = can("PROJECT_PLAN:UPDATE");
  const canCreate = can("PROJECT_PLAN:CREATE");
  const canDelete = can("PROJECT_PLAN:DELETE");

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };
  const openGroupCreate = () => {
    setEditingGroup(null);
    setGroupForm({ name: "", description: "" });
    setGroupModalOpen(true);
  };
  const openGroupEdit = (g: PlanGroupRow) => {
    setEditingGroup(g);
    setGroupForm({ name: g.name, description: g.description ?? "" });
    setGroupModalOpen(true);
  };
  // 成员行缺 settings/tags：编辑前按 id 拉详情回填（planApi.list 已被 planGroupApi.list 取代）
  const openEdit = async (row: { id: string }) => {
    try {
      const d = await planApi.detail(projectId!, row.id);
      setEditing(d);
      setForm({
        name: d.name,
        description: d.description ?? "",
        range: null,
        tags: d.tags,
        allowDuplicate: Boolean(d.settings?.allowDuplicate),
        autoUpdateStatus: Boolean(d.settings?.autoUpdateStatus),
        threshold: typeof d.settings?.threshold === "number" ? d.settings.threshold : 100,
      });
      setModalOpen(true);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "加载计划失败");
    }
  };
  const openMove = (m: PlanGroupMember) => {
    setMoveTarget(m);
    setMoveValue(m.groupId ?? "");
    setNewGroupName("");
  };

  // 关键字过滤（组名命中或任一成员命中则保留组，组内成员同步过滤）
  const kw = keyword.trim().toLowerCase();
  const matchName = (n: string) => !kw || n.toLowerCase().includes(kw);
  const groups = (data?.groups ?? []).filter(
    (g) => matchName(g.name) || g.members.some((m) => matchName(m.name)),
  );
  const ungrouped = (data?.ungrouped ?? []).filter((m) => matchName(m.name));
  const totalPlans = groups.reduce((s, g) => s + g.aggregate.memberCount, 0) + ungrouped.length;

  type ListRow =
    | { key: string; kind: "group"; group: PlanGroupRow }
    | { key: string; kind: "plan"; plan: PlanGroupMember };
  const rows: ListRow[] = [
    ...groups.map((g) => ({ key: `g:${g.id}`, kind: "group" as const, group: g })),
    ...ungrouped.map((m) => ({ key: `p:${m.id}`, kind: "plan" as const, plan: m })),
  ];

  // 组默认全展开（数据首载初始化；视图切换重置）
  useEffect(() => {
    setSelectedKeys([]);
    setExpandedInited(false);
  }, [archivedView]);
  useEffect(() => {
    if (!expandedInited && data) {
      setExpandedKeys((data.groups ?? []).map((g) => `g:${g.id}`));
      setExpandedInited(true);
    }
  }, [data, expandedInited]);

  const selectedIds = selectedKeys.filter((k) => k.startsWith("p:")).map((k) => k.slice(2));
  const allGroups = data?.groups ?? [];

  return (
    <div>
      <PageHeader
        title="测试计划"
        sub="计划 = 用例集合 + 执行配置 + 执行结果聚合（人工列表模式执行）；支持分组聚合与组报告"
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-active-plans"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${!archivedView ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => setArchivedView(false)}
              >
                进行中{!archivedView ? `（${totalPlans}）` : ""}
              </span>
              <span
                data-testid="tab-archived-plans"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${archivedView ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => setArchivedView(true)}
              >
                已归档{archivedView ? `（${totalPlans}）` : ""}
              </span>
            </div>
            {canCreate && (
              <Button
                icon={<FolderPlus size={14} />}
                onClick={openGroupCreate}
                data-testid="btn-new-plan-group"
              >
                新建计划组
              </Button>
            )}
            {canCreate && (
              <Button
                type="primary"
                icon={<Plus size={14} />}
                onClick={openCreate}
                data-testid="btn-new-plan"
              >
                新建计划
              </Button>
            )}
          </div>
        }
      />
      <div className="rabbit-card">
        <div className="flex gap-2 p-3 border-b border-[#F0F1F3]">
          <Input
            style={{ width: 256 }}
            allowClear
            prefix={<Search size={14} className="text-[#A8ABB0]" />}
            placeholder="搜索计划/分组名称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            data-testid="input-plan-keyword"
          />
        </div>
        {selectedIds.length > 0 && (
          <div
            className="flex items-center gap-2 px-3 py-2 border-b border-[#F0F1F3] bg-[#FAFBFC]"
            data-testid="plan-batch-bar"
          >
            <span className="text-[13px]">已选 {selectedIds.length} 个计划</span>
            {canUpdate && (
              <Popconfirm
                title={
                  archivedView
                    ? `恢复 ${selectedIds.length} 个计划？`
                    : `归档 ${selectedIds.length} 个计划？`
                }
                description={
                  archivedView
                    ? "恢复后计划恢复可编辑；当某分组内成员全部恢复时，该分组将级联恢复。"
                    : "归档后计划只读（code 10008 PLAN_ARCHIVED）；当某分组内成员全部归档时，该分组将级联归档。"
                }
                okText={archivedView ? "确认恢复" : "确认归档"}
                onConfirm={() => batchArchive.mutate({ ids: selectedIds, archived: !archivedView })}
              >
                <Button size="small" type="primary" ghost data-testid="plan-batch-archive-btn">
                  {archivedView ? "批量恢复" : "批量归档"}
                </Button>
              </Popconfirm>
            )}
            <Button size="small" onClick={() => setSelectedKeys([])}>
              清除选择
            </Button>
          </div>
        )}
        <Table<ListRow>
          rowKey="key"
          loading={isLoading}
          dataSource={rows}
          onRow={(record) =>
            ({
              "data-testid":
                record.kind === "group" ? `plan-group-row-${record.group.id}` : "plan-row",
              "data-row-id": record.kind === "plan" ? record.plan.id : undefined,
            }) as React.HTMLAttributes<HTMLTableRowElement>
          }
          pagination={false}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys.map(String)),
            // 仅未分组计划行可勾选（组成员经组级归档/移出管理）
            getCheckboxProps: (row) => ({ disabled: row.kind === "group" }),
          }}
          expandable={{
            expandedRowKeys: expandedKeys,
            onExpandedRowsChange: (keys) => setExpandedKeys(keys.map(String)),
            rowExpandable: (row) => row.kind === "group" && row.group.members.length > 0,
            expandedRowRender: (row) =>
              row.kind === "group" ? (
                <GroupMembersTable
                  members={
                    kw ? row.group.members.filter((m) => matchName(m.name)) : row.group.members
                  }
                  projectId={projectId}
                  canUpdate={canUpdate}
                  onMoveOut={(m) => movePlan.mutate({ planId: m.id, groupId: null })}
                />
              ) : null,
          }}
          columns={[
            {
              title: "名称",
              key: "name",
              render: (_, row) =>
                row.kind === "group" ? (
                  <span className="flex items-center gap-2">
                    <span>📁</span>
                    <span className="font-medium">{row.group.name}</span>
                    <Tag className="!mr-0">组 · {row.group.aggregate.memberCount} 成员</Tag>
                    {row.group.description && (
                      <span className="text-xs text-[#A8ABB0] truncate max-w-48">
                        {row.group.description}
                      </span>
                    )}
                  </span>
                ) : (
                  <PlanNameLink m={row.plan} />
                ),
            },
            {
              title: "用例数",
              key: "caseCount",
              width: 80,
              render: (_, row) =>
                row.kind === "group" ? row.group.aggregate.totalRefs : row.plan.caseCount,
            },
            {
              title: "执行进度",
              key: "progress",
              width: 180,
              render: (_, row) =>
                row.kind === "group" ? (
                  <div className="flex items-center gap-2">
                    <Progress
                      percent={
                        row.group.aggregate.totalRefs > 0
                          ? Math.round(
                              (row.group.aggregate.executed / row.group.aggregate.totalRefs) * 100,
                            )
                          : 0
                      }
                      size="small"
                      showInfo={false}
                      className="!m-0 w-24"
                    />
                    <span className="text-xs text-[#87888D]">
                      {row.group.aggregate.executed}/{row.group.aggregate.totalRefs}
                    </span>
                  </div>
                ) : (
                  <ProgressCell m={row.plan} />
                ),
            },
            {
              title: "通过率",
              key: "passRate",
              width: 170,
              render: (_, row) =>
                row.kind === "group" ? (
                  row.group.aggregate.passRate === null ? (
                    <span className="text-[#C0C4CC]">—</span>
                  ) : (
                    <span className="whitespace-nowrap">
                      <span className="font-medium">{row.group.aggregate.passRate}%</span>{" "}
                      <span
                        className="text-[10px] rounded px-1 py-0.5 bg-[#52C41A]/10 text-[#52C41A]"
                        data-testid={`group-threshold-badge-${row.group.id}`}
                      >
                        达标 {row.group.aggregate.thresholdMetCount}/
                        {row.group.aggregate.memberCount}
                      </span>
                    </span>
                  )
                ) : (
                  <PassRateCell m={row.plan} />
                ),
            },
            {
              title: "状态",
              key: "status",
              width: 100,
              render: (_, row) =>
                row.kind === "group" ? (
                  row.group.archivedAt ? (
                    <Tag>已归档</Tag>
                  ) : (
                    <span className="text-[#C0C4CC]">—</span>
                  )
                ) : (
                  <StatusCell m={row.plan} />
                ),
            },
            {
              title: "操作",
              key: "op",
              width: 300,
              render: (_, row) =>
                row.kind === "group" ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/plans/groups/${row.group.id}`)}
                      data-testid={`group-report-link-${row.group.id}`}
                    >
                      报告
                    </Button>
                    {canUpdate && (
                      <Popconfirm
                        title={row.group.archivedAt ? "恢复该分组？" : "归档该分组？"}
                        description="仅分组本身归档/恢复，成员计划保持当前状态。"
                        onConfirm={() =>
                          groupArchive.mutate({ id: row.group.id, archived: !row.group.archivedAt })
                        }
                      >
                        <Button type="link" size="small" className="!px-0">
                          {row.group.archivedAt ? "恢复" : "归档"}
                        </Button>
                      </Popconfirm>
                    )}
                    {canUpdate && (
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        onClick={() => openGroupEdit(row.group)}
                      >
                        编辑
                      </Button>
                    )}
                    {canDelete && (
                      <Popconfirm
                        title={`删除分组「${row.group.name}」？`}
                        description="仅删除分组本身，组内成员计划移回未分组（不删除计划）。"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => groupRemove.mutate(row.group.id)}
                      >
                        <Button type="link" size="small" danger className="!px-0">
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                ) : row.plan.archivedAt ? (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/plans/${row.plan.id}`)}
                    >
                      进入（只读）
                    </Button>
                    {canUpdate && (
                      <Popconfirm
                        title="取消归档后计划恢复可编辑，确认？"
                        onConfirm={() => archive.mutate({ id: row.plan.id, archived: false })}
                      >
                        <Button type="link" size="small" className="!px-0">
                          取消归档
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                ) : (
                  <span className="flex items-center gap-2 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/plans/${row.plan.id}`)}
                    >
                      进入
                    </Button>
                    {canUpdate && (
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        onClick={() => openMove(row.plan)}
                        data-testid={`plan-move-group-${row.plan.id}`}
                      >
                        移入分组
                      </Button>
                    )}
                    <PlanFollowStar projectId={projectId} planId={row.plan.id} />
                    {canUpdate && (
                      <Popconfirm
                        title="归档后计划只读"
                        description="归档后全部写操作将被拒绝（code 10008 PLAN_ARCHIVED），确认归档？"
                        okText="确认归档"
                        onConfirm={() => archive.mutate({ id: row.plan.id, archived: true })}
                      >
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          data-testid="btn-archive-plan"
                        >
                          归档
                        </Button>
                      </Popconfirm>
                    )}
                    {canUpdate && (
                      <Button
                        type="link"
                        size="small"
                        className="!px-0"
                        onClick={() => void openEdit(row.plan)}
                        data-testid={`btn-edit-plan-${row.plan.id}`}
                      >
                        编辑
                      </Button>
                    )}
                    {canDelete && (
                      <Popconfirm
                        title={`删除计划「${row.plan.name}」？`}
                        description="仅解除用例关联与执行记录，不删除用例本身。"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutate(row.plan.id)}
                      >
                        <Button type="link" size="small" danger className="!px-0">
                          删除
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                ),
            },
          ]}
        />
      </div>

      <Modal
        title={editing ? `编辑计划 · ${editing.name}` : "新建计划"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        width={560}
        destroyOnHidden
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">
              名称 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={form.name}
              maxLength={256}
              placeholder="计划名称"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              data-testid="input-plan-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input.TextArea
              rows={2}
              maxLength={2000}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="计划说明（选填）"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">起止时间</label>
            <DatePicker.RangePicker
              className="w-full"
              value={form.range as never}
              onChange={(vals) =>
                setForm({ ...form, range: vals as unknown as [DayjsLike, DayjsLike] | null })
              }
              data-testid="input-plan-range"
            />
            {editing && (
              <p className="text-xs text-[#A8ABB0] mt-1">
                当前：{editing.startAt ? editing.startAt.slice(0, 10) : "—"} ~{" "}
                {editing.endAt ? editing.endAt.slice(0, 10) : "—"}（不重选则保持不变）
              </p>
            )}
          </div>
          <div>
            <label className="block text-[13px] mb-1">标签</label>
            <Select
              mode="tags"
              className="w-full"
              value={form.tags}
              placeholder="输入回车添加（≤ 10 个）"
              onChange={(tags) => setForm({ ...form, tags })}
              data-testid="input-plan-tags"
            />
          </div>
          <div>
            <p className="text-[13px] font-medium mb-2">更多设置</p>
            <SettingsFields form={form} setForm={setForm} />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={save.isPending}
              disabled={!form.name.trim()}
              onClick={() => save.mutate()}
              data-testid="btn-submit-plan"
            >
              {editing ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 新建/编辑计划组 */}
      <Modal
        title={editingGroup ? `编辑分组 · ${editingGroup.name}` : "新建计划组"}
        open={groupModalOpen}
        onCancel={() => setGroupModalOpen(false)}
        footer={null}
        width={480}
        destroyOnHidden
      >
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-[13px] mb-1">
              名称 <span className="text-[#FF4D4F]">*</span>
            </label>
            <Input
              value={groupForm.name}
              maxLength={128}
              placeholder="分组名称"
              onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
              data-testid="input-group-name"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">描述</label>
            <Input.TextArea
              rows={2}
              maxLength={1000}
              value={groupForm.description}
              onChange={(e) => setGroupForm({ ...groupForm, description: e.target.value })}
              placeholder="分组说明（选填）"
              data-testid="input-group-desc"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setGroupModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              loading={groupSave.isPending}
              disabled={!groupForm.name.trim()}
              onClick={() => groupSave.mutate()}
              data-testid="btn-submit-group"
            >
              {editingGroup ? "保存" : "创建"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* 移入分组 */}
      <Modal
        title={`移入分组 · ${moveTarget?.name ?? ""}`}
        open={Boolean(moveTarget)}
        onCancel={() => setMoveTarget(null)}
        footer={null}
        width={480}
        destroyOnHidden
      >
        <div className="space-y-3 pt-2">
          <Radio.Group
            value={moveValue}
            onChange={(e) => setMoveValue(e.target.value)}
            className="!flex flex-col gap-2"
            data-testid="move-group-radios"
          >
            <Radio value="">不属于任何分组</Radio>
            {allGroups.map((g) => (
              <Radio key={g.id} value={g.id} data-testid={`move-group-option-${g.id}`}>
                📁 {g.name}（{g.aggregate.memberCount} 成员）
              </Radio>
            ))}
            <Radio value="__new__">＋ 新建组并移入</Radio>
          </Radio.Group>
          {moveValue === "__new__" && (
            <Input
              placeholder="新分组名称"
              value={newGroupName}
              maxLength={128}
              onChange={(e) => setNewGroupName(e.target.value)}
              data-testid="input-new-group-name"
            />
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMoveTarget(null)}>取消</Button>
            <Button
              type="primary"
              loading={movePlan.isPending}
              disabled={moveValue === "__new__" && !newGroupName.trim()}
              onClick={() => {
                if (!moveTarget) return;
                movePlan.mutate({
                  planId: moveTarget.id,
                  groupId: moveValue === "__new__" || moveValue === "" ? null : moveValue,
                  newGroupName: moveValue === "__new__" ? newGroupName : undefined,
                });
              }}
              data-testid="btn-confirm-move-group"
            >
              确认移入
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
