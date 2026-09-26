import { DomainError, ErrCode, config } from "@rabbit/shared";
import type { AssertSpec, DebugRequest, EventFrame, ExecCallback } from "@rabbit/shared";
import { eventFrameSchema } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { execQueue, redis } from "@/server/redis";

/** EXEC 编排：创建任务 → 入队；回调终态 → 事件流落库 + 报告生成。 */

export async function createDebugTask(
  projectId: string,
  userId: string,
  request: DebugRequest,
  asserts: AssertSpec[],
  clientTaskId?: string,
) {
  const task = await prisma.execTask.create({
    data: {
      projectId,
      type: "api_debug",
      status: "PENDING",
      clientTaskId: clientTaskId ?? null,
      poolId: config.defaultPoolId,
      payload: { request, asserts },
      createdBy: userId,
    },
    select: { id: true, clientTaskId: true },
  });
  await execQueue().add(
    "exec",
    {
      taskId: task.id,
      projectId,
      type: "api_debug",
      request,
      asserts,
    },
    { jobId: task.id, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  return { taskId: task.id };
}

/** 回调（engine → web）：终态幂等 + 全事件流持久化 + Report 生成。 */
export async function handleCallback(taskId: string, cb: ExecCallback) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId },
    select: { id: true, status: true, projectId: true, type: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在");
  if (task.status === "SUCCESS" || task.status === "FAILED") {
    return { idempotent: true }; // 终态幂等（rules/engine §2.1）
  }
  // 读取事件流（与 SSE 同源）
  const frames = await readStream(taskId);
  const stepResult = frames.find((f) => f.type === "step-result");
  const startedAt = frames[0];
  const final = frames.find(
    (f): f is Extract<EventFrame, { type: "task-final" }> => f.type === "task-final",
  );
  const durationMs = startedAt && final ? final.ts - startedAt.ts : null;

  await prisma.$transaction(async (tx) => {
    await tx.execTask.update({
      where: { id: taskId },
      data: {
        status: cb.outcome === "success" ? "SUCCESS" : "FAILED",
        failureKind: cb.failureKind ?? null,
        message: cb.message || null,
        startedAt: startedAt ? new Date(startedAt.ts) : null,
        finishedAt: new Date(),
        durationMs,
      },
    });
    const item = await tx.execItem.create({
      data: {
        taskId,
        refType: "api_debug",
        refId: "",
        status: cb.outcome === "success" ? "SUCCESS" : "FAILED",
      },
    });
    if (frames.length > 0) {
      await tx.execStepResult.createMany({
        data: frames.map((f, i) => ({ itemId: item.id, seq: i + 1, frame: f as object })),
      });
    }
    await tx.report.create({
      data: {
        taskId,
        projectId: task.projectId,
        reportType: "api_case",
        name:
          stepResult?.type === "step-result"
            ? `${stepResult.requestSnapshot.method} ${shortUrl(stepResult.requestSnapshot.url)}`
            : `任务 ${taskId.slice(0, 8)}`,
        createdBy: task.id,
      },
    });
  });
  return { idempotent: false, frames: frames.length };
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url.slice(0, 64);
  }
}

async function readStream(taskId: string): Promise<EventFrame[]> {
  const raw = await redis().xrange(config.execStreamKey(taskId), "-", "+");
  const frames: EventFrame[] = [];
  for (const [, fields] of raw) {
    const json = fields[fields.indexOf("data") + 1];
    if (!json) continue;
    try {
      frames.push(eventFrameSchema.parse(JSON.parse(json as string)));
    } catch {
      // 跳过坏帧
    }
  }
  return frames;
}

/** 报告详情：事件视图聚合（RPT-001 §4）。 */
export async function reportDetail(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: {
      id: true,
      status: true,
      type: true,
      failureKind: true,
      message: true,
      durationMs: true,
      createdAt: true,
      payload: true,
    },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在");
  const item = await prisma.execItem.findFirst({
    where: { taskId },
    select: { id: true },
  });
  const frames = item
    ? (
        await prisma.execStepResult.findMany({
          where: { itemId: item.id },
          orderBy: { seq: "asc" },
          select: { frame: true },
        })
      ).map((r) => r.frame as unknown as EventFrame)
    : await readStream(taskId);
  const stepResult = frames.find(
    (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
  );
  const payload = task.payload as { request?: DebugRequest; asserts?: AssertSpec[] };
  return {
    taskId: task.id,
    status: task.status,
    type: task.type,
    failureKind: task.failureKind ?? undefined,
    message: task.message ?? undefined,
    durationMs: task.durationMs ?? undefined,
    createdAt: task.createdAt.toISOString(),
    request: payload.request
      ? {
          method: payload.request.method,
          url: payload.request.url,
          headers: payload.request.headers,
          body: payload.request.body.content,
        }
      : undefined,
    response: stepResult
      ? {
          status: stepResult.responseSummary.status,
          durationMs: stepResult.durationMs,
          headers: stepResult.responseSummary.headers.slice(0, 20),
          bodyText: stepResult.responseSummary.bodyText,
          truncated: stepResult.responseSummary.truncated,
        }
      : undefined,
    asserts: stepResult?.asserts ?? [],
    logs: frames
      .filter((f): f is Extract<EventFrame, { type: "log" }> => f.type === "log")
      .map((f) => ({ ts: f.ts, level: f.level, message: f.message })),
  };
}

/** 调试历史。 */
export async function debugHistory(projectId: string, pageSize = 20) {
  const [total, tasks] = await Promise.all([
    prisma.execTask.count({ where: { projectId, type: "api_debug" } }),
    prisma.execTask.findMany({
      where: { projectId, type: "api_debug" },
      orderBy: { createdAt: "desc" },
      take: pageSize,
      select: { id: true, status: true, payload: true, createdAt: true },
    }),
  ]);
  return {
    total,
    items: tasks.map((t) => {
      const p = t.payload as { request?: { method: string; url: string } };
      return {
        id: t.id,
        status: t.status,
        method: p.request?.method ?? "GET",
        url: p.request?.url ?? "",
        createdAt: t.createdAt.toISOString(),
      };
    }),
  };
}
