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
  Select,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { Plus, Search } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { planApi, type PlanRow } from "@rabbit/api-client";
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

/** PLAN-001：测试计划列表（进度 / 通过率+阈值徽标 / 归档筛选 / 新建·编辑）。 */
export default function PlanListPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { message } = useApp();
  const { can } = usePermissions();
  const { currentProjectId: projectId } = useProjectStore();
  const [archivedView, setArchivedView] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ["plans", projectId, archivedView, keyword, page],
    queryFn: () =>
      planApi.list(projectId!, {
        archived: archivedView ? "only" : undefined,
        keyword: keyword || undefined,
        page,
        pageSize: 20,
      }),
    enabled: Boolean(projectId),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["plans", projectId] });
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
  const openEdit = (row: PlanRow) => {
    setEditing(row);
    setForm({
      name: row.name,
      description: row.description ?? "",
      range: null,
      tags: row.tags,
      allowDuplicate: Boolean(row.settings?.allowDuplicate),
      autoUpdateStatus: Boolean(row.settings?.autoUpdateStatus),
      threshold: typeof row.settings?.threshold === "number" ? row.settings.threshold : 100,
    });
    setModalOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="测试计划"
        sub="计划 = 用例集合 + 执行配置 + 执行结果聚合（人工列表模式执行）"
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-active-plans"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${!archivedView ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setArchivedView(false);
                  setPage(1);
                }}
              >
                进行中{!archivedView ? `（${data?.total ?? 0}）` : ""}
              </span>
              <span
                data-testid="tab-archived-plans"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${archivedView ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setArchivedView(true);
                  setPage(1);
                }}
              >
                已归档{archivedView ? `（${data?.total ?? 0}）` : ""}
              </span>
            </div>
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
            className="w-64"
            allowClear
            prefix={<Search size={14} className="text-[#A8ABB0]" />}
            placeholder="搜索计划名称"
            value={keyword}
            onChange={(e) => {
              setKeyword(e.target.value);
              setPage(1);
            }}
            data-testid="input-plan-keyword"
          />
        </div>
        <Table<PlanRow>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.items ?? []}
          onRow={(record) =>
            ({
              "data-testid": "plan-row",
              "data-row-id": record.id,
            }) as React.HTMLAttributes<HTMLTableRowElement>
          }
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total ?? 0,
            onChange: setPage,
            showTotal: (t) => `共 ${t} 条`,
          }}
          columns={[
            {
              title: "名称",
              dataIndex: "name",
              render: (v: string, row) => (
                <a
                  className="text-[#574BFF] font-medium"
                  href={`/plans/${row.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    router.push(`/plans/${row.id}`);
                  }}
                >
                  {v}
                </a>
              ),
            },
            { title: "用例数", dataIndex: "caseCount", width: 80 },
            {
              title: "执行进度",
              dataIndex: "progress",
              width: 180,
              render: (_v: number, row) => (
                <div className="flex items-center gap-2" data-testid="plan-progress">
                  <Progress
                    percent={row.progress}
                    size="small"
                    showInfo={false}
                    className="!m-0 w-24"
                  />
                  <span className="text-xs text-[#87888D]">
                    {row.executed}/{row.caseCount}
                  </span>
                </div>
              ),
            },
            {
              title: "通过率",
              dataIndex: "passRate",
              width: 150,
              render: (v: number | null, row) => {
                if (v === null) return <span className="text-[#C0C4CC]">—</span>;
                const threshold =
                  typeof row.settings?.threshold === "number" ? row.settings.threshold : 100;
                return (
                  <span className="whitespace-nowrap">
                    <span className="font-medium">{v}%</span>{" "}
                    {row.thresholdMet === null ? null : row.thresholdMet ? (
                      <span
                        className="text-[10px] rounded px-1 py-0.5 bg-[#52C41A]/10 text-[#52C41A]"
                        data-testid="plan-threshold-badge"
                      >
                        达标 ≥{threshold}%
                      </span>
                    ) : (
                      <span
                        className="text-[10px] rounded px-1 py-0.5 bg-[#FF4D4F]/10 text-[#FF4D4F]"
                        data-testid="plan-threshold-badge"
                      >
                        未达标 ≥{threshold}%
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              title: "状态",
              dataIndex: "status",
              width: 100,
              render: (v: string, row) => {
                const meta = STATUS_META[row.archivedAt ? "ARCHIVED" : v] ?? {
                  label: v,
                  color: "default",
                };
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            {
              title: "起止时间",
              key: "period",
              width: 150,
              render: (_, row) => (
                <span className="text-[#87888D] text-xs whitespace-nowrap">
                  {row.startAt ? row.startAt.slice(5, 10) : "—"} ~{" "}
                  {row.endAt ? row.endAt.slice(5, 10) : "—"}
                </span>
              ),
            },
            {
              title: "操作",
              key: "op",
              width: 240,
              render: (_, row) =>
                row.archivedAt ? (
                  <span className="flex gap-2 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/plans/${row.id}`)}
                    >
                      进入（只读）
                    </Button>
                    {canUpdate && (
                      <Popconfirm
                        title="取消归档后计划恢复可编辑，确认？"
                        onConfirm={() => archive.mutate({ id: row.id, archived: false })}
                      >
                        <Button type="link" size="small" className="!px-0">
                          取消归档
                        </Button>
                      </Popconfirm>
                    )}
                  </span>
                ) : (
                  <span className="flex gap-2 whitespace-nowrap">
                    <Button
                      type="link"
                      size="small"
                      className="!px-0"
                      onClick={() => router.push(`/plans/${row.id}`)}
                    >
                      进入
                    </Button>
                    {canUpdate && (
                      <Popconfirm
                        title="归档后计划只读"
                        description="归档后全部写操作将被拒绝（code 10008 PLAN_ARCHIVED），确认归档？"
                        okText="确认归档"
                        onConfirm={() => archive.mutate({ id: row.id, archived: true })}
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
                        onClick={() => openEdit(row)}
                        data-testid={`btn-edit-plan-${row.id}`}
                      >
                        编辑
                      </Button>
                    )}
                    {canDelete && (
                      <Popconfirm
                        title={`删除计划「${row.name}」？`}
                        description="仅解除用例关联与执行记录，不删除用例本身。"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => remove.mutate(row.id)}
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
    </div>
  );
}
