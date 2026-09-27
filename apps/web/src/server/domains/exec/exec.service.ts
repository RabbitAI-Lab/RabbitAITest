/** EXEC 编排 v2（API-003/EXEC-002/SYS-006/RPT-002）：任务创建（api_debug/api_case）→ 入队；
 * 回调终态 → 事件流按 item 分组落库 + 报告聚合；停止/重跑；任务与报告列表；分享。 */
import { randomUUID, randomBytes } from "node:crypto";
import { DomainError, ErrCode, config } from "@rabbit/shared";
import type {
  AssertSpec,
  EnvSnapshot,
  EventFrame,
  ExecCallback,
  ExecItemCommand,
  Processor,
  Extractor,
  RequestSpec,
} from "@rabbit/shared/execution";
import { eventFrameSchema, execCommandSchema } from "@rabbit/shared";
import { execTaskListQuerySchema, reportListQuerySchema } from "@rabbit/shared";
import type { z } from "zod";
import { prisma } from "@rabbit/db";
import { execQueue, redis } from "@/server/redis";
import { buildEnvSnapshot } from "@/server/domains/project/environment.service";

/** ───────────── 任务创建 ───────────── */

export interface DebugTaskInput {
  request: RequestSpec;
  asserts: AssertSpec[];
  pre: Processor[];
  post: Processor[];
  extracts: Extractor[];
  envId?: string;
  clientTaskId?: string;
}

