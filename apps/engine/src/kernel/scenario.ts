/**
 * API-006/007 场景执行内核：步骤树递归执行器（控制器循环/条件/once、变量作用域链、
 * 失败规则、思考时间、cookie keep、foreach 迭代注入、场景变量断言与 vars-final 帧）。
 * 纯执行语义（无 DB）；单步管线复用 runner/step.ts。
 */
import type Redis from "ioredis";
import type {
  AssertSpec,
  EnvSnapshot,
  LoopConfig,
  Processor,
  Extractor,
  ScenarioItemCommand,
  ScenarioStepNode,
  StepBundle,
} from "@rabbit/shared/execution";
import { execStopKey, loopConfigSchema, stepBundleSchema } from "@rabbit/shared/execution";
import type { EventWriter } from "../events.js";
import { ProcessorError, evalCondition, runProcessors } from "./processors.js";
import { runStep, type StepOutcome, type StepSpec } from "../runner/step.js";
import { evaluateAsserts } from "./asserts.js";

export interface ScenarioDeps {
  redis: Redis;
  writer: EventWriter;
  env: EnvSnapshot | undefined;
  /** item 级 tempVars（作用域链最高层；跨步骤存活） */
  tempVars: Record<string, string>;
  envVarUpdates: { name: string; value: string }[];
  /** 任务级 __counter（跨 item 连续） */
  counter: Map<string, number>;
}

export interface ScenarioItemOutcome {
  status: "SUCCESS" | "FAILED" | "STOPPED";
  failureKind?: string;
  message: string;
}

interface WalkState {
  /** abort 后余步 SKIPPED（onFailure=abort 或 STOPPED） */
  aborted: boolean;
  stopped: boolean;
  /** continue 失败规则：存在失败步骤但不中断（item 终态仍 FAILED，概览 §4.4） */
  failed: boolean;
  /** once 控制器本轮循环已执行（uid 集合；每轮循环重置由调用方处理顶层 once 语义） */
  onceDone: Set<string>;
}

function stepBundleOf(node: ScenarioStepNode): StepBundle {
  const raw = (node.config as { bundle?: unknown }).bundle;
  const parsed = stepBundleSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ProcessorError("CONFIG_ERROR", `步骤「${node.name}」请求配置无效（${node.stepType}）`);
  }
  return parsed.data;
}

interface StepOverride {
  asserts: AssertSpec[];
  pre: Processor[];
  post: Processor[];
  extracts: Extractor[];
  params: { constants: { name: string; value: string }[]; lists: { name: string; values: string[] }[] };
  onFailure?: "continue" | "abort";
}

function overrideOf(node: ScenarioStepNode): StepOverride | null {
  const raw = (node.config as { override?: unknown }).override;
  if (!raw) return null;
  const o = raw as {
    asserts?: AssertSpec[];
    pre?: Processor[];
    post?: Processor[];
    extracts?: Extractor[];
    params?: { constants?: { name: string; value: string }[]; lists?: { name: string; values: string[] }[] };
    onFailure?: "continue" | "abort";
  };
  return {
    asserts: o.asserts ?? [],
    pre: o.pre ?? [],
    post: o.post ?? [],
    extracts: o.extracts ?? [],
    params: { constants: o.params?.constants ?? [], lists: o.params?.lists ?? [] },
    ...(o.onFailure ? { onFailure: o.onFailure } : {}),
  };
}

function loopConfigOf(node: ScenarioStepNode): LoopConfig {
  const parsed = loopConfigSchema.safeParse(node.config);
  if (!parsed.success) {
    throw new ProcessorError("CONFIG_ERROR", `循环步骤「${node.name}」配置无效`);
  }
  return parsed.data;
}

/** 作用域链合并（渲染单表）：temp > 步骤参数 > 场景参数（常量+列表当前值+CSV 当前 row）> 环境变量。 */
function mergedVars(deps: ScenarioDeps, item: ScenarioItemCommand, stepParams?: { constants: { name: string; value: string }[]; lists: { name: string; values: string[] }[] }): Record<string, string> {
  const vars: Record<string, string> = { ...(deps.env?.vars ?? {}) };
  for (const c of item.params.constants) vars[c.name] = c.value;
  for (const l of item.params.lists) if (l.values.length > 0) vars[l.name] = l.values[0] ?? "";
  if (stepParams) {
    for (const l of stepParams.lists) if (l.values.length > 0) vars[l.name] = l.values[0] ?? "";
    for (const c of stepParams.constants) vars[c.name] = c.value;
  }
  Object.assign(vars, deps.tempVars); // temp 最高（含 foreach 注入的 var 与 row.col）
  return vars;
}

