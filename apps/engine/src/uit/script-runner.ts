/**
 * S13 UIT-003：UI 脚本模式执行器（官方 playwright test 子进程直执行）。
 * 工作区 apps/engine/.uit-run/{taskId}-{itemId}/：case.spec.ts（用户脚本原样落盘）+
 * playwright.config.ts（生成：workers=1/retries=0/json reporter/trace=on/失败截图）+
 * report.json + test-results/（trace.zip/截图附件）——置于 engine 包内使 @playwright/test 可解析。
 * 结果映射：report.json specs → step-op 帧（每 test 一行）+ 附件上传 internal/files
 * → ui-screenshot / ui-trace 帧；停止=kill 进程树；总超时 600s 硬顶。
 * 安全口径（rules/engine.md §6 例外，受信全功能脚本）：权限门禁+审计+独立子进程可强杀；
 * 子进程=execFile("node", [CLI 路径, 固定旗标]) 无 shell，用户脚本内容仅经文件传递、绝不进命令行；
 * 附件读取限定工作区边界内（防 report 构造路径越界）。
 */
import { execFile, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, UIT_SCRIPT_LIMITS, uiParamEnvKey } from "@rabbit/shared";
import type { UiParam } from "@rabbit/shared";
import type { EventWriter } from "../events.js";

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TRACE_UPLOAD_MAX = 5; // trace=on 每 test 一份 zip；上传前 5 份防大用例打爆 files

// ───────────────────────── 纯函数（单测面） ─────────────────────────

/** playwright.config.ts 生成（幂等纯函数；路径相对工作区 cwd；launchOptions 与 UIT-002 runner 同口径——CI 容器需 --no-sandbox）。 */
export function buildPlaywrightConfig(timeoutMs: number): string {
  return `import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  timeout: ${timeoutMs},
  retries: 0,
  workers: 1,
  fullyParallel: false,
  outputDir: 'test-results',
  reporter: [['json', { outputFile: 'report.json' }], ['line']],
  use: {
    headless: true,
    viewport: { width: 1280, height: 720 },
    trace: 'on',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--no-sandbox', '--disable-dev-shm-usage'] },
  },
});
`;
}

/** PW JSON reporter 单 test 展开行（specs 树递归；--list 干跑无 results）。 */
export interface PwSpecOutcome {
  title: string;
  suitePath: string[];
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted" | "flaky" | "listed";
  durationMs: number;
  error?: { message: string; line?: number; column?: number };
  attachments: { name: string; path?: string; contentType: string }[];
}

interface PwRawSuite {
  title?: string;
  file?: string;
  suites?: PwRawSuite[];
  specs?: PwRawSpec[];
}
interface PwRawSpec {
  title?: string;
  tests?: {
    results?: {
      status?: string;
      duration?: number;
      /** 1.63：错误数组（含 location；line 为 1 基）；旧版兼容读 error 字段（无 location） */
      errors?: { message?: string; location?: { line?: number; column?: number } }[];
      error?: { message?: string; location?: { line?: number; column?: number } } | string;
      attachments?: { name?: string; path?: string; contentType?: string }[];
    }[];
  }[];
}

function normalizeError(
  result:
    | {
        errors?: { message?: string; location?: { line?: number; column?: number } }[];
        error?: unknown;
      }
    | undefined,
): { message: string; line?: number; column?: number } | undefined {
  const first = result?.errors?.find((e) => e.message);
  if (first?.message) {
    return { message: first.message, line: first.location?.line, column: first.location?.column };
  }
  const err = result?.error;
  if (!err) return undefined;
  if (typeof err === "string") return { message: err.slice(0, 2000) };
  const e = err as { message?: string; location?: { line?: number; column?: number } };
  if (!e.message) return undefined;
  return { message: e.message.slice(0, 2000), line: e.location?.line, column: e.location?.column };
}

/** report.json（JSON reporter 数组形态）→ 每 test 一行；递归 suites 树，取每 spec 末次 result；
 * 顶层 suite 标题=文件名（与 file 字段相等）不计入 describe 链。 */