export async function createDebugTask(projectId: string, userId: string, input: DebugTaskInput) {
  // clientTaskId 幂等（API-003 §2 连点防重）：同键复用既有任务，不新建——
  // 与 (project_id, client_task_id) 唯一索引同语义（同键=同一任务，不论终态）；
  // 查询与插入间的真并发由 P2002 兜底回查。
  if (input.clientTaskId) {
    const existing = await prisma.execTask.findFirst({
      where: { projectId, clientTaskId: input.clientTaskId },
      select: { id: true },
    });
    if (existing) return { taskId: existing.id };
  }
  const envSnapshot = await buildEnvSnapshot(projectId, input.envId);
  let task: { id: string };
  try {
    task = await prisma.execTask.create({
      data: {
        projectId,
        type: "api_debug",
        status: "PENDING",
        clientTaskId: input.clientTaskId ?? null,
        poolId: config.defaultPoolId,
        envId: input.envId ?? null,
        payload: {
          request: input.request,
          asserts: input.asserts,
          pre: input.pre,
          post: input.post,
          extracts: input.extracts,
        },
        createdBy: userId,
      },
      select: { id: true },
    });
  } catch (err) {
    // 真并发竞态：查询-插入窗口内同键先落库 → 唯一索引 P2002，回查复用（幂等兜底）
    if (
      input.clientTaskId &&
      err instanceof Error &&
      (err as { code?: string }).code === "P2002"
    ) {
      const winner = await prisma.execTask.findFirst({
        where: { projectId, clientTaskId: input.clientTaskId },
        select: { id: true },
      });
      if (winner) return { taskId: winner.id };
    }
    throw err;
  }
  await execQueue().add(
    "exec",
    {
      taskId: task.id,
      projectId,
      type: "api_debug",
      request: input.request,
      asserts: input.asserts,
      pre: input.pre,
      post: input.post,
      extracts: input.extracts,
      ...(envSnapshot ? { envSnapshot } : {}),
    },
    { jobId: task.id, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  return { taskId: task.id };
}

export interface ApiCaseTaskInput {
  caseIds: string[];
  envId?: string;
  stopOnFail: boolean;
  clientTaskId?: string;
}

/** api_case 批量任务：预建 ExecItem（id 即 engine 侧 itemId）→ 入队（API-003 §2）。 */
export async function createApiCaseTask(projectId: string, userId: string, input: ApiCaseTaskInput) {
  const cases = await prisma.apiCase.findMany({
    where: { id: { in: input.caseIds }, projectId, deletedAt: null },
    include: { api: { select: { id: true, moduleId: true, method: true, path: true, num: true } } },
  });
  if (cases.length === 0)
    throw new DomainError(ErrCode.API_CASE_NOT_FOUND, "接口用例不存在或已删除");
  const found = new Set(cases.map((c) => c.id));
  const missing = input.caseIds.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError(ErrCode.API_CASE_NOT_FOUND, `部分用例不存在：${missing.length} 条`);
  // 保持调用方顺序
  const ordered = input.caseIds
    .map((id) => cases.find((c) => c.id === id))
    .filter((c): c is (typeof cases)[number] => Boolean(c));

  const envSnapshot = await buildEnvSnapshot(projectId, input.envId);
  const items: ExecItemCommand[] = [];
  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "api_case",
        status: "PENDING",
        clientTaskId: input.clientTaskId ?? null,
        poolId: config.defaultPoolId,
        envId: input.envId ?? null,
        payload: {
          stopOnFail: input.stopOnFail,
          caseIds: ordered.map((c) => c.id),
          items: ordered.map((c) => ({
            caseId: c.id,
            name: c.name,
            bundle: c.request,
          })),
        },
        createdBy: userId,
      },
      select: { id: true },
    });
    for (const c of ordered) {
      const bundle = c.request as { spec: RequestSpec; asserts?: AssertSpec[]; pre?: Processor[]; post?: Processor[]; extracts?: Extractor[] };
      const item = await tx.execItem.create({
        data: { taskId: task.id, refType: "api_case", refId: c.id, status: "PENDING" },
        select: { id: true },
      });
      items.push({
        itemId: item.id,
        caseId: c.id,
        name: c.name,
        moduleId: c.api.moduleId,
        request: bundle.spec,
        asserts: bundle.asserts ?? [],
        pre: bundle.pre ?? [],
        post: bundle.post ?? [],
        extracts: bundle.extracts ?? [],
      });
    }
    return task;
  });

  await execQueue().add(
    "exec",
    {
      taskId: created.id,
      projectId,
      type: "api_case",
      stopOnFail: input.stopOnFail,
      items,
      ...(envSnapshot ? { envSnapshot } : {}),
    },
    { jobId: created.id, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  return { taskId: created.id };
}

/** ───────────── 回调（engine → web）：终态幂等 + item 分组落库 + 报告聚合 ───────────── */

export async function handleCallback(taskId: string, cb: ExecCallback) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId },
    select: { id: true, status: true, projectId: true, type: true, payload: true, envId: true, createdBy: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在");
  if (task.status === "SUCCESS" || task.status === "FAILED" || task.status === "STOPPED") {
    return { idempotent: true }; // 终态幂等（rules/engine §2.1）
  }
  const frames = await readStream(taskId);
  const startedAt = frames[0];
  const final = frames.find(
    (f): f is Extract<EventFrame, { type: "task-final" }> => f.type === "task-final",
  );
  const durationMs = startedAt && final ? final.ts - startedAt.ts : null;

  // env 提取写回（API-004 §2：last-write-wins，报告与日志已留痕）
  if (cb.varUpdates.length > 0 && task.envId) {
    await applyVarUpdates(task.envId, cb.varUpdates);
  }

  await prisma.$transaction(async (tx) => {
    await tx.execTask.update({
      where: { id: taskId },
      data: {
        status: cb.outcome === "success" ? "SUCCESS" : cb.outcome === "stopped" ? "STOPPED" : "FAILED",
        failureKind: cb.failureKind ?? null,
        message: cb.message || null,
        startedAt: startedAt ? new Date(startedAt.ts) : null,
        finishedAt: new Date(),
        durationMs,
      },
    });
    const existingItems = await tx.execItem.findMany({
      where: { taskId },
      select: { id: true },
    });
    if (existingItems.length > 0) {
      // api_case：item 预建，帧按 itemId 分组落库 + item 状态聚合
      for (const item of existingItems) {
        const itemFrames = frames.filter((f) => "itemId" in f && f.itemId === item.id);
        const itemFinal = itemFrames.find(
          (f): f is Extract<EventFrame, { type: "item-final" }> => f.type === "item-final",
        );
        await tx.execItem.update({
          where: { id: item.id },
          data: {
            status: itemFinal?.status ?? "FAILED",
            result: (itemFinal
              ? { status: itemFinal.status, message: itemFinal.message }
              : { status: "FAILED", message: "缺少 item 终态帧" }) as object,
            startedAt: startedAt ? new Date(startedAt.ts) : null,
            finishedAt: new Date(),
          },
        });
        if (itemFrames.length > 0) {
          await tx.execStepResult.createMany({
            data: itemFrames.map((f, i) => ({ itemId: item.id, seq: i + 1, frame: f as object })),
          });
        }
      }
    } else {
      // api_debug（S0 兼容）：单 item 落库
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
    }
    // 报告聚合
    const items = await tx.execItem.findMany({ where: { taskId }, select: { status: true } });
    const passed = items.filter((i) => i.status === "SUCCESS").length;
    const failed = items.filter((i) => i.status === "FAILED").length;
    const stepResult = frames.find(
      (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
    );
    const existing = await tx.report.findFirst({ where: { taskId }, select: { id: true } });
    const name =
      task.type === "api_case"
        ? `批量执行 · ${items.length} 条用例`
        : stepResult
          ? `${stepResult.requestSnapshot.method} ${shortUrl(stepResult.requestSnapshot.url)}`
          : `任务 ${taskId.slice(0, 8)}`;
    const summary = JSON.stringify({ total: items.length, passed, failed, durationMs });
    if (existing) {
      await tx.report.update({ where: { id: existing.id }, data: { summary } });
    } else {
      await tx.report.create({
        data: {
          taskId,
          projectId: task.projectId,
          reportType: task.type,
          name,
          summary,
          createdBy: task.createdBy,
        },
      });
    }
  });
  return { idempotent: false, frames: frames.length };
}

async function applyVarUpdates(envId: string, updates: { name: string; value: string }[]) {
  const env = await prisma.environment.findUnique({ where: { id: envId } });
  if (!env) return;
  const cfg = (env.config ?? {}) as {
    vars?: { key: string; value: string; enabled?: boolean }[];
  };
  const vars = [...(cfg.vars ?? [])];
  for (const u of updates) {
    const hit = vars.find((v) => v.key === u.name);
    if (hit) hit.value = u.value;
    else vars.push({ key: u.name, value: u.value, enabled: true });
  }
  cfg.vars = vars;
  await prisma.environment.update({
    where: { id: envId },
    data: { config: cfg as object },
  });
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
      // 跳过坏帧（S0 语义保留）
    }
  }
  return frames;
}

