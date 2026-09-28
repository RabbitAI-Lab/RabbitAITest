"use client";

/**
 * 场景步骤配置编辑器（API-006 画板二右侧「步骤配置」Tab）：按 stepType 分支渲染。
 * 含引用目标选择器（接口/用例级联/场景）与可复用行编辑器（断言/处理器/常量）。
 */
import { AutoComplete, Button, Input, InputNumber, Radio, Select } from "antd";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { X } from "lucide-react";
import type { AssertSpec, Processor, ScenarioStepNode, StepBundle } from "@rabbit/shared";
import { apiApi, apiCaseApi, scenarioApi } from "@rabbit/api-client";
import { useProjectStore } from "@/stores/project";
import RequestEditor, { emptyBundle } from "@/components/api/RequestEditor";
import { ScriptRefPanel } from "@/components/api/ScriptRefPanel";
import FunctionHintPopover from "@/components/scenario/FunctionHintPopover";

export const ASSERT_KIND_OPTIONS = [
  { value: "status_code", label: "状态码" },
  { value: "response_time", label: "响应时间(ms)" },
  { value: "body_contains", label: "响应体包含" },
  { value: "body_jsonpath", label: "JSONPath" },
  { value: "response_header", label: "响应头" },
  { value: "variable", label: "变量（终态）" },
];
const ASSERT_OP_OPTIONS = ["eq", "ne", "gt", "lt", "ge", "le", "contains"].map((v) => ({ value: v, label: v }));

// ── 可复用行编辑器（场景断言 / 前后置处理器 / 常量） ──

export function AssertRowsEditor({ rows, onChange, testid }: { rows: AssertSpec[]; onChange: (rows: AssertSpec[]) => void; testid: string }) {
  const patch = (i: number, part: Partial<AssertSpec>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  return (
    <div className="space-y-1" data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <Select size="small" className="!w-32" value={r.kind} onChange={(v) => patch(i, { kind: v as AssertSpec["kind"] })} options={ASSERT_KIND_OPTIONS} />
          <Input size="small" className="!w-36" placeholder="path/变量名" value={r.path} onChange={(e) => patch(i, { path: e.target.value })} />
          <Select size="small" className="!w-20" value={r.op} onChange={(v) => patch(i, { op: v as AssertSpec["op"] })} options={ASSERT_OP_OPTIONS} />
          <Input size="small" className="flex-1" placeholder="期望值" value={r.expected} onChange={(e) => patch(i, { expected: e.target.value })} />
          <Button type="text" size="small" className="!px-1 !text-[#FF4D4F]" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <X size={12} strokeWidth={1.8} />
          </Button>
        </div>
      ))}
      <Button type="link" size="small" className="!px-0 !text-[#574BFF]" onClick={() => onChange([...rows, { kind: "status_code", path: "", op: "eq", expected: "200" }])}>
        ＋ 添加断言
      </Button>
    </div>
  );
}

