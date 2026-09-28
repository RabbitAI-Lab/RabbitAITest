import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 递归杀进程树（pnpm --filter xx start 的孙进程 tsx/node 不会被 pnpm 的 SIGTERM 带走，
 *  残留 mock 占用 :4000 导致下一轮 EADDRINUSE——2026-09-27 e2e 修复循环教训） */
function killTree(pid) {
  let children = [];
  try {
    children = execSync(`pgrep -P ${pid}`, { encoding: "utf8" })
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    /* 无子进程 */
  }
  for (const c of children) killTree(c);
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {
    /* 已退出 */
  }
}

export default async function globalTeardown() {
  const env = globalThis.__e2eEnv;
  if (!env) return;
  for (const { p } of env.procs ?? []) {
    try {
      killTree(p.pid);
    } catch {
      /* noop */
    }
  }
  // 兜底：tsx 进程链可能被 reparent（launchd），按本 worktree 绝对路径清残留（mock / engine worker）。
  // INFRA-005：模式限定为 `${root}/apps/*`——原裸 "apps/mock" 会误杀并行 worktree 的同路径进程
  for (const pat of [`${root}/apps/mock`, `${root}/apps/engine`]) {
    try {
      execSync(`pkill -9 -f "${pat}" || true`, { stdio: "ignore" });
    } catch {
      /* noop */
    }
  }
  if (env.pg) {
    try {
      await env.pg.stop();
    } catch {
      /* noop */
    }
  }
  console.log("[e2e-teardown] done");
}