/** 场景 item 执行：item-start → 场景前置 → 步骤树 → 场景变量断言 → 场景后置 → vars-final → item-final。 */
export async function runScenarioItem(deps: ScenarioDeps, item: ScenarioItemCommand): Promise<ScenarioItemOutcome> {
  const { redis, writer } = deps;
  const cookieJar = item.settings.cookieMode === "keep" ? new Map<string, string>() : undefined;
  const state: WalkState = { aborted: false, stopped: false, failed: false, onceDone: new Set() };
  await writer.emit({ type: "item-start", itemId: item.itemId, name: item.name });
  deps.tempVars["__scenario_name"] = item.name;

  let failure: { kind?: string; message: string } | null = null;

  // 场景级前置（含 wait/script；SQL 勘误延后中）
  try {
    const preCtx = { vars: mergedVars(deps, item), env: deps.env, logs: [] as string[] };
    await runProcessors(item.pre, preCtx);
    Object.assign(deps.tempVars, preCtx.vars);
    for (const l of preCtx.logs) await writer.emit({ type: "log", level: "info", message: l, itemId: item.itemId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writer.emit({ type: "log", level: "error", message: `场景前置失败：${message}`, itemId: item.itemId });
    failure = { kind: e instanceof ProcessorError ? e.kind : "CONFIG_ERROR", message };
  }

  if (!failure) {
    await walkNodes(item.steps, "0", item, deps, state, cookieJar, undefined);
    if (state.stopped) failure = { message: "任务被停止" };
    else if (state.aborted) failure = { kind: "ASSERT_FAILED", message: "步骤失败（失败规则=停止）" };
    else if (state.failed) failure = { kind: "ASSERT_FAILED", message: "存在失败步骤（失败规则=忽略继续）" };
  }

  // 场景变量断言（kind=variable 对 tempVars 终值）
  if (!failure && item.asserts.length > 0) {
    const vars = mergedVars(deps, item);
    const results = evaluateAsserts(item.asserts, {
      status: 0,
      headers: [],
      bodyText: "",
      durationMs: 0,
      vars,
    });
    const failed = results.filter((r) => !r.passed);
    if (failed.length > 0) {
      failure = { kind: "ASSERT_FAILED", message: `场景断言失败 ${failed.length} 条` };
      for (const r of failed) {
        await writer.emit({
          type: "log",
          level: "error",
          message: `场景断言 ${r.kind} ${r.path} ${r.op} ${r.expected} → 失败（实际 ${r.actual}）`,
          itemId: item.itemId,
        });
      }
    }
  }

  // 场景级后置（尽力执行，失败不改判已失败 item 的原因）
  try {
    const postCtx = { vars: mergedVars(deps, item), env: deps.env, logs: [] as string[] };
    await runProcessors(item.post, postCtx);
    Object.assign(deps.tempVars, postCtx.vars);
    for (const l of postCtx.logs) await writer.emit({ type: "log", level: "info", message: l, itemId: item.itemId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await writer.emit({ type: "log", level: "error", message: `场景后置失败：${message}`, itemId: item.itemId });
    if (!failure) failure = { kind: e instanceof ProcessorError ? e.kind : "CONFIG_ERROR", message };
  }

  // vars-final：变量终值（temp 终值 + 场景参数来源合并视图，RPT-003 变量 Tab）
  const varsFinal = mergedVars(deps, item);
  await writer.emit({
    type: "log",
    level: "info",
    kind: "vars-final",
    itemId: item.itemId,
    message: JSON.stringify(varsFinal),
  });

  const status: ScenarioItemOutcome["status"] = state.stopped ? "STOPPED" : failure ? "FAILED" : "SUCCESS";
  await writer.emit({
    type: "item-final",
    itemId: item.itemId,
    status,
    message: failure?.message ?? "",
  });
  return { status, ...(failure?.kind ? { failureKind: failure.kind } : {}), message: failure?.message ?? "" };
}

/** 停止检查（item 边界与控制器边界）。 */
async function checkStop(redis: Redis, taskId: string): Promise<boolean> {
  return (await redis.exists(execStopKey(taskId))) === 1;
}

/** 递归执行步骤树；stepPath 前缀为父路径（如 "0.2"），iteration 为循环迭代号（顶层 undefined）。 */
async function walkNodes(
  nodes: ScenarioStepNode[],
  pathPrefix: string,
  item: ScenarioItemCommand,
  deps: ScenarioDeps,
  state: WalkState,
  cookieJar: Map<string, string> | undefined,
  iteration: number | undefined,
): Promise<void> {
  const { redis, writer } = deps;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i] as ScenarioStepNode;
    const stepPath = `${pathPrefix}.${i}`;
    if (await checkStop(redis, writer.taskIdValue)) {
      state.stopped = true;
      state.aborted = true;
    }
    if (state.stopped || state.aborted) {
      await writer.emit({
        type: "step-skip",
        itemId: item.itemId,
        stepPath,
        stepName: node.name,
        ...(iteration !== undefined ? { iteration } : {}),
        reason: state.stopped ? "abort" : "abort",
      });
      continue;
    }
    if (!node.enabled) {
      await writer.emit({ type: "step-skip", itemId: item.itemId, stepPath, stepName: node.name, reason: "disabled" });
      continue;
    }

    try {
      // v4：控制器名经帧传递（RPT-003 报告树 loop/condition/once 节点名——S3 遗留修复；log kind=node-name 纯命名帧）
      if (node.stepType === "loop" || node.stepType === "condition" || node.stepType === "once") {
        await writer.emit({
          type: "log",
          level: "info",
          kind: "node-name",
          itemId: item.itemId,
          stepPath,
          message: node.name,
        });
      }
      switch (node.stepType) {
        case "custom":
        case "ref_api":
        case "ref_case":
        case "ref_scenario": {
          await runRequestNode(node, stepPath, item, deps, state, cookieJar, iteration);
          break;
        }
        case "script": {
          const started = Date.now();
          const config = node.config as { script?: string };
          const procCtx = { vars: mergedVars(deps, item), env: deps.env, logs: [] as string[] };
          try {
            await runProcessors([{ kind: "script", script: config.script ?? "" }], procCtx);
            Object.assign(deps.tempVars, procCtx.vars);
            for (const l of procCtx.logs) {
              await writer.emit({ type: "log", level: "info", message: l, itemId: item.itemId, stepPath });
            }
            await writer.emit({
              type: "step-op",
              itemId: item.itemId,
              stepPath,
              stepName: node.name,
              ...(iteration !== undefined ? { iteration } : {}),
              op: "script",
              status: "SUCCESS",
              durationMs: Date.now() - started,
              message: "",
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await writer.emit({
              type: "step-op",
              itemId: item.itemId,
              stepPath,
              stepName: node.name,
              ...(iteration !== undefined ? { iteration } : {}),
              op: "script",
              status: "FAILED",
              durationMs: Date.now() - started,
              message,
            });
            applyFailure(node, item, state);
          }
          break;
        }
        case "wait": {
          const config = node.config as { ms?: number };
          const started = Date.now();
          await new Promise((r) => setTimeout(r, Math.min(30000, Math.max(1, config.ms ?? 1000))));
          await writer.emit({
            type: "step-op",
            itemId: item.itemId,
            stepPath,
            stepName: node.name,
            ...(iteration !== undefined ? { iteration } : {}),
            op: "wait",
            status: "SUCCESS",
            durationMs: Date.now() - started,
            message: "",
          });
          break;
        }
        case "loop": {
          await runLoopNode(node, stepPath, item, deps, state, cookieJar);
          break;
        }
        case "condition": {
          const config = node.config as { expression?: string };
          const condVars = mergedVars(deps, item);
          let truthy: boolean;
          try {
            truthy = await evalCondition(config.expression ?? "true", { vars: condVars, env: deps.env, logs: [] });
          } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            await writer.emit({
              type: "log",
              level: "error",
              message: `条件求值失败（视为假）：${message}`,
              itemId: item.itemId,
              stepPath,
            });
            truthy = false;
          }
          if (truthy) {
            await walkNodes(node.children, stepPath, item, deps, state, cookieJar, iteration);
          } else {
            await writer.emit({ type: "step-skip", itemId: item.itemId, stepPath, stepName: node.name, reason: "condition" });
          }
          break;
        }
        case "once": {
          if (state.onceDone.has(node.uid)) {
            await writer.emit({ type: "step-skip", itemId: item.itemId, stepPath, stepName: node.name, reason: "once" });
          } else {
            state.onceDone.add(node.uid);
            await walkNodes(node.children, stepPath, item, deps, state, cookieJar, iteration);
          }
          break;
        }
      }
    } catch (e) {
      // 控制器级异常（配置无效等）：等同步骤失败
      const message = e instanceof Error ? e.message : String(e);
      await writer.emit({ type: "log", level: "error", message: `步骤「${node.name}」异常：${message}`, itemId: item.itemId, stepPath });
      applyFailure(node, item, state);
    }
    // 思考时间：顶层步骤间等待（迭代内不加）
    if (iteration === undefined && item.settings.thinkTimeMs > 0 && i < nodes.length - 1 && !state.aborted && !state.stopped) {
      await new Promise((r) => setTimeout(r, item.settings.thinkTimeMs));
    }
  }
}

function applyFailure(node: ScenarioStepNode, item: ScenarioItemCommand, state: WalkState): void {
  const override = overrideOf(node);
  const onFailure = override?.onFailure ?? item.settings.onFailure;
  if (onFailure === "abort") state.aborted = true;
  else state.failed = true;
}

async function runRequestNode(
  node: ScenarioStepNode,
  stepPath: string,
  item: ScenarioItemCommand,
  deps: ScenarioDeps,
  state: WalkState,
  cookieJar: Map<string, string> | undefined,
  iteration: number | undefined,
): Promise<void> {
  const bundle = stepBundleOf(node);
  const override = overrideOf(node);
  const stepParams = override?.params;
  // 渲染作用域：步骤参数覆盖场景参数（mergedVars 内部合并序保证）
  const step: StepSpec = {
    itemId: item.itemId,
    stepName: node.name,
    stepPath,
    ...(iteration !== undefined ? { iteration } : {}),
    moduleId: (node.config as { moduleId?: string }).moduleId,
    request: bundle.request,
    asserts: [...bundle.asserts, ...(override?.asserts ?? [])],
    pre: [...bundle.pre, ...(override?.pre ?? [])],
    post: [...bundle.post, ...(override?.post ?? [])],
    extracts: [...bundle.extracts, ...(override?.extracts ?? [])],
    ...(cookieJar ? { cookieJar } : {}),
    counter: deps.counter,
  };
  // 步骤参数进 temp 作用域（仅本步骤存活）：合并进渲染 vars 的最直接方式=临时写入后还原
  const saved: Record<string, string> = {};
  if (stepParams) {
    for (const c of stepParams.constants) {
      saved[c.name] = deps.tempVars[c.name] ?? "";
      deps.tempVars[c.name] = c.value;
    }
    for (const l of stepParams.lists) {
      if (l.values.length > 0) {
        saved[l.name] = deps.tempVars[l.name] ?? "";
        deps.tempVars[l.name] = l.values[0] ?? "";
      }
    }
  }
  const outcome: StepOutcome = await runStep(deps.redis, deps.writer, deps.env, deps.tempVars, step, deps.envVarUpdates);
  // 步骤参数还原：仅当该键仍是本步骤写入的值（提取写回同名时保留提取值）
  if (stepParams) {
    const restore = (key: string, written: string) => {
      if ((deps.tempVars[key] ?? "") === written) deps.tempVars[key] = saved[key] ?? "";
    };
    for (const c of stepParams.constants) restore(c.name, c.value);
    for (const l of stepParams.lists) if (l.values.length > 0) restore(l.name, l.values[0] ?? "");
  }
  if (outcome.status === "STOPPED") {
    state.stopped = true;
    state.aborted = true;
    return;
  }
  if (outcome.status === "FAILED") {
    applyFailure(node, item, state);
  }
}

async function runLoopNode(
  node: ScenarioStepNode,
  stepPath: string,
  item: ScenarioItemCommand,
  deps: ScenarioDeps,
  state: WalkState,
  cookieJar: Map<string, string> | undefined,
): Promise<void> {
  const loop = loopConfigOf(node);
  let iterations: { value: string; row: Record<string, string> }[] = [];

  if (loop.mode === "count") {
    iterations = Array.from({ length: loop.count }, () => ({ value: "", row: {} }));
  } else if (loop.mode === "foreach") {
    iterations = loop.iterations.map((it) => ({ value: it.value, row: it.row }));
    deps.tempVars[loop.var] = iterations[0]?.value ?? "";
  } else {
    // while：惰性迭代（上限 maxLoops）
    let n = 0;
    while (!state.aborted && !state.stopped && n < loop.maxLoops) {
      if (await checkStop(deps.redis, deps.writer.taskIdValue)) {
        state.stopped = true;
        state.aborted = true;
        break;
      }
      const truthy = await evalCondition(loop.condition, {
        vars: mergedVars(deps, item),
        env: deps.env,
        logs: [],
      });
      if (!truthy) break;
      n += 1;
      deps.tempVars["__loop_i"] = String(n);
      await walkNodes(node.children, stepPath, item, deps, state, cookieJar, n);
    }
    return;
  }

  for (let n = 0; n < iterations.length; n++) {
    if (state.aborted || state.stopped) break;
    if (await checkStop(deps.redis, deps.writer.taskIdValue)) {
      state.stopped = true;
      state.aborted = true;
      break;
    }
    const iter = iterations[n] as { value: string; row: Record<string, string> };
    const iterationNo = n + 1;
    deps.tempVars["__loop_i"] = String(iterationNo);
    if (loop.mode === "foreach") {
      deps.tempVars[loop.var] = iter.value;
      for (const [col, v] of Object.entries(iter.row)) deps.tempVars[`row.${col}`] = v;
    }
    await walkNodes(node.children, stepPath, item, deps, state, cookieJar, iterationNo);
    if (loop.mode === "foreach") {
      // 清理 row 注入（下一轮覆盖写入，末轮保留终值——报告 vars-final 需要末行）
    }
  }
}
