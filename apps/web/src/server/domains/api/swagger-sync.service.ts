/**
 * Swagger URL 定时同步（API-011 §2）：任务 CRUD（AppSetting 权威源，上限 10）→ 拉取（SSRF 守卫复用 S2）
 * → 解析（json/yaml 嗅探）→ 复用 import.service.importApis → 历史截 20。
 */
import { DomainError, ErrCode, swaggerSyncTaskSaveSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { ensureApiModule } from "@rabbit/db";
import { scheduleQueue } from "@/server/redis";
import { validateCron } from "./schedule.service";
import { importApis } from "./import.service";
import { assertSafeOutboundUrl } from "./outbound-guard";

type TaskSave = ReturnType<typeof swaggerSyncTaskSaveSchema.parse>;

interface Task {
  id: string;
  name: string;
  url: string;
  cover: boolean;
  moduleId: string | null;
  cron: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastResult: SyncResult | null;
}
interface SyncResult {
  added: number;
  updated: number;
  skipped: number;
  failed: Array<{ path: string; reason: string }>;
  ok: boolean;
  error?: string;
  ms: number;
}

const SETTING_KEY = "swaggerSyncTasks";
const MAX_TASKS = 10;
const HISTORY_LIMIT = 20;
const runHistory = new Map<string, SyncResult[]>(); // 进程内最近历史（lastResult 落 AppSetting）

async function readTasks(projectId: string): Promise<Task[]> {
  const row = await prisma.appSetting.findUnique({ where: { projectId_key: { projectId, key: SETTING_KEY } } });
  return ((row?.value as Task[] | undefined) ?? []);
}

async function writeTasks(projectId: string, list: Task[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { projectId_key: { projectId, key: SETTING_KEY } },
    create: { projectId, key: SETTING_KEY, value: list as never },
    update: { value: list as never },
  });
}

async function syncRepeatable(task: Task, projectId: string): Promise<void> {
  const queue = scheduleQueue();
  await queue.removeRepeatable("swagger-sync", { pattern: task.cron, jobId: `swsync-${task.id}` });
  if (task.enabled) {
    await queue.add("swagger-sync", { kind: "swagger-sync", taskId: task.id, projectId }, { repeat: { pattern: task.cron }, jobId: `swsync-${task.id}` });
  }
}

export async function listTasks(projectId: string): Promise<Task[]> {
  return readTasks(projectId);
}

export async function createTask(projectId: string, input: TaskSave): Promise<Task> {
  const tasks = await readTasks(projectId);
  if (tasks.length >= MAX_TASKS) {
    throw new DomainError(ErrCode.SWAGGER_TASKS_LIMIT_EXCEEDED, `同步任务上限 ${MAX_TASKS} 条`);
  }
  validateCron(input.cron);
  assertSafeOutboundUrl(input.url);
  const task: Task = {
    id: crypto.randomUUID(),
    name: input.name,
    url: input.url,
    cover: input.cover,
    moduleId: input.moduleId ?? null,
    cron: input.cron,
    enabled: true,
    lastRunAt: null,
    lastResult: null,
  };
  tasks.push(task);
  await writeTasks(projectId, tasks);
  await syncRepeatable(task, projectId);
  return task;
}

export async function updateTask(projectId: string, id: string, input: TaskSave & { enabled?: boolean }): Promise<void> {
  const tasks = await readTasks(projectId);
  const idx = tasks.findIndex((t) => t.id === id);
  if (idx < 0) throw new DomainError(ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND, "同步任务不存在");
  validateCron(input.cron);
  assertSafeOutboundUrl(input.url);
  tasks[idx] = {
    ...tasks[idx]!,
    name: input.name,
    url: input.url,
    cover: input.cover,
    moduleId: input.moduleId ?? null,
    cron: input.cron,
    enabled: input.enabled ?? tasks[idx]!.enabled,
  };
  await writeTasks(projectId, tasks);
  await syncRepeatable(tasks[idx]!, projectId);
}

export async function deleteTask(projectId: string, id: string): Promise<void> {
  const tasks = await readTasks(projectId);
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new DomainError(ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND, "同步任务不存在");
  const queue = scheduleQueue();
  await queue.removeRepeatable("swagger-sync", { pattern: task.cron, jobId: `swsync-${task.id}` }).catch(() => undefined);
  await writeTasks(projectId, tasks.filter((t) => t.id !== id));
  runHistory.delete(id);
}

/** 同步执行（手动「立即同步」与定时同路径；API-011 §2）。userId：手动=操作者；定时="system"（createdBy 非 FK）。 */
export async function runSync(projectId: string, taskId: string, userId = "system"): Promise<SyncResult> {
  const tasks = await readTasks(projectId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new DomainError(ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND, "同步任务不存在");
  const started = Date.now();
  let result: SyncResult;
  try {
    assertSafeOutboundUrl(task.url);
    const moduleId = task.moduleId ?? (await ensureApiModule(prisma, projectId));
    const res = await fetch(task.url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new DomainError(ErrCode.SWAGGER_FETCH_FAILED, `文档拉取失败 HTTP ${res.status}`);
    const raw = await res.text();
    if (!looksLikeOpenApi3(raw)) {
      throw new DomainError(ErrCode.SWAGGER_PARSE_FAILED, "文档不是 OpenAPI/Swagger 3.0（缺少 openapi: 3 标识）");
    }
    const report = await importApis(projectId, userId, {
      format: "openapi3",
      source: { content: raw },
      overwrite: task.cover,
      moduleId,
    });
    result = {
      added: report.created.length,
      updated: report.overwritten.length,
      skipped: report.skipped.length,
      failed: report.failed.slice(0, 50).map((f) => ({ path: `line ${f.line}`, reason: f.message })),
      ok: report.failed.length === 0,
      ms: Date.now() - started,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = {
      added: 0,
      updated: 0,
      skipped: 0,
      failed: [],
      ok: false,
      error: message.slice(0, 256),
      ms: Date.now() - started,
    };
  }
  const list = await readTasks(projectId);
  const idx = list.findIndex((t) => t.id === taskId);
  if (idx >= 0) {
    list[idx] = { ...list[idx]!, lastRunAt: new Date().toISOString(), lastResult: result };
    await writeTasks(projectId, list);
  }
  const hist = runHistory.get(taskId) ?? [];
  hist.unshift(result);
  runHistory.set(taskId, hist.slice(0, HISTORY_LIMIT));
  return result;
}

export async function taskHistory(projectId: string, taskId: string, page: number, pageSize: number) {
  const tasks = await readTasks(projectId);
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new DomainError(ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND, "同步任务不存在");
  const hist = runHistory.get(taskId) ?? [];
  const start = (page - 1) * pageSize;
  return { list: hist.slice(start, start + pageSize), total: hist.length, page, pageSize };
}

/** 内容嗅探（json/yaml 皆可；须含 openapi:"3 或 '3 标识） */
function looksLikeOpenApi3(raw: string): boolean {
  return /["']?openapi["']?\s*:\s*["']?3/.test(raw.slice(0, 4096));
}