export function parsePlaywrightReport(json: unknown): PwSpecOutcome[] {
  const out: PwSpecOutcome[] = [];
  const walk = (suites: PwRawSuite[], parents: string[]) => {
    for (const suite of suites) {
      const isFileNode = Boolean(suite.file) && suite.title === suite.file;
      const chain = suite.title && !isFileNode ? [...parents, suite.title] : parents;
      for (const spec of suite.specs ?? []) {
        const results = spec.tests?.flatMap((t) => t.results ?? []) ?? [];
        const last = results[results.length - 1];
        const statusRaw = last?.status ?? "listed";
        const status: PwSpecOutcome["status"] = (
          ["passed", "failed", "timedOut", "skipped", "interrupted", "flaky", "listed"] as const
        ).includes(statusRaw as PwSpecOutcome["status"])
          ? (statusRaw as PwSpecOutcome["status"])
          : "failed";
        out.push({
          title: spec.title ?? "(untitled)",
          suitePath: chain,
          status,
          durationMs: results.reduce((s, r) => s + (r.duration ?? 0), 0),
          error: normalizeError(last),
          attachments: (last?.attachments ?? [])
            .filter((a) => typeof a.path === "string" && a.path.length > 0)
            .map((a) => ({
              name: a.name ?? "",
              path: a.path as string,
              contentType: a.contentType ?? "application/octet-stream",
            })),
        });
      }
      if (suite.suites) walk(suite.suites, chain);
    }
  };
  // 1.63 JSON reporter 产物={config,suites,...} 对象；旧形态=顶层数组——双兼容
  const roots: PwRawSuite[] = Array.isArray(json)
    ? (json as PwRawSuite[])
    : Array.isArray((json as { suites?: unknown } | null)?.suites)
      ? (json as { suites: PwRawSuite[] }).suites
      : [];
  walk(roots, []);
  return out;
}

/** PW 状态 → 报告行状态（flaky 记 SUCCESS——retries=0 下 flaky 不会出现，防御性映射）。 */
export function mapPwStatus(status: PwSpecOutcome["status"]): "SUCCESS" | "FAILED" | "SKIPPED" {
  if (status === "passed" || status === "flaky") return "SUCCESS";
  if (status === "skipped" || status === "listed") return "SKIPPED";
  return "FAILED";
}

/** 错误代码帧：±3 行 + 出错行「>」标记（line 为 1 基——PW errors[].location.line 口径）。 */
export function extractCodeFrame(source: string, line1?: number): string {
  if (line1 === undefined || !Number.isInteger(line1) || line1 < 1) return "";
  const lines = source.split(/\r?\n/);
  const from = Math.max(1, line1 - 3);
  const to = Math.min(lines.length, line1 + 3);
  const rows: string[] = [];
  for (let i = from; i <= to; i++) {
    rows.push(`${i === line1 ? ">" : " "}${i} | ${lines[i - 1] ?? ""}`);
  }
  return rows.join("\n");
}

/** ANSI 色码剥离（PW message 携带终端着色；ESC 经 fromCharCode 规避源码控制字符）。 */
export function stripAnsi(s: string): string {
  const csi = `${String.fromCharCode(27)}\\[[0-9;]*m`;
  return s.replace(new RegExp(csi, "g"), "");
}

/** 报告行消息：剥离 ANSI 的错误主体（PW 自带代码帧「> N |」优先保留；无帧时用 location 自建），
 * 超长取头 800+尾 1200（帧在尾部，保定位信息）；上限 2000 对齐 stepOpFrame.message。 */
export function buildStepMessage(error: PwSpecOutcome["error"], scriptSource: string): string {
  if (!error) return "";
  let body = stripAnsi(error.message);
  if (!/^\s*>?\s*\d+ \|/m.test(body)) {
    const frame = extractCodeFrame(scriptSource, error.line);
    if (frame) body = `${body}\n${frame}`;
  }
  if (body.length > 2000) body = `${body.slice(0, 800)}\n…\n${body.slice(-1200)}`;
  return body.slice(0, 2000);
}

/** 工作区键净化（taskId/itemId 虽为 uuid，入口处显式白名单防路径穿越）。 */
function sanitizeRunKey(taskId: string, itemId: string): string {
  const ok = (s: string) => /^[A-Za-z0-9-]{1,80}$/.test(s);
  if (!ok(taskId) || !ok(itemId)) throw new Error("非法任务标识");
  return `${taskId}-${itemId}`;
}

