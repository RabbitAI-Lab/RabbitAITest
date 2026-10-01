/**
 * S11 UIT-002 UI 用例执行器（playwright-core 驱动 headless chromium）。
 * 指令→PW API 映射（元素引用已 web 侧预解析为内联 locator）；失败/截图指令→internal/files 上传
 * → ui-screenshot 事件帧（fileId 引用，不内联字节）。
 * 浏览器供给：PLAYWRIGHT_BROWSERS_PATH 与 tests/e2e 同源（tech-stack 登记）；缺失=CONFIG_ERROR。
 */
import { config } from "@rabbit/shared";
import type { UiStep } from "@rabbit/shared";
import type { EventWriter } from "../events.js";
import { precheckRunner, resolveRunner, runnerCheckHasFail } from "./runner-env.js";

export interface UiStepOutcome {
  seq: number;
  op: UiStep["op"];
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  message: string;
  expected?: string;
  actual?: string;
}

export interface UiCaseResult {
  status: "SUCCESS" | "FAILED" | "STOPPED";
  failureKind?: "ASSERT_FAILED" | "CONFIG_ERROR";
  message: string;
  steps: UiStepOutcome[];
}

type PwPage = import("playwright-core").Page;
type PwLocator = import("playwright-core").Locator;
type PwBrowser = import("playwright-core").Browser;

/** role 定位器简写解析（结构化实现）："button[name=提交]" → getByRole("button", {name})；裸 "button" → getByRole("button")。 */
export function parseRoleLocator(locator: string): { role: string; name?: string } | null {
  const bracket = locator.indexOf("[name=");
  if (bracket === -1) {
    return /^[a-z]+$/.test(locator) ? { role: locator } : null;
  }
  const role = locator.slice(0, bracket);
  const tail = locator.slice(bracket + "[name=".length);
  if (!tail.endsWith("]") || !/^[a-z]+$/.test(role)) return null;
  return { role, name: tail.slice(0, -1) };
}

/** 定位器构造（css/xpath/testid/text/role 五种）。 */
export function buildLocator(
  page: PwPage,
  ref: { locatorType: string; locator: string },
): PwLocator {
  switch (ref.locatorType) {
    case "css":
      return page.locator(ref.locator);
    case "xpath":
      return page.locator(`xpath=${ref.locator}`);
    case "testid":
      return page.getByTestId(ref.locator);
    case "text":
      return page.getByText(ref.locator);
    case "role": {
      const parsed = parseRoleLocator(ref.locator);
      if (!parsed) return page.locator(ref.locator); // 非法简写兜底 css 语义（断言/交互处暴露配置错误）
      const role = parsed.role as Parameters<PwPage["getByRole"]>[0];
      return page.getByRole(role, parsed.name ? { name: parsed.name, exact: false } : undefined);
    }
    default:
      return page.locator(ref.locator);
  }
}

/** 截图上传（internal/files，X-Internal-Token；失败静默降级——帧不带 fileId）。 */
export async function uploadScreenshot(
  projectId: string,
  name: string,
  buffer: Buffer,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", new Blob([new Uint8Array(buffer)], { type: "image/jpeg" }), `${name}.jpeg`);
    const res = await fetch(`${config.webUrl}/api/v1/internal/files`, {
      method: "POST",
      headers: { "X-Internal-Token": config.internalToken },
      body: form,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { fileId?: string } };
    return data.data?.fileId ?? null;
  } catch {
    return null;
  }
}

interface StepRef {
  elementId?: string;
  locator?: { locatorType: string; locator: string };
  elementName?: string;
}

function stepName(s: UiStep): string {
  const ref = s as UiStep & StepRef;
  switch (s.op) {
    case "goto":
      return s.url;
    case "fill":
      return `${ref.elementName ?? "元素"} ← ${s.value}`;
    case "click":
    case "select":
      return `${ref.elementName ?? "元素"}`;
    case "assert-text":
      return `${ref.elementName ?? "元素"} 期望「${s.expected}」`;
    case "assert-visible":
      return `${ref.elementName ?? "元素"} 可见`;
    case "wait":
      return `${s.ms}ms`;
    case "screenshot":
      return s.name || "截图";
  }
}