/** ───────────── 停止 / 重跑（EXEC-002） ───────────── */

export async function stopTask(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: { id: true, status: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  if (task.status !== "RUNNING" && task.status !== "PENDING")
    throw new DomainError(ErrCode.TASK_NOT_RUNNING, "任务不在运行中，无法停止");
  await redis().set(config.execStopKey(taskId), "1", "EX", 3600);
  return { taskId };
}

/** 失败重跑 = 复制原任务定义重建新任务（engine-execution-architecture §2，不续写旧任务）。 */
export async function rerunTask(projectId: string, userId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: { id: true, type: true, status: true, payload: true, envId: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  if (task.status !== "FAILED" && task.status !== "STOPPED")
    throw new DomainError(ErrCode.TASK_NOT_RERUNNABLE, "仅失败/已停止任务可重跑");
  const payload = task.payload as {
    request?: RequestSpec;
    asserts?: AssertSpec[];
    pre?: Processor[];
    post?: Processor[];
    extracts?: Extractor[];
    caseIds?: string[];
    stopOnFail?: boolean;
  };
  const rerunOf = task.id;
  if (task.type === "api_debug" && payload.request) {
    const r = await createDebugTask(projectId, userId, {
      request: payload.request,
      asserts: (payload.asserts ?? []) as AssertSpec[],
      pre: (payload.pre ?? []) as Processor[],
      post: (payload.post ?? []) as Processor[],
      extracts: (payload.extracts ?? []) as Extractor[],
      envId: task.envId ?? undefined,
    });
    await prisma.execTask
      .update({
        where: { id: r.taskId },
        data: { payload: { ...(task.payload as object), rerunOf } as object },
      })
      .catch(() => {});
    return r;
  }
  if (task.type === "api_case" && payload.caseIds) {
    const r = await createApiCaseTask(projectId, userId, {
      caseIds: payload.caseIds,
      envId: task.envId ?? undefined,
      stopOnFail: payload.stopOnFail ?? false,
    });
    await prisma.execTask
      .update({
        where: { id: r.taskId },
        data: { payload: { ...(task.payload as object), rerunOf } as object },
      })
      .catch(() => {});
    return r;
  }
  throw new DomainError(ErrCode.TASK_NOT_RERUNNABLE, "任务载荷缺失，无法重跑");
}

/** ───────────── 任务列表（SYS-006） ───────────── */

export async function listExecTasks(
  projectId: string | undefined,
  visibleProjectIds: string[],
  query: z.infer<typeof execTaskListQuerySchema>,
) {
  const where = {
    // type=plan 为计划报告占位任务（plan.service 懒创建），不进任务中心
    type: { not: "plan" },
    ...(projectId ? { projectId } : { projectId: { in: visibleProjectIds } }),
    ...(query.type ? { type: query.type } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.creator ? { createdBy: query.creator } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: new Date(query.from) } : {}),
            ...(query.to ? { lte: new Date(query.to) } : {}),
          },
        }
      : {}),
  };
  const [total, tasks] = await Promise.all([
    prisma.execTask.count({ where }),
    prisma.execTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { items: { select: { status: true } } },
    }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(tasks.map((t) => t.createdBy))] } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return {
    total,
    items: tasks.map((t) => {
      const p = t.payload as { rerunOf?: string };
      const passed = t.items.filter((i) => i.status === "SUCCESS").length;
      const running = t.status === "PENDING" || t.status === "RUNNING";
      return {
        id: t.id,
        type: t.type,
        status: t.status,
        stuck: running && t.updatedAt.getTime() < Date.now() - 10 * 60 * 1000,
        total: t.items.length,
        passed,
        creator: userName.get(t.createdBy) ?? t.createdBy.slice(0, 8),
        createdAt: t.createdAt.toISOString(),
        finishedAt: t.finishedAt?.toISOString() ?? null,
        durationMs: t.durationMs,
        rerunOf: p.rerunOf ?? null,
      };
    }),
  };
}

