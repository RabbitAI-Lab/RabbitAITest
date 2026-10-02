/**
 * AGENT-001 §4.4 Agent 工作目录模型：每 Agent 一份 `{RABBIT_AGENT_WS_ROOT}/{agentId}/`
 *   repos/{owner}__{repo}/（跨任务共享；任务前 ensure：clone / checkout 所选分支 + pull --ff-only）
 *   platform-docs/（跨任务共享；FILE-001 全量同步按 updatedAt 跳过）
 *   tasks/{taskId}/（每任务创建=pi cwd；软链 repos·platform-docs 只读；output/ 存非结构化产物）
 * 凭据经 https URL 内联注入子进程（git），不落盘；ensure 各步轨迹由调用方记录。
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DomainError, ErrCode } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { decryptCredential } from "@/server/domains/api/credential-crypto";
import { readFileObject } from "@/server/storage";

export function agentWsRoot(): string {
  return process.env.RABBIT_AGENT_WS_ROOT
    ? path.resolve(process.env.RABBIT_AGENT_WS_ROOT)
    : path.join(process.cwd(), ".data", "agent-ws");
}

export function agentWsDir(agentId: string): string {
  return path.join(agentWsRoot(), agentId);
}

export function repoDirName(owner: string, repo: string): string {
  return `${owner}__${repo}`;
}

export interface EnsureStep {
  kind: "clone" | "checkout_pull" | "docs_sync" | "task_dir";
  detail: string;
  ms: number;
}

function run(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs ?? 120_000);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

/** 凭据内联 https URL（token/password；oauth 取账号 token；none=原样）——只存在于子进程 argv */
interface RepoCredRow {
  repoUrl: string;
  host: string;
  username: string | null;
  authType: string;
  secretEnc: string | null;
  accountId: string | null;
}

async function authenticatedUrl(repo: RepoCredRow): Promise<string> {
  if (repo.authType === "none" || !repo.repoUrl.startsWith("http")) return repo.repoUrl;
  let cred = "";
  if (repo.authType === "oauth" && repo.accountId) {
    const acc = await prisma.scmAccount.findFirst({ where: { id: repo.accountId } });
    if (!acc) throw new DomainError(ErrCode.AGENT_WS_PREPARE_FAILED, "OAuth 授权账号已不存在");
    cred = decryptCredential(`scm-account:${acc.provider}`, acc.tokenEnc);
    // OAuth token 走 x-access-token 形态（https://x-access-token:{token}@host/…）
    const u = new URL(repo.repoUrl);
    u.username = "x-access-token";
    u.password = cred;
    return u.toString();
  }
  if (repo.secretEnc) {
    cred = decryptCredential(`scm-repo:${repo.host}`, repo.secretEnc);
    if (repo.authType === "token") {
      const u = new URL(repo.repoUrl);
      u.username = cred;
      u.password = "";
      return u.toString();
    }
    // password：username:password
    const u = new URL(repo.repoUrl);
    u.username = repo.username ?? "";
    u.password = cred;
    return u.toString();
  }
  return repo.repoUrl;
}

/** 平台文档同步：项目 FILE-001 文本类全量落 platform-docs/（updatedAt 未变跳过） */
async function syncPlatformDocs(projectId: string, docsDir: string, step: (s: EnsureStep) => void) {
  const t0 = Date.now();
  await fs.mkdir(docsDir, { recursive: true });
  const rows = await prisma.fileItem.findMany({
    where: { projectId, deletedAt: null },
    select: { id: true, name: true, storageKey: true, createdAt: true },
  });
  const metaPath = path.join(docsDir, ".sync.json");
  let prev: Record<string, string> = {};
  try {
    prev = JSON.parse(await fs.readFile(metaPath, "utf8")) as Record<string, string>;
  } catch {
    prev = {};
  }
  const next: Record<string, string> = {};
  let copied = 0;
  let skipped = 0;
  const docsReal = path.resolve(docsDir);
  for (const row of rows) {
    // 文件名安全化：仅 basename（剥离任何路径成分）+ 根目录边界断言（防穿越）
    const safe = path.basename(row.name).replace(/[/\\]/g, "_").slice(0, 200) || `file-${row.id}`;
    const target = path.resolve(docsReal, safe);
    if (!target.startsWith(docsReal + path.sep)) continue;
    const stamp = row.createdAt.toISOString();
    next[row.id] = `${safe}:${stamp}`;
    if (prev[row.id] === next[row.id]) {
      skipped++;
      continue;
    }
    try {
      const buf = await readFileObject(row.storageKey);
      await fs.writeFile(target, buf);
      copied++;
    } catch {
      /* 单文件失败跳过（不熔断 ensure） */
    }
  }
  await fs.writeFile(metaPath, JSON.stringify(next), "utf8");
  // 清理已删除文件的落盘副本
  for (const [id, entry] of Object.entries(prev)) {
    const stale = entry.split(":")[0];
    if (!next[id] && stale) await fs.rm(path.join(docsDir, stale), { force: true }).catch(() => {});
  }
  step({
    kind: "docs_sync",
    detail: `platform-docs 同步 ${copied} 复制 / ${skipped} 跳过`,
    ms: Date.now() - t0,
  });
}