/** 附件路径边界校验：解析后必须落在工作区内（防 report 被构造指向任意文件）。 */
function resolveInWorkspace(workspaceDir: string, p: string): string | null {
  const target = path.resolve(workspaceDir, p);
  return target.startsWith(workspaceDir + path.sep) ? target : null;
}

// ───────────────────────── 子进程执行 ─────────────────────────

function resolvePlaywrightCli(): string {
  // test runner 随 @playwright/test 发行（playwright-core 无 lib/test）；cli 不在 exports 域——经包根拼接
  const req = createRequire(import.meta.url);
  const testRoot = path.dirname(req.resolve("@playwright/test/package.json"));
  return path.join(testRoot, "cli.js");
}

interface ProcResult {
  code: number | null;
  stdout: string;
  stderr: string;
  stopped: boolean;
  timedOut: boolean;
}

/** 子进程执行 playwright CLI（同 plugin.service tarSafe 口径：可执行=字面量 "node"，无 shell；
 * argv=[CLI 路径, 固定旗标]，用户脚本内容只经文件传递）：停止轮询（SIGTERM→3s→SIGKILL）+ 总超时硬顶；输出截 64KB。 */
function runPlaywrightProc(
  mode: "run" | "list",
  opts: { cwd: string; env: NodeJS.ProcessEnv; isStopped: () => Promise<boolean> },
): Promise<ProcResult> {
  const cli = resolvePlaywrightCli();
  const child: ChildProcess = execFile(
    "node",
    mode === "run"
      ? [cli, "test", "--config", "playwright.config.ts"]
      : [cli, "test", "--list", "--config", "playwright.config.ts"],
    { cwd: opts.cwd, env: opts.env, maxBuffer: 1024 * 1024, windowsHide: true },
    () => undefined,
  );
  return waitProcResult(child, opts.isStopped);
}

async function waitProcResult(
  child: ChildProcess,
  isStopped: () => Promise<boolean>,
): Promise<ProcResult> {
  let stdout = "";
  let stderr = "";
  let stopped = false;
  let timedOut = false;
  let killed = false;
  const cap = (cur: string, chunk: Buffer): string => {
    const next = cur + chunk.toString("utf8");
    return next.length > 64 * 1024 ? next.slice(-64 * 1024) : next;
  };
  child.stdout?.on("data", (c: Buffer) => {
    stdout = cap(stdout, c);
  });
  child.stderr?.on("data", (c: Buffer) => {
    stderr = cap(stderr, c);
  });
  const killTree = () => {
    if (killed || child.exitCode !== null) return;
    killed = true;
    try {
      child.kill("SIGTERM");
      const killer = setTimeout(() => child.kill("SIGKILL"), 3000);
      killer.unref?.();
    } catch {
      // 进程已退出
    }
  };
  const stopTimer = setTimeout(() => {
    timedOut = true;
    killTree();
  }, UIT_SCRIPT_LIMITS.taskTotalTimeoutMs);
  stopTimer.unref?.();
  const stopPoll = setInterval(() => {
    void isStopped().then((s) => {
      if (s) {
        stopped = true;
        killTree();
      }
    });
  }, 1000);
  stopPoll.unref?.();
  const code = await new Promise<number | null>((resolve) => {
    child.once("close", (c) => resolve(c));
    child.once("error", () => resolve(null));
  });
  clearTimeout(stopTimer);
  clearInterval(stopPoll);
  return { code, stdout, stderr, stopped, timedOut };
}

/** 附件上传（internal/files，X-Internal-Token；失败静默降级返回 null）。 */
async function uploadUiAsset(
  projectId: string,
  fileName: string,
  mime: string,
  buffer: Buffer,
): Promise<string | null> {
  try {
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", new Blob([new Uint8Array(buffer)], { type: mime }), fileName);
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

async function prepareWorkspace(
  runKey: string,
  script: string,
  timeoutMs: number,
): Promise<string> {
  const dir = path.join(ENGINE_ROOT, ".uit-run", runKey);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "case.spec.ts"), script, "utf8");
  await writeFile(path.join(dir, "playwright.config.ts"), buildPlaywrightConfig(timeoutMs), "utf8");
  return dir;
}

