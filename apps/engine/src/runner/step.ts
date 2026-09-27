/** API-004/006 单步管线：渲染 → 前置 → 采样 → 提取 → 断言 → 后置（含场景帧元数据与 Cookie jar）。
 * S3 从 worker.ts 提取（scenario 执行器复用）；帧扩展字段 stepPath/iteration/stepName 全 additive。 */
import type Redis from "ioredis";
import type {
  AssertSpec,
  EnvSnapshot,
  Extractor,
  Processor,
  RequestSpec,
} from "@rabbit/shared/execution";
import type { EventWriter } from "../events.js";
import { evaluateAsserts, classifyFailure } from "../kernel/asserts.js";
import { runExtractors } from "../kernel/extract.js";
import { ProcessorError, runProcessors } from "../kernel/processors.js";
import { hostsMap, mergeGlobals, renderRequest, resolveUrl } from "../kernel/render.js";
import { httpSample } from "../samplers/http.js";
import { getSamplerPlugin } from "../kernel/samplers/registry.js";
import { execStopKey } from "@rabbit/shared";

export interface StepSpec {
  itemId?: string;
  name?: string;
  moduleId?: string;
  request: RequestSpec;
  asserts: AssertSpec[];
  pre: Processor[];
  post: Processor[];
  extracts: Extractor[];
  /** S3 场景帧元数据（stepPath 树路径 / iteration 循环迭代号 / stepName 报告树节点名） */
  stepPath?: string;
  iteration?: number;
  stepName?: string;
  /** S3 cookie keep：场景级 jar（渲染后注入 Cookie 头；响应 Set-Cookie 收集回写） */
  cookieJar?: Map<string, string>;
  /** S3 函数库计数器（__counter 任务作用域） */
  counter?: Map<string, number>;
}

export type StepOutcome = { status: "SUCCESS" | "FAILED" | "STOPPED"; failureKind?: string; message: string };

async function isStopped(redis: Redis, taskId: string): Promise<boolean> {
  return (await redis.exists(execStopKey(taskId))) === 1;
}

function applyCookies(spec: RequestSpec, jar: Map<string, string>): RequestSpec {
  if (jar.size === 0) return spec;
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const idx = spec.headers.findIndex((h) => h.key.toLowerCase() === "cookie");
  if (idx >= 0) {
    const existing = spec.headers[idx];
    if (existing) {
      const headers = [...spec.headers];
      headers[idx] = { ...existing, value: cookie, enabled: true };
      return { ...spec, headers };
    }
  }
  return { ...spec, headers: [...spec.headers, { key: "Cookie", value: cookie, enabled: true }] };
}

