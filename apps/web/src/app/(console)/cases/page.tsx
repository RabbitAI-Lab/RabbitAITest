"use client";

import {
  Button,
  Checkbox,
  DatePicker,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Popover,
  Radio,
  Select,
  Steps,
  Table,
  Tag,
  TreeSelect,
  Upload,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  Download,
  Filter,
  Plus,
  RotateCcw,
  Settings2,
  Star,
  Trash2,
  Upload as UploadIcon,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import {
  authApi,
  caseApiV2,
  caseIoApi,
  fieldDefApi,
  memberApi,
  moduleApi,
  prefApi,
  templateApi,
  viewApi,
  type CaseQueryV2,
  type CaseRowV2,
  type CaseViewDto,
  type ImportReport,
} from "@rabbit/api-client";
import type { CaseLevel, FieldDefInput, TemplateFieldBinding } from "@rabbit/shared";
import { useProjectStore } from "@/stores/project";
import { usePermissions, useProjectInfo } from "@/hooks/usePermissions";
import { PageHeader } from "@/components/PageHeader";
import { ModuleTreePanel } from "@/components/ModuleTreePanel";
import { MemberSelect } from "@/components/crosscut";
import { DynamicFieldCell, DynamicFieldInput, type DynFieldDef } from "@/components/DynamicField";
import { flattenModules, toTreeSelectData } from "@/components/CaseForm";
import { useApp } from "@/hooks/useApp";

/** CASE-002：模块树 + 用例列表完整版（视图 Tabs / 高级筛选 / 批量操作 / 导入导出 / 列设置）。 */

const levelColor: Record<string, string> = { P0: "red", P1: "orange", P2: "blue", P3: "default" };
const STATUS_OPTIONS = [
  { value: "PREPARING", label: "未开始" },
  { value: "UNDERWAY", label: "进行中" },
  { value: "COMPLETED", label: "已完成" },
  { value: "FAILED", label: "失败" },
];
const statusText = (s: string) => STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s;
const BASE_EXPORT_FIELDS: { key: string; label: string }[] = [
  { key: "num", label: "编号" },
  { key: "module", label: "模块" },
  { key: "name", label: "名称" },
  { key: "precondition", label: "前置条件" },
  { key: "level", label: "等级" },
  { key: "tags", label: "标签" },
  { key: "steps", label: "步骤 + 预期结果" },
];

interface AdvFilters {
  level?: CaseLevel;
  tags: string[];
  status?: string;
  creator?: string;
  range?: [Dayjs, Dayjs];
  dyn: Record<string, unknown>;
}

const EMPTY_FILTERS: AdvFilters = { tags: [], dyn: {} };

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CaseListPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { message, modal } = useApp();
  const { can } = usePermissions();
  const { currentProjectId } = useProjectStore();
  const project = useProjectInfo();
  const orgId = project?.org.id ?? null;
  const projectId = currentProjectId;

  const [recycled, setRecycled] = useState(false);
  const [viewKey, setViewKey] = useState<string>("all"); // all | followed | mine | view:{id}
  const [keyword, setKeyword] = useState("");
  const [filters, setFilters] = useState<AdvFilters>(EMPTY_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [includeChildren, setIncludeChildren] = useState(true);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<React.Key[]>([]);

  // 列设置（含动态字段列；用户偏好持久化）
  const [colPref, setColPref] = useState<string[] | null>(null);
  const [colOpen, setColOpen] = useState(false);

  // 视图 / 模块 / 动态字段数据源
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => authApi.me(), staleTime: 5 * 60_000 });
  const viewsQ = useQuery({
    queryKey: ["case", "views", projectId],
    queryFn: () => viewApi.list(projectId!),
    enabled: Boolean(projectId),
  });
  const modulesQ = useQuery({
    queryKey: ["modules", projectId, "case"],
    queryFn: () => moduleApi.list(projectId!, "case"),
    enabled: Boolean(projectId),
  });
  const defsQ = useQuery({
    queryKey: ["field-defs", orgId, "case"],
    queryFn: () => fieldDefApi.list(orgId!, "case"),
    enabled: Boolean(orgId),
  });
  const templatesQ = useQuery({
    queryKey: ["templates", orgId, projectId, "case"],
    queryFn: () => templateApi.list(orgId!, projectId!, "case"),
    enabled: Boolean(orgId && projectId),
  });
  const membersQ = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => memberApi.projectMembers(projectId!),
    enabled: Boolean(projectId),
    staleTime: 60_000,
  });

  const defs: DynFieldDef[] = (defsQ.data ?? [])
    .filter((d) => d.enabled)
    .map((d) => ({ ...d, options: d.options as FieldDefInput["options"] }) as DynFieldDef);
  const defaultTemplate = (templatesQ.data ?? []).find((t) => t.isDefault);
  const bindings: TemplateFieldBinding[] | undefined = defaultTemplate?.fields?.map((b) => ({
    ...b,
    visibleInList: b.visibleInList ?? false,
  }));
  const visibleDynDefs = (bindings ?? [])
    .filter((b) => b.visibleInList)
    .map((b) => defs.find((d) => d.key === b.fieldKey))
    .filter((d): d is DynFieldDef => Boolean(d));

  // 我关注的（Star 徽标与切换；服务端按登录用户过滤）
  const followedQ = useQuery({
    queryKey: ["case", "followed", projectId],
    queryFn: () =>
      caseApiV2.list(projectId!, { page: 1, pageSize: 100, followedBy: meQ.data!.userId }),
    enabled: Boolean(projectId && meQ.data?.userId),
  });
  const followedIds = new Set((followedQ.data?.items ?? []).map((c) => c.id));

  const flatModules = flattenModules(modulesQ.data?.items ?? []);
  const moduleName = (id: string) => flatModules.find((m) => m.id === id)?.name ?? "—";
  const memberName = (id: string | null) =>
    membersQ.data?.items.find((m) => m.id === id)?.name ?? "—";

  // 列偏好加载（case_columns）
  useEffect(() => {
    if (!projectId) return;
    prefApi
      .get("case_columns", projectId)
      .then((r) => {
        if (Array.isArray(r.value))
          setColPref(r.value.filter((v): v is string => typeof v === "string"));
      })
      .catch(() => undefined);
  }, [projectId]);

  // ── 查询组装 ──
  const customView = viewKey.startsWith("view:")
    ? (viewsQ.data?.views ?? []).find((v) => v.id === viewKey.slice(5))
    : undefined;
  const dynQuery = Object.fromEntries(
    Object.entries(filters.dyn).filter(
      ([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0),
    ),
  );
  const listQuery: CaseQueryV2 = {
    page,
    pageSize: 20,
    recycled: recycled ? "true" : "false",
    keyword: keyword || undefined,
    ...(viewKey === "followed" && meQ.data ? { followedBy: meQ.data.userId } : {}),
    ...(viewKey === "mine" ? { createdByMe: "true" } : {}),
    ...(customView ? { viewId: customView.id } : {}),
    ...(moduleId ? { moduleId, includeChildren: includeChildren ? "true" : "false" } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.tags.length ? { tags: filters.tags.join(",") } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.creator ? { creator: filters.creator } : {}),
    ...(filters.range
      ? {
          updatedFrom: filters.range[0].startOf("day").toISOString(),
          updatedTo: filters.range[1].endOf("day").toISOString(),
        }
      : {}),
    ...(Object.keys(dynQuery).length ? { fields: JSON.stringify(dynQuery) } : {}),
  };

  const listQ = useQuery({
    queryKey: ["case", "list-v2", projectId, JSON.stringify(listQuery)],
    queryFn: () => caseApiV2.list(projectId!, listQuery),
    enabled: Boolean(projectId),
  });

  const invalidateCases = () => {
    void qc.invalidateQueries({ queryKey: ["case"] });
    void qc.invalidateQueries({ queryKey: ["modules", projectId, "case"] });
  };

  // ── 行操作 ──
  const remove = useMutation({
    mutationFn: (id: string) => caseApiV2.remove(projectId!, id),
    onSuccess: () => {
      invalidateCases();
      message.success(recycled ? "已移入回收站" : "已删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const restore = useMutation({
    mutationFn: (id: string) => caseApiV2.restore(projectId!, id),
    onSuccess: () => {
      invalidateCases();
      message.success("已恢复");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "恢复失败"),
  });
  const purge = useMutation({
    mutationFn: (id: string) => caseApiV2.purge(projectId!, id),
    onSuccess: () => {
      invalidateCases();
      message.success("已彻底删除");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除失败"),
  });
  const follow = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => caseApiV2.follow(projectId!, id, on),
    onSuccess: (_r, { on }) => {
      void qc.invalidateQueries({ queryKey: ["case", "followed", projectId] });
      message.success(on ? "已关注，变更将提醒" : "已取消关注");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "操作失败"),
  });
  const copy = useMutation({
    mutationFn: (id: string) => caseApiV2.copy(projectId!, id),
    onSuccess: (r) => {
      invalidateCases();
      message.success(`已复制为「${r.name}」（C-${String(r.num).padStart(4, "0")}）`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "复制失败"),
  });
  const batch = useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: "move" | "delete" | "update";
      body: Record<string, unknown>;
    }) => caseApiV2.batch(projectId!, action, body),
    onSuccess: (r, { action }) => {
      invalidateCases();
      setSelected([]);
      message.success(
        action === "move"
          ? `已移动 ${r.affected} 条`
          : action === "update"
            ? `已更新 ${r.affected} 条`
            : `已删除 ${r.affected} 条（进入回收站）`,
      );
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "批量操作失败"),
  });

  async function shareRow(r: CaseRowV2) {
    const url = `${window.location.origin}/cases?moduleId=${r.moduleId}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success("链接已复制");
    } catch {
      message.error("复制失败，请手动复制地址栏链接");
    }
  }

  // ── 视图：另存为 / 删除 / 应用 ──
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const saveView = useMutation({
    mutationFn: () =>
      viewApi.create(projectId!, {
        name: viewName.trim(),
        query: currentStateQuery(),
        isDefault: false,
      }),
    onSuccess: (v) => {
      setSaveViewOpen(false);
      setViewName("");
      void qc.invalidateQueries({ queryKey: ["case", "views", projectId] });
      setViewKey(`view:${v.id}`);
      message.success("视图已保存");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "保存视图失败"),
  });
  const removeView = useMutation({
    mutationFn: (id: string) => viewApi.remove(projectId!, id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["case", "views", projectId] });
      setViewKey("all");
      message.success("视图已删除，已回退「全部」");
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "删除视图失败"),
  });

  function currentStateQuery(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    if (keyword) o.keyword = keyword;
    if (filters.level) o.level = filters.level;
    if (filters.tags.length) o.tags = filters.tags.join(",");
    if (filters.status) o.status = filters.status;
    if (filters.creator) o.creator = filters.creator;
    if (filters.range) {
      o.updatedFrom = filters.range[0].startOf("day").toISOString();
      o.updatedTo = filters.range[1].endOf("day").toISOString();
    }
    if (Object.keys(dynQuery).length) o.fields = dynQuery;
    if (moduleId) {
      o.moduleId = moduleId;
      o.includeChildren = includeChildren;
    }
    return o;
  }

  function applyView(v: CaseViewDto) {
    setViewKey(`view:${v.id}`);
    setPage(1);
    setSelected([]);
    const q = v.query ?? {};
    setKeyword(typeof q.keyword === "string" ? q.keyword : "");
    setModuleId(typeof q.moduleId === "string" ? q.moduleId : null);
    setIncludeChildren(q.includeChildren !== false);
    const tags = Array.isArray(q.tags)
      ? (q.tags as string[]).join(",")
      : typeof q.tags === "string"
        ? q.tags
        : "";
    setFilters({
      level: typeof q.level === "string" ? (q.level as CaseLevel) : undefined,
      tags: tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      status: typeof q.status === "string" ? q.status : undefined,
      creator: typeof q.creator === "string" ? q.creator : undefined,
      range:
        typeof q.updatedFrom === "string" && typeof q.updatedTo === "string"
          ? [dayjs(q.updatedFrom), dayjs(q.updatedTo)]
          : undefined,
      dyn:
        q.fields && typeof q.fields === "object"
          ? { ...(q.fields as Record<string, unknown>) }
          : {},
    });
  }

  // ── 批量弹窗 ──
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>();
  const [batchEditOpen, setBatchEditOpen] = useState(false);
  const [batchLevel, setBatchLevel] = useState<CaseLevel>();
  const [batchTags, setBatchTags] = useState<string[]>([]);
  const selectedIds = selected.map(String);

  // ── 导入向导（CASE-004 三步）──
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState(1);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importMode, setImportMode] = useState<"skip" | "overwrite">("skip");
  const [importModule, setImportModule] = useState<string>();
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [tplDownloading, setTplDownloading] = useState(false);
  const { Dragger } = Upload;

  const doImport = useMutation({
    mutationFn: () =>
      caseIoApi.importCases(projectId!, importFile!, importMode, importModule ?? undefined),
    onSuccess: (r) => {
      setImportReport(r);
      setImportStep(3);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "导入失败"),
  });

  function resetWizard() {
    setImportStep(1);
    setImportFile(null);
    setImportMode("skip");
    setImportReport(null);
  }

  async function downloadTemplate() {
    if (!projectId) return;
    setTplDownloading(true);
    try {
      const { blob, filename } = await caseIoApi.template(projectId);
      saveBlob(blob, filename);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "模板下载失败");
    } finally {
      setTplDownloading(false);
    }
  }

  // ── 导出弹窗（CASE-004）──
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"excel" | "excel_split" | "xmind">("excel");
  const [exportFields, setExportFields] = useState<string[] | null>(null);
  const [exportScope, setExportScope] = useState<"filter" | "selected">("filter");
  const [exporting, setExporting] = useState(false);

  const defaultExportFields = [
    ...BASE_EXPORT_FIELDS.map((f) => f.key),
    ...visibleDynDefs.map((d) => d.key),
  ];
  const activeExportFields = exportFields ?? defaultExportFields;

  async function doExport() {
    if (!projectId) return;
    setExporting(true);
    try {
      const { blob, filename } = await caseIoApi.exportCases(projectId, {
        format: exportFormat,
        fields: exportFormat === "xmind" ? [] : activeExportFields,
        caseIds: exportScope === "selected" && selectedIds.length ? selectedIds : undefined,
      });
      saveBlob(blob, filename);
      message.success("导出成功");
      setExportOpen(false);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  }

  // ── 列设置 ──
  const defaultCols = ["module", "tags", "updatedAt", ...visibleDynDefs.map((d) => `dyn:${d.key}`)];
  const activeCols = colPref ?? defaultCols;
  function toggleCol(key: string, on: boolean) {
    const next = on ? [...new Set([...activeCols, key])] : activeCols.filter((k) => k !== key);
    setColPref(next);
    if (projectId)
      void prefApi
        .put("case_columns", projectId, next)
        .catch(() => message.warning("列设置保存失败"));
  }

  if (!projectId) return <Empty description="请先选择项目" />;

  const canCreate = can("PROJECT_CASE:CREATE");
  const canUpdate = can("PROJECT_CASE:UPDATE");
  const canDelete = can("PROJECT_CASE:DELETE");
  const rows = listQ.data?.items ?? [];

  const dynCols: ColumnsType<CaseRowV2> = visibleDynDefs
    .filter((d) => activeCols.includes(`dyn:${d.key}`))
    .map((d) => ({
      title: d.name,
      key: `dyn-${d.key}`,
      width: 120,
      render: (_, r) => <DynamicFieldCell def={d} value={r.fields?.[d.key]} />,
    }));

  const viewTabs: { key: string; label: string; testid: string }[] = [
    { key: "all", label: "全部", testid: "view-tab-all" },
    { key: "followed", label: "我关注的", testid: "view-tab-followed" },
    { key: "mine", label: "我创建的", testid: "view-tab-mine" },
    ...(viewsQ.data?.views ?? []).map((v) => ({
      key: `view:${v.id}`,
      label: v.name,
      testid: `view-${v.id}`,
    })),
  ];

  return (
    <div>
      <PageHeader
        title={recycled ? "回收站" : "功能用例"}
        sub={recycled ? "已删除用例可恢复或彻底删除" : "项目内全部功能测试用例"}
        extra={
          <div className="flex items-center gap-2">
            <div className="flex bg-white border border-[#E5E6EB] rounded-md p-0.5 text-[13px]">
              <span
                data-testid="tab-all"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${!recycled ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setRecycled(false);
                  setPage(1);
                }}
              >
                全部
              </span>
              <span
                data-testid="tab-recycle"
                className={`px-3 py-1 rounded cursor-pointer transition-colors ${recycled ? "bg-[#574BFF]/8 text-[#574BFF] font-medium" : "text-[#646A73]"}`}
                onClick={() => {
                  setRecycled(true);
                  setPage(1);
                  setSelected([]);
                }}
              >
                回收站
              </span>
            </div>
            {!recycled && canCreate && (
              <Button
                type="primary"
                icon={<Plus size={14} />}
                onClick={() =>
                  router.push(moduleId ? `/cases/new?moduleId=${moduleId}` : "/cases/new")
                }
                data-testid="btn-new-case"
              >
                新建用例
              </Button>
            )}
          </div>
        }
      />

      <div className="flex gap-4 items-stretch">
        {!recycled && (
          <ModuleTreePanel
            projectId={projectId}
            scene="case"
            selectedId={moduleId}
            includeChildren={includeChildren}
            onSelect={(id) => {
              setModuleId(id);
              setPage(1);
            }}
            onIncludeChildrenChange={setIncludeChildren}
            canEdit={canUpdate}
          />
        )}
        <div className="rabbit-card flex-1 min-w-0 flex flex-col">
          {/* 首行：视图 Tabs + 搜索 + 高级筛选 + 列设置 + 导入导出 */}
          {/* min-h-12（非固定 h-12）：视图 Tab 增多时允许换行增高，避免内容溢出遮挡表格（CASE-002-02 走查暴露） */}
          <div className="flex items-center gap-3 px-3 min-h-12 border-b border-[#F0F1F3] text-[13px] flex-wrap">
            {!recycled ? (
              <div className="flex items-center gap-4 min-w-0 overflow-x-auto">
                {viewTabs.map((t) => (
                  <span key={t.key} className="flex items-center gap-1 shrink-0">
                    <span
                      data-testid={t.testid}
                      className={`pb-2.5 pt-3 -mb-px border-b-2 cursor-pointer transition-colors ${viewKey === t.key ? "border-[#574BFF] text-[#574BFF] font-medium" : "border-transparent text-[#646A73] hover:text-[#3D4350]"}`}
                      onClick={() => {
                        if (t.key.startsWith("view:")) {
                          const v = (viewsQ.data?.views ?? []).find(
                            (x) => `view:${x.id}` === t.key,
                          );
                          if (v) applyView(v);
                        } else {
                          setViewKey(t.key);
                          setPage(1);
                        }
                      }}
                    >
                      {t.label}
                    </span>
                    {t.key.startsWith("view:") && (
                      <span title="删除该视图" className="flex items-center">
                        <X
                          size={12}
                          className="text-[#A8ABB0] hover:text-[#FF4D4F] cursor-pointer"
                          onClick={() => {
                            const v = viewsQ.data?.views.find((x) => `view:${x.id}` === t.key);
                            if (v) {
                              modal.confirm({
                                title: `删除视图「${v.name}」？`,
                                content: "删除后回退「全部」视图。",
                                okButtonProps: { danger: true },
                                onOk: () => removeView.mutateAsync(v.id),
                              });
                            }
                          }}
                        />
                      </span>
                    )}
                  </span>
                ))}
                <Button
                  type="link"
                  size="small"
                  className="!px-1"
                  title="将当前筛选组合另存为视图"
                  onClick={() => setSaveViewOpen(true)}
                  data-testid="btn-save-view"
                >
                  ＋
                </Button>
              </div>
            ) : (
              <span className="text-[#646A73]">回收站中的用例可恢复或彻底删除</span>
            )}
            <div className="ml-auto flex items-center gap-2 shrink-0">
              <Input.Search
                placeholder="搜索名称，回车查询"
                className="w-52"
                allowClear
                data-testid="input-keyword"
                onSearch={(v) => {
                  setKeyword(v);
                  setPage(1);
                }}
              />
              {!recycled && (
                <>
                  <Button
                    size="small"
                    icon={<Filter size={13} />}
                    onClick={() => setAdvancedOpen((v) => !v)}
                    data-testid="btn-advanced-filter"
                  >
                    高级筛选{advancedOpen ? "▴" : "▾"}
                  </Button>
                  <Popover
                    open={colOpen}
                    onOpenChange={setColOpen}
                    trigger="click"
                    placement="bottomRight"
                    content={
                      <div className="w-52" data-testid="column-setting-popover">
                        <p className="text-xs text-[#A8ABB0] mb-1">显示列</p>
                        {[
                          { key: "module", label: "模块" },
                          { key: "tags", label: "标签" },
                          { key: "status", label: "状态" },
                          { key: "creator", label: "创建人" },
                          { key: "updatedAt", label: "更新时间" },
                          ...visibleDynDefs.map((d) => ({ key: `dyn:${d.key}`, label: d.name })),
                        ].map((c) => (
                          <p key={c.key} className="my-1">
                            <Checkbox
                              checked={activeCols.includes(c.key)}
                              onChange={(e) => toggleCol(c.key, e.target.checked)}
                            >
                              {c.label}
                            </Checkbox>
                          </p>
                        ))}
                      </div>
                    }
                  >
                    <Button
                      size="small"
                      icon={<Settings2 size={13} />}
                      data-testid="btn-column-setting"
                      title="列设置"
                    />
                  </Popover>
                  {canCreate && (
                    <Button
                      size="small"
                      icon={<UploadIcon size={13} />}
                      onClick={() => {
                        resetWizard();
                        setImportOpen(true);
                      }}
                      data-testid="btn-import"
                    >
                      导入
                    </Button>
                  )}
                  <Button
                    size="small"
                    icon={<Download size={13} />}
                    onClick={() => setExportOpen(true)}
                    data-testid="btn-export"
                  >
                    导出
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* 高级筛选区（展开态） */}
          {advancedOpen && !recycled && (
            <div
              className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-[#F0F1F3] bg-[#F7F8FA]/60"
              data-testid="advanced-filter-panel"
            >
              <Select
                className="w-28"
                allowClear
                placeholder="等级：全部"
                virtual={false}
                value={filters.level}
                options={["P0", "P1", "P2", "P3"].map((l) => ({ value: l, label: `等级 ${l}` }))}
                onChange={(v) => {
                  setFilters((f) => ({ ...f, level: v as CaseLevel | undefined }));
                  setPage(1);
                }}
                data-testid="select-level"
              />
              <Select
                className="w-44"
                mode="tags"
                allowClear
                placeholder="标签（回车添加，命中任一）"
                value={filters.tags}
                onChange={(v) => {
                  setFilters((f) => ({ ...f, tags: v }));
                  setPage(1);
                }}
                data-testid="select-tags"
              />
              <Select
                className="w-32"
                allowClear
                placeholder="状态：全部"
                value={filters.status}
                options={STATUS_OPTIONS}
                onChange={(v) => {
                  setFilters((f) => ({ ...f, status: v }));
                  setPage(1);
                }}
                data-testid="select-status"
              />
              <MemberSelect
                projectId={projectId}
                value={filters.creator}
                onChange={(v) => {
                  setFilters((f) => ({ ...f, creator: Array.isArray(v) ? v[0] : v }));
                  setPage(1);
                }}
                placeholder="创建人：全部"
              />
              <DatePicker.RangePicker
                value={filters.range}
                onChange={(vals) => {
                  setFilters((f) => ({
                    ...f,
                    range: vals && vals[0] && vals[1] ? [vals[0], vals[1]] : undefined,
                  }));
                  setPage(1);
                }}
                data-testid="range-updated"
              />
              {visibleDynDefs.map((d) => (
                <span key={d.key} className="w-40">
                  <DynamicFieldInput
                    def={d}
                    value={filters.dyn[d.key]}
                    onChange={(v) => {
                      setFilters((f) => ({ ...f, dyn: { ...f.dyn, [d.key]: v } }));
                      setPage(1);
                    }}
                  />
                </span>
              ))}
              <Button
                size="small"
                onClick={() => {
                  setFilters(EMPTY_FILTERS);
                  setKeyword("");
                  setModuleId(null);
                  setPage(1);
                }}
              >
                重置
              </Button>
            </div>
          )}

          {/* 批量操作条 */}
          {!recycled && selected.length > 0 && (
            <div
              className="flex items-center gap-3 px-3 py-2 border-b border-[#F0F1F3] bg-[#574BFF]/[.05] text-[13px]"
              data-testid="batch-bar"
            >
              <span className="text-[#574BFF] font-medium">已选 {selected.length} 项</span>
              {canUpdate && (
                <Button
                  type="link"
                  size="small"
                  className="!px-0"
                  disabled={!modulesQ.data}
                  data-testid="btn-batch-move"
                  onClick={() => {
                    setMoveTarget(undefined);
                    setMoveOpen(true);
                  }}
                >
                  移动
                </Button>
              )}
              {canUpdate && (
                <Button
                  type="link"
                  size="small"
                  className="!px-0"
                  data-testid="btn-batch-edit"
                  onClick={() => {
                    setBatchLevel(undefined);
                    setBatchTags([]);
                    setBatchEditOpen(true);
                  }}
                >
                  批量编辑
                </Button>
              )}
              {canDelete && (
                <Button
                  type="link"
                  size="small"
                  danger
                  className="!px-0"
                  data-testid="btn-batch-delete"
                  onClick={() => {
                    modal.confirm({
                      title: `将 ${selected.length} 条用例移入回收站？`,
                      okButtonProps: { danger: true },
                      okText: "移入回收站",
                      onOk: () =>
                        batch.mutateAsync({ action: "delete", body: { ids: selectedIds } }),
                    });
                  }}
                >
                  删除
                </Button>
              )}
              <Button
                type="link"
                size="small"
                className="!px-0"
                onClick={() => {
                  setExportScope("selected");
                  setExportOpen(true);
                }}
              >
                导出勾选行
              </Button>
              <Button
                type="link"
                size="small"
                className="!px-0 ml-auto text-[#A8ABB0]"
                onClick={() => setSelected([])}
              >
                取消选择
              </Button>
            </div>
          )}

          {/* 列表 */}
          <div className="flex-1 min-w-0">
            <Table<CaseRowV2>
              rowKey="id"
              data-testid="case-table"
              loading={listQ.isLoading}
              dataSource={rows}
              rowSelection={
                recycled
                  ? undefined
                  : {
                      selectedRowKeys: selected,
                      onChange: (keys) => setSelected(keys),
                    }
              }
              pagination={{
                current: page,
                pageSize: 20,
                total: listQ.data?.total ?? 0,
                onChange: (p) => {
                  setPage(p);
                  setSelected([]);
                },
                showTotal: (t) => `共 ${t} 条`,
              }}
              locale={{
                emptyText:
                  moduleId && rows.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="该模块暂无用例，去新建或导入"
                    />
                  ) : (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={recycled ? "回收站为空" : "无匹配结果，调整筛选或清空条件"}
                    />
                  ),
              }}
              columns={[
                {
                  title: "编号",
                  dataIndex: "num",
                  width: 92,
                  render: (n: number, r) => (
                    <a className="text-[#87888D] hover:text-[#574BFF]" href={`/cases/${r.id}`}>
                      C-{String(n).padStart(4, "0")}
                    </a>
                  ),
                },
                {
                  title: "用例名称",
                  dataIndex: "name",
                  render: (name: string, r) => (
                    <span className="inline-flex items-center gap-1">
                      <a
                        className="text-[#1F2329] hover:text-[#574BFF] font-medium"
                        href={`/cases/${r.id}?edit=1`}
                      >
                        {name}
                      </a>
                      {followedIds.has(r.id) && (
                        <Star size={12} className="fill-[#FA8C16] text-[#FA8C16]" />
                      )}
                    </span>
                  ),
                },
                {
                  title: "等级",
                  dataIndex: "level",
                  width: 68,
                  render: (l: string) => (
                    <Tag bordered={false} color={levelColor[l]}>
                      {l}
                    </Tag>
                  ),
                },
                ...(activeCols.includes("module")
                  ? [
                      {
                        title: "模块",
                        key: "module",
                        width: 130,
                        render: (_: unknown, r: CaseRowV2) => (
                          <span className="text-[#87888D]">{moduleName(r.moduleId)}</span>
                        ),
                      },
                    ]
                  : []),
                ...(activeCols.includes("tags")
                  ? [
                      {
                        title: "标签",
                        dataIndex: "tags",
                        width: 170,
                        render: (tags: string[]) =>
                          tags.length ? (
                            tags.map((t) => (
                              <Tag key={t} bordered={false} color="processing">
                                {t}
                              </Tag>
                            ))
                          ) : (
                            <span className="text-[#C0C4CC]">—</span>
                          ),
                      },
                    ]
                  : []),
                ...(activeCols.includes("status")
                  ? [
                      {
                        title: "状态",
                        dataIndex: "status",
                        width: 90,
                        render: (s: string) => <span className="text-xs">{statusText(s)}</span>,
                      },
                    ]
                  : []),
                ...(activeCols.includes("creator")
                  ? [
                      {
                        title: "创建人",
                        key: "creator",
                        width: 90,
                        render: (_: unknown, r: CaseRowV2) => (
                          <span className="text-[#87888D]">{memberName(r.createdBy)}</span>
                        ),
                      },
                    ]
                  : []),
                ...dynCols,
                ...(activeCols.includes("updatedAt")
                  ? [
                      {
                        title: "更新时间",
                        dataIndex: "updatedAt",
                        width: 110,
                        render: (s: string) => (
                          <span className="text-[#87888D] text-xs">{s.slice(0, 10)}</span>
                        ),
                      },
                    ]
                  : []),
                {
                  title: "操作",
                  key: "ops",
                  width: recycled ? 190 : 230,
                  render: (_, r) =>
                    recycled ? (
                      <span className="flex items-center gap-1">
                        <Button
                          type="link"
                          size="small"
                          icon={<RotateCcw size={13} />}
                          data-testid={`btn-restore-${r.num}`}
                          onClick={() => restore.mutate(r.id)}
                        >
                          恢复
                        </Button>
                        <Popconfirm
                          title="彻底删除"
                          description="该操作不可恢复，确认删除？"
                          okText="彻底删除"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => purge.mutate(r.id)}
                        >
                          <Button type="link" size="small" danger icon={<Trash2 size={13} />}>
                            彻底删除
                          </Button>
                        </Popconfirm>
                      </span>
                    ) : (
                      <span className="flex items-center gap-1">
                        <a
                          className="text-[#574BFF] hover:opacity-80"
                          href={`/cases/${r.id}?edit=1`}
                        >
                          编辑
                        </a>
                        <span className="text-[#E5E6EB]">|</span>
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          icon={
                            <Star
                              size={13}
                              className={
                                followedIds.has(r.id) ? "fill-[#FA8C16] text-[#FA8C16]" : ""
                              }
                            />
                          }
                          onClick={() => follow.mutate({ id: r.id, on: !followedIds.has(r.id) })}
                          data-testid={`btn-follow-${r.num}`}
                        >
                          {followedIds.has(r.id) ? "已关注" : "关注"}
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          onClick={() => copy.mutate(r.id)}
                          data-testid={`btn-copy-${r.num}`}
                        >
                          复制
                        </Button>
                        <Button
                          type="link"
                          size="small"
                          className="!px-0"
                          onClick={() => void shareRow(r)}
                          data-testid={`btn-share-${r.num}`}
                        >
                          分享
                        </Button>
                        {canDelete && (
                          <Button
                            type="link"
                            size="small"
                            danger
                            className="!px-0"
                            onClick={() => remove.mutate(r.id)}
                            data-testid={`btn-delete-${r.num}`}
                          >
                            删除
                          </Button>
                        )}
                      </span>
                    ),
                },
              ]}
            />
          </div>
        </div>
      </div>

      {/* 另存为视图 */}
      <Modal
        title="另存为视图"
        open={saveViewOpen}
        onCancel={() => setSaveViewOpen(false)}
        okText="保存"
        cancelText="取消"
        okButtonProps={{ disabled: !viewName.trim() }}
        confirmLoading={saveView.isPending}
        onOk={() => saveView.mutate()}
      >
        <p className="text-[13px] text-[#646A73] mb-2">
          将当前筛选组合（模块 + 关键字 + 高级筛选）保存为自定义视图：
        </p>
        <Input
          value={viewName}
          maxLength={64}
          placeholder="视图名称（如：冒烟集）"
          onChange={(e) => setViewName(e.target.value)}
          data-testid="input-view-name"
          onPressEnter={() => viewName.trim() && saveView.mutate()}
        />
      </Modal>

      {/* 批量移动 */}
      <Modal
        title={`移动 ${selected.length} 条用例到模块`}
        open={moveOpen}
        onCancel={() => setMoveOpen(false)}
        okText="移动"
        cancelText="取消"
        okButtonProps={{ disabled: !moveTarget }}
        confirmLoading={batch.isPending}
        onOk={() =>
          batch.mutate({ action: "move", body: { ids: selectedIds, moduleId: moveTarget } })
        }
      >
        <TreeSelect
          className="w-full"
          value={moveTarget}
          treeData={toTreeSelectData(modulesQ.data?.items ?? [])}
          treeDefaultExpandAll
          placeholder="选择目标模块"
          onChange={(v) => setMoveTarget(v)}
          data-testid="select-move-target"
        />
        <p className="text-xs text-[#A8ABB0] mt-2">移动后用例归属目标模块，模块计数将同步更新。</p>
      </Modal>

      {/* 批量编辑 */}
      <Modal
        title={`批量编辑 ${selected.length} 条用例`}
        open={batchEditOpen}
        onCancel={() => setBatchEditOpen(false)}
        okText="应用"
        cancelText="取消"
        confirmLoading={batch.isPending}
        onOk={() =>
          batch.mutate({
            action: "update",
            body: {
              ids: selectedIds,
              ...(batchLevel ? { level: batchLevel } : {}),
              ...(batchTags.length ? { addTags: batchTags } : {}),
            },
          })
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-[13px] mb-1">等级（留空=不变）</label>
            <Select
              className="w-full"
              allowClear
              virtual={false}
              placeholder="保持不变"
              value={batchLevel}
              options={["P0", "P1", "P2", "P3"].map((l) => ({ value: l, label: l }))}
              onChange={(v) => setBatchLevel(v as CaseLevel | undefined)}
              data-testid="select-batch-level"
            />
          </div>
          <div>
            <label className="block text-[13px] mb-1">追加标签（留空=不变）</label>
            <Select
              className="w-full"
              mode="tags"
              allowClear
              placeholder="输入回车添加"
              value={batchTags}
              onChange={setBatchTags}
              data-testid="select-batch-tags"
            />
          </div>
        </div>
      </Modal>

      {/* 导入向导（三步） */}
      <Modal
        title="导入用例"
        open={importOpen}
        onCancel={() => setImportOpen(false)}
        footer={
          importStep === 3
            ? [
                <Button key="re" onClick={resetWizard}>
                  重新上传
                </Button>,
                <Button
                  key="done"
                  type="primary"
                  onClick={() => {
                    setImportOpen(false);
                    invalidateCases();
                  }}
                >
                  完成
                </Button>,
              ]
            : undefined
        }
        okText={importStep === 1 ? "下一步" : "开始导入"}
        cancelText="取消"
        okButtonProps={importStep === 1 ? { disabled: !importFile } : undefined}
        confirmLoading={doImport.isPending}
        onOk={() => {
          if (importStep === 1) {
            setImportStep(2);
            return;
          }
          doImport.mutate();
        }}
        width={640}
      >
        <Steps
          size="small"
          current={importStep - 1}
          className="mb-4"
          items={[{ title: "上传文件" }, { title: "确认映射" }, { title: "结果报告" }]}
        />
        {importStep === 1 && (
          <div data-testid="import-step-upload">
            <Dragger
              accept=".xlsx,.xmind"
              maxCount={1}
              fileList={
                importFile
                  ? [{ uid: "-1", name: importFile.name, status: "done", size: importFile.size }]
                  : []
              }
              beforeUpload={(file) => {
                setImportFile(file);
                return false;
              }}
              onRemove={() => setImportFile(null)}
            >
              <p className="ant-upload-drag-icon">
                <UploadIcon size={24} className="text-[#574BFF]" />
              </p>
              <p className="ant-upload-text text-[13px]">点击或拖拽文件到此处上传</p>
              <p className="ant-upload-hint text-xs">
                支持 .xlsx / .xmind（兼容 MeterSphere 官方模板），单次 ≤ 5000 行
              </p>
            </Dragger>
            <div className="flex items-center gap-3 mt-3 text-[13px]">
              <a
                className="text-[#574BFF] cursor-pointer"
                onClick={() => void downloadTemplate()}
                data-testid="btn-download-template"
              >
                {tplDownloading ? "模板下载中…" : "下载 Excel 模板"}
              </a>
              <span className="text-xs text-[#A8ABB0]">
                {visibleDynDefs.length
                  ? `列头含动态字段：${visibleDynDefs.map((d) => d.name).join(" / ")}`
                  : "固定列：编号/模块/名称/前置/步骤/预期/等级/标签"}
              </span>
            </div>
          </div>
        )}
        {importStep === 2 && importFile && (
          <div className="space-y-4" data-testid="import-step-mapping">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[13px] text-[#646A73]">文件：{importFile.name}</span>
              <div className="ml-auto flex items-center gap-4">
                <Radio.Group
                  value={importMode}
                  onChange={(e) => setImportMode(e.target.value)}
                  data-testid="radio-import-mode"
                >
                  <Radio value="skip">相同编号跳过</Radio>
                  <Radio value="overwrite">相同编号覆盖</Radio>
                </Radio.Group>
              </div>
            </div>
            <div>
              <label className="block text-[13px] mb-1">
                目标模块（不选=按文件「所属模块」列自动匹配）
              </label>
              <TreeSelect
                className="w-full"
                value={importModule}
                treeData={toTreeSelectData(modulesQ.data?.items ?? [])}
                treeDefaultExpandAll
                allowClear
                placeholder="默认：文件模块列 / 默认模块"
                onChange={(v) => setImportModule(v)}
                data-testid="select-import-module"
              />
            </div>
            <p className="text-xs text-[#A8ABB0]">
              覆盖 = 按编号匹配存量（回收站不参与），白名单字段全量替换并记录变更历史；跳过 =
              仅计数不改数据。 全部行先校验后原子落库，失败行不导入。
            </p>
          </div>
        )}
        {importStep === 3 && importReport && (
          <div className="space-y-4" data-testid="import-step-report">
            <div className="flex gap-8 text-center py-2">
              <div>
                <p className="text-2xl font-semibold text-[#52C41A]">
                  {importReport.created + importReport.overwritten}
                </p>
                <p className="text-xs text-[#646A73] mt-1">导入成功</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[#FF4D4F]">{importReport.failed}</p>
                <p className="text-xs text-[#646A73] mt-1">校验失败</p>
              </div>
              <div>
                <p className="text-2xl font-semibold text-[#87888D]">{importReport.skipped}</p>
                <p className="text-xs text-[#646A73] mt-1">跳过（编号已存在）</p>
              </div>
              <div className="ml-auto self-center text-xs text-[#A8ABB0] text-right">
                模式：{importReport.mode === "overwrite" ? "相同编号覆盖" : "相同编号跳过"}
                <br />
                共解析 {importReport.total} 行
              </div>
            </div>
            {importReport.failed > 0 && (
              <div>
                <p className="text-xs text-[#A8ABB0] mb-1.5">失败行明细（修正模板后可重新上传）</p>
                <table className="w-full text-xs border border-[#F0F1F3] rounded">
                  <thead className="bg-[#F7F8FA] text-[#87888D]">
                    <tr>
                      <th className="p-1.5 text-left">行号</th>
                      <th className="p-1.5 text-left">失败原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importReport.errors.map((e) => (
                      <tr key={e.row} className="border-t bg-[#FF4D4F]/5">
                        <td className="p-1.5">{e.row}</td>
                        <td className="p-1.5 text-[#FF4D4F]">{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {importReport.ignoredColumns.length > 0 && (
              <p className="text-xs text-[#A8ABB0]">
                提示：文件列「{importReport.ignoredColumns.join("、")}
                」未能识别，已按忽略列处理，未导入。
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* 导出弹窗 */}
      <Modal
        title="导出用例"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        okText="导出"
        cancelText="取消"
        confirmLoading={exporting}
        onOk={() => void doExport()}
      >
        <div className="space-y-4">
          <div>
            <p className="text-[13px] text-[#3D4350] mb-2">导出格式</p>
            <Radio.Group
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value)}
              data-testid="radio-export-format"
              options={[
                { value: "excel", label: "Excel 默认（每用例一行）" },
                { value: "excel_split", label: "Excel 拆分（步骤单元格纵向拆分）" },
                { value: "xmind", label: "Xmind（按模块树结构）" },
              ]}
            />
            {exportFormat === "xmind" && (
              <p className="text-xs text-[#A8ABB0] mt-1">
                Xmind 结构固定（模块→用例→步骤；标记=等级、备注=前置/预期），字段勾选不适用。
              </p>
            )}
          </div>
          {exportFormat !== "xmind" && (
            <div>
              <p className="text-[13px] text-[#3D4350] mb-2">导出字段</p>
              <div className="space-y-1.5">
                <p className="flex items-center gap-3 flex-wrap text-[13px]">
                  <span className="text-xs text-[#A8ABB0] w-16">基础字段</span>
                  {BASE_EXPORT_FIELDS.map((f) => (
                    <Checkbox
                      key={f.key}
                      checked={activeExportFields.includes(f.key)}
                      onChange={(e) =>
                        setExportFields(
                          e.target.checked
                            ? [...activeExportFields, f.key]
                            : activeExportFields.filter((k) => k !== f.key),
                        )
                      }
                    >
                      {f.label}
                    </Checkbox>
                  ))}
                </p>
                {defs.length > 0 && (
                  <p className="flex items-center gap-3 flex-wrap text-[13px]">
                    <span className="text-xs text-[#A8ABB0] w-16">动态字段</span>
                    {defs.map((d) => (
                      <Checkbox
                        key={d.key}
                        checked={activeExportFields.includes(d.key)}
                        onChange={(e) =>
                          setExportFields(
                            e.target.checked
                              ? [...activeExportFields, d.key]
                              : activeExportFields.filter((k) => k !== d.key),
                          )
                        }
                      >
                        {d.name}
                      </Checkbox>
                    ))}
                  </p>
                )}
              </div>
            </div>
          )}
          <div>
            <p className="text-[13px] text-[#3D4350] mb-2">导出范围</p>
            <Radio.Group
              value={exportScope}
              onChange={(e) => setExportScope(e.target.value)}
              data-testid="radio-export-scope"
            >
              <Radio value="filter">当前筛选结果（共 {listQ.data?.total ?? 0} 条）</Radio>
              <Radio value="selected" disabled={selected.length === 0}>
                已勾选行（{selected.length} 条）
              </Radio>
            </Radio.Group>
          </div>
        </div>
      </Modal>
    </div>
  );
}
