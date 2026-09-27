/** API-008 定时任务：AppSetting 权威源 + BullMQ repeatable 触发器双轨；web instrumentation 起 consumer。 */
import { DomainError, ErrCode } from "@rabbit/shared";
import type { z } from "zod";
import { scenarioScheduleSaveSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { scheduleQueue } from "@/server/redis";
import { createScenarioTask } from "@/server/domains/exec/exec.service";
import { randomUUID } from "node:crypto";

type SaveInput = z.infer<typeof scenarioScheduleSaveSchema>;

export interface ScenarioSchedule {
  id: string;
  name: string;
  cron: string;
  scenarioIds: string[];
  envId?: string;
  enabled: boolean;
  notify: boolean;
  lastRunAt?: string;
}

const SETTING_KEY = "scenario_schedules";

/** cron 词法校验：5 段（分 时 日 月 周），数字、星号、逗号、连字符与步进；最短间隔 5 分钟（防风暴）。 */
export function validateCron(cron: string): void {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) throw new DomainError(ErrCode.CRON_INVALID, "cron 必须 5 段（分 时 日 月 周）");
  const fieldRe = /^(\*|\d+|\*\/\d+|\d+-\d+|\d+(,\d+)*)(\/\d+)?$/;
  for (const f of fields) {
    if (!fieldRe.test(f)) throw new DomainError(ErrCode.CRON_INVALID, `cron 字段非法：${f}`);
  }
  // 最短间隔：分钟段必须为固定值或 ≥5 步进（简化口径：不接受 `*` 或 `*/n`(n<5) 的分钟段）
  const minute = fields[0] ?? "";
  if (minute === "*" || minute.startsWith("*/")) {
    const step = minute === "*" ? 1 : Number(minute.slice(2));
    if (!Number.isFinite(step) || step < 5) throw new DomainError(ErrCode.CRON_INVALID, "分钟段最短间隔 5 分钟（防触发风暴）");
  }
}

async function readSchedules(projectId: string): Promise<ScenarioSchedule[]> {
  const row = await prisma.appSetting.findUnique({ where: { projectId_key: { projectId, key: SETTING_KEY } } });
  return ((row?.value as ScenarioSchedule[] | undefined) ?? []);
}

async function writeSchedules(projectId: string, list: ScenarioSchedule[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { projectId_key: { projectId, key: SETTING_KEY } },
    create: { projectId, key: SETTING_KEY, value: list as never },
    update: { value: list as never },
  });
}

async function syncRepeatable(schedule: ScenarioSchedule): Promise<void> {
  // 幂等同步：先移除旧 repeatable（以 jobId 为键），启用时重建
  const jobId = `schedule-${schedule.id}`;
  await scheduleQueue().removeRepeatable("fire", { pattern: schedule.cron, jobId });
  if (schedule.enabled) {
    await scheduleQueue().add("fire", { scheduleId: schedule.id, projectId: null }, { repeat: { pattern: schedule.cron }, jobId });
  }
}

export async function listSchedules(projectId: string) {
  const list = await readSchedules(projectId);
  return { total: list.length, list };
}

export async function createSchedule(projectId: string, userId: string, input: SaveInput) {
  validateCron(input.cron);
  const scenarios = await prisma.scenario.count({ where: { id: { in: input.scenarioIds }, projectId, deletedAt: null } });
  if (scenarios === 0) throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, "场景不存在或已删除");
  const schedule: ScenarioSchedule = {
    id: randomUUID(),
    name: input.name,
    cron: input.cron,
    scenarioIds: input.scenarioIds,
    envId: input.envId,
    enabled: input.enabled,
    notify: input.notify,
  };
  const list = await readSchedules(projectId);
  list.push(schedule);
  await writeSchedules(projectId, list);
  await syncRepeatable(schedule);
  void userId;
  return { id: schedule.id };
}

export async function updateSchedule(projectId: string, id: string, input: SaveInput) {
  validateCron(input.cron);
  const list = await readSchedules(projectId);
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) throw new DomainError(ErrCode.SCHEDULE_NOT_FOUND, "定时任务不存在");
  list[idx] = { ...list[idx]!, name: input.name, cron: input.cron, scenarioIds: input.scenarioIds, envId: input.envId, enabled: input.enabled, notify: input.notify };
  await writeSchedules(projectId, list);
  await syncRepeatable(list[idx]!);
  return { id };
}

