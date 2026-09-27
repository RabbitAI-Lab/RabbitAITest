"use client";

/** S4 PLAN-002 测试规划 Tab：左测试点树 + 右点内用例清单 + 点配置抽屉 + 关联（三页签+挂点）。 */
import {
  Button,
  Drawer,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Select,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  message as antMessage,
} from "antd";
import type { DataNode } from "antd/es/tree";
import { Loader2, Plus } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  apiApi,
  apiCaseApi,
  caseApiV2,
  envApi,
  moduleApi,
  planApi,
  planCaseApi,
  pointApi,
  scenarioApi,
  type PlanCaseRow,
} from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { usePlanExecute } from "./PlanExecBar";

const EXEC_META: Record<string, { label: string; color: string }> = {
  NOT_RUN: { label: "未执行", color: "#87888D" },
  PASS: { label: "通过", color: "#52C41A" },
  FAIL: { label: "失败", color: "#FF4D4F" },
  BLOCKED: { label: "阻塞", color: "#FA8C16" },
  SKIPPED: { label: "跳过", color: "#C9CDD4" },
};
const REF_TYPE_TAG: Record<string, { label: string; cls: string }> = {
  functional_case: { label: "功能", cls: "bg-green-50 text-green-600 border-green-200" },
  api_case: { label: "接口", cls: "bg-blue-50 text-blue-600 border-blue-200" },
  scenario: { label: "场景", cls: "bg-purple-50 text-purple-600 border-purple-200" },
};

interface PointRow {
  id: string;
  parentId: string | null;
  name: string;
  inheritConfig: boolean;
  config: { envId?: string | null; poolId?: string | null; serial?: boolean; stopOnFail?: boolean };
  order: number;
  counts: { functional_case: number; api_case: number; scenario: number };
  children: PointRow[];
}

