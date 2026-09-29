#!/usr/bin/env node
/**
 * e2e web 构建副本（INFRA-005）：
 * 在仓库内 `pnpm --filter web build` 出生产构建，复制到槽位专属 /tmp 目录
 * （rabbit-env e2e.tmpWebRoot），并把 apps/web/node_modules 以整目录软链回仓库——
 * 使 `pnpm test:e2e` 的 webServer 与同 worktree 运行中的 `pnpm dev` 互不干扰
 * （next dev 会持续写坏仓库 .next，e2e 需要稳定的生产构建）。
 *
 * 用法：node scripts/e2e-web-copy.mjs
 * ⚠ 须在 dev 栈停止后运行（构建写 apps/web/.next 与 next dev 冲突）；
 * ⚠ 代码变更后须重跑本脚本——副本构建不随仓库更新（S5 教训：过期副本掩盖 testid 改动致本地假绿）。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, symlinkSync, cpSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rabbitEnv } from "./rabbit-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENV = rabbitEnv();
const webSrc = path.join(root, "apps", "web");
const webDst = path.join(ENV.e2e.tmpWebRoot, "apps", "web");

console.log(`[e2e-web-copy] slot=${ENV.slot} 副本目标：${ENV.e2e.tmpWebRoot}`);
console.log("[e2e-web-copy] 仓库内生产构建 …");
const build = spawnSync("pnpm", ["--filter", "web", "build"], { cwd: root, stdio: "inherit" });
if (build.status !== 0) {
  console.error("[e2e-web-copy] 构建失败");
  process.exit(1);
}

rmSync(ENV.e2e.tmpWebRoot, { recursive: true, force: true });
mkdirSync(path.dirname(webDst), { recursive: true });
// 复制 apps/web（含 .next 构建产物与 public/配置；排除 node_modules——运行时整体软链回仓库，
// node 的模块解析沿物理路径走，仓库内 pnpm 的相对软链 workspace 依赖不受影响）
cpSync(webSrc, webDst, {
  recursive: true,
  filter: (src) => path.relative(webSrc, src) !== "node_modules",
});
symlinkSync(path.join(webSrc, "node_modules"), path.join(webDst, "node_modules"), "dir");
console.log(
  `[e2e-web-copy] 完成：${ENV.e2e.tmpWebRoot}（playwright webServer 将从副本起 web :${ENV.e2e.webPort}）`,
);