export function ProcessorRowsEditor({ rows, onChange, testid }: { rows: Processor[]; onChange: (rows: Processor[]) => void; testid: string }) {
  const patch = (i: number, part: Record<string, unknown>) => onChange(rows.map((r, idx) => (idx === i ? ({ ...r, ...part } as Processor) : r)));
  return (
    <div className="space-y-1" data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-start gap-1">
          <Select
            size="small"
            className="!w-24"
            value={r.kind}
            onChange={(v) => patch(i, { kind: v as Processor["kind"] })}
            options={[
              { value: "script", label: "脚本" },
              { value: "wait", label: "等待" },
              { value: "sql", label: "SQL（延后）", disabled: true },
            ]}
          />
          {r.kind === "wait" ? (
            <InputNumber size="small" className="!w-32" min={0} max={30000} addonAfter="ms" value={r.ms ?? 0} onChange={(v) => patch(i, { ms: Number(v ?? 0) })} />
          ) : (r as { scriptRef?: unknown }).scriptRef ? (
            <div className="flex-1">
              <ScriptRefPanel
                value={(r as { scriptRef: { scriptId: string; params: Record<string, string> } }).scriptRef}
                onChange={(v) => patch(i, v ? { script: "", scriptRef: v } : { script: "" })}
              />
              <button type="button" className="text-[11px] text-[#574BFF]" onClick={() => patch(i, { script: "" })}>
                切换为内联脚本
              </button>
            </div>
          ) : (
            <div className="flex-1 flex gap-1">
              <Input size="small" className="flex-1 font-mono" placeholder='脚本（quickjs：log / setVar / getVar / envGet）' value={(r as { script?: string }).script ?? ""} onChange={(e) => patch(i, { script: e.target.value })} />
              <button type="button" className="text-[11px] text-[#574BFF] shrink-0" onClick={() => patch(i, { script: "", scriptRef: { scriptId: "", params: {} } })}>
                引用公共脚本
              </button>
            </div>
          )}
          <Button type="text" size="small" className="!px-1 !text-[#FF4D4F]" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <X size={12} strokeWidth={1.8} />
          </Button>
        </div>
      ))}
      <Button type="link" size="small" className="!px-0 !text-[#574BFF]" onClick={() => onChange([...rows, { kind: "script", script: "" } as Processor])}>
        ＋ 添加处理器
      </Button>
    </div>
  );
}

export function ConstRowsEditor({
  rows,
  onChange,
  testid,
}: {
  rows: { name: string; value: string; description?: string }[];
  onChange: (rows: { name: string; value: string; description?: string }[]) => void;
  testid: string;
}) {
  const patch = (i: number, part: Partial<{ name: string; value: string }>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...part } : r)));
  return (
    <div className="space-y-1" data-testid={testid}>
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <Input size="small" className="!w-40 font-mono" placeholder="变量名" value={r.name} onChange={(e) => patch(i, { name: e.target.value })} />
          <span className="text-xs text-[#A8ABB0]">=</span>
          <Input size="small" className="flex-1 font-mono" placeholder="值（支持 ${__func} / @mock / 管道）" value={r.value} onChange={(e) => patch(i, { value: e.target.value })} />
          <Button type="text" size="small" className="!px-1 !text-[#FF4D4F]" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}>
            <X size={12} strokeWidth={1.8} />
          </Button>
        </div>
      ))}
      <Button type="link" size="small" className="!px-0 !text-[#574BFF]" onClick={() => onChange([...rows, { name: "", value: "" }])}>
        ＋ 添加
      </Button>
    </div>
  );
}

// ── 引用目标选择器 ──