function collectCookies(headers: { key: string; value: string }[], jar: Map<string, string>): void {
  for (const h of headers) {
    if (h.key.toLowerCase() !== "set-cookie") continue;
    const first = h.value.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

/** 单步管线（API-004 §2；环境全局区并入；S3 扩展帧元数据/cookie/函数渲染）。 */
export async function runStep(
  redis: Redis,
  writer: EventWriter,
  env: EnvSnapshot | undefined,
  tempVars: Record<string, string>,
  step: StepSpec,
  envVarUpdates: { name: string; value: string }[],
): Promise<StepOutcome> {
  const vars = { ...(env?.vars ?? {}), ...tempVars };
  const ctx = { vars, env, moduleId: step.moduleId, counter: step.counter };
  const frameMeta = {
    ...(step.stepPath ? { stepPath: step.stepPath } : {}),
    ...(step.iteration !== undefined ? { iteration: step.iteration } : {}),
    stepName: step.stepName ?? "",
  };
  const log = async (level: "info" | "warn" | "error", message: string) => {
    await writer.emit({
      type: "log",
      level,
      message,
      ...(step.itemId ? { itemId: step.itemId } : {}),
      ...(step.stepPath ? { stepPath: step.stepPath } : {}),
    });
  };
  const pre = step.request.skipPre ? [] : mergeGlobals(env?.pre, step.pre);
  const post = step.request.skipPost ? [] : [...step.post, ...(env?.post ?? [])];
  // 提取器：环境全局在前（供后续断言/脚本消费）
  const extracts = mergeGlobals(env?.extracts, step.extracts);
  const asserts = mergeGlobals([], step.asserts).concat(env?.asserts ?? []);

  try {
    const withCookies = step.cookieJar ? applyCookies(step.request, step.cookieJar) : step.request;
    const rendered = renderRequest(withCookies, ctx);
    const url = resolveUrl(rendered, ctx);
    await writer.emit({
      type: "step-start",
      method: rendered.method,
      url,
      ...(step.itemId ? { itemId: step.itemId } : {}),
      ...frameMeta,
    });
    const procCtx = { vars: tempVars, env, logs: [] as string[] };
    await runProcessors(pre, procCtx);
    for (const l of procCtx.logs) await log("info", l);
    Object.assign(vars, tempVars); // 前置写回的临时变量对渲染结果可见（下一步生效）

    if (await isStopped(redis, writer.taskIdValue)) {
      return { status: "STOPPED", message: "任务被停止" };
    }
    // 采样期协作式停止：轮询停止键 → 中断在途请求（EXEC-002 §2）
    const abort = new AbortController();
    const stopWatcher = setInterval(() => {
      void isStopped(redis, writer.taskIdValue).then((stopped) => {
        if (stopped) abort.abort();
      });
    }, 300);
    let result;
    // PLUG-002：非 http(s) 协议走插件采样器（协议标识=request.protocol 小写；engine 进程内）
    const rawProtocol = String((step.request as { protocol?: unknown }).protocol ?? "http").toLowerCase();
    const protocolPlugin =
      rawProtocol !== "http" && rawProtocol !== "https" ? getSamplerPlugin(rawProtocol) : null;
    if (rawProtocol !== "http" && rawProtocol !== "https" && !protocolPlugin) {
      throw new ProcessorError("CONFIG_ERROR", `协议插件不可用：${rawProtocol}（未启用或加载失败）`);
    }
    try {
      if (protocolPlugin) {
        // SamplerResult → HTTP 采样形态标准化（headers kv 数组 / durationMs 字段名对齐）
        const sampler = protocolPlugin.buildSampler((step.request as { protocolConfig?: unknown }).protocolConfig);
        const sr = await sampler.run();
        result = {
          status: sr.ok ? 200 : sr.code === 1 ? 504 : 502,
          bodyText: sr.bodyText.slice(0, 4096),
          durationMs: sr.responseTimeMs,
          requestUrl: `${rawProtocol}://${JSON.stringify((step.request as { protocolConfig?: unknown }).protocolConfig ?? {})}`,
          truncated: false,
          headers: Object.entries(sr.headers ?? {}).map(([key, value]) => ({
            key,
            value,
            enabled: true,
          })),
        };
      } else {
        result = await httpSample(rendered, url, (m) => void log("info", m), {
          hosts: hostsMap(env),
          signal: abort.signal,
        });
      }
    } catch (e) {
      if (abort.signal.aborted && (await isStopped(redis, writer.taskIdValue))) {
        return { status: "STOPPED", message: "任务被停止（在途请求已中断）" };
      }
      throw e;
    } finally {
      clearInterval(stopWatcher);
    }
    if (step.cookieJar) collectCookies(result.headers, step.cookieJar);

    const extractResults = runExtractors(extracts, {
      bodyText: result.bodyText,
      headers: result.headers,
    });
    for (const e of extractResults) {
      if (e.scope === "temp") tempVars[e.variable] = e.value;
      else envVarUpdates.push({ name: e.variable, value: e.value });
    }
    const assertInput = {
      status: result.status,
      headers: result.headers,
      bodyText: result.bodyText,
      durationMs: result.durationMs,
      vars: { ...vars, ...tempVars },
    };
    const assertResults = evaluateAsserts(asserts, assertInput);
    for (const a of assertResults) {
      await log(
        a.passed ? "info" : "error",
        `断言 ${a.kind}${a.path ? ` ${a.path}` : ""} ${a.op} ${a.expected} → ${a.passed ? "通过" : `失败（实际 ${a.actual}）`}`,
      );
    }
    await writer.emit({
      type: "step-result",
      ...(step.itemId ? { itemId: step.itemId } : {}),
      ...frameMeta,
      status: result.status,
      durationMs: result.durationMs,
      requestSnapshot: {
        method: rendered.method,
        url: result.requestUrl,
        headers: rendered.headers
          .filter((row) => row.enabled)
          .map((row) => ({ key: row.key, value: row.value })),
        body:
          "content" in rendered.body
            ? rendered.body.content
            : `(${rendered.body.kind}${"rows" in rendered.body ? ` ×${rendered.body.rows.length}` : ""})`,
      },
      responseSummary: {
        status: result.status,
        headers: result.headers,
        bodyText: result.bodyText,
        truncated: result.truncated,
      },
      asserts: assertResults,
      extracts: extractResults,
    });

    const postCtx = { vars: tempVars, env, logs: [] as string[] };
    await runProcessors(post, postCtx);
    for (const l of postCtx.logs) await log("info", l);

    const failureKind = classifyFailure(assertResults);
    return {
      status: failureKind ? "FAILED" : "SUCCESS",
      ...(failureKind ? { failureKind } : {}),
      message: failureKind ? `${assertResults.filter((a) => !a.passed).length} 条断言失败` : "",
    };
  } catch (err) {
    if (err instanceof ProcessorError) {
      await log("error", `${err.kind}：${err.message}`);
      return { status: "FAILED", failureKind: err.kind, message: err.message };
    }
    const message = err instanceof Error ? err.message : String(err);
    await log("error", `网络/配置错误：${message}`);
    return { status: "FAILED", failureKind: "NETWORK_ERROR", message };
  }
}