export interface EnsureWorkspaceInput {
  projectId: string;
  agentId: string;
  runId: string;
  /** 本次任务涉及的仓库与分支（pipelineConfig.repos 或 agent.repoIds+默认分支） */
  repos: { repoId: string; branch: string }[];
}

/**
 * 任务出队后的工作目录准备（§4.4）：repos ensure + platform-docs 同步 + tasks/{runId} 创建。
 * 任一步失败 → DomainError(70704)，由调用方置 Run FAILED。
 */
export async function ensureWorkspace(
  input: EnsureWorkspaceInput,
  step: (s: EnsureStep) => void,
): Promise<{ taskDir: string; wsDir: string }> {
  const wsDir = agentWsDir(input.agentId);
  const reposDir = path.join(wsDir, "repos");
  const docsDir = path.join(wsDir, "platform-docs");
  await fs.mkdir(reposDir, { recursive: true });

  for (const r of input.repos) {
    const row = await prisma.scmRepository.findFirst({
      where: { id: r.repoId, projectId: input.projectId, deletedAt: null },
    });
    if (!row) {
      step({ kind: "checkout_pull", detail: `仓库 ${r.repoId} 不在本项目，跳过`, ms: 0 });
      continue;
    }
    const dir = path.join(reposDir, repoDirName(row.owner, row.repo));
    const url = await authenticatedUrl(row);
    const exists = await fs
      .stat(path.join(dir, ".git"))
      .then(() => true)
      .catch(() => false);
    let t0 = Date.now();
    if (!exists) {
      const res = await run("git", ["clone", "--branch", r.branch, "--single-branch", url, dir], {
        timeoutMs: 300_000,
      });
      if (res.code !== 0) {
        throw new DomainError(
          ErrCode.AGENT_WS_PREPARE_FAILED,
          `克隆 ${row.owner}/${row.repo}@${r.branch} 失败：${res.stderr.slice(0, 200)}`,
        );
      }
      step({
        kind: "clone",
        detail: `repos/${repoDirName(row.owner, row.repo)} clone @${r.branch}`,
        ms: Date.now() - t0,
      });
    } else {
      // fetch + checkout + pull --ff-only（分支切换与最新化）
      const git = async (...args: string[]) => run("git", args, { cwd: dir, timeoutMs: 180_000 });
      const fetch = await git("fetch", "origin", r.branch);
      const co = await git("checkout", r.branch);
      const pull = await git("pull", "--ff-only", "origin", r.branch);
      const ok = fetch.code === 0 && co.code === 0 && pull.code === 0;
      if (!ok) {
        const stderr = [fetch.stderr, co.stderr, pull.stderr].find((s) => s.trim()) ?? "";
        throw new DomainError(
          ErrCode.AGENT_WS_PREPARE_FAILED,
          `${row.owner}/${row.repo}@${r.branch} 切分支/拉取失败：${stderr.slice(0, 200)}`,
        );
      }
      step({
        kind: "checkout_pull",
        detail: `repos/${repoDirName(row.owner, row.repo)} → ${r.branch} + pull`,
        ms: Date.now() - t0,
      });
    }
    t0 = Date.now();
    void t0;
  }

  await syncPlatformDocs(input.projectId, docsDir, step);

  // tasks/{runId}：软链（相对 ../../repos · ../../platform-docs）+ output/
  const t0 = Date.now();
  const taskDir = path.join(wsDir, "tasks", input.runId);
  await fs.mkdir(path.join(taskDir, "output"), { recursive: true });
  const linkRepos = path.join(taskDir, "repos");
  const linkDocs = path.join(taskDir, "platform-docs");
  for (const [link, target] of [
    [linkRepos, "../../repos"],
    [linkDocs, "../../platform-docs"],
  ] as const) {
    await fs.rm(link, { force: true }).catch(() => {});
    await fs.symlink(target, link, "dir").catch(async (e: unknown) => {
      throw new DomainError(ErrCode.AGENT_WS_PREPARE_FAILED, `创建软链失败：${String(e)}`);
    });
  }
  step({
    kind: "task_dir",
    detail: `tasks/${input.runId}/ 创建 + 软链 + output/`,
    ms: Date.now() - t0,
  });

  return { taskDir, wsDir };
}

/** Agent 软删后的工作区清理（best-effort） */
export async function cleanupWorkspace(agentId: string): Promise<void> {
  await fs.rm(agentWsDir(agentId), { recursive: true, force: true }).catch(() => {});
}

/** 只读护栏：任务目录下相对路径解析后的真实路径是否落在 repos/ 或 platform-docs/（写须拒绝） */
export function isReadOnlyZone(wsDir: string, taskDir: string, relPath: string): boolean {
  const abs = path.resolve(taskDir, relPath);
  const reposReal = path.join(wsDir, "repos") + path.sep;
  const docsReal = path.join(wsDir, "platform-docs") + path.sep;
  return abs.startsWith(reposReal) || abs.startsWith(docsReal);
}

export function wsFingerprint(wsDir: string): string {
  return createHash("sha256").update(wsDir).digest("hex").slice(0, 12);
}
