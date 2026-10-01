/**
 * S14 UIT-004：Runner 环境检测与项目级 Runner 解析（引擎侧唯一事实源）。
 * - 双轨：内置 runner（engine 自带 @playwright/test）+ 项目 runner（.runners/{projectId}/{runnerId}/，
 *   npm 精确版本安装，磁盘按项目分域——跨项目 runner 经 uuid 白名单+目录归属双重校验，无穿透面）；
 * - checklist 六项三态（node/runner_pkg/chromium/disk/ffmpeg/npm_registry），纯函数 assembleChecklist
 *   单测面（探测结果注入），collectProbes 做实测（chromium 用所选 runner 的 playwright-core
 *   executablePath() 落盘 stat——版本↔revision 映射由 registry 权威给出，防「装了别的版本」误判）；
 * - 预检缓存 5min（key=runner 标识）：执行/校验任务下发前 fail 项阻断（规格 §2 D5：warn 不阻断）；
 * - 安装：npm install（execFile 无 shell、版本白名单、registry 仅 https）→ cli.js install chromium
 *   → 全量检测 → 回调；全程 stage 进度上报（npm/browsers/check）。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { mkdir, readdir, rm, stat, statfs, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config, RUNNER_VERSION_RE } from "@rabbit/shared";
import type { RunnerEnvCheckItem, RunnerCheckResult, RunnerJob } from "@rabbit/shared";
import { runnerCheckItemSchema } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";

const ENGINE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const RUNNERS_ROOT = path.join(ENGINE_ROOT, ".runners");
const PRECHECK_TTL_MS = 5 * 60 * 1000;
const DISK_MIN_BYTES = 1024 * 1024 * 1024; // 1GB
const NPM_INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_LOG_TAIL = 2000;

const log = logFor("engine");

// ───────────────────────── 解析（双轨 + 隔离校验） ─────────────────────────

export interface ResolvedRunner {
  kind: "builtin" | "project";
  /** 项目 runner 目录（.runners/{projectId}/{runnerId}）；内置=null（engine 包内解析） */
  dir: string | null;
  /** @playwright/test CLI（cli.js）绝对路径 */
  cliPath: string;
  /** runner 的 node_modules 目录（工作区 symlink 目标；内置=engine 解析链，无需 symlink） */
  nodeModulesDir: string | null;
  /** 展示标识（帧/日志用），如 "builtin 1.63.0" / "pw-1.63.0" */
  label: string;
  version: string;
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function requireBuiltinPlaywright(): { pkgDir: string; version: string } {
  const req = createRequire(import.meta.url);
  const pkgDir = path.dirname(req.resolve("@playwright/test/package.json"));
  const version = requirePkgVersion(pkgDir);
  return { pkgDir, version };
}

function requirePkgVersion(pkgDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "(unknown)";
  } catch {
    return "(unknown)";
  }
}

/** 项目 runner 目录（uuid 白名单防穿越——projectId/runnerId 虽来自任务，仍显式校验）。 */
export function projectRunnerDir(projectId: string, runnerId: string): string {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(runnerId)) {
    throw new Error("非法 runner 标识（uuid 白名单）");
  }
  return path.join(RUNNERS_ROOT, projectId, runnerId);
}

/**
 * 解析执行用 runner：runnerId 空=内置；非空=项目 runner（目录+包必须存在，缺失=环境问题不静默回落——
 * 预检 checklist 的 runner_pkg fail 项承载，用户显式选择的 runner 缺失必须可见）。
 */
export async function resolveRunner(
  projectId: string,
  runnerId: string | null | undefined,
): Promise<ResolvedRunner> {
  if (!runnerId) {
    const { pkgDir, version } = requireBuiltinPlaywright();
    return {
      kind: "builtin",
      dir: null,
      cliPath: path.join(pkgDir, "cli.js"),
      nodeModulesDir: path.dirname(pkgDir), // <pkgDir>/node_modules
      label: `builtin ${version}`,
      version,
    };
  }
  const dir = projectRunnerDir(projectId, runnerId);
  const pkgDir = path.join(dir, "node_modules", "@playwright", "test");
  const pkgJson = path.join(pkgDir, "package.json");
  try {
    await stat(pkgJson);
  } catch {
    throw new Error(`项目 runner 目录缺失或未完成安装（${path.relative(ENGINE_ROOT, dir)}）`);
  }
  const version = requirePkgVersion(pkgDir);
  return {
    kind: "project",
    dir,
    cliPath: path.join(pkgDir, "cli.js"),
    nodeModulesDir: path.join(dir, "node_modules"),
    label: `pw-${version}`,
    version,
  };
}

