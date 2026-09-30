/**
 * S11 LOAD-003 性能测试域服务：施压计划 CRUD → 执行（BullMQ load 队列）→ 停止 →
 * 秒级度量（Redis Stream 回放/SSE 由路由层承载）→ 报告（回调汇总，Report.summary.metrics）。
 * 门控=路由层 assertEntpEnabled("LOAD_TEST")（先权限后门控，规格 §2）。
 */
import { randomUUID } from "node:crypto";
import { DomainError, ErrCode, config, loadQueueNameFor } from "@rabbit/shared";
import type {
  LoadCommand,
  LoadMetricFrame,
  LoadSummary,
  LoadTestCreate,
  LoadTestUpdate,
} from "@rabbit/shared";
import { loadMetricFrameSchema } from "@rabbit/shared";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { prisma } from "@rabbit/db";
import { redis } from "@/server/redis";
import { recordAudit } from "@/server/domains/system/audit.service";
import type { z } from "zod";
import type { loadTaskListQuerySchema } from "./load.schemas";

/** load 队列（web 侧入队端；engine 消费同键位）——与 execQueueFor 同构的懒加载池。 */
const loadQueues = new Map<string, Queue>();
export function loadQueueFor(poolId?: string | null): Queue {
  const name = loadQueueNameFor(poolId);
  let q = loadQueues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: new Redis(config.redisUrl, { maxRetriesPerRequest: null }),
    });
    loadQueues.set(name, q);
  }
  return q;
}

