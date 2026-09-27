"use client";

/**
 * API-006 场景编辑页（原型画板二）：头部基本信息/执行/保存 + 左步骤树 + 右五配置区
 * （步骤配置 / 参数 API-007 / 前置后置 / 断言 / 设置）。步骤树与配置分端点保存。
 */
import { Button, Checkbox, Drawer, Empty, Input, Modal, Radio, Select, Table, Tabs, Tag } from "antd";
import { ArrowLeft, Eye, History, Play, Save } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fileApi, scenarioApi } from "@rabbit/api-client";
import type { ScenarioConfigSave, ScenarioDetail } from "@rabbit/api-client";
import type { AssertSpec, Processor, ScenarioStepNode } from "@rabbit/shared";
import { parseCsv } from "@rabbit/shared/execution/csv";
import { useApp } from "@/hooks/useApp";
import { usePermissions } from "@/hooks/usePermissions";
import { useProjectStore } from "@/stores/project";
import EnvSelect from "@/components/api/EnvSelect";
import { ChangeTimeline } from "@/components/crosscut";
import StepTreePanel, { findNode } from "@/components/scenario/StepTreePanel";
import StepConfigEditor, { AssertRowsEditor, ConstRowsEditor, ProcessorRowsEditor } from "@/components/scenario/StepConfigEditor";
import FunctionHintPopover from "@/components/scenario/FunctionHintPopover";
import { ApiError } from "@rabbit/api-client";

const LEVELS = ["P0", "P1", "P2", "P3"];
const STATUSES: { value: string; label: string }[] = [
  { value: "PREPARE", label: "未开始" },
  { value: "UNDERWAY", label: "进行中" },
  { value: "COMPLETED", label: "已完成" },
];

function defaultConfig(): ScenarioConfigSave {
  return {
    params: { constants: [], lists: [], csv: { source: "inline", delimiter: ",", hasHeader: true } },
    prePost: { pre: [], post: [] },
    asserts: [],
    settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
  };
}