export function RefTargetPicker({
  mode,
  value,
  onPick,
}: {
  mode: "api" | "case" | "scenario";
  value?: string;
  onPick: (id: string, name: string) => void;
}) {
  const { currentProjectId: projectId } = useProjectStore();
  const [caseApiId, setCaseApiId] = useState<string | undefined>(undefined);

  const apisQ = useQuery({
    queryKey: ["apis", "list", projectId, JSON.stringify({ page: 1, pageSize: 100 })],
    queryFn: () => apiApi.list(projectId!, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId) && (mode === "api" || mode === "case"),
    staleTime: 60_000,
  });
  const casesQ = useQuery({
    queryKey: ["api-cases", "list", projectId, caseApiId],
    queryFn: () => apiCaseApi.list(projectId!, caseApiId!, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId && caseApiId) && mode === "case",
  });
  const scenQ = useQuery({
    queryKey: ["scenarios", "list", projectId, JSON.stringify({ page: 1, pageSize: 100 })],
    queryFn: () => scenarioApi.list(projectId!, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId) && mode === "scenario",
    staleTime: 60_000,
  });

  if (mode === "case") {
    return (
      <div className="space-y-2" data-testid="ref-picker-case">
        <Select
          className="!w-full"
          placeholder="1. 选择接口"
          showSearch
          optionFilterProp="label"
          value={caseApiId || undefined}
          onChange={setCaseApiId}
          options={(apisQ.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name}（${a.method} ${a.path}）` }))}
          data-testid="ref-picker-case-api"
        />
        <Select
          className="!w-full"
          placeholder="2. 选择用例"
          showSearch
          optionFilterProp="label"
          value={value || undefined}
          onChange={(v) => {
            const c = (casesQ.data?.items ?? []).find((x) => x.id === v);
            onPick(v, c?.name ?? "");
          }}
          options={(casesQ.data?.items ?? []).map((c) => ({ value: c.id, label: c.name }))}
          data-testid="ref-picker-case-target"
        />
        {value && !caseApiId && <p className="text-[11px] text-[#A8ABB0]">已绑定用例；如需更换请先选择其所属接口</p>}
      </div>
    );
  }

  const options =
    mode === "api"
      ? (apisQ.data?.items ?? []).map((a) => ({ value: a.id, label: `${a.name}（${a.method} ${a.path}）` }))
      : (scenQ.data?.items ?? []).map((s) => ({ value: s.id, label: `${s.name} #${s.num}` }));
  return (
    <Select
      className="!w-full"
      placeholder={mode === "api" ? "选择接口定义" : "选择场景"}
      showSearch
      optionFilterProp="label"
      value={value || undefined}
      onChange={(v) => {
        const hit = options.find((o) => o.value === v);
        onPick(v, (hit?.label ?? "").replace(/（.*$/, "").replace(/ #\d+$/, ""));
      }}
      options={options}
      loading={mode === "api" ? apisQ.isLoading : scenQ.isLoading}
      data-testid={`ref-picker-${mode}`}
    />
  );
}

// ── 步骤配置主编辑器 ──

export interface StepConfigEditorProps {
  step: ScenarioStepNode;
  /** 更新步骤（部分字段合并）。 */
  onChange: (patch: Partial<ScenarioStepNode>) => void;
  /** foreach 数据源候选（列表名 + CSV 列名）。 */
  foreachSources: string[];
  canEdit: boolean;
}

export default function StepConfigEditor({ step, onChange, foreachSources, canEdit }: StepConfigEditorProps) {
  const cfg = step.config as Record<string, unknown>;
  const setConfig = (part: Record<string, unknown>) => onChange({ config: { ...cfg, ...part } });
  const disabled = !canEdit;

  const nameRow = (
    <div>
      <p className="mb-1 text-xs text-[#646A73]">步骤名称</p>
      <Input
        className="!w-72"
        value={step.name}
        disabled={disabled}
        data-testid="input-step-name"
        onChange={(e) => onChange({ name: e.target.value })}
      />
    </div>
  );

  if (step.stepType === "ref_api" || step.stepType === "ref_case" || step.stepType === "ref_scenario") {
    const override = (cfg.override ?? {}) as { onFailure?: "continue" | "abort"; asserts?: AssertSpec[] };
    const refMode = (cfg.refMode as string) ?? "ref";
    return (
      <div className="space-y-4" data-testid="step-config-ref">
        {nameRow}
        <div>
          <p className="mb-1 text-xs text-[#646A73]">引用目标</p>
          {step.stepType === "ref_scenario" && <span className="mr-2 rounded bg-[#13C2C2]/10 px-1 text-[10px] text-[#13C2C2]">引用（执行时展开子树）</span>}
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <RefTargetPicker
                mode={step.stepType === "ref_api" ? "api" : step.stepType === "ref_case" ? "case" : "scenario"}
                value={(cfg.refId as string) || undefined}
                onPick={(id, name) => {
                  setConfig({ refId: id });
                  if (name) onChange({ name });
                }}
              />
            </div>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-[#646A73]">引用模式</p>
          <Radio.Group
            value={refMode}
            disabled={disabled}
            onChange={(e) => setConfig({ refMode: e.target.value })}
            options={[
              { value: "ref", label: "完全引用（执行时取最新定义）" },
              { value: "copy", label: "复制快照（导入/导出展开）" },
            ]}
          />
        </div>
        <div className="rounded border border-[#F0F1F3] p-3">
          <p className="mb-2 text-xs font-medium text-[#3D4350]">步骤级覆盖</p>
          <div className="mb-3 flex items-center gap-2">
            <span className="w-20 text-xs text-[#646A73]">失败规则</span>
            <Select
              className="!w-44"
              disabled={disabled}
              value={override.onFailure ?? "follow"}
              onChange={(v) => setConfig({ override: { ...override, onFailure: v === "follow" ? undefined : (v as "continue" | "abort"), asserts: override.asserts ?? [] } })}
              options={[
                { value: "follow", label: "跟随场景设置" },
                { value: "continue", label: "忽略错误继续" },
                { value: "abort", label: "停止运行" },
              ]}
              data-testid="select-step-override-onfail"
            />
          </div>
          <p className="mb-1 text-xs text-[#646A73]">追加断言（在引用目标断言之后执行）</p>
          <AssertRowsEditor
            rows={(override.asserts ?? []) as AssertSpec[]}
            testid="step-override-asserts"
            onChange={(asserts) => setConfig({ override: { ...override, asserts } })}
          />
        </div>
      </div>
    );
  }

  if (step.stepType === "custom") {
    const bundle = (cfg.bundle as StepBundle | undefined) ?? undefined;
    const rb = bundle
      ? { spec: bundle.request, asserts: bundle.asserts ?? [], pre: bundle.pre ?? [], post: bundle.post ?? [], extracts: bundle.extracts ?? [] }
      : emptyBundle();
    return (
      <div className="space-y-3" data-testid="step-config-custom">
        {nameRow}
        <RequestEditor
          bundle={rb}
          compact
          onChange={(nb) => setConfig({ bundle: { request: nb.spec, asserts: nb.asserts, pre: nb.pre, post: nb.post, extracts: nb.extracts } })}
        />
      </div>
    );
  }

  if (step.stepType === "loop") {
    const loop = (cfg ?? {}) as { mode?: string; count?: number; condition?: string; maxLoops?: number; var?: string; source?: string };
    const mode = (loop.mode ?? "count") as "count" | "while" | "foreach";
    const iterations = (cfg.iterations as unknown[] | undefined) ?? [];
    return (
      <div className="space-y-4" data-testid="step-config-loop">
        {nameRow}
        <div>
          <p className="mb-1 text-xs text-[#646A73]">循环模式</p>
          <Radio.Group
            value={mode}
            disabled={disabled}
            data-testid="radio-loop-mode"
            onChange={(e) => {
              const m = e.target.value as "count" | "while" | "foreach";
              setConfig(m === "count" ? { mode: m, count: 1 } : m === "while" ? { mode: m, condition: "true", maxLoops: 10000 } : { mode: m, var: "item", source: foreachSources[0] ?? "" });
            }}
            options={[
              { value: "count", label: "次数" },
              { value: "while", label: "While" },
              { value: "foreach", label: "ForEach" },
            ]}
          />
        </div>
        {mode === "count" && (
          <div className="flex items-center gap-2">
            <span className="w-24 text-xs text-[#646A73]">循环次数</span>
            <InputNumber min={1} max={10000} disabled={disabled} value={loop.count ?? 1} data-testid="input-loop-count" onChange={(v) => setConfig({ count: Number(v ?? 1) })} />
          </div>
        )}
        {mode === "while" && (
          <>
            <div>
              <p className="mb-1 text-xs text-[#646A73]">条件表达式（quickjs；truthy 继续循环）</p>
              <Input className="!w-full font-mono" disabled={disabled} placeholder='如：getVar("ok") === "1"' value={loop.condition ?? ""} data-testid="input-loop-while" onChange={(e) => setConfig({ condition: e.target.value })} />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-[#646A73]">最大循环数</span>
              <InputNumber min={1} max={10000} disabled={disabled} value={loop.maxLoops ?? 10000} onChange={(v) => setConfig({ maxLoops: Number(v ?? 10000) })} />
            </div>
          </>
        )}
        {mode === "foreach" && (
          <>
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-[#646A73]">数据源 source</span>
              <AutoComplete
                className="!w-64"
                disabled={disabled}
                value={loop.source}
                data-testid="input-loop-foreach-source"
                options={foreachSources.map((s) => ({ value: s }))}
                onChange={(v) => setConfig({ source: v })}
                placeholder="列表名 / CSV 列名"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="w-24 text-xs text-[#646A73]">迭代变量 var</span>
              <Input className="!w-64 font-mono" disabled={disabled} value={loop.var ?? ""} data-testid="input-loop-foreach-var" onChange={(e) => setConfig({ var: e.target.value })} placeholder="如 item / user；CSV 整行经 row.列名 可取" />
            </div>
            <p className="text-[11px] text-[#A8ABB0]">
              迭代序列在任务下发时由服务端预展开（列表 {foreachSources.length} 个候选源）；{iterations.length > 0 ? `当前已内嵌 ${iterations.length} 条` : "编辑态不保存迭代序列"}
            </p>
          </>
        )}
        <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] text-[#87888D]">子步骤在左侧树中该节点下添加（＋ 子步骤）</p>
      </div>
    );
  }

  if (step.stepType === "condition") {
    return (
      <div className="space-y-4" data-testid="step-config-condition">
        {nameRow}
        <div>
          <p className="mb-1 text-xs text-[#646A73]">条件表达式（quickjs；truthy 执行子步骤，否则子步骤 SKIPPED）</p>
          <Input className="!w-full font-mono" disabled={disabled} placeholder='如：getVar("token") !== ""' value={(cfg.expression as string) ?? ""} data-testid="input-condition-expr" onChange={(e) => setConfig({ expression: e.target.value })} />
        </div>
        <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] text-[#87888D]">子步骤在左侧树中该节点下添加</p>
      </div>
    );
  }

  if (step.stepType === "once") {
    return (
      <div className="space-y-4" data-testid="step-config-once">
        {nameRow}
        <p className="rounded bg-[#F7F8FA] px-3 py-2 text-[11px] leading-5 text-[#87888D]">
          仅一次控制器：批量执行/重跑等重复触发时，本节点子树每次任务内只执行首轮（repeatable job 重入自动跳过）。子步骤在左侧树中该节点下添加。
        </p>
      </div>
    );
  }

  if (step.stepType === "script") {
    const script = (cfg.script as string) ?? "";
    return (
      <div className="space-y-4" data-testid="step-config-script">
        {nameRow}
        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className="text-xs text-[#646A73]">脚本（quickjs 沙箱）</p>
            <FunctionHintPopover
              onInsert={(syntax) => setConfig({ script: script ? `${script}\n${syntax}` : syntax })}
            />
          </div>
          <Input.TextArea
            rows={8}
            className="!w-full font-mono !text-xs"
            disabled={disabled}
            placeholder={'log("...") / setVar("k", v) / getVar("k") / envGet("name")'}
            value={script}
            data-testid="input-step-script"
            onChange={(e) => setConfig({ script: e.target.value })}
          />
        </div>
      </div>
    );
  }

  // wait
  return (
    <div className="space-y-4" data-testid="step-config-wait">
      {nameRow}
      <div className="flex items-center gap-2">
        <span className="w-20 text-xs text-[#646A73]">等待时长</span>
        <InputNumber min={0} max={30000} disabled={disabled} value={(cfg.ms as number) ?? 1000} data-testid="input-wait-ms" onChange={(v) => setConfig({ ms: Number(v ?? 0) })} addonAfter="ms" />
      </div>
    </div>
  );
}