// ───────────────────────── checklist（纯函数单测面 + 实测探测） ─────────────────────────

export interface ProbeResults {
  nodeVersion: string;
  /** runner 包实测版本；null=不可解析（fail） */
  runnerPkgVersion: string | null;
  /** chromium 可执行文件路径；null=缺失（fail） */
  chromiumPath: string | null;
  diskFreeBytes: number | null;
  /** ffmpeg 目录存在（warn 级，video=P2）；null=未探测 */
  ffmpegDir: string | null;
  /** registry 可达性（仅安装场景探测；null=未探测）；false=不可达（warn） */
  registryOk: boolean | null;
  registrySource: string;
}

/** checklist 组装（顺序/文案/hint 单一事实源；探测结果注入——T08 单测面）。 */
export function assembleChecklist(p: ProbeResults): RunnerEnvCheckItem[] {
  const items: RunnerEnvCheckItem[] = [];
  const nodeMajor = Number.parseInt(p.nodeVersion.replace(/^v/, ""), 10);
  items.push(
    Number.isFinite(nodeMajor) && nodeMajor >= 18
      ? runnerCheckOk("node", "node 运行时", `${p.nodeVersion} ≥ 18（引擎子进程）`)
      : runnerCheckItem("node", "node 运行时", "fail", p.nodeVersion, "引擎需 Node ≥ 18"),
  );
  items.push(
    p.runnerPkgVersion
      ? runnerCheckOk("runner_pkg", "runner 包", `@playwright/test ${p.runnerPkgVersion}`)
      : runnerCheckItem(
          "runner_pkg",
          "runner 包",
          "fail",
          "不可解析（未安装或安装中断）",
          "重新安装该 Runner",
        ),
  );
  items.push(
    p.chromiumPath
      ? runnerCheckOk("chromium", "chromium 二进制", p.chromiumPath)
      : runnerCheckItem(
          "chromium",
          "chromium 二进制",
          "fail",
          "未找到该版本所需的 chromium（可执行文件缺失）",
          "引擎主机执行 node cli.js install chromium（重新安装 Runner 亦会自动补装）",
        ),
  );
  items.push(
    p.diskFreeBytes !== null && p.diskFreeBytes >= DISK_MIN_BYTES
      ? runnerCheckOk(
          "disk",
          "磁盘空间",
          `${(p.diskFreeBytes / 1024 / 1024 / 1024).toFixed(1)}GB 可用 ≥ 1GB`,
        )
      : runnerCheckItem(
          "disk",
          "磁盘空间",
          "fail",
          p.diskFreeBytes !== null
            ? `${(p.diskFreeBytes / 1024 / 1024 / 1024).toFixed(2)}GB 可用（需 ≥ 1GB）`
            : "不可读取",
          "清理引擎主机磁盘后重试",
        ),
  );
  items.push(
    p.ffmpegDir === null
      ? runnerCheckItem(
          "ffmpeg",
          "ffmpeg",
          "warn",
          "未检测（不影响执行；仅影响视频录制，P2 功能）",
          undefined,
        )
      : runnerCheckOk("ffmpeg", "ffmpeg", p.ffmpegDir),
  );
  if (p.registryOk !== null) {
    items.push(
      p.registryOk
        ? runnerCheckOk("npm_registry", "npm / registry", `${p.registrySource} 可达`)
        : runnerCheckItem(
            "npm_registry",
            "npm / registry",
            "warn",
            `${p.registrySource} 不可达（仅影响「安装新 Runner」，不影响执行）`,
            "检查引擎主机网络/代理；离线环境见规格 §6",
          ),
    );
  }
  return items;
}

function runnerCheckOk(
  key: RunnerEnvCheckItem["key"],
  label: string,
  detail: string,
): RunnerEnvCheckItem {
  return runnerCheckItem(key, label, "ok", detail);
}
function runnerCheckItem(
  key: RunnerEnvCheckItem["key"],
  label: string,
  status: RunnerEnvCheckItem["status"],
  detail: string,
  hint?: string,
): RunnerEnvCheckItem {
  return runnerCheckItemSchema.parse({ key, label, status, detail, hint });
}

export function runnerCheckHasFail(items: RunnerEnvCheckItem[]): boolean {
  return items.some((i) => i.status === "fail");
}