export default function ScenarioEditPage() {
  const { id } = useParams<{ id: string }>();
  const { currentProjectId: projectId } = useProjectStore();
  const { can } = usePermissions();
  const { message } = useApp();
  const router = useRouter();
  const qc = useQueryClient();
  const canUpdate = can("PROJECT_SCENARIO:UPDATE");

  const detailQ = useQuery({
    queryKey: ["scenarios", "detail", projectId, id],
    queryFn: () => scenarioApi.detail(projectId!, id),
    enabled: Boolean(projectId && id),
  });

  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [level, setLevel] = useState("P2");
  const [status, setStatus] = useState("UNDERWAY");
  const [tagsText, setTagsText] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [config, setConfig] = useState<ScenarioConfigSave>(defaultConfig());
  const [steps, setSteps] = useState<ScenarioStepNode[]>([]);
  const [version, setVersion] = useState(1);
  const [origin, setOrigin] = useState<{ meta: string; config: string; steps: string }>({ meta: "", config: "", steps: "" });
  const [tab, setTab] = useState("step");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [envId, setEnvId] = useState<string | undefined>(undefined);
  const [changesOpen, setChangesOpen] = useState(false);
  const [varsOpen, setVarsOpen] = useState(false);

  useEffect(() => {
    const d = detailQ.data;
    if (!d || loadedId === d.id) return;
    setLoadedId(d.id);
    setName(d.name);
    setLevel(d.level);
    setStatus(d.status);
    setTagsText((d.tags ?? []).join(", "));
    setModuleId(d.moduleId);
    setConfig({ ...defaultConfig(), ...d.config });
    setSteps(d.steps ?? []);
    setVersion(d.version);
    setOrigin({
      meta: JSON.stringify([d.name, d.level, d.status, d.tags ?? [], d.moduleId]),
      config: JSON.stringify({ ...defaultConfig(), ...d.config }),
      steps: JSON.stringify(d.steps ?? []),
    });
  }, [detailQ.data, loadedId]);

  const tags = tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean);
  const metaDirty = origin.meta !== JSON.stringify([name, level, status, tags, moduleId]);
  const configDirty = origin.config !== JSON.stringify(config);
  const stepsDirty = origin.steps !== JSON.stringify(steps);
  const dirty = metaDirty || configDirty || stepsDirty;

  const saveM = useMutation({
    mutationFn: async () => {
      let v = version;
      if (stepsDirty) {
        const r = await scenarioApi.saveSteps(projectId!, id, { version: v, steps });
        v = r.version;
      }
      if (metaDirty || configDirty) {
        const r = await scenarioApi.update(projectId!, id, { name, moduleId, level: level as "P0", status: status as "PREPARE", tags, version: v, config });
        v = r.version;
      }
      return v;
    },
    onSuccess: async (v) => {
      setVersion(v);
      message.success(`已保存（v${v}）`);
      // 先等 detail 缓存刷新完成再解锁重置——否则 invalidate 期间的旧缓存先到，
      // effect 会用旧 config（空）覆盖刚保存的编辑态（API-007-01 竞态）
      await qc.invalidateQueries({ queryKey: ["scenarios", "detail", projectId, id] });
      setLoadedId(null);
      void qc.invalidateQueries({ queryKey: ["scenarios", "list"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 409 || e.code === 20409)) message.error("内容已被他人修改，请刷新页面后重试");
      else message.error(e instanceof Error ? e.message : "保存失败");
    },
  });

  const execM = useMutation({
    mutationFn: () => scenarioApi.execute(projectId!, id, envId ? { envId } : {}),
    onSuccess: (r) => {
      if (r.warnings?.length) message.warning(r.warnings[0]);
      message.success(`已提交执行（任务 ${r.taskId.slice(0, 8)}）`);
      router.push(`/reports/${r.taskId}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "执行失败"),
  });

  const stepDebugM = useMutation({
    mutationFn: (stepId: string) => scenarioApi.executeStep(projectId!, id, stepId, envId ? { envId } : {}),
    onSuccess: (r) => {
      message.success(`单步已提交（任务 ${r.taskId.slice(0, 8)}）`);
      router.push(`/reports/${r.taskId}`);
    },
    onError: (e) => message.error(e instanceof Error ? e.message : "单步执行失败"),
  });

  const onStepDebug = (uid: string) => {
    if (stepsDirty) {
      message.warning("步骤树有未保存修改——单步执行以已保存版本运行，请先保存");
      return;
    }
    stepDebugM.mutate(uid);
  };

  const changesQ = useQuery({
    queryKey: ["scenarios", "changes", projectId, id],
    queryFn: () => scenarioApi.changes(projectId!, id),
    enabled: Boolean(projectId && id && changesOpen),
  });

  // foreach 数据源候选：列表名 + CSV 列名（inline 可前端解析；file 模式由服务端解析，允许手输）
  const csvPreview = useMemo(() => {
    const c = config.params.csv;
    if (c.source === "inline" && (c.inlineText ?? "").trim()) {
      return parseCsv(c.inlineText ?? "", { delimiter: c.delimiter, hasHeader: c.hasHeader });
    }
    return null;
  }, [config.params.csv]);

  const foreachSources = useMemo(() => {
    // 后端按「列表名或 CSV 列名」原文匹配 source，此处不加前缀
    const names = config.params.lists.map((l) => l.name).filter(Boolean);
    const cols = csvPreview?.columns ?? [];
    return [...names, ...cols];
  }, [config.params.lists, csvPreview]);

  const patchStep = (uid: string, patch: Partial<ScenarioStepNode>) => {
    setSteps((prev) => {
      const walk = (nodes: ScenarioStepNode[]): ScenarioStepNode[] =>
        nodes.map((n) => (n.uid === uid ? { ...n, ...patch } : { ...n, children: walk(n.children) }));
      return walk(prev);
    });
  };

  const selectedStep = selectedUid ? findNode(steps, selectedUid) : undefined;

  if (!projectId) return <Empty description="请先选择项目" />;
  if (detailQ.isLoading) return <Empty description="加载中…" />;
  if (detailQ.isError || !detailQ.data) return <Empty description={(detailQ.error as Error | undefined)?.message ?? "场景不存在"} />;

  const d: ScenarioDetail = detailQ.data;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-xs text-[#87888D]">
        <a href="/scenarios" className="flex items-center gap-1 hover:text-[#574BFF]">
          <ArrowLeft size={13} strokeWidth={1.8} />
          返回场景列表
        </a>
        <span>·</span>
        <span>
          {d.name} <span className="text-[#A8ABB0]">#{d.num}</span>
        </span>
      </div>

      {/* 头部：基本信息 + 操作 */}
      <div className="rabbit-card flex flex-wrap items-center gap-2 p-3">
        <Input className="!w-56" value={name} disabled={!canUpdate} data-testid="input-scenario-name" onChange={(e) => setName(e.target.value)} />
        <Select className="!w-20" value={level} disabled={!canUpdate} onChange={setLevel} options={LEVELS.map((l) => ({ value: l, label: l }))} data-testid="select-scenario-level" />
        <Select className="!w-28" value={status} disabled={!canUpdate} onChange={setStatus} options={STATUSES} data-testid="select-scenario-status" />
        <Input className="!w-52" placeholder="标签（逗号分隔）" value={tagsText} disabled={!canUpdate} onChange={(e) => setTagsText(e.target.value)} />
        {tags.slice(0, 5).map((t) => (
          <Tag key={t} className="!mr-0">
            {t}
          </Tag>
        ))}
        <span className="rounded bg-[#F0F1F3] px-1.5 py-0.5 text-[11px] text-[#646A73]">当前版本 v{version}</span>
        {dirty && <span className="text-[11px] text-[#FA8C16]">未保存</span>}
        <div className="ml-auto flex items-center gap-2">
          <EnvSelect value={envId} onChange={setEnvId} />
          <Button size="small" icon={<History size={13} strokeWidth={1.8} />} onClick={() => setChangesOpen(true)} data-testid="btn-scenario-changes">
            变更历史
          </Button>
          {canUpdate && (
            <>
              <Button size="small" icon={<Play size={13} strokeWidth={1.8} />} loading={execM.isPending} onClick={() => execM.mutate()} data-testid="btn-exec-scenario">
                执行
              </Button>
              <Button size="small" type="primary" icon={<Save size={13} strokeWidth={1.8} />} loading={saveM.isPending} disabled={!dirty || !name.trim()} onClick={() => saveM.mutate()} data-testid="btn-save-scenario">
                保存
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 主体：左步骤树 + 右五配置区 */}
      <div className="flex items-stretch gap-3">
        <div className="rabbit-card w-[420px] shrink-0" data-testid="scenario-step-tree-card">
          <StepTreePanel
            steps={steps}
            onChange={setSteps}
            selectedUid={selectedUid}
            onSelect={setSelectedUid}
            canEdit={canUpdate}
            onStepDebug={onStepDebug}
          />
        </div>
        <div className="rabbit-card min-w-0 flex-1 p-3">
          <Tabs
            activeKey={tab}
            onChange={setTab}
            items={[
              {
                key: "step",
                label: (
                  <span data-testid="scenario-tab-step">步骤配置</span>
                ),
                children: selectedStep ? (
                  <StepConfigEditor
                    step={selectedStep}
                    onChange={(patch) => patchStep(selectedStep.uid, patch)}
                    foreachSources={foreachSources}
                    canEdit={canUpdate}
                  />
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="在左侧步骤树选中一个步骤进行配置" />
                ),
              },
              {
                key: "params",
                label: (
                  <span data-testid="scenario-tab-params">参数</span>
                ),
                children: (
                  <ParamsPanel config={config} onChange={setConfig} canEdit={canUpdate} csvPreview={csvPreview} onOpenVars={() => setVarsOpen(true)} steps={steps} />
                ),
              },
              {
                key: "prepost",
                label: (
                  <span data-testid="scenario-tab-prepost">前置/后置</span>
                ),
                children: (
                  <div className="space-y-5">
                    <div>
                      <p className="mb-2 text-xs font-medium text-[#3D4350]">场景前置（首个步骤之前执行）</p>
                      <ProcessorRowsEditor
                        rows={(config.prePost.pre ?? []) as Processor[]}
                        testid="scenario-pre-rows"
                        onChange={(pre) => setConfig({ ...config, prePost: { ...config.prePost, pre } })}
                      />
                    </div>
                    <div>
                      <p className="mb-2 text-xs font-medium text-[#3D4350]">场景后置（终态之后执行）</p>
                      <ProcessorRowsEditor
                        rows={(config.prePost.post ?? []) as Processor[]}
                        testid="scenario-post-rows"
                        onChange={(post) => setConfig({ ...config, prePost: { ...config.prePost, post } })}
                      />
                    </div>
                    <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] text-[#87888D]">场景变量断言（终态对 tempVars 求值）在「断言」页签配置；SQL 处理器静态门禁未解禁（API-006 勘误 1）</p>
                  </div>
                ),
              },
              {
                key: "asserts",
                label: (
                  <span data-testid="scenario-tab-asserts">断言</span>
                ),
                children: (
                  <div className="space-y-2">
                    <p className="text-xs text-[#646A73]">场景级断言：执行终态对变量求值（variable 类断言主用；请求类断言建议配在步骤上）</p>
                    <AssertRowsEditor
                      rows={(config.asserts ?? []) as AssertSpec[]}
                      testid="scenario-assert-rows"
                      onChange={(asserts) => setConfig({ ...config, asserts })}
                    />
                  </div>
                ),
              },
              {
                key: "settings",
                label: (
                  <span data-testid="scenario-tab-settings">设置</span>
                ),
                children: (
                  <div className="max-w-md space-y-4">
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-xs text-[#646A73]">Cookie 策略</span>
                      <Select
                        className="!w-40"
                        disabled={!canUpdate}
                        value={config.settings.cookieMode}
                        onChange={(v) => setConfig({ ...config, settings: { ...config.settings, cookieMode: v } })}
                        options={[
                          { value: "off", label: "关闭（步骤间不共享）" },
                          { value: "keep", label: "保持（场景级 CookieJar）" },
                        ]}
                        data-testid="select-cookie-mode"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-xs text-[#646A73]">思考时间</span>
                      <Input
                        className="!w-32"
                        type="number"
                        min={0}
                        max={30000}
                        addonAfter="ms"
                        disabled={!canUpdate}
                        value={config.settings.thinkTimeMs}
                        onChange={(e) => setConfig({ ...config, settings: { ...config.settings, thinkTimeMs: Math.max(0, Math.min(30000, Number(e.target.value) || 0)) } })}
                        data-testid="input-think-time"
                      />
                      <span className="text-[11px] text-[#A8ABB0]">每个请求步骤后等待</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-28 text-xs text-[#646A73]">失败规则</span>
                      <Select
                        className="!w-40"
                        disabled={!canUpdate}
                        value={config.settings.onFailure}
                        onChange={(v) => setConfig({ ...config, settings: { ...config.settings, onFailure: v } })}
                        options={[
                          { value: "abort", label: "停止运行（余步 SKIPPED）" },
                          { value: "continue", label: "忽略错误继续" },
                        ]}
                        data-testid="select-on-failure"
                      />
                    </div>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>

      {/* 变更历史 */}
      <Drawer title="变更历史" open={changesOpen} onClose={() => setChangesOpen(false)} width={520}>
        <ChangeTimeline
          items={(changesQ.data?.items ?? []).map((c) => ({
            id: `${c.seq}`,
            seq: c.seq,
            action: c.action,
            diff: c.diff,
            userName: c.user,
            createdAt: c.createdAt,
          }))}
        />
      </Drawer>

      {/* 变量视图（API-007 画板三） */}
      <Modal title="变量视图（渲染优先级自上而下）" open={varsOpen} footer={null} onCancel={() => setVarsOpen(false)} width={640}>
        <VarsView config={config} steps={steps} csvPreview={csvPreview} />
      </Modal>
    </div>
  );
}

/** 参数页签（API-007 画板一：常量 / 列表 / CSV 三分区）。 */
function ParamsPanel({
  config,
  onChange,
  canEdit,
  csvPreview,
  onOpenVars,
  steps,
}: {
  config: ScenarioConfigSave;
  onChange: (c: ScenarioConfigSave) => void;
  canEdit: boolean;
  csvPreview: { columns: string[]; rows: string[][]; skippedRows: number } | null;
  onOpenVars: () => void;
  steps: ScenarioStepNode[];
}) {
  const { currentProjectId: projectId } = useProjectStore();
  const { message } = useApp();
  const csv = config.params.csv;
  const setParams = (part: Partial<ScenarioConfigSave["params"]>) => onChange({ ...config, params: { ...config.params, ...part } });

  const filesQ = useQuery({
    queryKey: ["files", "list", projectId, JSON.stringify({ page: 1, pageSize: 100 })],
    queryFn: () => fileApi.list(projectId!, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId) && csv.source === "file",
    staleTime: 60_000,
  });

  const uploadCsv = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await fileApi.upload(projectId!, f);
      setParams({ csv: { ...csv, source: "file", fileId: r.id } });
      message.success(`已上传 ${r.name}（文件管理）`);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "上传失败");
    }
  };

  return (
    <div className="space-y-6" data-testid="scenario-params-panel">
      <div className="flex justify-end">
        <Button size="small" icon={<Eye size={13} strokeWidth={1.8} />} onClick={onOpenVars} data-testid="btn-vars-view">
          变量视图
        </Button>
      </div>

      {/* 常量 */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h4 className="m-0 text-xs font-medium text-[#1F2329]">常量</h4>
          <span className="text-[11px] text-[#87888D]">渲染 `${"{"}name{"}"}` · 覆盖同名环境变量</span>
          <FunctionHintPopover />
        </div>
        <ConstRowsEditor rows={config.params.constants} testid="params-constants" onChange={(constants) => setParams({ constants })} />
      </section>

      {/* 列表 */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h4 className="m-0 text-xs font-medium text-[#1F2329]">列表</h4>
          <span className="text-[11px] text-[#87888D]">供 ForEach 迭代或 `${"{"}listName{"}"}` 取当前值</span>
        </div>
        <div className="space-y-1" data-testid="params-lists">
          {config.params.lists.map((l, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                size="small"
                className="!w-40 font-mono"
                placeholder="列表名"
                value={l.name}
                onChange={(e) => setParams({ lists: config.params.lists.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)) })}
              />
              <span className="text-xs text-[#A8ABB0]">=</span>
              <Select
                size="small"
                className="flex-1"
                mode="tags"
                placeholder="多个值（回车确认）"
                value={l.values}
                open={false}
                onChange={(values) => setParams({ lists: config.params.lists.map((x, idx) => (idx === i ? { ...x, values } : x)) })}
              />
              <Button type="text" size="small" className="!px-1 !text-[#FF4D4F]" onClick={() => setParams({ lists: config.params.lists.filter((_, idx) => idx !== i) })}>
                ×
              </Button>
            </div>
          ))}
          <Button type="link" size="small" className="!px-0 !text-[#574BFF]" onClick={() => setParams({ lists: [...config.params.lists, { name: "", values: [] }] })}>
            ＋ 添加列表
          </Button>
        </div>
      </section>

      {/* CSV */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h4 className="m-0 text-xs font-medium text-[#1F2329]">CSV（场景级）</h4>
          <span className="text-[11px] text-[#87888D]">绑定 ForEach 后逐行注入 `row.列名`</span>
        </div>
        <div className="space-y-2" data-testid="params-csv">
          <Radio.Group
            value={csv.source}
            disabled={!canEdit}
            onChange={(e) => setParams({ csv: { ...csv, source: e.target.value } })}
            data-testid="radio-csv-source"
          >
            <Radio.Button value="inline">本地上传</Radio.Button>
            <Radio.Button value="file">文件管理关联</Radio.Button>
          </Radio.Group>
          {csv.source === "inline" ? (
            <div>
              <Input.TextArea
                rows={5}
                className="!w-full font-mono !text-xs"
                placeholder={"name,email,age\nalice,a@demo.io,21"}
                value={csv.inlineText ?? ""}
                disabled={!canEdit}
                data-testid="input-csv-inline"
                onChange={(e) => setParams({ csv: { ...csv, inlineText: e.target.value } })}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select
                className="!w-64"
                placeholder="选择文件（文件管理）"
                showSearch
                optionFilterProp="label"
                value={csv.fileId || undefined}
                disabled={!canEdit}
                onChange={(v) => setParams({ csv: { ...csv, fileId: v } })}
                options={(filesQ.data?.items ?? []).map((f) => ({ value: f.id, label: `${f.name}（${(f.size / 1024).toFixed(1)}KB）` }))}
                data-testid="select-csv-file"
              />
              <input type="file" accept=".csv" className="text-xs" disabled={!canEdit} data-testid="input-csv-upload" onChange={(e) => uploadCsv(e.target.files?.[0])} />
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-[#646A73]">
              分隔符
              <Select
                size="small"
                className="!w-20"
                value={csv.delimiter}
                disabled={!canEdit}
                onChange={(v) => setParams({ csv: { ...csv, delimiter: v } })}
                options={[
                  { value: ",", label: ", 逗号" },
                  { value: ";", label: "; 分号" },
                  { value: "\t", label: "Tab" },
                ]}
              />
            </span>
            <Checkbox
              checked={csv.hasHeader}
              disabled={!canEdit}
              onChange={(e) => setParams({ csv: { ...csv, hasHeader: e.target.checked } })}
              data-testid="check-csv-header"
            >
              首行表头
            </Checkbox>
          </div>
          {csvPreview && csvPreview.columns.length > 0 && (
            <div className="rounded border border-[#F0F1F3]" data-testid="csv-preview">
              <Table
                size="small"
                pagination={false}
                columns={csvPreview.columns.slice(0, 8).map((c) => ({ title: c, dataIndex: c, key: c }))}
                dataSource={csvPreview.rows.slice(0, 10).map((row) => Object.fromEntries(csvPreview.columns.map((c, j) => [c, row[j] ?? ""])) as Record<string, string>)}
                rowKey={(_, i) => String(i)}
              />
              <p className="px-2 py-1 text-[11px] text-[#A8ABB0]">
                预览前 10 行{csvPreview.skippedRows > 0 ? ` · ${csvPreview.skippedRows} 行列数不一致已跳过` : ""}
              </p>
            </div>
          )}
          {csv.source === "file" && <p className="text-[11px] text-[#A8ABB0]">文件模式：列解析在任务下发时由服务端完成；ForEach source 直接填列名</p>}
        </div>
      </section>
      <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] leading-5 text-[#87888D]">
        渲染优先级：步骤提取 &gt; 步骤参数 &gt; 场景参数（本页）&gt; 环境变量。共 {steps.length} 个根步骤使用这些参数。
      </p>
    </div>
  );
}

/** 变量视图 Modal（API-007 画板三：四级来源合并展示）。 */
function VarsView({
  config,
  steps,
  csvPreview,
}: {
  config: ScenarioConfigSave;
  steps: ScenarioStepNode[];
  csvPreview: { columns: string[] } | null;
}) {
  const rows: { name: string; source: string; value: string; note: string }[] = [];
  const walk = (nodes: ScenarioStepNode[]) => {
    for (const n of nodes) {
      const bundle = (n.config as { bundle?: { extracts?: { variable: string; scope?: string }[] } }).bundle;
      for (const ex of bundle?.extracts ?? []) {
        rows.push({ name: ex.variable, source: "步骤提取（temp）", value: "运行时", note: `步骤「${n.name}」提取写回` });
      }
      walk(n.children);
    }
  };
  walk(steps);
  for (const c of config.params.constants) rows.push({ name: c.name, source: "场景参数", value: c.value, note: "覆盖同名环境变量" });
  for (const l of config.params.lists) rows.push({ name: l.name, source: "场景参数（列表）", value: `${l.values.length} 项`, note: "ForEach 迭代源" });
  for (const col of csvPreview?.columns ?? []) rows.push({ name: `row.${col}`, source: "CSV 列", value: "逐行注入", note: "CSV 保留字 row" });

  return (
    <Table
      size="small"
      rowKey={(r) => `${r.source}-${r.name}`}
      pagination={false}
      dataSource={rows}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无参数" /> }}
      columns={[
        { title: "变量", dataIndex: "name", render: (v: string) => <code className="font-mono text-xs text-[#574BFF]">{`$` + "{" + v + "}"}</code> },
        { title: "生效来源", dataIndex: "source", width: 130 },
        { title: "值", dataIndex: "value", ellipsis: true },
        { title: "说明", dataIndex: "note", ellipsis: true },
      ]}
    />
  );
}
