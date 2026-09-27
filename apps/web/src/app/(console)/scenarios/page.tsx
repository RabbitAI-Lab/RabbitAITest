"use client";

/**
 * API-006 场景列表页（原型画板一/三）：模块树 + 场景/回收站页签 + 批量执行（API-008）/
 * 导入导出（API-009）/定时任务与误报规则入口。
 */
import { Button, Drawer, Empty, Input, Modal, Popconfirm, Radio, Select, Switch, Table, Tag } from "antd";
import { Download, Play, Plus, Upload } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { moduleApi, poolApi, scenarioApi } from "@rabbit/api-client";
import type { ScenarioRow } from "@rabbit/api-client";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import { PageHeader } from "@/components/PageHeader";
import { ModuleTreePanel } from "@/components/ModuleTreePanel";
import EnvSelect from "@/components/api/EnvSelect";

const LEVEL_META: Record<string, { color: string; label: string }> = {
  P0: { color: "#FF4D4F", label: "P0" },
  P1: { color: "#FA8C16", label: "P1" },
  P2: { color: "#646A73", label: "P2" },
  P3: { color: "#A8ABB0", label: "P3" },
};
const STATUS_META: Record<string, { color: string; label: string }> = {
  PREPARE: { color: "#87888D", label: "未开始" },
  UNDERWAY: { color: "#1677FF", label: "进行中" },
  COMPLETED: { color: "#52C41A", label: "已完成" },
};
const LAST_RUN_META: Record<string, { color: string; label: string }> = {
  SUCCESS: { color: "#52C41A", label: "SUCCESS" },
  FAILED: { color: "#FF4D4F", label: "FAILED" },
  FAKE_ERROR: { color: "#FA8C16", label: "误报" },
  STOPPED: { color: "#87888D", label: "STOPPED" },
};

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "刚刚";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  return d.toLocaleDateString("zh-CN");
}

