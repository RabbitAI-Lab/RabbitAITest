#!/usr/bin/env node
/**
 * dev 栈槽位端口清障（pnpm dev 启动前自动回收本仓残留进程）。
 *
 * 背景：dev 栈被强杀 / 终端会话回收后常残留 next-server、embedded-postgres 等监听进程，
 * 下次 pnpm dev 直接 fail-fast 起不来，需人工 lsof+kill。本模块把这一步自动化。
 *
 * 边界（对齐 rules/git-workflow.md §9.4 清场纪律——只清本槽位，禁跨槽互杀）：
 * - 目标端口仅当前槽位的 dev.web / dev.mock / dev.runner（+ 未设 DATABASE_URL 时 dev.pg）；
 *   端口表出自 rabbit-env.mjs，跨槽位端口永不触碰；Redis 共享实例（6379）永不触碰
 * - 只杀 LISTEN 进程（浏览器的客户端连接、PG backend 连接不受影响）
 * - TERM → 限时未退 KILL 兜底（postmaster 对 TERM 是 smart shutdown，idle backend 会拖住）；
 *   杀不掉（外部用户进程/权限不足）不硬来，交回 assertSlotPortsFree 报错并给指引
 * - RABBIT_DEV_NO_CLEAN=1 跳过清障，保留纯 fail-fast 口径（本槽位端口上故意跑着
 *   其他服务、希望 dev 明确报错而非杀掉时使用）
 *
 * CLI：node scripts/dev-ports-clean.mjs   # 手动清当前槽位（排障用）
 */
import { spawnSync } from "node:child_process";
import { rabbitEnv } from "./rabbit-env.mjs";

/** lsof -t 输出 → 去重 PID 列表（纯函数） */
export function parseListenerPids(stdout) {
  const pids = (stdout ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  return [...new Set(pids)];
}

/** 清理目标端口表（纯函数）：web/mock/runner 恒定；pg 仅自管 embedded PG 时纳入 */
export function planCleanTargets(env, includePg) {
  const targets = [
    [env.dev.webPort, "web"],
    [env.dev.mockPort, "mock"],
    [env.dev.runnerPort, "plugin-runner"],
  ];
  if (includePg) targets.push([env.dev.pgPort, "embedded-postgres"]);
  return targets;
}

function defaultLsof(port) {
  const r = spawnSync("lsof", ["-nP", "-ti", `:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
  // lsof 无匹配返回 1；无 lsof 可用（精简镜像）同样视为无占用
  if (r.error || r.status !== 0) return "";
  return r.stdout ?? "";
}

function defaultKill(pid, signal) {
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false; // ESRCH=已退出；EPERM=无权限（外部用户进程），交回 fail-fast
  }
}

function defaultPs(pid) {
  const r = spawnSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 ? (r.stdout ?? "").trim() : "";
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 对当前槽位 dev 端口做 LISTEN 清障；返回逐端口结果数组：
 *   { port, name, pids, killed, survivors }——killed=false 表示有进程杀不动，
 *   由调用方（dev.mjs assertSlotPortsFree）兜底报错。全部依赖可注入（测试用）。
 */
export async function cleanSlotPorts({
  env = rabbitEnv(),
  includePg = true,
  lsof = defaultLsof,
  kill = defaultKill,
  ps = defaultPs,
  isAlive = defaultIsAlive,
  log = () => {},
  waitMs = 3000,
} = {}) {
  const results = [];
  for (const [port, name] of planCleanTargets(env, includePg)) {
    const pids = parseListenerPids(lsof(port));
    if (pids.length === 0) continue;
    for (const pid of pids)
      log(`:${port}（${name}）被占用，SIGTERM pid=${pid}（${ps(pid) || "未知命令"}）`);
    for (const pid of pids) kill(pid, "SIGTERM");
    let survivors = pids.filter(isAlive);
    const deadline = Date.now() + waitMs;
    while (survivors.length > 0 && Date.now() < deadline) {
      await sleep(200);
      survivors = pids.filter(isAlive);
    }
    if (survivors.length > 0) {
      for (const pid of survivors) log(`:${port}（${name}）pid=${pid} 未退，SIGKILL 兜底`);
      for (const pid of survivors) kill(pid, "SIGKILL");
      await sleep(500);
      survivors = survivors.filter(isAlive);
    }
    results.push({ port, name, pids, killed: survivors.length === 0, survivors });
  }
  return results;
}

// CLI 入口判定：仅当本模块是启动脚本（与 rabbit-env.mjs 同款 argv 判定，防编译路径误触发）
const isMain =
  typeof process.argv[1] === "string" && process.argv[1].endsWith("dev-ports-clean.mjs");
if (isMain) {
  cleanSlotPorts({ log: (msg) => console.log(`[dev-clean] ${msg}`) }).then((results) => {
    if (results.length === 0) {
      console.log("[dev-clean] 当前槽位 dev 端口无残留监听");
      return;
    }
    const failed = results.filter((r) => !r.killed);
    if (failed.length > 0) {
      for (const r of failed) {
        console.error(
          `[dev-clean] :${r.port}（${r.name}）杀不动 pid=${r.survivors.join(",")}（权限/外部进程）`,
        );
      }
      process.exitCode = 1;
    }
  });
}