/** ───────────── 报告（RPT-002） ───────────── */

export async function listReports(projectId: string, query: z.infer<typeof reportListQuerySchema>) {
  const where = {
    projectId,
    ...(query.reportType ? { reportType: query.reportType } : {}),
    ...(query.keyword ? { name: { contains: query.keyword } } : {}),
  };
  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { task: { select: { status: true, createdBy: true } } },
    }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(reports.map((r) => r.task.createdBy))] } },
    select: { id: true, name: true },
  });
  const userName = new Map(users.map((u) => [u.id, u.name]));
  return {
    total,
    items: reports.map((r) => ({
      taskId: r.taskId,
      name: r.name,
      reportType: r.reportType,
      taskStatus: r.task.status,
      summary: parseSummary(r.summary),
      creator: userName.get(r.task.createdBy) ?? r.task.createdBy.slice(0, 8),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/** 报告详情（事件视图聚合，RPT-001 §4 + RPT-002 item 扩展）。 */
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
      reports: { select: { name: true, summary: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const items = await prisma.execItem.findMany({
    where: { taskId },
    orderBy: { id: "asc" }, // 建立顺序=调用方顺序（ExecItem 无 createdAt 列）
    select: { id: true, refType: true, refId: true, status: true, result: true },
  });
  const stepFrames = items.length
    ? (
        await prisma.execStepResult.findMany({
          where: { itemId: { in: items.map((i) => i.id) } },
          orderBy: { seq: "asc" },
          select: { itemId: true, frame: true },
        })
      ).map((r) => ({ itemId: r.itemId, frame: r.frame as unknown as EventFrame }))
    : (await readStream(taskId)).map((f) => ({ itemId: items[0]?.id ?? "", frame: f }));

  // item 汇总（api_case；按任务载荷顺序呈现——ExecItem 无排序列，uuid 序不稳定）
  const payloadOrder = ((task.payload as { items?: { caseId: string; name: string }[] })?.items ?? []).map(
    (i) => i.caseId,
  );
  const orderedItems = [...items].sort(
    (a, b) => (payloadOrder.indexOf(a.refId) + 1 || 99) - (payloadOrder.indexOf(b.refId) + 1 || 99),
  );
  const itemViews = orderedItems.map((item) => {
    const frames = stepFrames.filter((s) => s.itemId === item.id).map((s) => s.frame);
    const stepResult = frames.find(
      (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
    );
    return {
      itemId: item.id,
      refType: item.refType,
      refId: item.refId,
      status: item.status,
      durationMs: stepResult?.durationMs ?? null,
      assertTotal: stepResult?.asserts.length ?? 0,
      assertPassed: stepResult ? stepResult.asserts.filter((a) => a.passed).length : 0,
      name: itemName(item, frames),
    };
  });

  // 单请求视图（api_debug 兼容 / 钻取数据）
  const firstStep = stepFrames.find((s) => s.frame.type === "step-result")?.frame as
    | Extract<EventFrame, { type: "step-result" }>
    | undefined;
  const payload = task.payload as {
    request?: RequestSpec;
    asserts?: AssertSpec[];
  };
  return {
    taskId: task.id,
    name: task.reports[0]?.name ?? `任务 ${taskId.slice(0, 8)}`,
    status: task.status,
    type: task.type,
    failureKind: task.failureKind ?? undefined,
    message: task.message ?? undefined,
    durationMs: task.durationMs ?? undefined,
    createdAt: task.createdAt.toISOString(),
    summary: parseSummary(task.reports[0]?.summary),
    items: itemViews,
    request: payload.request
      ? {
          method: payload.request.method,
          url: payload.request.url,
          headers: payload.request.headers,
          body:
            "content" in payload.request.body ? payload.request.body.content : "(非文本请求体)",
        }
      : undefined,
    response: firstStep
      ? {
          status: firstStep.responseSummary.status,
          durationMs: firstStep.durationMs,
          headers: firstStep.responseSummary.headers.slice(0, 20),
          bodyText: firstStep.responseSummary.bodyText,
          truncated: firstStep.responseSummary.truncated,
        }
      : undefined,
    asserts: firstStep?.asserts ?? [],
    logs: stepFrames
      .filter((s) => s.frame.type === "log")
      .map((s) => {
        const f = s.frame as Extract<EventFrame, { type: "log" }>;
        return { ts: f.ts, level: f.level, message: f.message };
      }),
  };
}

function parseSummary(raw: string | null | undefined): { total?: number; passed?: number; failed?: number } | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

function itemName(
  item: { refType: string; refId: string; result: unknown },
  frames: EventFrame[],
): string {
  const itemStart = frames.find(
    (f): f is Extract<EventFrame, { type: "item-start" }> => f.type === "item-start",
  );
  if (itemStart) return itemStart.name;
  const r = item.result as { name?: string } | null;
  return r?.name ?? item.refType;
}

/** item 级帧钻取（RPT-002 §4）。 */
export async function itemFrames(projectId: string, taskId: string, itemId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: { id: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const item = await prisma.execItem.findFirst({ where: { id: itemId, taskId } });
  if (!item) throw new DomainError(ErrCode.TASK_NOT_FOUND, "执行条目不存在");
  const frames = await prisma.execStepResult.findMany({
    where: { itemId },
    orderBy: { seq: "asc" },
    select: { frame: true },
  });
  return frames.map((f) => f.frame as unknown as EventFrame);
}

/** 删除报告（级联清五表，RPT-002 §2 单口径）。 */
export async function deleteReport(projectId: string, taskId: string) {
  const report = await prisma.report.findFirst({
    where: { taskId, projectId },
    select: { id: true, taskId: true },
  });
  if (!report) throw new DomainError(ErrCode.REPORT_NOT_FOUND, "报告不存在或已删除");
  await prisma.$transaction(async (tx) => {
    await tx.reportShare.deleteMany({ where: { reportId: report.id } });
    await tx.report.deleteMany({ where: { id: report.id } });
    const items = await tx.execItem.findMany({ where: { taskId }, select: { id: true } });
    if (items.length > 0) {
      await tx.execStepResult.deleteMany({ where: { itemId: { in: items.map((i) => i.id) } } });
    }
    await tx.execItem.deleteMany({ where: { taskId } });
    await tx.execTask.deleteMany({ where: { id: taskId } });
  });
  return { taskId };
}

/** ───────────── 分享（RPT-002） ───────────── */

export async function createShare(
  projectId: string,
  taskId: string,
  expireHours: number,
) {
  const report = await prisma.report.findFirst({
    where: { taskId, projectId },
    select: { id: true },
  });
  if (!report) throw new DomainError(ErrCode.REPORT_NOT_FOUND, "报告不存在或已删除");
  const token = randomBytes(24).toString("base64url");
  const share = await prisma.reportShare.create({
    data: {
      reportId: report.id,
      token,
      expireAt: new Date(Date.now() + expireHours * 3600 * 1000),
    },
  });
  return { token: share.token, expireAt: share.expireAt.toISOString() };
}

export async function listShares(projectId: string, taskId: string) {
  const report = await prisma.report.findFirst({
    where: { taskId, projectId },
    select: { id: true },
  });
  if (!report) throw new DomainError(ErrCode.REPORT_NOT_FOUND, "报告不存在或已删除");
  const shares = await prisma.reportShare.findMany({
    where: { reportId: report.id },
    orderBy: { createdAt: "desc" },
  });
  return {
    items: shares.map((s) => ({
      token: s.token,
      expireAt: s.expireAt.toISOString(),
      expired: s.expireAt.getTime() < Date.now(),
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

export async function revokeShare(projectId: string, taskId: string, token: string) {
  const report = await prisma.report.findFirst({
    where: { taskId, projectId },
    select: { id: true },
  });
  if (!report) throw new DomainError(ErrCode.REPORT_NOT_FOUND, "报告不存在或已删除");
  await prisma.reportShare.deleteMany({ where: { reportId: report.id, token } });
  return { token };
}

/** 免登读（token 即凭证；过期/不存在统一 404 语义）。 */
export async function shareDetail(token: string) {
  const share = await prisma.reportShare.findUnique({
    where: { token },
    include: { report: { select: { taskId: true, projectId: true } } },
  });
  if (!share || share.expireAt.getTime() < Date.now())
    throw new DomainError(ErrCode.SHARE_NOT_FOUND, "分享链接不存在或已过期");
  const detail = await reportDetail(share.report.projectId, share.report.taskId);
  return { ...detail, shared: true, expireAt: share.expireAt.toISOString() };
}

/** ───────────── 调试历史（API-001 兼容） ───────────── */

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

/** 引擎入队载荷校验（内部：rerun/execute 前 contract 复核）。 */
export function parseCommand(data: unknown) {
  return execCommandSchema.parse(data);
}

export const newUuid = randomUUID;