export default function ScenarioListPage() {
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const { message, modal } = useApp();
  const router = useRouter();
  const qc = useQueryClient();

  const [tab, setTab] = useState<"list" | "recycle">("list");
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [level, setLevel] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [historyOf, setHistoryOf] = useState<ScenarioRow | null>(null);

  // 弹窗状态
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newModule, setNewModule] = useState<string>("");
  const [newLevel, setNewLevel] = useState("P2");
  const [execOpen, setExecOpen] = useState<ScenarioRow[] | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>("");

  const canCreate = can("PROJECT_SCENARIO:CREATE");
  const canUpdate = can("PROJECT_SCENARIO:UPDATE");
  const canDelete = can("PROJECT_SCENARIO:DELETE");

  const listQuery = useMemo(
    () => ({
      page,
      pageSize: 20,
      includeChildren: true,
      recycle: tab === "recycle",
      ...(moduleId ? { moduleId } : {}),
      ...(keyword.trim() ? { keyword: keyword.trim() } : {}),
      ...(level ? { level } : {}),
      ...(status ? { status } : {}),
    }),
    [page, tab, moduleId, keyword, level, status],
  );

  const listQ = useQuery({
    queryKey: ["scenarios", "list", projectId, JSON.stringify(listQuery)],
    queryFn: () => scenarioApi.list(projectId!, listQuery),
    enabled: Boolean(projectId),
  });

  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "scenario"],
    queryFn: () => moduleApi.list(projectId!, "scenario"),
    enabled: Boolean(projectId),
  });

  const flatModules = useMemo(() => {
    const out: { id: string; name: string; depth: number }[] = [];
    const walk = (nodes: { id: string; name: string; children: unknown[] }[], depth: number) => {
      for (const n of nodes) {
        out.push({ id: n.id, name: `${"— ".repeat(depth)}${n.name}`, depth });
        walk(n.children as typeof nodes, depth + 1);
      }
    };
    if (modulesQ.data?.items) walk(modulesQ.data.items, 0);
    return out;
  }, [modulesQ.data]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["scenarios"] });
    qc.invalidateQueries({ queryKey: ["modules", projectId, "scenario"] });
  };

  const createM = useMutation({
    mutationFn: () => scenarioApi.create(projectId!, { name: newName.trim(), moduleId: newModule, level: newLevel }),
    onSuccess: (r) => {
      setNewOpen(false);
      setNewName("");
      invalidate();
      message.success(`场景已创建（#${r.num}）`);
      router.push(`/scenarios/${r.id}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "创建失败"),
  });

  const removeM = useMutation({
    mutationFn: (id: string) => scenarioApi.remove(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已移入回收站");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });

  const batchDeleteM = useMutation({
    mutationFn: (ids: string[]) => scenarioApi.batchDelete(projectId!, ids),
    onSuccess: (r) => {
      setSelected([]);
      invalidate();
      message.success(`已删除 ${r.count} 个场景`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量删除失败"),
  });

  const batchCopyM = useMutation({
    mutationFn: (ids: string[]) => scenarioApi.batchCopy(projectId!, ids),
    onSuccess: (r) => {
      setSelected([]);
      invalidate();
      message.success(`已复制 ${r.count} 个场景（新名称追加 -copy）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量复制失败"),
  });

  const batchMoveM = useMutation({
    mutationFn: (v: { ids: string[]; moduleId: string }) => scenarioApi.batchMove(projectId!, v.ids, v.moduleId),
    onSuccess: (r) => {
      setMoveOpen(false);
      setSelected([]);
      invalidate();
      message.success(`已移动 ${r.count} 个场景`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量移动失败"),
  });

  const restoreM = useMutation({
    mutationFn: (id: string) => scenarioApi.restore(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已恢复");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "恢复失败"),
  });

  const purgeM = useMutation({
    mutationFn: (id: string) => scenarioApi.purge(projectId!, id),
    onSuccess: () => {
      invalidate();
      message.success("已彻底删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "彻底删除失败"),
  });

  const copyOneM = useMutation({
    mutationFn: (id: string) => scenarioApi.copy(projectId!, id),
    onSuccess: (r) => {
      invalidate();
      message.success(`已复制（新场景 #${r.num}）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "复制失败"),
  });

  const historyQ = useQuery({
    queryKey: ["scenarios", "history", projectId, historyOf?.id],
    queryFn: () => scenarioApi.history(projectId!, historyOf!.id),
    enabled: Boolean(projectId && historyOf),
  });

  const rows = listQ.data?.items ?? [];
  const selectedRows = rows.filter((r) => selected.includes(r.id));

  const doExport = async (mode: "ref" | "flatten") => {
    if (!selectedRows.length) return;
    try {
      const { blob, filename } = await scenarioApi.exportJson(projectId!, selectedRows.map((r) => r.id), mode);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      message.success(`已导出 ${selectedRows.length} 个场景（${mode === "ref" ? "保留引用关系" : "展开为自定义请求"}）`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    }
  };

  const listColumns = [
    {
      title: "名称",
      dataIndex: "name",
      render: (name: string, r: ScenarioRow) => (
        <div className="flex items-center gap-2">
          <a className="font-medium text-[#1F2329] hover:text-[#574BFF]" href={`/scenarios/${r.id}`} data-testid={`scenario-name-${r.num}`}>
            {name}
          </a>
          <span className="text-xs text-[#A8ABB0]">#{r.num}</span>
        </div>
      ),
    },
    {
      title: "等级",
      dataIndex: "level",
      width: 64,
      render: (lv: string) => {
        const m = LEVEL_META[lv] ?? { color: "#646A73", label: lv };
        return (
          <span className="rounded border px-1 text-[11px]" style={{ color: m.color, borderColor: `${m.color}66` }} data-testid="scenario-level">
            {m.label}
          </span>
        );
      },
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 90,
      render: (s: string) => {
        const m = STATUS_META[s] ?? { color: "#87888D", label: s };
        return (
          <span className="flex items-center gap-1.5 text-xs text-[#3D4350]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.color }} />
            {m.label}
          </span>
        );
      },
    },
    {
      title: "标签",
      dataIndex: "tags",
      width: 140,
      render: (tags: string[]) => (tags?.length ? tags.slice(0, 3).map((t) => <Tag key={t} className="!mr-1 !text-[11px]">{t}</Tag>) : <span className="text-[#A8ABB0]">—</span>),
    },
    { title: "步骤数", dataIndex: "stepCount", width: 76, render: (v: number) => <span className="text-xs text-[#3D4350]">{v}</span> },
    {
      title: "最近执行",
      dataIndex: "lastRun",
      width: 130,
      render: (lr: ScenarioRow["lastRun"]) => {
        if (!lr) return <span className="text-xs text-[#A8ABB0]">未执行</span>;
        const m = LAST_RUN_META[lr.status] ?? { color: "#87888D", label: lr.status };
        return (
          <span className="text-xs" style={{ color: m.color }}>
            {m.label} · {fmtTime(lr.finishedAt)}
          </span>
        );
      },
    },
    {
      title: "操作",
      key: "op",
      width: 230,
      render: (_: unknown, r: ScenarioRow) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canUpdate && (
            <Button type="link" size="small" className="!px-0" data-testid={`btn-exec-scenario-${r.num}`} onClick={() => setExecOpen([r])}>
              执行
            </Button>
          )}
          <span className="text-[#E5E6EB]">|</span>
          <Button type="link" size="small" className="!px-0" onClick={() => setHistoryOf(r)}>
            历史
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          <Button type="link" size="small" className="!px-0" onClick={() => copyOneM.mutate(r.id)} disabled={!canCreate}>
            复制
          </Button>
          {canDelete && (
            <>
              <span className="text-[#E5E6EB]">|</span>
              <Button
                type="link"
                size="small"
                className="!px-0 !text-[#FF4D4F]"
                onClick={() =>
                  modal.confirm({
                    title: `删除场景「${r.name}」？`,
                    content: "场景将移入回收站，可随时恢复。",
                    okText: "删除",
                    okButtonProps: { danger: true },
                    onOk: () => removeM.mutateAsync(r.id),
                  })
                }
              >
                删除
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const recycleColumns = [
    {
      title: "名称",
      dataIndex: "name",
      render: (name: string, r: ScenarioRow) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-[#1F2329]">{name}</span>
          <span className="text-xs text-[#A8ABB0]">#{r.num}</span>
        </div>
      ),
    },
    { title: "步骤数", dataIndex: "stepCount", width: 90 },
    { title: "删除时间", dataIndex: "deletedAt", width: 170, render: (v: string | null) => <span className="text-xs text-[#646A73]">{v ? new Date(v).toLocaleString("zh-CN") : "—"}</span> },
    {
      title: "操作",
      key: "op",
      width: 180,
      render: (_: unknown, r: ScenarioRow) => (
        <div className="flex items-center gap-1">
          <Button type="link" size="small" className="!px-0 !text-[#574BFF]" data-testid={`btn-restore-${r.num}`} onClick={() => restoreM.mutate(r.id)}>
            恢复
          </Button>
          <span className="text-[#E5E6EB]">|</span>
          <Popconfirm title="彻底删除后不可恢复，确认？" okText="彻底删除" okButtonProps={{ danger: true }} onConfirm={() => purgeM.mutate(r.id)}>
            <Button type="link" size="small" className="!px-0 !text-[#FF4D4F]">
              彻底删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  if (!projectId) return <Empty description="请先选择项目" />;

  return (
    <div>
      <PageHeader
        title="接口场景"
        sub="多步骤业务场景编排：引用接口/用例/场景、循环、条件、CSV 参数化、批量与定时执行"
        extra={
          canCreate && (
            <Button type="primary" icon={<Plus size={14} strokeWidth={1.8} />} data-testid="btn-new-scenario" onClick={() => { setNewModule(flatModules[0]?.id ?? ""); setNewOpen(true); }}>
              新建场景
            </Button>
          )
        }
      />
      <div className="flex items-stretch gap-4">
        <ModuleTreePanel
          projectId={projectId}
          scene="scenario"
          selectedId={moduleId}
          includeChildren
          onSelect={(id) => { setModuleId(id); setPage(1); }}
          canEdit={canUpdate}
        />
        <div className="rabbit-card flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-4 border-b border-[#F0F1F3] px-3">
            <button
              type="button"
              className={`border-b-2 px-1 py-2.5 text-sm ${tab === "list" ? "border-[#574BFF] font-medium text-[#574BFF]" : "border-transparent text-[#646A73]"}`}
              data-testid="scenarios-tab-list"
              onClick={() => { setTab("list"); setPage(1); }}
            >
              场景
            </button>
            <button
              type="button"
              className={`border-b-2 px-1 py-2.5 text-sm ${tab === "recycle" ? "border-[#574BFF] font-medium text-[#574BFF]" : "border-transparent text-[#646A73]"}`}
              data-testid="scenarios-tab-recycle"
              onClick={() => { setTab("recycle"); setPage(1); setSelected([]); }}
            >
              回收站
            </button>
          </div>
          {tab === "list" ? (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-[#F0F1F3] px-3 py-2">
                {canUpdate && (
                  <Button
                    size="small"
                    icon={<Play size={13} strokeWidth={1.8} />}
                    disabled={selectedRows.length === 0}
                    data-testid="btn-batch-exec"
                    onClick={() => setExecOpen(selectedRows)}
                  >
                    批量执行
                  </Button>
                )}
                <Button size="small" href="/tasks?subTab=cron" data-testid="btn-goto-schedules">
                  定时任务
                </Button>
                <Button size="small" href="/scenarios/false-alarm" data-testid="btn-goto-false-alarm">
                  误报规则
                </Button>
                {canCreate && (
                  <Button size="small" icon={<Upload size={13} strokeWidth={1.8} />} onClick={() => setImportOpen(true)} data-testid="btn-import-scenario">
                    导入
                  </Button>
                )}
                <Button
                  size="small"
                  icon={<Download size={13} strokeWidth={1.8} />}
                  disabled={selectedRows.length === 0}
                  onClick={() => doExport("ref")}
                  data-testid="btn-export-ref"
                >
                  导出
                </Button>
                {canUpdate && selectedRows.length > 0 && (
                  <>
                    <Button size="small" disabled={!flatModules.length} onClick={() => setMoveOpen(true)}>
                      移动
                    </Button>
                    <Button size="small" onClick={() => batchCopyM.mutate(selectedRows.map((r) => r.id))}>
                      复制
                    </Button>
                  </>
                )}
                {canDelete && selectedRows.length > 0 && (
                  <Button
                    size="small"
                    danger
                    onClick={() =>
                      modal.confirm({
                        title: `删除 ${selectedRows.length} 个场景？`,
                        content: "将移入回收站，可随时恢复。",
                        okText: "删除",
                        okButtonProps: { danger: true },
                        onOk: () => batchDeleteM.mutateAsync(selectedRows.map((r) => r.id)),
                      })
                    }
                  >
                    批量删除
                  </Button>
                )}
                <div className="ml-auto flex items-center gap-2">
                  <Input.Search
                    placeholder="搜索名称/编号"
                    size="small"
                    className="!w-44"
                    data-testid="input-scenario-keyword"
                    allowClear
                    onSearch={(v) => { setKeyword(v); setPage(1); }}
                  />
                  <Select size="small" className="!w-24" placeholder="等级" allowClear data-testid="select-scenario-level" onChange={(v) => { setLevel(v); setPage(1); }} options={Object.keys(LEVEL_META).map((k) => ({ value: k, label: k }))} />
                  <Select size="small" className="!w-28" placeholder="状态" allowClear data-testid="select-scenario-status" onChange={(v) => { setStatus(v); setPage(1); }} options={Object.entries(STATUS_META).map(([v, m]) => ({ value: v, label: m.label }))} />
                </div>
              </div>
              <div className="flex-1 overflow-x-auto p-0">
                <Table<ScenarioRow>
                  rowKey="id"
                  size="middle"
                  loading={listQ.isLoading}
                  columns={listColumns}
                  dataSource={rows}
                  rowSelection={canUpdate ? { selectedRowKeys: selected, onChange: setSelected } : undefined}
                  onRow={(r) => ({ "data-testid": `scenario-row-${r.num}` }) as React.HTMLAttributes<HTMLTableRowElement>}
                  pagination={{ current: page, pageSize: 20, total: listQ.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
                  locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无场景" /> }}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 p-0" data-testid="recycle-table">
              <Table<ScenarioRow>
                rowKey="id"
                size="middle"
                loading={listQ.isLoading}
                columns={recycleColumns}
                dataSource={rows}
                pagination={{ current: page, pageSize: 20, total: listQ.data?.total ?? 0, onChange: setPage, showTotal: (t) => `共 ${t} 条` }}
                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="回收站为空" /> }}
              />
            </div>
          )}
        </div>
      </div>

      {/* 新建场景 */}
      <Modal
        title="新建场景"
        open={newOpen}
        okText="创建"
        cancelText="取消"
        okButtonProps={{ disabled: !newName.trim() || !newModule }}
        confirmLoading={createM.isPending}
        onOk={() => createM.mutate()}
        onCancel={() => setNewOpen(false)}
      >
        <div className="space-y-3 pt-2">
          <div>
            <p className="mb-1 text-xs text-[#646A73]">场景名称</p>
            <Input placeholder="如：下单主流程" data-testid="input-new-scenario-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
          <div>
            <p className="mb-1 text-xs text-[#646A73]">所属模块</p>
            <Select className="!w-full" value={newModule || undefined} onChange={setNewModule} options={flatModules.map((m) => ({ value: m.id, label: m.name }))} data-testid="select-new-scenario-module" />
          </div>
          <div>
            <p className="mb-1 text-xs text-[#646A73]">等级</p>
            <Radio.Group value={newLevel} onChange={(e) => setNewLevel(e.target.value)} options={Object.keys(LEVEL_META).map((k) => ({ value: k, label: k }))} />
          </div>
        </div>
      </Modal>

      {/* 批量执行（API-008 画板一） */}
      {execOpen && <BatchExecModal rows={execOpen} onClose={() => setExecOpen(null)} />}

      {/* 导入（API-009） */}
      <Modal title="导入场景" open={importOpen} footer={null} onCancel={() => setImportOpen(false)} width={560}>
        <ImportPanel onDone={() => { setImportOpen(false); invalidate(); }} />
      </Modal>

      {/* 批量移动（API-008 画板三） */}
      <Modal
        title={`移动 ${selectedRows.length} 个场景`}
        open={moveOpen}
        okText="移动"
        cancelText="取消"
        onOk={() => batchMoveM.mutate({ ids: selectedRows.map((r) => r.id), moduleId: moveTarget })}
        onCancel={() => setMoveOpen(false)}
        okButtonProps={{ disabled: !moveTarget }}
      >
        <p className="mb-2 pt-2 text-xs text-[#646A73]">选择目标模块（含子级场景将一并保留模块归属）</p>
        <Select className="!w-full" placeholder="目标模块" value={moveTarget || undefined} onChange={setMoveTarget} options={flatModules.map((m) => ({ value: m.id, label: m.name }))} data-testid="select-move-target" />
      </Modal>

      {/* 执行历史 */}
      <Drawer title={`执行历史 · ${historyOf?.name ?? ""}`} open={Boolean(historyOf)} onClose={() => setHistoryOf(null)} width={480}>
        {(historyQ.data ?? []).length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无执行记录" />
        ) : (
          <div className="space-y-2">
            {historyQ.data!.map((h) => (
              <div key={h.itemId} className="flex items-center gap-2 rounded border border-[#F0F1F3] px-3 py-2 text-xs">
                <span className="font-mono text-[#87888D]">{h.taskId.slice(0, 8)}</span>
                <span style={{ color: (LAST_RUN_META[h.status] ?? { color: "#87888D", label: h.status }).color }}>{(LAST_RUN_META[h.status] ?? { label: h.status }).label}</span>
                <span className="text-[#A8ABB0]">{h.finishedAt ? new Date(h.finishedAt).toLocaleString("zh-CN") : h.taskStatus}</span>
                <a className="ml-auto text-[#574BFF]" href={`/reports/${h.taskId}`}>
                  查看报告
                </a>
              </div>
            ))}
          </div>
        )}
      </Drawer>
    </div>
  );
}

/** 批量执行弹窗（API-008 画板一：环境/池/串并/失败停止）。 */
function BatchExecModal({ rows, onClose }: { rows: ScenarioRow[]; onClose: () => void }) {
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const { message } = useApp();
  const router = useRouter();
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [poolId, setPoolId] = useState<string>();
  const [mode, setMode] = useState<"serial" | "parallel">("serial");
  const [stopOnFail, setStopOnFail] = useState(false);

  // 池列表为系统级端点（SYSTEM_POOL:READ）：无权限不拉（避免 403 噪声），选择项回落默认池
  const poolsQ = useQuery({
    queryKey: ["pools"],
    queryFn: () => poolApi.list(),
    staleTime: 60_000,
    enabled: can("SYSTEM_POOL:READ"),
  });

  const execM = useMutation({
    mutationFn: () =>
      scenarioApi.executeBatch(projectId!, {
        scenarioIds: rows.map((r) => r.id),
        ...(envId ? { envId } : {}),
        ...(poolId ? { poolId } : {}),
        stopOnFail,
        mode,
      }),
    onSuccess: (r) => {
      message.success(`${rows.length} 个场景已提交（任务 ${r.taskId.slice(0, 8)}）`);
      onClose();
      router.push(`/tasks?focus=${r.taskId}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "提交失败"),
  });

  return (
    <Modal
      title={`批量执行 · ${rows.length} 个场景`}
      open
      okText="执行"
      cancelText="取消"
      confirmLoading={execM.isPending}
      onOk={() => execM.mutate()}
      onCancel={onClose}
    >
      <div className="space-y-3 pt-2">
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-[#646A73]">环境</span>
          <EnvSelect value={envId} onChange={(v) => setEnvId(v)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-[#646A73]">资源池</span>
          <Select
            className="!w-56"
            placeholder="默认池"
            allowClear
            value={poolId}
            onChange={setPoolId}
            data-testid="select-exec-pool"
            options={(poolsQ.data?.items ?? []).map((p) => ({ value: p.id, label: `${p.name}（${p.type} · 并发 ${p.maxConcurrency}）` }))}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-[#646A73]">模式</span>
          <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)} data-testid="radio-exec-mode">
            <Radio.Button value="serial">串行</Radio.Button>
            <Radio.Button value="parallel">并行</Radio.Button>
          </Radio.Group>
          <span className="text-[11px] text-[#A8ABB0]">{mode === "parallel" ? "按资源池并发槽同时运行" : "逐场景顺序执行"}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 text-xs text-[#646A73]">失败停止</span>
          <Switch checked={stopOnFail} onChange={setStopOnFail} data-testid="switch-stop-on-fail" />
          <span className="text-[11px] text-[#A8ABB0]">首个失败后余项跳过（SKIPPED）</span>
        </div>
        <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] leading-5 text-[#87888D]">
          {rows.length} 个场景 → 1 个任务 · {rows.length} 个执行项；提交后跳转任务中心并高亮新任务。勾选上限 50；每场景生成独立报告。
        </p>
      </div>
    </Modal>
  );
}

/** 导入面板（API-009：预览 → 导入）。 */
function ImportPanel({ onDone }: { onDone: () => void }) {
  const { currentProjectId: projectId } = useProjectStore();
  const { message } = useApp();
  const fileRef = useRef<File | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof scenarioApi.importPreview>> | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    fileRef.current = f;
    setFile(f);
    try {
      setPreview(await scenarioApi.importPreview(projectId!, f));
    } catch (e) {
      setPreview(null);
      message.error(e instanceof Error ? e.message : "预览失败");
    }
  };

  const importM = useMutation({
    mutationFn: () => scenarioApi.import(projectId!, fileRef.current!),
    onSuccess: (r) => {
      message.success(`已导入 ${r.count} 个场景${r.warnings.length ? `（${r.warnings.length} 条警告）` : ""}`);
      onDone();
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "导入失败"),
  });

  return (
    <div className="space-y-3 pt-2">
      <input
        type="file"
        accept=".json,.jmx"
        data-testid="input-import-file"
        className="block w-full text-xs"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <p className="text-[11px] text-[#87888D]">支持 Rabbit JSON（保留引用关系）/ JMeter jmx / MeterSphere JSON</p>
      {preview && (
        <div className="rounded border border-[#F0F1F3] bg-[#F7F8FA] p-3 text-xs" data-testid="import-preview">
          <p>
            格式 <b>{preview.format}</b> · 场景 <b>{preview.scenarioCount}</b> · 步骤 <b>{preview.stepCount}</b>
          </p>
          {preview.firstSteps.length > 0 && (
            <p className="mt-1 text-[#646A73]">
              首步骤：{preview.firstSteps.slice(0, 6).map((s) => `${s.name}（${s.stepType}）`).join("、")}
              {preview.firstSteps.length > 6 ? " …" : ""}
            </p>
          )}
          {preview.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-[#FA8C16]">
              {preview.warnings.slice(0, 5).map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={!file || !preview} loading={importM.isPending} type="primary" data-testid="btn-do-import" onClick={() => importM.mutate()}>
          导入
        </Button>
      </div>
    </div>
  );
}
