/**
 * 插件管理服务（PLUG-001 §2）：上传流水线（tarball → 清单校验 → 存储 → 解包 → 登记 → runner 加载）
 * 与启停/组织范围/删除依赖校验。
 */
import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  DomainError,
  ErrCode,
  pluginManifestSchema,
  RABBIT_PLUGIN_SPI_VERSION,
} from "@rabbit/shared";
import type { PluginManifest } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { putObject, deleteObject } from "@/server/storage";
import { runnerHealth, runnerLoad, runnerUnload, runnerList } from "@/server/plugin-runner.client";

const run = promisify(execFile);
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
/** 解包成员白名单（自有构建产物形态；防路径穿越/夹带——rules/security 供应链纪律） */
const ALLOWED_MEMBERS = new Set(["package.json", "index.js"]);

const PLUGIN_DIR = process.env.PLUGIN_DIR ?? path.join(process.cwd(), "data", "plugins");

function tarSafe(args: string[]) {
  return run("tar", args, { maxBuffer: 16 * 1024 * 1024 });
}

function compareVersion(a: string, b: string): number {
  const av = a.split(".").map(Number);
  const bv = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (av[i] ?? 0) - (bv[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 上传（multipart tarball）：校验清单/版本递增/成员白名单 → 存储+解包 → 登记（enabled=false） */
export async function uploadPlugin(
  buffer: Buffer,
  orgScope: "ALL" | string[],
): Promise<{ id: string; manifest: PluginManifest }> {
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_TARBALL_BYTES) {
    throw new DomainError(
      ErrCode.PLUGIN_PACKAGE_INVALID,
      `插件包大小须在 (0, 32MB]，当前 ${buffer.byteLength}`,
    );
  }
  const tmp = path.join(tmpdir(), `rabbit-plugin-${randomUUID()}.tgz`);
  await writeFile(tmp, buffer);
  try {
    // 成员白名单（tar -tzf 列表；拒绝路径穿越/夹带非常规成员）
    const { stdout: listOut } = await tarSafe(["-tzf", tmp]);
    const members = listOut
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const m of members) {
      if (!ALLOWED_MEMBERS.has(m)) {
        throw new DomainError(
          ErrCode.PLUGIN_PACKAGE_INVALID,
          `插件包含不允许的成员：${m}（仅 package.json/index.js）`,
        );
      }
    }
    // 清单解析
    const { stdout: pkgOut } = await tarSafe(["-xzOf", tmp, "package.json"]);
    let manifest: PluginManifest;
    try {
      manifest = pluginManifestSchema.parse(JSON.parse(pkgOut).rabbitPlugin);
    } catch {
      throw new DomainError(
        ErrCode.PLUGIN_PACKAGE_INVALID,
        "package.json → rabbitPlugin 清单非法或缺失",
      );
    }
    if (manifest.spiVersion !== RABBIT_PLUGIN_SPI_VERSION) {
      throw new DomainError(
        ErrCode.PLUGIN_SPI_INCOMPATIBLE,
        `SPI 版本不兼容：插件 ${manifest.spiVersion} ≠ 宿主 ${RABBIT_PLUGIN_SPI_VERSION}`,
      );
    }
    if (!members.includes(manifest.entry)) {
      throw new DomainError(ErrCode.PLUGIN_PACKAGE_INVALID, `入口文件 ${manifest.entry} 不在包内`);
    }
    // 版本递增（同名同 kind）
    const existing = await prisma.plugin.findFirst({
      where: { name: manifest.name, kind: manifest.kind },
      orderBy: { updatedAt: "desc" },
    });
    if (existing && compareVersion(manifest.version, existing.version) <= 0) {
      throw new DomainError(
        ErrCode.PLUGIN_VERSION_CONFLICT,
        `同名插件已存在 ${existing.version}，上传版本需更高`,
      );
    }
    // 存储 + 解包 + 登记
    const storageKey = await putObject(buffer);
    const dir = path.join(PLUGIN_DIR, manifest.name, manifest.version);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    await tarSafe(["-xzf", tmp, "-C", dir]);
    // 幂等 upsert 式（name+kind 唯一约束）：并发上传竞态下 P2002 兜底回查 update，保证单一 id
    let plugin;
    try {
      plugin = existing
        ? await prisma.plugin.update({
            where: { id: existing.id },
            data: {
              version: manifest.version,
              storageKey,
              orgScope: orgScope as never,
              enabled: false,
            },
          })
        : await prisma.plugin.create({
            data: {
              name: manifest.name,
              kind: manifest.kind,
              version: manifest.version,
              storageKey,
              orgScope: orgScope as never,
              enabled: false,
            },
          });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        const winner = await prisma.plugin.findFirstOrThrow({
          where: { name: manifest.name, kind: manifest.kind },
          orderBy: { updatedAt: "desc" },
        });
        plugin = await prisma.plugin.update({
          where: { id: winner.id },
          data: { version: manifest.version, storageKey, orgScope: orgScope as never },
        });
      } else throw e;
    }
    return { id: plugin.id, manifest };
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** S-future PLUG-003 §2.4：定义/用例保存时协议可用性校验（http/https 内置放行；
 * 其余协议须存在已启用的同名协议插件，否则 40511——PLUG-002 预留码首次兑现）。
 * 调试执行不落库，由引擎走既有 40510（PROTOCOL_NOT_SUPPORTED），不在本函数重复校验。 */
export async function assertProtocolAvailable(protocol: string | undefined): Promise<void> {
  if (!protocol || protocol.toLowerCase() === "http" || protocol.toLowerCase() === "https") return;
  const hit = await prisma.plugin.findFirst({
    where: { kind: "protocol", name: protocol, enabled: true },
    select: { id: true },
  });
  if (!hit)
    throw new DomainError(
      ErrCode.PROTOCOL_PLUGIN_LOAD_FAILED,
      `协议插件 ${protocol} 未启用或不存在（请先在系统设置-插件中启用）`,
    );
}

export async function listPlugins(filter: { kind?: string; keyword?: string }) {
  const rows = await prisma.plugin.findMany({
    where: {
      ...(filter.kind ? { kind: filter.kind } : {}),
      ...(filter.keyword
        ? { name: { contains: filter.keyword, mode: "insensitive" as const } }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
  });
  const runtime = new Map((await runnerList()).map((p) => [p.name, p]));
  return rows.map((r) => {
    const rt = runtime.get(r.name);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      version: r.version,
      spiVersion: RABBIT_PLUGIN_SPI_VERSION,
      orgScope: r.orgScope as "ALL" | string[],
      description: r.description,
      enabled: r.enabled,
      runtimeStatus: !r.enabled ? "STOPPED" : rt ? rt.workerStatus : "ERROR",
      runtimeError: rt?.lastError ?? (!r.enabled ? null : "plugin-runner 不可达或未加载"),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

async function requirePlugin(id: string) {
  const p = await prisma.plugin.findUnique({ where: { id } });
  if (!p) throw new DomainError(ErrCode.PLUGIN_NOT_FOUND, "插件不存在");
  return p;
}

/** 启停：启用=runner 热加载；停用=卸载（配置保留）。orgScope 变更同步。 */
export async function updatePlugin(
  id: string,
  input: { enabled?: boolean; orgScope?: "ALL" | string[] },
): Promise<void> {
  const p = await requirePlugin(id);
  const data: Record<string, unknown> = {};
  if (input.orgScope !== undefined) data.orgScope = input.orgScope;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  await prisma.plugin.update({ where: { id }, data: data as never });
  if (input.enabled === true) {
    if (!(await runnerHealth())) {
      await prisma.plugin.update({ where: { id }, data: { enabled: false } });
      throw new DomainError(ErrCode.PLUGIN_RUNNER_UNAVAILABLE, "plugin-runner 不可达，无法启用");
    }
    // 幂等：runner 已含同名插件（重复启用场景）则跳过 load
    const already = (await runnerList()).some(
      (r) => r.name === p.name && r.workerStatus === "RUNNING",
    );
    if (!already)
      await runnerLoad({
        pluginId: p.id,
        name: p.name,
        kind: p.kind,
        version: p.version,
        spiVersion: RABBIT_PLUGIN_SPI_VERSION,
        dir: path.join(PLUGIN_DIR, p.name, p.version),
        entry: "index.js",
      });
  } else if (input.enabled === false) {
    await runnerUnload(p.id).catch(() => undefined);
  }
}

/** 删除：仅停用状态且无平台同步关联引用（INTG 删除依赖校验） */
export async function deletePlugin(id: string): Promise<void> {
  const p = await requirePlugin(id);
  if (p.enabled) {
    throw new DomainError(ErrCode.PLUGIN_DELETE_FORBIDDEN, "插件启用中，请先停用");
  }
  if (p.kind === "platform") {
    const refs = await prisma.platformSyncConfig.count({
      where: { platform: p.name.replace(/-platform$/, "") },
    });
    if (refs > 0) {
      throw new DomainError(
        ErrCode.PLUGIN_DELETE_FORBIDDEN,
        `存在 ${refs} 个项目同步关联引用该平台插件`,
      );
    }
  }
  rmSync(path.join(PLUGIN_DIR, p.name, p.version), { recursive: true, force: true });
  await deleteObject(p.storageKey);
  await prisma.plugin.delete({ where: { id } });
}

/** orgScope 求值（PLUG-001 §2）：ALL 或含 orgId */
export function scopeAllows(orgScope: unknown, orgId: string): boolean {
  if (orgScope === "ALL") return true;
  return Array.isArray(orgScope) && orgScope.includes(orgId);
}

/** 按平台名解析已启用插件（INTG 用；平台插件名约定 {platform}-platform）。
 *  以 runner 实际加载实例为准（按 name 匹配）——免疫历史上传竞态遗留的多行 id 漂移；
 *  DB 行仅校验「已启用」存在。 */
export async function enabledPlatformPluginId(platform: string): Promise<string> {
  const name = `${platform}-platform`;
  const p = await prisma.plugin.findFirst({ where: { name, kind: "platform", enabled: true } });
  if (!p) throw new DomainError(ErrCode.PLUGIN_NOT_FOUND, `平台插件未启用：${name}`);
  // 多版本 slot 并存时取最新加载的（findLast——上传升级后旧 slot 仍在 runner 内）
  const all = (await runnerList()).filter((r) => r.name === name && r.workerStatus === "RUNNING");
  const running = all.length > 0 ? all[all.length - 1] : undefined;
  if (running) return running.pluginId;
  return p.id;
}

export const pluginDir = PLUGIN_DIR;