export async function toggleSchedule(projectId: string, id: string, enabled: boolean, actorId?: string) {
  const list = await readSchedules(projectId);
  const s = list.find((x) => x.id === id);
  if (!s) throw new DomainError(ErrCode.SCHEDULE_NOT_FOUND, "定时任务不存在");
  s.enabled = enabled;
  await writeSchedules(projectId, list);
  await syncRepeatable(s);
  // S5 MSG-001：定时任务启停事件
  if (actorId) {
    try {
      const { dispatch } = await import("@/server/domains/message/notify.service");
      await dispatch({
        projectId,
        event: enabled ? "SCHEDULE_ENABLED" : "SCHEDULE_DISABLED",
        title: `[定时任务] ${s.name} 已${enabled ? "启用" : "停用"}`,
        content: `时间：${new Date().toLocaleString("zh-CN")}`,
        actorId,
      });
    } catch {
      // 通知失败不阻断（MSG-001 §2）
    }
  }
  return { id, enabled };
}

export async function deleteSchedule(projectId: string, id: string) {
  const list = await readSchedules(projectId);
  const s = list.find((x) => x.id === id);
  if (!s) throw new DomainError(ErrCode.SCHEDULE_NOT_FOUND, "定时任务不存在");
  await writeSchedules(projectId, list.filter((x) => x.id !== id));
  await scheduleQueue().removeRepeatable("fire", { pattern: s.cron, jobId: `schedule-${s.id}` });
  return { id };
}

/** 定时触发回调（scheduler consumer 与「立即执行」共用）：场景全删→自动停用（API-008 §2）。 */
export async function fireSchedule(scheduleId: string, projectId?: string | null): Promise<{ taskId?: string; skipped?: string }> {
  const settingsRows = await prisma.appSetting.findMany({ where: { key: SETTING_KEY } });
  const all = settingsRows.flatMap((r) => (r.value as unknown as ScenarioSchedule[]) ?? []);
  const s = all.find((x) => x.id === scheduleId);
  if (!s) return { skipped: "schedule 不存在（已删除）" };
  // 权威源回查 projectId
  const pid =
    projectId ??
    settingsRows
      .flatMap((r) => (r.value as unknown as (ScenarioSchedule & { projectId?: string })[]) ?? [])
      .find((x) => x.id === scheduleId)?.projectId ??
    settingsRows.find((r) => ((r.value as unknown as ScenarioSchedule[]) ?? []).some((x) => x.id === scheduleId))?.projectId;
  if (!pid) return { skipped: "schedule 无项目上下文" };
  if (!s.enabled) return { skipped: "已停用" };
  const alive = await prisma.scenario.findMany({ where: { id: { in: s.scenarioIds }, projectId: pid, deletedAt: null }, select: { id: true } });
  if (alive.length === 0) {
    await toggleSchedule(pid, s.id, false);
    return { skipped: "场景全部被删，定时任务自动停用" };
  }
  const r = await createScenarioTask(pid, "system:schedule", {
    scenarioIds: alive.map((a) => a.id),
    envId: s.envId,
    stopOnFail: false,
    mode: "serial",
  });
  // S5 MSG-001：定时来源与 notify 标志写入任务 payload（执行完成通知判定）
  const t = await prisma.execTask.findUnique({ where: { id: r.taskId }, select: { payload: true } });
  if (t) {
    await prisma.execTask.update({
      where: { id: r.taskId },
      data: { payload: { ...((t.payload ?? {}) as object), scheduleId: s.id, notify: s.notify } },
    });
  }
  // 记录最近触发
  const list = await readSchedules(pid);
  const found = list.find((x) => x.id === s.id);
  if (found) {
    found.lastRunAt = new Date().toISOString();
    if (alive.length < s.scenarioIds.length) found.scenarioIds = alive.map((a) => a.id);
    await writeSchedules(pid, list);
  }
  return { taskId: r.taskId };
}
