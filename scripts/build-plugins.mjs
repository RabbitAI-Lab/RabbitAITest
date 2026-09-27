/**
 * 插件包构建（PLUG-001 §4）：plugins/{name}/index.ts → esbuild bundle（自包含 js）
 * → 附 package.json（rabbitPlugin 清单）→ tar.gz → plugins/dist/{name}-{version}.tgz
 * 清单单一来源=本表（name/kind/version/spiVersion/entry）。
 */
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 插件清单表（版本随发布递增） */
const PLUGINS = [
  { name: "jira-platform", kind: "platform", version: "1.0.2", spiVersion: "1.0", entry: "index.js" },
  { name: "zentao-platform", kind: "platform", version: "1.0.1", spiVersion: "1.0", entry: "index.js" },
  { name: "tapd-platform", kind: "platform", version: "1.0.1", spiVersion: "1.0", entry: "index.js" },
  { name: "tcp-conn", kind: "protocol", version: "1.0.1", spiVersion: "1.0", entry: "index.js" },
];

const DIST = path.join(ROOT, "plugins", "dist");
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

for (const p of PLUGINS) {
  const stage = path.join(DIST, `stage-${p.name}`);
  mkdirSync(stage, { recursive: true });
  await build({
    entryPoints: [path.join(ROOT, "plugins", p.name, "index.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile: path.join(stage, "index.js"),
    // @rabbit/shared 仅 type-only 依赖：bundle 后自包含
    external: [],
    logLevel: "warning",
  });
  writeFileSync(
    path.join(stage, "package.json"),
    `${JSON.stringify({ name: `@rabbit-plugin/${p.name}`, version: p.version, rabbitPlugin: p }, null, 2)}\n`,
  );
  const tgz = path.join(DIST, `${p.name}-${p.version}.tgz`);
  // tar 参数列表调用（无 shell 拼接）；-C 切目录打包
  await run("tar", ["-czf", tgz, "-C", stage, "package.json", "index.js"]);
  rmSync(stage, { recursive: true, force: true });
  console.log(`[build-plugins] ${path.relative(ROOT, tgz)}`);
}
cpSync(path.join(ROOT, "plugins", "README.md"), path.join(DIST, "README.md"));
console.log(`[build-plugins] ${PLUGINS.length} plugins → plugins/dist/`);
