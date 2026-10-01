/**
 * S14 UIT-004：项目级 Runner 服务（web 侧编排）。
 * 隔离四级之 API/表层：全部查询带 projectId（withProjectScope 之上再收口——跨项目 runnerId
 * 一律 UI_RUNNER_NOT_FOUND 404 防枚举）；安装/检测/清理经 runner-jobs 队列交引擎执行，
 * 结果由 internal/runners/report 回调回写（引擎无 DB 纪律）；内置 runner=虚拟行（常量+Redis 缓存检测）。
 */
import { Prisma } from "@prisma/client";
import {
  DomainError,
  ErrCode,
  RUNNER_VERSION_RE,
  BUILTIN_RUNNER,
  config,
  runnerCheckResultSchema,
} from "@rabbit/shared";
import type { RunnerEnvCheckItem, RunnerReport, UiRunnerView } from "@rabbit/shared";
import { logFor } from "@rabbit/shared/logger";
import { prisma } from "@rabbit/db";
import { redis, runnerQueue } from "@/server/redis";

const log = logFor("http");

// ───────────────────────── 视图组装 ─────────────────────────

function parseCheck(
  json: unknown,
): { items: RunnerEnvCheckItem[]; checkedAt: string; version?: string } | null {
  const parsed = runnerCheckResultSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function toView(row: {
  id: string;
  projectId: string;
  name: string;
  kind: string;
  version: string;
  status: string;
  isDefault: boolean;
  installSource: string;
  installLogTail: string | null;
  lastCheckAt: Date | null;
  checkItems: unknown;
  createdAt: Date;
}): UiRunnerView {
  const check = parseCheck(row.checkItems);
  return {
    id: row.id,
    projectId: row.projectId,
    kind: "project",
    name: row.name,
    version: row.version,
    status: row.status as UiRunnerView["status"],
    isDefault: row.isDefault,
    installSource: row.installSource,
    installLogTail: row.installLogTail ?? undefined,
    lastCheckAt: row.lastCheckAt ? row.lastCheckAt.toISOString() : null,
    check: check
      ? { items: check.items, checkedAt: check.checkedAt, version: check.version }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function builtinCheckCache(): Promise<{
  items: RunnerEnvCheckItem[];
  checkedAt: string;
  version?: string;
} | null> {
  try {
    const raw = await redis().get(config.builtinRunnerCheckKey);
    if (!raw) return null;
    return parseCheck(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 内置 runner 虚拟行（不入表；检测缓存命中时带 checklist 与实测版本）。 */
export async function builtinRunnerView(projectId: string): Promise<UiRunnerView> {
  const check = await builtinCheckCache();
  return {
    id: BUILTIN_RUNNER.id,
    projectId,
    kind: "builtin",
    name: BUILTIN_RUNNER.name,
    version: check?.version ?? BUILTIN_RUNNER.version,
    status: "READY",
    isDefault: false,
    lastCheckAt: check?.checkedAt ?? null,
    check: check
      ? { items: check.items, checkedAt: check.checkedAt, version: check.version }
      : null,
    createdAt: new Date(0).toISOString(),
  };
}

// ───────────────────────── 查询 ─────────────────────────

/** 列表：本项目 runner（活跃集）+ 内置虚拟行；默认 runner 置首的稳定序（信封 {items,total}）。 */
export async function listUiRunners(
  projectId: string,
): Promise<{ items: UiRunnerView[]; total: number }> {
  const rows = await prisma.uiRunner.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  const views = rows.map(toView);
  const items = [await builtinRunnerView(projectId), ...views];
  return { items, total: items.length };
}

async function requireRunner(projectId: string, runnerId: string) {
  const row = await prisma.uiRunner.findFirst({
    where: { id: runnerId, projectId, deletedAt: null },
  });
  if (!row) throw new DomainError(ErrCode.UI_RUNNER_NOT_FOUND, "Runner 不存在或非本项目");
  return row;
}

export async function uiRunnerDetail(projectId: string, runnerId: string): Promise<UiRunnerView> {
  if (runnerId === BUILTIN_RUNNER.id) return builtinRunnerView(projectId);
  return toView(await requireRunner(projectId, runnerId));
}

/** 执行链路解析（uit.service 下发前）：项目默认 READY runner → null（内置）。 */
export async function resolveDefaultRunnerId(projectId: string): Promise<string | null> {
  const row = await prisma.uiRunner.findFirst({
    where: { projectId, deletedAt: null, isDefault: true, status: "READY" },
    select: { id: true },
  });
  return row?.id ?? null;
}

// ───────────────────────── 安装 / 检测 / 默认 / 删除 ─────────────────────────

export async function installUiRunner(
  projectId: string,
  userId: string,
  input: { version: string },
): Promise<UiRunnerView> {
  if (!RUNNER_VERSION_RE.test(input.version)) {
    throw new DomainError(ErrCode.UI_RUNNER_VERSION_INVALID, "版本必须为精确 semver（如 1.63.0）");
  }
  // 同版本重复安装=幂等复用（FAILED 行重试；READY 行拒绝 busy）
  const existing = await prisma.uiRunner.findFirst({
    where: { projectId, version: input.version, deletedAt: null },
  });
  if (existing?.status === "INSTALLING") {
    throw new DomainError(ErrCode.UI_RUNNER_BUSY, "该版本正在安装中");
  }
  if (existing?.status === "READY") {
    throw new DomainError(ErrCode.UI_RUNNER_BUSY, "该版本已安装（如需重装请先删除）");
  }
  const row = existing
    ? await prisma.uiRunner.update({
        where: { id: existing.id },
        data: { status: "INSTALLING", installLogTail: null, isDefault: existing.isDefault },
      })
    : await prisma.uiRunner.create({
        data: {
          projectId,
          name: `pw-${input.version}`,
          kind: "project",
          version: input.version,
          status: "INSTALLING",
          isDefault: !(await prisma.uiRunner.findFirst({
            where: { projectId, deletedAt: null, isDefault: true },
            select: { id: true },
          })),
          installSource: "https://registry.npmjs.org",
          createdById: userId,
        },
      });
  // jobId 带时戳：重试安装（FAILED 行复用）必须产生新 job——BullMQ 对已完成同 jobId 去重不重跑
  await runnerQueue().add(
    "runner",
    {
      kind: "install",
      runnerId: row.id,
      projectId,
      version: input.version,
      source: "https://registry.npmjs.org",
    },
    { jobId: `runner-install-${row.id}-${Date.now()}`, attempts: 1, removeOnComplete: 5000 },
  );
  log.info(
    { projectId, runnerId: row.id, version: input.version, userId },
    "ui runner install enqueued",
  );
  return toView(row);
}

export async function checkUiRunner(
  projectId: string,
  runnerId: string | null | "builtin",
): Promise<{ accepted: true }> {
  const target = runnerId ?? "builtin";
  if (target === "builtin") {
    await runnerQueue().add(
      "runner",
      { kind: "check", projectId, target: "builtin" },
      { attempts: 1 },
    );
    return { accepted: true };
  }
  const row = await requireRunner(projectId, target);
  if (row.status === "INSTALLING")
    throw new DomainError(ErrCode.UI_RUNNER_BUSY, "安装进行中，完成后自动检测");
  await runnerQueue().add(
    "runner",
    { kind: "check", projectId, target: "project", runnerId: row.id },
    { jobId: `runner-check-${row.id}-${Date.now()}`, attempts: 1 },
  );
  return { accepted: true };
}

export async function setDefaultUiRunner(
  projectId: string,
  runnerId: string,
): Promise<{ ok: true }> {
  const row = await requireRunner(projectId, runnerId);
  if (row.status !== "READY") {
    throw new DomainError(ErrCode.UI_RUNNER_BUSY, "仅 READY 状态可设为默认（安装完成且环境可用）");
  }
  await prisma.$transaction([
    prisma.uiRunner.updateMany({
      where: { projectId, isDefault: true },
      data: { isDefault: false },
    }),
    prisma.uiRunner.update({ where: { id: row.id }, data: { isDefault: true } }),
  ]);
  return { ok: true };
}

/** 删除=软删行 + 引擎目录清理 job（READY/FAILED 可删；INSTALLING 拒绝——安装进程在跑）。 */
export async function deleteUiRunner(projectId: string, runnerId: string): Promise<{ ok: true }> {
  const row = await requireRunner(projectId, runnerId);
  if (row.status === "INSTALLING") {
    throw new DomainError(ErrCode.UI_RUNNER_BUSY, "安装进行中，不可删除（可取消安装后删除）");
  }
  await prisma.uiRunner.update({
    where: { id: row.id },
    data: { deletedAt: new Date(), isDefault: false },
  });
  await runnerQueue().add(
    "runner",
    { kind: "remove", runnerId: row.id, projectId },
    { jobId: `runner-remove-${row.id}-${Date.now()}`, attempts: 1 },
  );
  return { ok: true };
}

// ───────────────────────── 引擎回调（internal/runners/report） ─────────────────────────

export async function handleRunnerReport(report: RunnerReport): Promise<void> {
  if (report.kind === "progress") {
    // 安装进度：落 installLogTail（前缀 stage 供前端解析三段）；仅 INSTALLING 行生效
    await prisma.uiRunner
      .updateMany({
        where: { id: report.runnerId, projectId: report.projectId, status: "INSTALLING" },
        data: { installLogTail: `[${report.stage}] ${report.logTail}`.slice(0, 2000) },
      })
      .catch((e) => log.warn({ err: e }, "runner progress write failed"));
    return;
  }
  if (report.kind === "install") {
    await prisma.uiRunner
      .update({
        where: { id: report.runnerId },
        data: {
          status: report.status,
          installLogTail: report.installLogTail || null,
          ...(report.check
            ? {
                checkItems: report.check as unknown as Prisma.InputJsonValue,
                lastCheckAt: new Date(report.check.checkedAt),
              }
            : {}),
        },
      })
      .catch((e) => log.warn({ err: e }, "runner install report write failed"));
    return;
  }
  if (report.kind === "check") {
    if (report.target === "builtin") {
      await redis()
        .set(config.builtinRunnerCheckKey, JSON.stringify(report.check), "EX", 3600)
        .catch(() => undefined);
      return;
    }
    if (report.runnerId) {
      await prisma.uiRunner
        .update({
          where: { id: report.runnerId },
          data: {
            checkItems: report.check as unknown as Prisma.InputJsonValue,
            lastCheckAt: new Date(report.check.checkedAt),
          },
        })
        .catch((e) => log.warn({ err: e }, "runner check report write failed"));
    }
    return;
  }
  // remove：目录清理结果仅日志（行已软删）
  log.info({ runnerId: report.runnerId, ok: report.ok }, "runner dir removed");
}