/** chromium 期望路径：从所选 runner 的 playwright-core 解析（registry 权威映射，D3）。 */
async function chromiumExecutableFor(runner: ResolvedRunner): Promise<string | null> {
  try {
    const req = createRequire(
      runner.kind === "project" && runner.dir
        ? path.join(runner.dir, "package.json")
        : import.meta.url,
    );
    const corePkgDir = path.dirname(req.resolve("playwright-core/package.json"));
    // 内建 pathToFileURL：pnpm 路径含 @，自制 encodeURIComponent 版会产出 %40——
    // 原生 Node 可解码但 vite-node（vitest）按字面加载失败（实测坑）
    const mod = (await import(pathToFileURL(path.join(corePkgDir, "index.js")).href)) as {
      chromium?: { executablePath: () => string };
      default?: { chromium?: { executablePath: () => string } };
    };
    const chromium = mod.chromium ?? mod.default?.chromium;
    if (!chromium) return null;
    const p = chromium.executablePath();
    await stat(p);
    return p;
  } catch {
    return null;
  }
}

/** registry 探测：仅 https + 拒绝内网/环回（Mimosa SSRF 口径；安装源=官方或配置源域名）。 */
export function assertRegistryUrl(source: string): URL {
  const url = new URL(source);
  if (url.protocol !== "https:") throw new Error("registry 仅允许 https");
  const host = url.hostname;
  const blocked =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^169\.254\./.test(host) ||
    host === "0.0.0.0";
  if (blocked) throw new Error(`registry host 不允许：${host}`);
  return url;
}

async function probeRegistry(source: string): Promise<boolean> {
  try {
    const url = assertRegistryUrl(source);
    const res = await fetch(`${url.origin}/-/ping`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 浏览器缓存根（PLAYWRIGHT_BROWSERS_PATH 或默认 ~/.cache/ms-playwright / ~/Library/Caches/ms-playwright）。 */
async function browsersRoot(): Promise<string> {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  const home = process.env.HOME ?? process.cwd();
  return path.join(home, "Library", "Caches", "ms-playwright");
}

/** 实测探测（npm_registry 仅 installContext=true 时探测——执行场景不做外网请求）。 */
export async function collectProbes(
  runner: ResolvedRunner,
  opts: { installContext?: boolean; registrySource?: string } = {},
): Promise<ProbeResults> {
  const registrySource = opts.registrySource ?? "https://registry.npmjs.org";
  let diskFree: number | null = null;
  try {
    // 探测引擎根（恒存在；.runners 未建目录时 statfs 会 ENOENT 误报 fail）
    const fs = await statfs(ENGINE_ROOT);
    diskFree = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    diskFree = null;
  }
  let ffmpegDir: string | null = null;
  try {
    const root = await browsersRoot();
    const entries = await readdirSafe(root);
    ffmpegDir = entries.find((e) => e.startsWith("ffmpeg-")) ?? null;
  } catch {
    ffmpegDir = null;
  }
  return {
    nodeVersion: process.version,
    runnerPkgVersion: runner.version && runner.version !== "(unknown)" ? runner.version : null,
    chromiumPath: await chromiumExecutableFor(runner),
    diskFreeBytes: diskFree,
    ffmpegDir,
    registryOk: opts.installContext ? await probeRegistry(registrySource) : null,
    registrySource,
  };
}

async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** 全量检测（绕过缓存；安装完成/手动「重新检测」用）。 */
export async function checkRunnerEnv(
  runner: ResolvedRunner,
  opts: { installContext?: boolean; registrySource?: string } = {},
): Promise<RunnerCheckResult> {
  const probes = await collectProbes(runner, opts);
  return {
    items: assembleChecklist(probes),
    checkedAt: new Date().toISOString(),
    version: runner.version,
  };
}

// ───────────────────────── 预检缓存（执行/校验前；TTL 5min） ─────────────────────────

const precheckCache = new Map<string, { at: number; items: RunnerEnvCheckItem[] }>();

export function clearPrecheckCache(runnerKey?: string): void {
  if (runnerKey) precheckCache.delete(runnerKey);
  else precheckCache.clear();
}

/** 执行/校验前预检：命中缓存（≤5min）直接复用；fail 项返回清单（阻断语义由调用方落地）。 */
export async function precheckRunner(runner: ResolvedRunner): Promise<RunnerEnvCheckItem[]> {
  const key = runner.label;
  const hit = precheckCache.get(key);
  if (hit && Date.now() - hit.at < PRECHECK_TTL_MS) return hit.items;
  const items = (await checkRunnerEnv(runner)).items;
  precheckCache.set(key, { at: Date.now(), items });
  return items;
}

// ───────────────────────── 安装 / 清理（runner-jobs 消费） ─────────────────────────

export type ProgressReporter = (stage: "npm" | "browsers" | "check", logTail: string) => void;

function tail(s: string): string {
  return s.length > INSTALL_LOG_TAIL ? s.slice(-INSTALL_LOG_TAIL) : s;
}

/** 子进程运行（无 shell；argv 字面量+白名单值；超时硬顶+树杀）。 */
function runProc(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs: number },
  onData?: (chunk: string) => void,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(cmd, args, { cwd: opts.cwd, windowsHide: true });
    const cap = (c: Buffer) => {
      output = tail(output + c.toString("utf8"));
      onData?.(output);
    };
    child.stdout?.on("data", cap);
    child.stderr?.on("data", cap);
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* noop */
      }
    }, opts.timeoutMs);
    timer.unref();
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, output: tail(output) });
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, output: tail(`${output}\nspawn error: ${cmd}`) });
    });
  });
}