function paramsEnv(params: UiParam[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const p of params) env[uiParamEnvKey(p.key)] = p.value;
  return env;
}

// ───────────────────────── 结果类型 ─────────────────────────

export interface ScriptStepOutcome {
  seq: number;
  op: "script";
  name: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  durationMs: number;
  message: string;
}

export interface ScriptCaseResult {
  status: "SUCCESS" | "FAILED" | "STOPPED";
  failureKind?: "ASSERT_FAILED" | "CONFIG_ERROR" | "SCRIPT_ERROR";
  message: string;
  steps: ScriptStepOutcome[];
}

export interface ScriptValidateResult {
  ok: boolean;
  titles: string[];
  error?: string;
}

// ───────────────────────── 执行主流程 ─────────────────────────

/** 脚本用例执行：官方 runner 子进程 → report.json → step-op/ui-screenshot/ui-trace 帧。 */
export async function runUiScriptCase(
  redis: import("ioredis").Redis,
  writer: EventWriter,
  cmd: {
    taskId: string;
    projectId: string;
    itemId: string;
    name: string;
    script: string;
    params: UiParam[];
    timeoutMs: number;
  },
  isStopped: () => Promise<boolean>,
): Promise<ScriptCaseResult> {
  void redis; // 预留（截图上传直连 web，不经 redis）
  const runKey = sanitizeRunKey(cmd.taskId, cmd.itemId);
  const dir = await prepareWorkspace(runKey, cmd.script, cmd.timeoutMs);
  let result: ScriptCaseResult;
  try {
    const res = await runPlaywrightProc("run", {
      cwd: dir,
      env: { ...process.env, ...paramsEnv(cmd.params) },
      isStopped,
    });
    if (res.stopped) {
      return { status: "STOPPED", message: "任务被停止", steps: [] };
    }
    if (res.timedOut) {
      return {
        status: "FAILED",
        failureKind: "SCRIPT_ERROR",
        message: `任务总超时（${UIT_SCRIPT_LIMITS.taskTotalTimeoutMs / 1000}s）——进程树已终止`,
        steps: [],
      };
    }
    let specs: PwSpecOutcome[] = [];
    let reportMissing = false;
    try {
      const raw = await readFile(path.join(dir, "report.json"), "utf8");
      specs = parsePlaywrightReport(JSON.parse(raw));
    } catch {
      reportMissing = true;
    }
    if (reportMissing || specs.length === 0) {
      // report 缺失/零 test：编译失败、空脚本或 CLI 崩溃——CONFIG_ERROR + stderr 尾部定位
      const tail = (res.stderr || res.stdout).trim().slice(-800);
      return {
        status: "FAILED",
        failureKind: "CONFIG_ERROR",
        message: `未收集到任何测试（report.json ${reportMissing ? "缺失" : "为空"}）——请用「校验脚本」定位：${tail}`,
        steps: [],
      };
    }
    const steps: ScriptStepOutcome[] = [];
    let traceCount = 0;
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!;
      const seq = i + 1;
      const status = mapPwStatus(spec.status);
      const message = buildStepMessage(spec.error, cmd.script);
      // 附件：失败截图（image/*）→ ui-screenshot；trace.zip → ui-trace（上限 5 份；路径限定工作区内）
      let shotFileId: string | null = null;
      for (const att of spec.attachments) {
        const attPath = resolveInWorkspace(dir, att.path as string);
        if (!attPath) continue;
        if (att.contentType.startsWith("image/")) {
          try {
            const buf = await readFile(attPath);
            shotFileId = await uploadUiAsset(
              cmd.projectId,
              `ui-${cmd.taskId.slice(0, 8)}-t${seq}.${att.contentType.includes("png") ? "png" : "jpeg"}`,
              att.contentType,
              buf,
            );
          } catch {
            // 附件读取失败不阻断
          }
          if (shotFileId) {
            await writer.emit({
              type: "ui-screenshot",
              itemId: cmd.itemId,
              stepSeq: seq,
              fileId: shotFileId,
              name: status === "FAILED" ? `失败现场 · ${spec.title}` : spec.title,
            });
          }
        } else if (att.name === "trace" && traceCount < TRACE_UPLOAD_MAX) {
          traceCount += 1;
          try {
            const buf = await readFile(attPath);
            const fileId = await uploadUiAsset(
              cmd.projectId,
              `ui-${cmd.taskId.slice(0, 8)}-trace${traceCount}.zip`,
              "application/zip",
              buf,
            );
            if (fileId) {
              await writer.emit({
                type: "ui-trace",
                itemId: cmd.itemId,
                fileId,
                name: `trace · ${spec.title}`,
              });
            }
          } catch {
            // trace 上传失败不阻断
          }
        }
      }
      steps.push({
        seq,
        op: "script",
        name: spec.title,
        status,
        durationMs: Math.round(spec.durationMs),
        message: status === "FAILED" ? message : "",
      });
      await writer.emit({
        type: "step-op",
        itemId: cmd.itemId,
        stepPath: String(seq),
        stepName: spec.title,
        op: "script",
        status: status === "SUCCESS" ? "SUCCESS" : "FAILED",
        durationMs: Math.round(spec.durationMs),
        message: status === "FAILED" ? message : "",
      });
    }
    if (traceCount >= TRACE_UPLOAD_MAX && specs.length > TRACE_UPLOAD_MAX) {
      await writer.emit({
        type: "log",
        level: "warn",
        itemId: cmd.itemId,
        message: `trace 上限 ${TRACE_UPLOAD_MAX} 份，其余 trace.zip 未上传（本地工作区已清理）`,
      });
    }
    const failStep = steps.find((s) => s.status === "FAILED");
    result = failStep
      ? {
          status: "FAILED",
          failureKind: "ASSERT_FAILED",
          message: `第 ${failStep.seq} 个测试失败：${failStep.message.split("\n")[0] ?? ""}`.slice(
            0,
            2000,
          ),
          steps,
        }
      : { status: "SUCCESS", message: "", steps };
  } finally {
    await rm(path.join(ENGINE_ROOT, ".uit-run", runKey), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
  return result;
}

/** 脚本校验干跑：playwright test --list（不启浏览器）→ 标题清单或编译错误（file:line）。 */
export async function runUiScriptValidate(
  redis: import("ioredis").Redis,
  writer: EventWriter,
  cmd: { taskId: string; projectId: string; itemId: string; name: string; script: string },
  isStopped: () => Promise<boolean>,
): Promise<ScriptValidateResult> {
  void redis;
  void cmd.projectId; // 干跑无附件上传
  const runKey = sanitizeRunKey(cmd.taskId, cmd.itemId);
  const dir = await prepareWorkspace(runKey, cmd.script, 30000);
  try {
    const res = await runPlaywrightProc("list", {
      cwd: dir,
      env: { ...process.env },
      isStopped,
    });
    if (res.stopped) return { ok: false, titles: [], error: "任务被停止" };
    let titles: string[] = [];
    try {
      const raw = await readFile(path.join(dir, "report.json"), "utf8");
      titles = parsePlaywrightReport(JSON.parse(raw)).map((s) => s.title);
    } catch {
      // --list 干跑 report 缺失：回落 stdout 标题行（"  ✓ 标题"）
      titles = res.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[✔✓·-]\s+/.test(l))
        .map((l) => l.replace(/^[✔✓·-]\s+/, "").trim())
        .filter(Boolean);
    }
    if (res.code !== 0) {
      const tail = (res.stderr || res.stdout).trim().slice(-1500) || `exit ${res.code}`;
      return { ok: false, titles, error: tail };
    }
    if (titles.length === 0) {
      return { ok: false, titles, error: "未收集到任何测试（脚本须包含 test() 用例）" };
    }
    for (let i = 0; i < titles.length; i++) {
      await writer.emit({
        type: "step-op",
        itemId: cmd.itemId,
        stepPath: String(i + 1),
        stepName: titles[i]!,
        op: "script",
        status: "SUCCESS",
        durationMs: 0,
        message: "",
      });
    }
    return { ok: true, titles };
  } finally {
    await rm(path.join(ENGINE_ROOT, ".uit-run", runKey), {
      recursive: true,
      force: true,
    }).catch(() => undefined);
  }
}