/**
 * 单用例执行主流程：逐步推进，失败即终（abort 语义与场景 onFailure=abort 同口径）。
 * 事件帧：item-start/item-final 由 worker 层发；本函数发 step-op 步状态帧 + ui-screenshot 截图帧。
 */
export async function runUiCase(
  redis: import("ioredis").Redis,
  writer: EventWriter,
  cmd: {
    taskId: string;
    projectId: string;
    itemId: string;
    name: string;
    steps: UiStep[];
    timeoutMs: number;
  },
  isStopped: () => Promise<boolean>,
): Promise<UiCaseResult> {
  const steps: UiStepOutcome[] = [];
  // v7（UIT-004）：步骤模式=内置 runner 预检（chromium/node/磁盘 fail 项阻断，runner-check 帧承载）
  try {
    const builtin = await resolveRunner(cmd.projectId, null);
    const items = await precheckRunner(builtin);
    if (runnerCheckHasFail(items)) {
      await writer.emit({ type: "runner-check", itemId: cmd.itemId, runner: builtin.label, items });
      const fails = items.filter((i) => i.status === "fail");
      return {
        status: "FAILED",
        failureKind: "CONFIG_ERROR",
        message: `Runner 环境预检未通过（${builtin.label} · ${fails.length} 项失败：${fails
          .map((f) => f.label)
          .join("、")}）——处置指引见 runner-check 清单`,
        steps,
      };
    }
  } catch (e) {
    return {
      status: "FAILED",
      failureKind: "CONFIG_ERROR",
      message: `Runner 解析失败：${(e as Error).message}`,
      steps,
    };
  }
  let chromiumApi: typeof import("playwright-core");
  try {
    chromiumApi = await import("playwright-core");
  } catch {
    return {
      status: "FAILED",
      failureKind: "CONFIG_ERROR",
      message: "playwright-core 未安装（engine 依赖缺失）",
      steps,
    };
  }
  let browser: PwBrowser | null = null;
  try {
    browser = await chromiumApi.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  } catch (err) {
    return {
      status: "FAILED",
      failureKind: "CONFIG_ERROR",
      message: `chromium 启动失败（浏览器二进制缺失，见部署文档 UI 测试章节）：${err instanceof Error ? err.message : String(err)}`,
      steps,
    };
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  let failed = false;
  try {
    for (let i = 0; i < cmd.steps.length; i++) {
      const step = cmd.steps[i];
      if (!step) continue;
      const seq = i + 1;
      const name = stepName(step);
      if (failed) {
        steps.push({
          seq,
          op: step.op,
          name,
          status: "SKIPPED",
          durationMs: 0,
          message: "前序失败终止",
        });
        continue;
      }
      if (await isStopped()) {
        steps.push({
          seq,
          op: step.op,
          name,
          status: "SKIPPED",
          durationMs: 0,
          message: "任务被停止",
        });
        for (let j = i + 1; j < cmd.steps.length; j++) {
          const s2 = cmd.steps[j];
          if (!s2) continue;
          steps.push({
            seq: j + 1,
            op: s2.op,
            name: stepName(s2),
            status: "SKIPPED",
            durationMs: 0,
            message: "任务被停止",
          });
        }
        return { status: "STOPPED", message: "任务被停止", steps };
      }
      const t0 = Date.now();
      let outcome: UiStepOutcome;
      try {
        outcome = await execStep(page, step, seq, name, cmd.timeoutMs);
      } catch (err) {
        outcome = {
          seq,
          op: step.op,
          name,
          status: "FAILED",
          durationMs: Date.now() - t0,
          message: err instanceof Error ? err.message.slice(0, 500) : "步骤执行异常",
        };
      }
      // 失败自动截图 + screenshot 指令截图：上传→ui-screenshot 帧（fileId 引用）
      if (outcome.status === "FAILED" || step.op === "screenshot") {
        try {
          const buf = await page.screenshot({ type: "jpeg", quality: 60 });
          const fileId = await uploadScreenshot(
            cmd.projectId,
            `ui-${cmd.taskId.slice(0, 8)}-s${seq}`,
            buf,
          );
          if (fileId) {
            await writer.emit({
              type: "ui-screenshot",
              itemId: cmd.itemId,
              stepSeq: seq,
              fileId,
              name: outcome.status === "FAILED" ? `失败现场（步骤 ${seq}）` : name,
            });
            if (outcome.status === "FAILED") outcome.message = `${outcome.message}（已自动截图）`;
          }
        } catch {
          // 截图失败不阻断
        }
      }
      steps.push(outcome);
      await writer.emit({
        type: "step-op",
        itemId: cmd.itemId,
        stepPath: String(seq),
        stepName: name,
        op: step.op === "wait" ? "wait" : "script", // step-op op 枚举复用：ui 交互/断言=script 语义位（契约 v5 additive 约定）
        status: outcome.status === "SUCCESS" ? "SUCCESS" : "FAILED",
        durationMs: outcome.durationMs,
        message: outcome.message,
      });
      if (outcome.status === "FAILED") failed = true;
    }
  } finally {
    await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
  const failStep = steps.find((s) => s.status === "FAILED");
  if (failStep) {
    return {
      status: "FAILED",
      failureKind: failStep.message.includes("元素已删除") ? "CONFIG_ERROR" : "ASSERT_FAILED",
      message: `第 ${failStep.seq} 步失败：${failStep.message}`.slice(0, 500),
      steps,
    };
  }
  return { status: "SUCCESS", message: "", steps };
}

/** 单步执行（自动等待由 PW 内建；超时=用例 timeoutMs）。 */
async function execStep(
  page: PwPage,
  step: UiStep,
  seq: number,
  name: string,
  timeoutMs: number,
): Promise<UiStepOutcome> {
  const t0 = Date.now();
  const done = (status: "SUCCESS" | "FAILED", message = "", extra?: Partial<UiStepOutcome>) => ({
    seq,
    op: step.op,
    name,
    status,
    durationMs: Date.now() - t0,
    message,
    ...extra,
  });
  const ref = step as UiStep & StepRef;
  const requireLocator = (): PwLocator => {
    if (!ref.locator) throw new Error("缺少定位器（元素引用或内联 locator 必填）");
    if (ref.locator.locator.startsWith("__missing__:")) {
      throw new Error(`元素已删除（${ref.elementId}）`);
    }
    return buildLocator(page, ref.locator);
  };
  switch (step.op) {
    case "goto":
      await page.goto(step.url, { timeout: timeoutMs, waitUntil: "domcontentloaded" });
      return done("SUCCESS");
    case "click":
      await requireLocator().click({ timeout: timeoutMs });
      return done("SUCCESS");
    case "fill":
      await requireLocator().fill(step.value, { timeout: timeoutMs });
      return done("SUCCESS");
    case "select":
      await requireLocator().selectOption({ label: step.value }, { timeout: timeoutMs });
      return done("SUCCESS");
    case "assert-text": {
      const loc = requireLocator();
      const actual = (await loc.innerText({ timeout: timeoutMs }).catch(() => "")).trim();
      const passed = actual.includes(step.expected);
      return passed
        ? done("SUCCESS", "", { expected: step.expected, actual })
        : done("FAILED", `期望「${step.expected}」实际「${actual.slice(0, 200)}」`, {
            expected: step.expected,
            actual: actual.slice(0, 500),
          });
    }
    case "assert-visible": {
      const loc = requireLocator();
      const visible = await loc
        .isVisible({ timeout: Math.min(timeoutMs, 5000) })
        .catch(() => false);
      return visible ? done("SUCCESS") : done("FAILED", "元素不可见");
    }
    case "wait":
      await page.waitForTimeout(step.ms);
      return done("SUCCESS");
    case "screenshot":
      return done("SUCCESS");
  }
}
