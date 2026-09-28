/**
 * 项目三方同步编排（INTG-001/002 §2）：项目关联（PlatformSyncConfig）+ 推送/拉取 + 定时（BullMQ repeatable）
 * + 同步历史（AppSetting，截 20）+ syncState 状态机（NONE→SYNCED→SYNC_FAILED）。
 */
import {
  DomainError,
  ErrCode,
  platformSyncSaveSchema,
  PLATFORM_STATUS_DEFAULT_MAPPING,
} from "@rabbit/shared";
import type { PlatformBug } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { scheduleQueue } from "@/server/redis";
import { requireIntegration } from "./integration.service";
import { enabledPlatformPluginId } from "./plugin.service";
import { runnerCall } from "@/server/plugin-runner.client";
import { validateCron } from "./schedule.service";

type SaveInput = ReturnType<typeof platformSyncSaveSchema.parse>;
const HISTORY_KEY = "platformSyncHistory";

// ── 项目关联 ──

export async function getSyncConfig(projectId: string) {
  const r = await prisma.platformSyncConfig.findUnique({ where: { projectId } });
  if (!r) return null;
  return {
    platform: r.platform,
    projectKey: r.projectKey,
    bugTypes: r.bugTypes,
    mode: r.mode,
    cron: r.cron,
    enabled: r.enabled,
    // statusMapping 融入 bugTypes JSON（{"bugTypes":[...],"statusMapping":[...]} 形态，见 saveSyncConfig）
    statusMapping:
      (r.bugTypes as { statusMapping?: Array<{ platform: string; local: string }> })
        .statusMapping ?? [],
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function saveSyncConfig(
  projectId: string,
  orgId: string,
  input: SaveInput,
): Promise<void> {
  await requireIntegration(orgId, input.platform); // 组织未配置 → 422 70012
  if (input.cron && input.enabled) validateCron(input.cron);
  const payload = {
    bugTypes: input.bugTypes,
    statusMapping: input.statusMapping,
  } as never;
  await prisma.platformSyncConfig.upsert({
    where: { projectId },
    create: {
      projectId,
      platform: input.platform,
      projectKey: input.projectKey,
      bugTypes: payload,
      mode: input.mode,
      cron: input.cron ?? null,
      enabled: input.enabled,
    },
    update: {
      platform: input.platform,
      projectKey: input.projectKey,
      bugTypes: payload,
      mode: input.mode,
      cron: input.cron ?? null,
      enabled: input.enabled,
    },
  });
  await syncRepeatable(projectId);
}

async function syncRepeatable(projectId: string): Promise<void> {
  const r = await prisma.platformSyncConfig.findUnique({ where: { projectId } });
  const queue = scheduleQueue();
  await queue.removeRepeatable("platform-sync", {
    pattern: "*/5 * * * *",
    jobId: `platform-sync-${projectId}`,
  });
  if (r?.enabled && r.cron) {
    await queue.add(
      "platform-sync",
      { kind: "platform-sync", projectId },
      { repeat: { pattern: r.cron }, jobId: `platform-sync-${projectId}` },
    );
  }
}

// ── 推送（本地 Bug → 平台）──

export async function pushBug(
  projectId: string,
  orgId: string,
  bugId: string,
): Promise<{ platformKey: string }> {
  const bug = await prisma.bug.findFirst({ where: { id: bugId, projectId, deletedAt: null } });
  if (!bug) throw new DomainError(ErrCode.BUG_NOT_FOUND, "缺陷不存在");
  const cfg = await prisma.platformSyncConfig.findUnique({ where: { projectId } });
  if (!cfg?.enabled)
    throw new DomainError(ErrCode.PLATFORM_SYNC_CONFIG_INVALID, "项目未启用三方同步");
  const { config } = await requireIntegration(orgId, cfg.platform);
  const pluginId = await enabledPlatformPluginId(cfg.platform);
  const store = cfg.bugTypes as never as { bugTypes?: Array<{ local: string; platform: string }> };
  const payload = {
    projectKey: cfg.projectKey,
    title: bug.title,
    description: bug.description,
    fields: (bug.fields as Record<string, unknown>) ?? {},
    bugType: store.bugTypes?.find(
      (m) => m.local === ((bug.fields as { type?: string }).type ?? "功能缺陷"),
    )?.platform,
  };
  const alreadySynced =
    bug.platform === cfg.platform && bug.platformKey && bug.syncState === "SYNCED";
  try {
    const ref = alreadySynced
      ? await runnerCall<{ platformKey: string }>(pluginId, "updateIssue", [
          config,
          bug.platformKey,
          payload,
        ])
      : await runnerCall<{ platformKey: string }>(pluginId, "createIssue", [config, payload]);
    await prisma.bug.update({
      where: { id: bugId },
      data: { platform: cfg.platform, platformKey: ref.platformKey, syncState: "SYNCED" },
    });
    await appendHistory(projectId, {
      direction: "push",
      ok: true,
      detail: `${bug.num} → ${ref.platformKey}`,
      ms: 0,
    });
    return ref;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.bug
      .update({ where: { id: bugId }, data: { syncState: "SYNC_FAILED" } })
      .catch(() => undefined);
    await appendHistory(projectId, {
      direction: "push",
      ok: false,
      detail: message.slice(0, 256),
      ms: 0,
    });
    throw translatePlatformError(message);
  }
}

// ── 拉取（平台状态 → 本地回写）──

export async function pullBugs(
  projectId: string,
  orgId: string,
  trigger: "manual" | "cron",
): Promise<{ pulled: number; updated: number }> {
  const cfg = await prisma.platformSyncConfig.findUnique({ where: { projectId } });
  if (!cfg?.enabled)
    throw new DomainError(ErrCode.PLATFORM_SYNC_CONFIG_INVALID, "项目未启用三方同步");
  const { config } = await requireIntegration(orgId, cfg.platform);
  const pluginId = await enabledPlatformPluginId(cfg.platform);
  const since = cfg.mode === "INCREMENT" ? new Date(Date.now() - 24 * 60 * 60 * 1000) : undefined;
  const started = Date.now();
  try {
    const bugs = await runnerCall<PlatformBug[]>(pluginId, "syncBugs", [
      config,
      cfg.projectKey,
      since ? since.toISOString() : undefined,
    ]);
    let updated = 0;
    const store = cfg.bugTypes as never as {
      statusMapping?: Array<{ platform: string; local: string }>;
    };
    const mapping: Record<string, string> = {
      ...PLATFORM_STATUS_DEFAULT_MAPPING[
        cfg.platform as keyof typeof PLATFORM_STATUS_DEFAULT_MAPPING
      ],
      ...Object.fromEntries((store.statusMapping ?? []).map((m) => [m.platform, m.local])),
    };
    for (const pb of bugs) {
      const local = await prisma.bug.findFirst({
        where: { projectId, platform: cfg.platform, platformKey: pb.platformKey, deletedAt: null },
        select: { id: true, status: true },
      });
      if (!local) continue;
      const target = mapping[pb.status.toLowerCase()] ?? mapping[pb.status];
      if (target && target !== local.status) {
        await prisma.bug.update({ where: { id: local.id }, data: { status: target } });
        const seq =
          (await prisma.changeLog.count({ where: { entityType: "bug", entityId: local.id } })) + 1;
        await prisma.changeLog.create({
          data: {
            entityType: "bug",
            entityId: local.id,
            seq,
            action: "update",
            userId: null,
            diff: {
              source: "platform-sync",
              status: { from: local.status, to: target },
              platformStatus: pb.status,
            } as never,
          },
        });
        updated += 1;
      }
    }
    await appendHistory(projectId, {
      direction: "pull",
      ok: true,
      detail: `拉取 ${bugs.length} 条，回写 ${updated} 条`,
      ms: Date.now() - started,
      trigger,
    });
    return { pulled: bugs.length, updated };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendHistory(projectId, {
      direction: "pull",
      ok: false,
      detail: message.slice(0, 256),
      ms: Date.now() - started,
      trigger,
    });
    throw translatePlatformError(message);
  }
}

function translatePlatformError(message: string): DomainError {
  if (message.includes("PLATFORM_UNAUTHORIZED")) {
    return new DomainError(ErrCode.PLATFORM_UNAUTHORIZED, message);
  }
  if (message.includes("不可达") || message.includes("runner")) {
    return new DomainError(ErrCode.PLUGIN_RUNNER_UNAVAILABLE, message);
  }
  return new DomainError(ErrCode.SYNC_TASK_FAILED, message);
}

// ── 同步历史（AppSetting，截 20）──

interface HistoryEntry {
  at: string;
  direction: "push" | "pull";
  ok: boolean;
  detail: string;
  ms: number;
  trigger?: string;
}

async function appendHistory(projectId: string, entry: Omit<HistoryEntry, "at">): Promise<void> {
  const row = await prisma.appSetting.findUnique({
    where: { projectId_key: { projectId, key: HISTORY_KEY } },
  });
  const list = (row?.value as HistoryEntry[] | undefined) ?? [];
  list.unshift({ ...entry, at: new Date().toISOString() });
  await prisma.appSetting.upsert({
    where: { projectId_key: { projectId, key: HISTORY_KEY } },
    create: { projectId, key: HISTORY_KEY, value: list.slice(0, 20) as never },
    update: { value: list.slice(0, 20) as never },
  });
}

export async function listHistory(projectId: string, page: number, pageSize: number) {
  const row = await prisma.appSetting.findUnique({
    where: { projectId_key: { projectId, key: HISTORY_KEY } },
  });
  const list = (row?.value as HistoryEntry[] | undefined) ?? [];
  const start = (page - 1) * pageSize;
  return {
    list: list.slice(start, start + pageSize),
    total: list.length,
    page,
    pageSize,
  };
}