export function PointsPanel({
  projectId,
  planId,
  cases,
  writable,
}: {
  projectId: string;
  planId: string;
  cases: (PlanCaseRow & { pointId?: string | null })[];
  writable: boolean;
}) {
  const qc = useQueryClient();
  const { message } = useApp();
  const canUpdate = usePermissions().can("PROJECT_PLAN:UPDATE") && writable;
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null); // null=未分组
  const [configOpen, setConfigOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState<{ refIds: string[] } | null>(null);

  const pointsQ = useQuery({
    queryKey: ["plan-points", planId],
    queryFn: () => pointApi.list(projectId, planId),
  });
  const points = pointsQ.data?.points ?? [];
  const ungrouped = pointsQ.data?.ungrouped;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["plan-points", planId] });
    qc.invalidateQueries({ queryKey: ["plan-detail", planId] });
  };

  const createPoint = useMutation({
    mutationFn: (v: { name: string; parentId: string | null }) =>
      pointApi.create(projectId, planId, v),
    onSuccess: () => {
      message.success("测试点已创建");
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const renamePoint = useMutation({
    mutationFn: (v: { id: string; name: string }) => pointApi.update(projectId, planId, v.id, { name: v.name }),
    onSuccess: () => {
      message.success("已重命名");
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  /** 执行本点（PLAN-003：构造限定该点的引擎任务；mutation 来自 PlanExecBar 复用 hook）。 */
  const executePoint = usePlanExecute(projectId, planId);
  const deletePoint = useMutation({
    mutationFn: (id: string) => pointApi.remove(projectId, planId, id),
    onSuccess: (_r, id) => {
      message.success("测试点已删除");
      if (selectedPoint === id) setSelectedPoint(null);
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });
  const moveCases = useMutation({
    mutationFn: (v: { refIds: string[]; pointId: string | null }) =>
      pointApi.moveCases(projectId, planId, v.refIds, v.pointId),
    onSuccess: (r) => {
      message.success(`已移动 ${r.affected} 条`);
      setMoveOpen(null);
      invalidate();
    },
    onError: (e: Error) => message.error(e.message),
  });

  // 点树扁平化（含路径）
  const flatten = (nodes: PointRow[], depth: number): { p: PointRow; depth: number }[] =>
    nodes.flatMap((n) => [{ p: n, depth }, ...flatten(n.children ?? [], depth + 1)]);
  const flat = flatten(points, 0);
  const idOf = selectedPoint ?? "";

  const currentName = selectedPoint
    ? (flat.find((f) => f.p.id === selectedPoint)?.p.name ?? "测试点")
    : "未分组";
  const currentLabel = selectedPoint
    ? (flat.find((f) => f.p.id === selectedPoint)?.p.inheritConfig
        ? "继承配置：沿祖先链 → 计划默认"
        : "显式配置")
    : "执行配置：计划默认";

  const pointCases = cases.filter((c) =>
    selectedPoint ? c.pointId === selectedPoint : !c.pointId,
  );
  const [moveSel, setMoveSel] = useState<string | null>(null);

  const treeData: DataNode[] = [
    ...buildPointTree(points, {
      canUpdate,
      onSelect: (id) => setSelectedPoint(id),
      selectedPoint,
      onAddChild: (parentId) => {
        let name = "";
        Modal.confirm({
          title: "添加子测试点",
          content: (
            <Input
              placeholder="测试点名称"
              onChange={(e) => {
                name = e.target.value;
              }}
            />
          ),
          onOk: () =>
            name.trim()
              ? createPoint.mutateAsync({ name: name.trim(), parentId })
              : Promise.reject("名称不能为空"),
        });
      },
      onRename: (id, oldName) => {
        let name = oldName;
        Modal.confirm({
          title: "重命名测试点",
          content: (
            <Input
              defaultValue={oldName}
              onChange={(e) => {
                name = e.target.value;
              }}
            />
          ),
          onOk: () =>
            name.trim() && name !== oldName
              ? renamePoint.mutateAsync({ id, name: name.trim() })
              : Promise.resolve(),
        });
      },
      onDelete: (id) => deletePoint.mutate(id),
    }),
    {
      title: (
        <span
          className={selectedPoint === null ? "text-[#574BFF] font-medium" : "text-[#A8ABB0] italic"}
          data-testid="point-ungrouped"
        >
          未分组
          <span className="ml-1 text-[10px] border rounded px-1 bg-slate-100 text-slate-500">
            全部 {ungrouped ? ungrouped.functional_case + ungrouped.api_case + ungrouped.scenario : 0}
          </span>
        </span>
      ),
      key: "__ungrouped__",
    },
  ];

  return (
    <div className="flex gap-3 items-stretch" data-testid="plan-points-panel">
      {/* 左：测试点树 */}
      <div className="rabbit-card w-[280px] shrink-0">
        <div className="flex items-center justify-between px-3 h-11 border-b border-[#F0F1F3]">
          <span className="text-sm font-medium">测试点</span>
          {canUpdate && (
            <Button
              size="small"
              type="text"
              icon={<Plus size={14} />}
              onClick={() => {
                let name = "";
                Modal.confirm({
                  title: "添加测试点",
                  content: (
                    <Input
                      placeholder="测试点名称"
                      onChange={(e) => {
                        name = e.target.value;
                      }}
                    />
                  ),
                  onOk: () =>
                    name.trim()
                      ? createPoint.mutateAsync({ name: name.trim(), parentId: null })
                      : Promise.reject("名称不能为空"),
                });
              }}
              data-testid="btn-add-point"
            >
              父点
            </Button>
          )}
        </div>
        <div className="p-2 overflow-auto max-h-[560px]">
          {pointsQ.isLoading ? (
            <div className="flex justify-center py-8 text-[#A8ABB0]">
              <Loader2 className="animate-spin" size={16} />
            </div>
          ) : (
            <Tree treeData={treeData} defaultExpandAll blockNode />
          )}
        </div>
      </div>

      {/* 右：点内清单 */}
      <div className="rabbit-card flex-1 min-w-0">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-[#F0F1F3] flex-wrap">
          <span className="text-sm font-medium" data-testid="point-current-name">
            {currentName}
          </span>
          <span className="text-[10px] border rounded px-1.5 py-0.5 bg-slate-100 text-slate-500">
            {currentLabel}
          </span>
          <div className="ml-auto flex gap-2">
            {canUpdate && (
              <>
                {selectedPoint && (
                  <Button size="small" onClick={() => setConfigOpen(true)} data-testid="btn-point-config">
                    点配置
                  </Button>
                )}
                <Button size="small" icon={<Plus size={12} />} onClick={() => setLinkOpen(true)} data-testid="btn-link-to-point">
                  关联用例
                </Button>
              </>
            )}
            <Button
              size="small"
              type="primary"
              loading={executePoint.isPending}
              disabled={!canUpdate}
              onClick={() => executePoint.mutate(selectedPoint ?? undefined)}
              data-testid="btn-execute-point"
            >
              ▶ 执行本点
            </Button>
          </div>
        </div>
        <Table<(PlanCaseRow & { pointId?: string | null })>
          rowKey="refId"
          size="middle"
          dataSource={pointCases}
          pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条` }}
          locale={{ emptyText: <Empty description="暂无挂载用例" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          columns={[
            {
              title: "类型",
              width: 84,
              render: (_, r) => {
                const t = REF_TYPE_TAG[(r.refType as string)] ?? REF_TYPE_TAG.functional_case!;
                return <span className={`text-[10px] border rounded px-1.5 py-0.5 ${t.cls}`}>{t.label}</span>;
              },
            },
            { title: "名称", dataIndex: "name", ellipsis: true },
            { title: "执行人", width: 90, render: (_, r) => r.execUserId?.slice(0, 8) ?? "—" },
            {
              title: "状态",
              width: 90,
              render: (_, r) => {
                const m = EXEC_META[r.status] ?? EXEC_META.NOT_RUN!;
                return (
                  <span style={{ color: m.color }} className="font-medium">
                    {m.label}
                  </span>
                );
              },
            },
            ...(canUpdate
              ? [
                  {
                    title: "操作",
                    width: 150,
                    render: (_: unknown, r: PlanCaseRow & { pointId?: string | null }) => (
                      <span className="space-x-2 text-[#574BFF] text-xs">
                        <a onClick={() => planApi.removeCase(projectId, planId, r.refId).then(() => { invalidate(); message.success("已移出"); }).catch((e: Error) => message.error(e.message))}>
                          移出
                        </a>
                        <a onClick={() => { setMoveOpen({ refIds: [r.refId] }); setMoveSel(r.pointId ?? null); }} data-testid={`btn-move-ref-${r.refId}`}>
                          移到其他点
                        </a>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
      </div>

      {/* 点配置抽屉 */}
      {selectedPoint && (
        <PointConfigDrawer
          projectId={projectId}
          planId={planId}
          point={(() => { const hit = flat.find((f) => f.p.id === selectedPoint); return hit ? hit.p : null; })()}
          open={configOpen}
          onClose={() => setConfigOpen(false)}
          onSaved={invalidate}
        />
      )}

      {/* 关联用例（三页签+挂点） */}
      {linkOpen && (
        <LinkPointCasesModal
          projectId={projectId}
          planId={planId}
          defaultPointId={selectedPoint}
          points={flat.map((f) => f.p)}
          onClose={() => setLinkOpen(false)}
          onLinked={invalidate}
        />
      )}

      {/* 移动弹窗 */}
      <Modal
        open={moveOpen !== null}
        title={`移动到其他点（${moveOpen?.refIds.length ?? 0} 项）`}
        onCancel={() => setMoveOpen(null)}
        onOk={() => moveOpen && moveCases.mutate({ refIds: moveOpen.refIds, pointId: moveSel })}
        okText="移动"
        okButtonProps={{ "data-testid": "btn-confirm-move" } as { "data-testid": string }}
      >
        <div className="border rounded p-2 text-[13px] space-y-1">
          <label className="flex items-center gap-2">
            <input type="radio" checked={moveSel === null} onChange={() => setMoveSel(null)} /> 未分组
          </label>
          {flat.map((f) => (
            <label key={f.p.id} className="flex items-center gap-2" style={{ paddingLeft: f.depth * 12 }}>
              <input
                type="radio"
                checked={moveSel === f.p.id}
                onChange={() => setMoveSel(f.p.id)}
              />
              {f.p.name}
            </label>
          ))}
        </div>
      </Modal>
    </div>
  );
}

function buildPointTree(
  nodes: PointRow[],
  opts: {
    canUpdate: boolean;
    selectedPoint: string | null;
    onSelect: (id: string) => void;
    onAddChild: (parentId: string) => void;
    onRename: (id: string, name: string) => void;
    onDelete: (id: string) => void;
  },
): DataNode[] {
  return nodes.map((n) => ({
    title: (
      <span className="group flex items-center gap-1.5 w-full" data-testid={`point-node-${n.id}`}>
        <span
          className={opts.selectedPoint === n.id ? "text-[#574BFF] font-medium" : ""}
          onClick={() => opts.onSelect(n.id)}
        >
          {n.name}
        </span>
        {(n.counts.functional_case > 0 || n.counts.api_case > 0 || n.counts.scenario > 0) && (
          <>
            {n.counts.functional_case > 0 && (
              <span className="text-[10px] border rounded px-1 bg-green-50 text-green-600 border-green-200">
                功能 {n.counts.functional_case}
              </span>
            )}
            {n.counts.api_case > 0 && (
              <span className="text-[10px] border rounded px-1 bg-blue-50 text-blue-600 border-blue-200">
                接口 {n.counts.api_case}
              </span>
            )}
            {n.counts.scenario > 0 && (
              <span className="text-[10px] border rounded px-1 bg-purple-50 text-purple-600 border-purple-200">
                场景 {n.counts.scenario}
              </span>
            )}
          </>
        )}
        {opts.canUpdate && (
          <span className="ml-auto hidden group-hover:inline-flex gap-1 text-xs">
            <a className="text-[#574BFF]" onClick={() => opts.onAddChild(n.id)}>
              ＋子
            </a>
            <a className="text-[#574BFF]" onClick={() => opts.onRename(n.id, n.name)}>
              ✎
            </a>
            <Popconfirm title="删除测试点？" description="点下有用例或子点时将被拒绝" onConfirm={() => opts.onDelete(n.id)}>
              <a className="text-red-400">🗑</a>
            </Popconfirm>
          </span>
        )}
      </span>
    ),
    key: n.id,
    children: buildPointTree(n.children ?? [], opts),
  }));
}

function PointConfigDrawer({
  projectId,
  planId,
  point,
  open,
  onClose,
  onSaved,
}: {
  projectId: string;
  planId: string;
  point: PointRow | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { message } = useApp();
  const [inherit, setInherit] = useState(true);
  const [envId, setEnvId] = useState<string | null>(null);
  const [serial, setSerial] = useState(true);
  const [stopOnFail, setStopOnFail] = useState(false);
  const [loaded, setLoaded] = useState<string | null>(null);
  if (point && loaded !== point.id) {
    setLoaded(point.id);
    setInherit(point.inheritConfig);
    setEnvId(point.config?.envId ?? null);
    setSerial(point.config?.serial ?? true);
    setStopOnFail(point.config?.stopOnFail ?? false);
  }
  const envsQ = useQuery({
    queryKey: ["envs", projectId],
    queryFn: () => envApi.list(projectId),
  });
  const save = useMutation({
    mutationFn: () =>
      pointApi.update(projectId, planId, point!.id, {
        inheritConfig: inherit,
        config: inherit ? {} : { envId, serial, stopOnFail },
      }),
    onSuccess: () => {
      message.success("点配置已保存");
      onSaved();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });
  return (
    <Drawer title={`点配置 · ${point?.name ?? ""}`} open={open} onClose={onClose} width={360} data-testid="point-config-drawer">
      <div className="space-y-3 text-[13px]">
        <label className="flex items-center gap-2">
          <Switch size="small" checked={inherit} onChange={setInherit} />
          继承上级配置（链尾回退计划默认）
        </label>
        <div className={`space-y-3 border rounded p-3 ${inherit ? "opacity-50 pointer-events-none" : ""}`}>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 w-16">环境</span>
            <Select
              className="flex-1"
              allowClear
              value={envId ?? undefined}
              onChange={(v) => setEnvId(v ?? null)}
              options={(envsQ.data?.items ?? []).map((e: { id: string; name: string }) => ({ value: e.id, label: e.name }))}
              placeholder="计划默认"
              data-testid="point-config-env"
            />
          </div>
          <label className="flex items-center gap-2">
            <Switch size="small" checked={serial} onChange={setSerial} /> 串行执行
          </label>
          <label className="flex items-center gap-2">
            <Switch size="small" checked={stopOnFail} onChange={setStopOnFail} /> 失败停止
          </label>
        </div>
        <p className="text-[11px] text-[#A8ABB0]">生效优先级：点显式 &gt; 祖先链 &gt; 计划默认</p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={save.isPending} onClick={() => save.mutate()} data-testid="btn-save-point-config">
            保存
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

function LinkPointCasesModal({
  projectId,
  planId,
  defaultPointId,
  points,
  onClose,
  onLinked,
}: {
  projectId: string;
  planId: string;
  defaultPointId: string | null;
  points: PointRow[];
  onClose: () => void;
  onLinked: () => void;
}) {
  const { message } = useApp();
  const [tab, setTab] = useState<"cases" | "apiCases" | "scenarios">("cases");
  const [pointId, setPointId] = useState<string | null>(defaultPointId);
  const [moduleId, setModuleId] = useState<string | undefined>();
  const [keyword, setKeyword] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "case"],
    queryFn: () => moduleApi.list(projectId, "case"),
    enabled: tab === "cases",
  });
  const casesQ = useQuery({
    queryKey: ["pick-cases", projectId, keyword],
    queryFn: () =>
      caseApiV2.list(projectId, {
        keyword: keyword || undefined,
        moduleId,
        includeChildren: "true",
        page: 1,
        pageSize: 50,
      }),
    enabled: tab === "cases",
  });
  const apisQ = useQuery({
    queryKey: ["pick-apis", projectId],
    queryFn: () => apiApi.list(projectId, { page: 1, pageSize: 20 }),
    enabled: tab === "apiCases",
  });
  const [pickApiId, setPickApiId] = useState<string | null>(null);
  const apiCasesQ = useQuery({
    queryKey: ["pick-api-cases", projectId, pickApiId],
    queryFn: () => apiCaseApi.list(projectId, pickApiId!, { pageSize: 50 }),
    enabled: tab === "apiCases" && Boolean(pickApiId),
  });
  const scenariosQ = useQuery({
    queryKey: ["pick-scenarios", projectId],
    queryFn: () => scenarioApi.list(projectId, { page: 1, pageSize: 50 }),
    enabled: tab === "scenarios",
  });

  const link = useMutation({
    mutationFn: () => {
      const ids = [...checked];
      return planCaseApi.add(projectId, planId, {
        caseIds: tab === "cases" ? ids : [],
        apiCaseIds: tab === "apiCases" ? ids : [],
        scenarioIds: tab === "scenarios" ? ids : [],
        pointId,
      });
    },
    onSuccess: () => {
      message.success(`已关联 ${checked.size} 条`);
      onLinked();
      onClose();
    },
    onError: (e: Error) => message.error(e.message),
  });

  const moduleTree: DataNode[] = (modulesQ.data?.items ?? [])
    .filter((m: { parentId: string | null }) => !m.parentId)
    .map((root: { id: string; name: string }) => ({
      title: root.name,
      key: root.id,
      children: (modulesQ.data?.items ?? [])
        .filter((m: { parentId: string | null }) => m.parentId === root.id)
        .map((c: { id: string; name: string }) => ({ title: c.name, key: c.id })),
    }));

  return (
    <Modal
      open
      title={`关联用例到「${pointId ? (points.find((p) => p.id === pointId)?.name ?? "") : "未分组"}」`}
      onCancel={onClose}
      width={760}
      footer={
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#A8ABB0]">挂载到点</span>
          <Select
            className="w-44"
            value={pointId ?? undefined}
            allowClear
            placeholder="未分组"
            onChange={(v) => setPointId(v ?? null)}
            options={points.map((p) => ({ value: p.id, label: p.name }))}
            data-testid="link-point-select"
          />
          <div className="flex-1" />
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            disabled={checked.size === 0}
            loading={link.isPending}
            onClick={() => link.mutate()}
            data-testid="btn-confirm-link"
          >
            关联 ({checked.size})
          </Button>
        </div>
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => {
          setTab(k as typeof tab);
          setChecked(new Set());
        }}
        items={[
          { key: "cases", label: "功能用例", },
          { key: "apiCases", label: "接口用例" },
          { key: "scenarios", label: "场景" },
        ]}
      />
      <div className="flex gap-3 pt-1">
        {tab === "cases" && (
          <div className="w-[220px] border rounded p-2 max-h-[340px] overflow-auto">
            <Tree
              treeData={[{ title: "全部模块", key: "all" }, ...moduleTree]}
              defaultExpandAll
              onSelect={(keys) => {
                const k = keys[0];
                setModuleId(k && k !== "all" ? String(k) : undefined);
              }}
            />
          </div>
        )}
        <div className="flex-1">
          {tab === "cases" && (
            <Input.Search
              placeholder="搜索用例名称"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="mb-2"
            />
          )}
          {tab === "apiCases" && (
            <Select
              className="w-full mb-2"
              placeholder="选择接口定义"
              value={pickApiId ?? undefined}
              onChange={(v) => {
                setPickApiId(v ?? null);
                setChecked(new Set());
              }}
              options={(apisQ.data?.items ?? []).map((a: { id: string; name: string; method: string; path: string }) => ({
                value: a.id,
                label: `${a.method} ${a.path} · ${a.name}`,
              }))}
            />
          )}
          <div className="border rounded divide-y max-h-[320px] overflow-auto text-[13px]" data-testid="link-candidates">
            {tab === "cases" &&
              (casesQ.data?.items ?? []).map((c: { id: string; name: string; level: string }) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAFBFC]">
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}
                  <Tag className="ml-auto">{c.level}</Tag>
                </label>
              ))}
            {tab === "apiCases" &&
              pickApiId &&
              (apiCasesQ.data?.items ?? []).map((c: { id: string; name: string; level: string }) => (
                <label key={c.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAFBFC]">
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} /> {c.name}
                  <Tag className="ml-auto">{c.level}</Tag>
                </label>
              ))}
            {tab === "apiCases" && !pickApiId && (
              <p className="px-3 py-6 text-center text-xs text-[#A8ABB0]">请先选择接口定义</p>
            )}
            {tab === "scenarios" &&
              (scenariosQ.data?.items ?? []).map((s: { id: string; name: string; level: string }) => (
                <label key={s.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[#FAFBFC]">
                  <input type="checkbox" checked={checked.has(s.id)} onChange={() => toggle(s.id)} /> {s.name}
                  <Tag className="ml-auto">{s.level}</Tag>
                </label>
              ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
