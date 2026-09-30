"use client";

/** S11 UIT-002：步骤编辑器表单（新建 /ui-test/cases/new 与编辑 /ui-test/cases/[caseId] 共用）。
 *  行式编辑（P1 登记简化，不做拖拽）：指令下拉 + 元素选择 + 参数 + 删。 */
import { Button, Input, InputNumber, Select, Space, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { uitApi, ApiError, type UiCaseRow } from "@rabbit/api-client";
import type { UiStep } from "@rabbit/shared";

const OPS: { value: UiStep["op"]; label: string }[] = [
  { value: "goto", label: "goto（打开页面）" },
  { value: "click", label: "click（点击元素）" },
  { value: "fill", label: "fill（填写输入）" },
  { value: "select", label: "select（下拉选择）" },
  { value: "assert-text", label: "assert-text（断言文案）" },
  { value: "assert-visible", label: "assert-visible（断言可见）" },
  { value: "wait", label: "wait（等待毫秒）" },
  { value: "screenshot", label: "screenshot（截图）" },
];

const ELEMENT_OPS: readonly string[] = ["click", "fill", "select", "assert-text", "assert-visible"];

function defaultStep(op: UiStep["op"]): UiStep {
  switch (op) {
    case "goto":
      return { op: "goto", url: "" };
    case "click":
      return { op: "click" } as UiStep;
    case "fill":
      return { op: "fill", value: "" } as UiStep;
    case "select":
      return { op: "select", value: "" } as UiStep;
    case "assert-text":
      return { op: "assert-text", expected: "" } as UiStep;
    case "assert-visible":
      return { op: "assert-visible" } as UiStep;
    case "wait":
      return { op: "wait", ms: 1000 };
    case "screenshot":
      return { op: "screenshot", name: "" };
  }
}

export function UiCaseForm({ projectId, initial }: { projectId: string; initial?: UiCaseRow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [msg, msgCtx] = message.useMessage();
  const [name, setName] = useState(initial?.name ?? "");
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs ?? 15000);
  const [steps, setSteps] = useState<UiStep[]>(
    initial?.steps ?? [{ op: "goto", url: "" }],
  );

  const { data: elements } = useQuery({
    queryKey: ["ui-elements", projectId, "all"],
    queryFn: () => uitApi.elements(projectId, { page: 1, pageSize: 100 }),
    enabled: Boolean(projectId),
  });
  const elementOptions = (elements?.list ?? []).map((e) => ({
    value: e.id,
    label: `${e.name}（${e.locatorType}）`,
  }));

  const saveMut = useMutation({
    mutationFn: () => {
      const payload = { name, steps, timeoutMs };
      return initial
        ? uitApi.updateCase(projectId, initial.id, payload)
        : uitApi.createCase(projectId, payload);
    },
    onSuccess: () => {
      msg.success("已保存");
      void qc.invalidateQueries({ queryKey: ["ui-cases"] });
      router.push("/ui-test");
    },
    onError: (e) => msg.error(e instanceof ApiError ? `保存失败（${e.code}）：${e.message}` : "保存失败"),
  });

  const updateStep = (i: number, patch: Partial<UiStep>) => {
    setSteps(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as UiStep) : s)));
  };

  return (
    <div className="space-y-4" data-testid="uit-case-form">
      {msgCtx}
      <div className="flex gap-3 items-end flex-wrap border rounded p-3 bg-white">
        <label className="text-sm space-y-1 flex-1 min-w-60">
          <span className="text-xs text-slate-500 block">用例名称</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} data-testid="uit-case-name" />
        </label>
        <label className="text-sm space-y-1 w-44">
          <span className="text-xs text-slate-500 block">步骤超时（ms，5s-60s）</span>
          <InputNumber
            min={5000}
            max={60000}
            step={1000}
            value={timeoutMs}
            onChange={(v) => setTimeoutMs(v ?? 15000)}
            data-testid="uit-timeout"
          />
        </label>
      </div>

      <div className="border rounded bg-white" data-testid="uit-step-editor">
        <div className="text-xs text-slate-400 px-3 py-2 border-b">
          步骤序列（上限 50；元素列引用元素库——交互/断言指令必选元素）
        </div>
        {steps.map((s, i) => {
          const ref = s as UiStep & { elementId?: string };
          const needsElement = ELEMENT_OPS.includes(s.op);
          return (
            <div key={i} className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm">
              <span className="text-slate-400 w-5">{i + 1}</span>
              <span data-testid={`uit-step-op-${i}`} className="inline-block">
                <Select
                  value={s.op}
                  onChange={(op) => updateStep(i, defaultStep(op as UiStep["op"]))}
                  options={OPS}
                  style={{ width: 210 }}
                />
              </span>
              {needsElement && (
                <span data-testid={`uit-step-element-${i}`} className="inline-block">
                  <Select
                    value={ref.elementId}
                    onChange={(elementId) => updateStep(i, { elementId } as Partial<UiStep>)}
                    options={elementOptions}
                    placeholder="选择元素（元素库）"
                    style={{ width: 220 }}
                    showSearch
                    optionFilterProp="label"
                  />
                </span>
              )}
              {s.op === "goto" && (
                <Input
                  value={s.url}
                  onChange={(e) => updateStep(i, { url: e.target.value })}
                  placeholder="http(s) 绝对 URL"
                  className="font-mono text-xs flex-1"
                  data-testid={`uit-step-url-${i}`}
                />
              )}
              {s.op === "fill" && (
                <Input
                  value={s.value}
                  onChange={(e) => updateStep(i, { value: e.target.value })}
                  placeholder="填写值"
                  className="flex-1"
                  data-testid={`uit-step-value-${i}`}
                />
              )}
              {s.op === "select" && (
                <Input
                  value={s.value}
                  onChange={(e) => updateStep(i, { value: e.target.value })}
                  placeholder="选项 label"
                  className="flex-1"
                  data-testid={`uit-step-value-${i}`}
                />
              )}
              {s.op === "assert-text" && (
                <Input
                  value={s.expected}
                  onChange={(e) => updateStep(i, { expected: e.target.value })}
                  placeholder="期望包含的文案"
                  className="flex-1"
                  data-testid={`uit-step-expected-${i}`}
                />
              )}
              {s.op === "wait" && (
                <InputNumber
                  min={1}
                  max={30000}
                  value={s.ms}
                  onChange={(v) => updateStep(i, { ms: v ?? 1000 })}
                  addonAfter="ms"
                  data-testid={`uit-step-wait-${i}`}
                />
              )}
              {s.op === "screenshot" && (
                <Input
                  value={s.name}
                  onChange={(e) => updateStep(i, { name: e.target.value })}
                  placeholder="截图名（可选）"
                  className="flex-1"
                  data-testid={`uit-step-shot-name-${i}`}
                />
              )}
              <a className="text-red-400 text-xs" onClick={() => setSteps(steps.filter((_x, j) => j !== i))}>
                删
              </a>
            </div>
          );
        })}
        <div className="px-3 py-2">
          <Button
            size="small"
            data-testid="uit-add-step"
            disabled={steps.length >= 50}
            onClick={() => setSteps([...steps, defaultStep("goto")])}
          >
            + 添加步骤
          </Button>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Space>
          <Button onClick={() => router.push("/ui-test")}>取消</Button>
          <Button
            type="primary"
            loading={saveMut.isPending}
            data-testid="uit-save-btn"
            onClick={() => saveMut.mutate()}
          >
            保存用例
          </Button>
        </Space>
      </div>
    </div>
  );
}