/**
 * 项目 runner 安装：npm install 精确版本 → cli.js install chromium → 全量检测（installContext 含 registry 探测）。
 * 任一阶段失败即返回 FAILED+日志尾部（不残留半成品目录——清目录后报告，重试=全新安装）。
 */
export async function installProjectRunner(
  job: Extract<RunnerJob, { kind: "install" }>,
  onProgress: ProgressReporter,
): Promise<{
  status: "READY" | "FAILED";
  installLogTail: string;
  check: RunnerCheckResult | null;
}> {
  if (!RUNNER_VERSION_RE.test(job.version)) {
    return {
      status: "FAILED",
      installLogTail: `版本非法（精确 semver 白名单拒绝）：${job.version}`,
      check: null,
    };
  }
  let source: URL;
  try {
    source = assertRegistryUrl(job.source);
  } catch (e) {
    return {
      status: "FAILED",
      installLogTail: `安装源校验失败：${(e as Error).message}`,
      check: null,
    };
  }
  const dir = projectRunnerDir(job.projectId, job.runnerId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "rabbit-runner", private: true, dependencies: {} }, null, 2),
    "utf8",
  );
  const npmR = await runProc(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--registry",
      source.origin,
      `@playwright/test@${job.version}`,
    ],
    { cwd: dir, timeoutMs: NPM_INSTALL_TIMEOUT_MS },
    (o) => onProgress("npm", o),
  );
  if (npmR.code !== 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { status: "FAILED", installLogTail: tail(npmR.output), check: null };
  }
  const runner = await resolveRunner(job.projectId, job.runnerId);
  onProgress("browsers", tail(npmR.output));
  const broR = await runProc(
    "node",
    [runner.cliPath, "install", "chromium"],
    { cwd: dir, timeoutMs: NPM_INSTALL_TIMEOUT_MS },
    (o) => onProgress("browsers", o),
  );
  if (broR.code !== 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    return { status: "FAILED", installLogTail: tail(broR.output), check: null };
  }
  onProgress("check", tail(broR.output));
  const check = await checkRunnerEnv(runner, {
    installContext: true,
    registrySource: source.origin,
  });
  clearPrecheckCache(runner.label);
  return { status: "READY", installLogTail: tail(broR.output), check };
}

/** 目录清理（软删行后的磁盘回收；幂等）。 */
export async function removeRunnerDir(projectId: string, runnerId: string): Promise<boolean> {
  try {
    const dir = projectRunnerDir(projectId, runnerId);
    await rm(dir, { recursive: true, force: true });
    return true;
  } catch (e) {
    log.warn({ err: e }, "runner dir remove failed");
    return false;
  }
}

// ───────────────────────── 工作区 symlink（项目 runner 版本解析） ─────────────────────────

/** 工作区内建 node_modules symlink → runner 的 node_modules（import '@playwright/test' 解析到项目版本）。
 * 已存在（重试残留）先清；内置 runner 不建（工作区位于 engine 包内，解析链天然命中）。 */
export async function linkRunnerNodeModules(
  workspaceDir: string,
  runner: ResolvedRunner,
): Promise<void> {
  if (runner.kind !== "project" || !runner.nodeModulesDir) return;
  const link = path.join(workspaceDir, "node_modules");
  await unlink(link).catch(() => undefined);
  await symlink(runner.nodeModulesDir, link, "dir");
}

/** 引擎自检入口（启动/心跳前跑一次内置 runner 快检，日志留痕）。 */
export async function logBuiltinSelfCheck(): Promise<void> {
  try {
    const runner = await resolveRunner("00000000-0000-0000-0000-000000000000", null);
    const items = await precheckRunner(runner);
    const fails = items.filter((i) => i.status === "fail");
    if (fails.length > 0) {
      log.warn(
        { runner: runner.label, fails: fails.map((f) => f.key) },
        "builtin runner env check failed",
      );
    } else {
      log.info({ runner: runner.label }, "builtin runner env check ok");
    }
  } catch (e) {
    log.warn({ err: e }, "builtin runner env check error");
  }
}
