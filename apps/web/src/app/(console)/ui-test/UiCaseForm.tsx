"use client";

/**
 * S11 UIT-002：步骤编辑器表单（指令行编辑，P1 登记简化不做拖拽）。
 * S13 UIT-003：双模式编辑器——脚本模式（CodeMirror 6 代码编辑器为主体：粘贴 AI 产出的标准
 * Playwright Test 脚本零改造直用；右侧参数 KV→RABBIT_PARAM_* env 注入 + 元素库只读参考 + 校验干跑）
 * 与步骤模式（UIT-002 原样保留）经 Segmented 切换；两侧数据独立保留，保存以当前模式为准。
 */
import { Button, Input, InputNumber, Modal, Select, Space, message } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { uitApi, execTaskDetailApi, ApiError, type UiCaseRow } from "@rabbit/api-client";
import type { UiCaseMode, UiParam, UiStep } from "@rabbit/shared";

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

const SCRIPT_TEMPLATES: { key: string; label: string; script: string }[] = [
  {
    key: "blank",
    label: "空模板",
    script: `import { test, expect } from '@playwright/test';

test('用例标题', async ({ page }) => {
  // 编写步骤……
});
`,
  },
  {
    key: "login",
    label: "登录冒烟",
    script: `import { test, expect } from '@playwright/test';

const BASE = process.env.RABBIT_PARAM_BASEURL ?? 'http://127.0.0.1:3000';

test('登录冒烟', async ({ page }) => {
  await page.goto(\`\${BASE}/login\`);
  await page.getByLabel('邮箱').fill(process.env.RABBIT_PARAM_USERNAME ?? 'admin@rabbit.test');
  await page.getByLabel('密码').fill(process.env.RABBIT_PARAM_PASSWORD ?? 'rabbit-pass-123');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByText('工作台')).toBeVisible();
});
`,
  },
  {
    key: "form",
    label: "表单提交",
    script: `import { test, expect } from '@playwright/test';

const BASE = process.env.RABBIT_PARAM_BASEURL ?? 'http://127.0.0.1:4000';

test('表单提交', async ({ page }) => {
  await page.goto(\`\${BASE}/uit/demo\`);
  await page.getByTestId('demo-username').fill('rabbit-e2e');
  await page.getByRole('button', { name: '提交' }).click();
  await expect(page.locator('.demo-result-text')).toContainText('提交成功，rabbit-e2e');
});
`,
  },
  {
    key: "asserts",
    label: "断言套件",
    script: `import { test, expect } from '@playwright/test';

const BASE = process.env.RABBIT_PARAM_BASEURL ?? 'http://127.0.0.1:4000';

test.describe('断言套件', () => {
  test('元素可见', async ({ page }) => {
    await page.goto(\`\${BASE}/uit/demo\`);
    await expect(page.getByTestId('demo-username')).toBeVisible();
  });

  test('文案精确匹配', async ({ page }) => {
    await page.goto(\`\${BASE}/uit/demo\`);
    await page.getByTestId('demo-submit').click();
    await expect(page.getByTestId('demo-result')).toHaveText('提交成功，guest');
  });
});
`,
  },
];

const DEFAULT_SCRIPT = SCRIPT_TEMPLATES[2]!.script;

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

interface ValidateState {
  ok: boolean;
  titles: string[];
  error: string;
}