type LoadTestRow = {
  id: string;
  projectId: string;
  name: string;
  status: string;
  target: unknown;
  pressure: unknown;
  thresholds: unknown;
  envId: string | null;
  createdBy: string;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function serialize(t: LoadTestRow) {
  return {
    id: t.id,
    projectId: t.projectId,
    name: t.name,
    status: t.status,
    target: t.target,
    pressure: t.pressure,
    thresholds: t.thresholds,
    envId: t.envId,
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** ───────────── CRUD ───────────── */

export async function listLoadTests(
  projectId: string,
  query: { page: number; pageSize: number; name?: string },
) {
  const where = {
    projectId,
    deletedAt: null,
    ...(query.name ? { name: { contains: query.name } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.loadTest.count({ where }),
    prisma.loadTest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  // 最近任务状态（列表展示：每计划查最近一次 load 任务）
  const ids = rows.map((r) => r.id);
  const lastTasks = ids.length
    ? await prisma.execTask.findMany({
        where: { projectId, type: "load", refId: { in: ids } },
        orderBy: { createdAt: "desc" },
        distinct: ["refId"],
        select: { refId: true, status: true, id: true },
      })
    : [];
  const lastByRef = new Map(lastTasks.map((t) => [t.refId, t]));
  return {
    list: rows.map((r) => {
      const lt = lastByRef.get(r.id);
      return {
        ...serialize(r as LoadTestRow),
        lastTask: lt ? { taskId: lt.id, status: lt.status } : null,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getLoadTest(projectId: string, id: string) {
  const row = await prisma.loadTest.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!row) throw new DomainError(ErrCode.LOAD_TEST_NOT_FOUND, "施压计划不存在");
  return serialize(row as LoadTestRow);
}

export async function createLoadTest(projectId: string, userId: string, input: LoadTestCreate) {
  const row = await prisma.loadTest.create({
    data: {
      projectId,
      name: input.name,
      target: input.target as object,
      pressure: input.pressure as object,
      thresholds: input.thresholds as object,
      envId: input.envId ?? null,
      createdBy: userId,
    },
  });
  recordAudit({
    userId,
    scope: "project",
    projectId,
    action: "load-test.create",
    objectType: "load_test",
    objectId: row.id,
    detail: { name: input.name },
  });
  return serialize(row as unknown as LoadTestRow);
}

export async function updateLoadTest(projectId: string, id: string, input: LoadTestUpdate) {
  const existing = await prisma.loadTest.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.LOAD_TEST_NOT_FOUND, "施压计划不存在");
  const row = await prisma.loadTest.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.target !== undefined ? { target: input.target as object } : {}),
      ...(input.pressure !== undefined ? { pressure: input.pressure as object } : {}),
      ...(input.thresholds !== undefined ? { thresholds: input.thresholds as object } : {}),
      ...(input.envId !== undefined ? { envId: input.envId } : {}),
    },
  });
  return serialize(row as unknown as LoadTestRow);
}

export async function deleteLoadTest(projectId: string, id: string) {
  const existing = await prisma.loadTest.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.LOAD_TEST_NOT_FOUND, "施压计划不存在");
  await prisma.loadTest.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/** ───────────── 执行 / 停止 ───────────── */

export async function runLoadTest(projectId: string, id: string, userId: string) {
  const lt = await prisma.loadTest.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!lt) throw new DomainError(ErrCode.LOAD_TEST_NOT_FOUND, "施压计划不存在");
  // 并发互斥（规格 §2：同项目同时仅一个 RUNNING 施压任务）
  const running = await prisma.execTask.findFirst({
    where: { projectId, type: "load", status: { in: ["PENDING", "RUNNING"] } },
    select: { id: true },
  });
  if (running) throw new DomainError(ErrCode.LOAD_TEST_RUNNING, "项目内已有运行中的施压任务");
  const task = await prisma.execTask.create({
    data: {
      projectId,
      type: "load",
      refType: "load_test",
      refId: lt.id,
      status: "PENDING",
      poolId: config.defaultPoolId,
      payload: { loadTestId: lt.id },
      createdBy: userId,
    },
    select: { id: true },
  });
  const command: LoadCommand = {
    taskId: task.id,
    projectId,
    loadTestId: lt.id,
    name: lt.name,
    target: lt.target as LoadCommand["target"],
    pressure: lt.pressure as LoadCommand["pressure"],
    thresholds: lt.thresholds as LoadCommand["thresholds"],
  };
  await loadQueueFor(config.defaultPoolId).add("load", command, {
    jobId: task.id,
    attempts: 1, // 施压任务不重试（幂等语义=手动重跑）
  });
  return { taskId: task.id };
}

export async function stopLoadTask(projectId: string, taskId: string, userId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId, type: "load" },
    select: { id: true, status: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  if (task.status !== "RUNNING" && task.status !== "PENDING") {
    throw new DomainError(ErrCode.LOAD_TASK_NOT_RUNNABLE, "任务不在运行中，无法停止");
  }
  await redis().set(config.loadStopKey(taskId), "1", "EX", 3600);
  recordAudit({
    userId,
    scope: "project",
    projectId,
    action: "load-task.stop",
    objectType: "exec_task",
    objectId: taskId,
    detail: {},
  });
  return { taskId };
}

/** ───────────── 任务与度量 ───────────── */

export async function listLoadTasks(
  projectId: string,
  query: z.infer<typeof loadTaskListQuerySchema>,
) {
  const where = {
    projectId,
    type: "load",
    ...(query.loadTestId ? { refId: query.loadTestId } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.execTask.count({ where }),
    prisma.execTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        refId: true,
        status: true,
        message: true,
        durationMs: true,
        createdAt: true,
        createdBy: true,
      },
    }),
  ]);
  return {
    list: rows.map((t) => ({
      taskId: t.id,
      loadTestId: t.refId,
      status: t.status,
      message: t.message,
      durationMs: t.durationMs,
      createdAt: t.createdAt.toISOString(),
      createdBy: t.createdBy,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** 秒级度量时间线（Stream XRANGE 回放；终态任务 Stream TTL 内可读，过期回落 Report.summary）。 */
export async function loadTaskMetrics(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId, type: "load" },
    select: { id: true, status: true, refId: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const raw = await redis().xrange(config.loadStreamKey(taskId), "-", "+");
  const frames: LoadMetricFrame[] = [];
  for (const [, fields] of raw) {
    const json = fields[fields.indexOf("data") + 1];
    if (!json) continue;
    try {
      frames.push(loadMetricFrameSchema.parse(JSON.parse(json as string)));
    } catch {
      // 跳过坏帧（与 exec readStream 同口径）
    }
  }
  if (frames.length > 0) return { taskId, status: task.status, frames };
  // 回落：报告已落库（终态且 Stream 过期/任务停止后回调汇总）
  const report = await prisma.report.findFirst({
    where: { taskId, reportType: "load" },
    select: { summary: true },
  });
  const metrics = report?.summary
    ? ((JSON.parse(report.summary) as { metrics?: { frames?: unknown[] } }).metrics?.frames ?? [])
    : [];
  return { taskId, status: task.status, frames: metrics as LoadMetricFrame[] };
}

/** 报告详情（type=load 报告=summary.metrics 全量时间线+结论）。 */
export async function loadReportDetail(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId, type: "load" },
    select: { id: true, status: true, refId: true, createdAt: true, durationMs: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const report = await prisma.report.findFirst({
    where: { taskId, reportType: "load" },
    select: { id: true, name: true, summary: true, createdAt: true },
  });
  if (!report) throw new DomainError(ErrCode.REPORT_NOT_FOUND, "报告不存在（任务未完成或已清理）");
  const parsed = report.summary ? (JSON.parse(report.summary) as Record<string, unknown>) : {};
  return {
    reportId: report.id,
    taskId: task.id,
    loadTestId: task.refId,
    name: report.name,
    status: task.status,
    durationMs: task.durationMs,
    createdAt: report.createdAt.toISOString(),
    summary: parsed.summary ?? null,
    frames: (parsed.metrics as { frames?: unknown[] })?.frames ?? [],
  };
}

/** 回调汇总：引擎回调（type=load）→ 写 Report(summary.metrics)（exec.service.ts load 分支调用）。 */
export async function summarizeLoadReport(
  taskId: string,
  summary: LoadSummary,
  frames: LoadMetricFrame[],
): Promise<void> {
  await prisma.report.updateMany({
    where: { taskId, reportType: "load" },
    data: {
      summary: JSON.stringify({ summary, metrics: { frames } }),
    },
  });
}

/** exec 回调 load 分支的任务级终态兜底（引擎失联/命令丢弃时任务回收用——由任务超时扫表调用，S11 新增）。 */
export function newLoadTaskId(): string {
  return randomUUID();
}