export function UiCaseForm({ projectId, initial }: { projectId: string; initial?: UiCaseRow }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [msg, msgCtx] = message.useMessage();
  const [name, setName] = useState(initial?.name ?? "");
  const [mode, setMode] = useState<UiCaseMode>(initial?.mode ?? "script");
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs ?? (initial ? 15000 : 30000));
  // 双模式数据独立保留（切换不丢，保存以当前模式为准——规格 §2 存量兼容）
  const [steps, setSteps] = useState<UiStep[]>(
    initial?.steps?.length ? initial.steps : [{ op: "goto", url: "" }],
  );
  const [script, setScript] = useState(initial?.script || DEFAULT_SCRIPT);
  const [params, setParams] = useState<UiParam[]>(
    Array.isArray(initial?.params) ? initial.params : [{ key: "BASEURL", value: "" }],
  );
  const [validate, setValidate] = useState<ValidateState | null>(null);
  const [validateBusy, setValidateBusy] = useState(false);

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
      const payload =
        mode === "script"
          ? { name, mode, steps: [], script, params, timeoutMs }
          : { name, mode, steps, params: [], timeoutMs };
      return initial
        ? uitApi.updateCase(projectId, initial.id, payload)
        : uitApi.createCase(projectId, payload);
    },
    onSuccess: () => {
      msg.success("已保存");
      void qc.invalidateQueries({ queryKey: ["ui-cases"] });
      router.push("/ui-test");
    },
    onError: (e) =>
      msg.error(e instanceof ApiError ? `保存失败（${e.code}）：${e.message}` : "保存失败"),
  });

  const updateStep = (i: number, patch: Partial<UiStep>) => {
    setSteps(steps.map((s, j) => (j === i ? ({ ...s, ...patch } as UiStep) : s)));
  };

  /** 校验干跑：ui_validate 任务轮询至终态（成功=标题清单 / 失败=错误定位）。 */
  const runValidate = async () => {
    setValidateBusy(true);
    setValidate(null);
    try {
      const v = await uitApi.validateScript(projectId, { name, script });
      for (let i = 0; i < 60; i++) {
        const d = await execTaskDetailApi.uiDetail(projectId, v.taskId);
        if (d.status !== "PENDING" && d.status !== "RUNNING") {
          const item = d.items[0];
          if (d.status === "SUCCESS" && item) {
            setValidate({ ok: true, titles: item.steps.map((s) => s.name), error: "" });
          } else {
            setValidate({ ok: false, titles: [], error: item?.steps[0]?.message || "校验失败" });
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      setValidate({ ok: false, titles: [], error: "校验超时（60s）" });
    } catch (e) {
      setValidate({
        ok: false,
        titles: [],
        error: e instanceof ApiError ? e.message : "校验请求失败",
      });
    } finally {
      setValidateBusy(false);
    }
  };

  const switchMode = (next: UiCaseMode) => {
    if (next === mode) return;
    Modal.confirm({
      title: `切换到「${next === "script" ? "脚本" : "步骤"}模式」？`,
      content:
        "两侧内容独立保留（切回后可继续编辑），保存时以当前模式为准；不提供步骤 ↔ 脚本自动互转。",
      okText: "确认切换",
      cancelText: "取消",
      onOk: () => setMode(next),
    });
  };

  return (
    <div className="space-y-4" data-testid="uit-case-form">
      {msgCtx}
      <div className="flex gap-3 items-end flex-wrap border rounded p-3 bg-white">
        <label className="text-sm space-y-1 flex-1 min-w-60">
          <span className="text-xs text-slate-500 block">用例名称</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="uit-case-name"
          />
        </label>
        <div className="text-sm space-y-1">
          <span className="text-xs text-slate-500 block">模式</span>
          <div
            className="border rounded-md p-0.5 flex bg-slate-50"
            data-testid="uit3-mode-segmented"
          >
            <button
              className={`rounded px-4 py-1 text-sm ${mode === "script" ? "bg-[#574BFF] text-white" : "text-slate-500"}`}
              onClick={() => switchMode("script")}
            >
              脚本模式
            </button>
            <button
              className={`rounded px-4 py-1 text-sm ${mode === "steps" ? "bg-[#574BFF] text-white" : "text-slate-500"}`}
              onClick={() => switchMode("steps")}
            >
              步骤模式
            </button>
          </div>
        </div>
        <label className="text-sm space-y-1 w-44">
          <span className="text-xs text-slate-500 block">
            {mode === "script" ? "单 test 超时（ms，5s-300s）" : "步骤超时（ms，5s-60s）"}
          </span>
          <InputNumber
            min={5000}
            max={mode === "script" ? 300000 : 60000}
            step={1000}
            value={timeoutMs}
            onChange={(v) => setTimeoutMs(v ?? (mode === "script" ? 30000 : 15000))}
            data-testid="uit-timeout"
          />
        </label>
      </div>

      {mode === "script" ? (
        <div className="flex gap-3 items-start" data-testid="uit3-script-editor">
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Select
                size="small"
                style={{ width: 140 }}
                placeholder="插入模板…"
                value={null}
                onChange={(key) => {
                  const t = SCRIPT_TEMPLATES.find((x) => x.key === key);
                  if (t) setScript(t.script);
                }}
                options={SCRIPT_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))}
                data-testid="uit3-template-select"
              />
              <button
                className="border border-[#574BFF]/40 text-[#574BFF] rounded px-3 py-1 text-xs disabled:opacity-40"
                disabled={validateBusy}
                data-testid="uit3-validate-btn"
                onClick={() => void runValidate()}
              >
                {validateBusy ? "校验中…" : "✓ 校验脚本（干跑收集）"}
              </button>
              <span className="text-xs text-slate-400">{script.length} 字符 / 上限 100 KB</span>
            </div>
            <div
              className="border border-slate-700 rounded-md overflow-hidden"
              data-testid="uit3-code-editor"
            >
              <CodeMirror
                value={script}
                height="480px"
                theme={oneDark}
                extensions={[javascript({ typescript: true })]}
                onChange={(v) => setScript(v)}
                basicSetup={{ lineNumbers: true, highlightActiveLine: true, autocompletion: true }}
              />
            </div>
            {validate && (
              <div
                className={`border rounded-md px-3 py-2 text-sm ${validate.ok ? "bg-emerald-50/60 border-emerald-200" : "bg-red-50/60 border-red-200"}`}
                data-testid="uit3-validate-result"
              >
                {validate.ok ? (
                  <span>
                    ✓ 校验通过 — 识别 <b>{validate.titles.length}</b> 个测试：
                    <span className="text-slate-500">{validate.titles.join(" · ")}</span>
                  </span>
                ) : (
                  <pre className="text-xs text-red-600 whitespace-pre-wrap max-h-40 overflow-auto">
                    {validate.error}
                  </pre>
                )}
              </div>
            )}
          </div>
          <aside className="w-72 shrink-0 space-y-3">
            <div className="border rounded bg-white" data-testid="uit3-params-panel">
              <div className="px-3 py-2 border-b text-sm font-medium">参数（注入子进程 env）</div>
              <div className="p-3 space-y-2 text-sm">
                {params.map((p, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="font-mono text-xs flex-1"
                      value={p.key}
                      onChange={(e) =>
                        setParams(
                          params.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                        )
                      }
                    />
                    <Input
                      className="font-mono text-xs flex-1"
                      value={p.value}
                      onChange={(e) =>
                        setParams(
                          params.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                    />
                    <a
                      className="text-red-400 text-xs"
                      onClick={() => setParams(params.filter((_x, j) => j !== i))}
                    >
                      删
                    </a>
                  </div>
                ))}
                <button
                  className="text-xs text-[#574BFF]"
                  data-testid="uit3-add-param"
                  onClick={() => setParams([...params, { key: "", value: "" }])}
                >
                  + 添加参数（≤20 组）
                </button>
                <div className="text-xs text-slate-400">
                  脚本内以 <code className="font-mono">process.env.RABBIT_PARAM_键大写</code>{" "}
                  读取；值 ≤2048
                </div>
              </div>
            </div>
            <div className="border rounded bg-white">
              <div className="px-3 py-2 border-b text-sm font-medium">元素库（只读参考）</div>
              <div className="divide-y text-sm max-h-56 overflow-auto">
                {(elements?.list ?? []).map((e) => (
                  <div key={e.id} className="px-3 py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{e.name}</div>
                      <div className="font-mono text-xs text-slate-400 truncate">
                        {e.locatorType}: {e.locator}
                      </div>
                    </div>
                    <a
                      className="text-xs text-[#574BFF]"
                      onClick={() =>
                        void navigator.clipboard?.writeText(`${e.locatorType}: ${e.locator}`)
                      }
                    >
                      复制
                    </a>
                  </div>
                ))}
                {(elements?.list ?? []).length === 0 && (
                  <div className="px-3 py-2 text-xs text-slate-400">
                    暂无元素（脚本模式不依赖元素库）
                  </div>
                )}
              </div>
            </div>
            <div className="border rounded bg-white p-3 text-xs text-slate-500 space-y-1">
              <div className="font-medium text-slate-600 text-sm">执行说明</div>
              <div>· 引擎以官方 playwright test 子进程执行（workers=1 / retries=0）</div>
              <div>· 每 test 超时=上方设置；任务总超时 600s 硬顶</div>
              <div>· trace=on、失败自动截图；报告页可下载 trace.zip</div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="border rounded bg-white" data-testid="uit-step-editor">
          <div className="text-xs text-slate-400 px-3 py-2 border-b">
            步骤序列（上限 50；元素列引用元素库——交互/断言指令必选元素）
          </div>
          {steps.map((s, i) => {
            const ref = s as UiStep & { elementId?: string };
            const needsElement = ELEMENT_OPS.includes(s.op);
            return (
              <div
                key={i}
                className="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 text-sm"
              >
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
                <a
                  className="text-red-400 text-xs"
                  onClick={() => setSteps(steps.filter((_x, j) => j !== i))}
                >
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
      )}

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
