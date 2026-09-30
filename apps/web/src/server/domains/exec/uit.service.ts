/**
 * S11 UIT-002 UI 测试域服务：元素库 CRUD + UI 用例 CRUD（步骤 schema 校验）+
 * 执行（ui_case/ui_batch 入 exec 队列；元素引用预解析内联——engine 无 DB，同 API-006 ref 解析先例）+
 * 报告（复用 exec 事件流：step-op 帧逐步状态 + ui-screenshot 帧 fileId）。
 */
import { DomainError, ErrCode, config } from "@rabbit/shared";
import type {
  UiCaseCreate,
  UiCaseUpdate,
  UiElementCreate,
  UiElementUpdate,
  UiStep,
  UI_ELEMENT_OPS,
} from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import { execQueueFor } from "@/server/redis";
import { recordAudit } from "@/server/domains/system/audit.service";

type UiElementRow = {
  id: string;
  projectId: string;
  name: string;
  locatorType: string;
  locator: string;
  description: string | null;
  moduleId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function serializeElement(e: UiElementRow) {
  return {
    id: e.id,
    projectId: e.projectId,
    name: e.name,
    locatorType: e.locatorType,
    locator: e.locator,
    description: e.description,
    moduleId: e.moduleId,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

function serializeCase(c: {
  id: string;
  projectId: string;
  name: string;
  steps: unknown;
  timeoutMs: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    steps: c.steps,
    timeoutMs: c.timeoutMs,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** ───────────── 元素库 ───────────── */

export async function listUiElements(
  projectId: string,
  query: { page: number; pageSize: number; name?: string },
) {
  const where = {
    projectId,
    deletedAt: null,
    ...(query.name ? { name: { contains: query.name } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.uiElement.count({ where }),
    prisma.uiElement.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return {
    list: rows.map((r) => serializeElement(r as UiElementRow)),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function createUiElement(projectId: string, input: UiElementCreate) {
  const row = await prisma.uiElement.create({
    data: {
      projectId,
      name: input.name,
      locatorType: input.locatorType,
      locator: input.locator,
      description: input.description ?? "",
      moduleId: input.moduleId ?? null,
    },
  });
  return serializeElement(row as UiElementRow);
}

export async function updateUiElement(projectId: string, id: string, input: UiElementUpdate) {
  const existing = await prisma.uiElement.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.UI_ELEMENT_NOT_FOUND, "元素不存在");
  const row = await prisma.uiElement.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.locatorType !== undefined ? { locatorType: input.locatorType } : {}),
      ...(input.locator !== undefined ? { locator: input.locator } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.moduleId !== undefined ? { moduleId: input.moduleId } : {}),
    },
  });
  return serializeElement(row as UiElementRow);
}

/** 元素删除：悬空语义（规格 §4——不级联删用例；引用它的用例执行时 CONFIG_ERROR）。 */
export async function deleteUiElement(projectId: string, id: string) {
  const existing = await prisma.uiElement.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.UI_ELEMENT_NOT_FOUND, "元素不存在");
  await prisma.uiElement.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/** ───────────── UI 用例 ───────────── */

export async function listUiCases(
  projectId: string,
  query: { page: number; pageSize: number; name?: string },
) {
  const where = {
    projectId,
    deletedAt: null,
    ...(query.name ? { name: { contains: query.name } } : {}),
  };
  const [total, rows] = await prisma.$transaction([
    prisma.uiTestCase.count({ where }),
    prisma.uiTestCase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const lastTasks = ids.length
    ? await prisma.execTask.findMany({
        where: { projectId, type: { in: ["ui_case", "ui_batch"] }, refId: { in: ids } },
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
        ...serializeCase(r),
        stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
        lastTask: lt ? { taskId: lt.id, status: lt.status } : null,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export async function getUiCase(projectId: string, id: string) {
  const row = await prisma.uiTestCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!row) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  return serializeCase(row);
}

export async function createUiCase(projectId: string, userId: string, input: UiCaseCreate) {
  const row = await prisma.uiTestCase.create({
    data: {
      projectId,
      name: input.name,
      steps: input.steps as object[],
      timeoutMs: input.timeoutMs,
      createdBy: userId,
    },
  });
  recordAudit({
    userId,
    scope: "project",
    projectId,
    action: "ui-case.create",
    objectType: "ui_test_case",
    objectId: row.id,
    detail: { name: input.name, stepCount: input.steps.length },
  });
  return serializeCase(row);
}

export async function updateUiCase(projectId: string, id: string, input: UiCaseUpdate) {
  const existing = await prisma.uiTestCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  const row = await prisma.uiTestCase.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.steps !== undefined ? { steps: input.steps as object[] } : {}),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    },
  });
  return serializeCase(row);
}

export async function deleteUiCase(projectId: string, id: string) {
  const existing = await prisma.uiTestCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  await prisma.uiTestCase.update({ where: { id }, data: { deletedAt: new Date() } });
  return { id };
}

/** ───────────── 执行 ───────────── */

const ELEMENT_OPS: readonly string[] = [
  "click",
  "fill",
  "select",
  "assert-text",
  "assert-visible",
] satisfies (typeof UI_ELEMENT_OPS)[number][];

/**
 * 元素引用预解析（web 侧，engine 无 DB）：elementId → 内联 locator+elementName。
 * 悬空引用=CONFIG_ERROR（语义冻结：不拒绝保存、执行时报错——规格 §4）。
 */
export async function resolveUiSteps(projectId: string, steps: UiStep[]): Promise<UiStep[]> {
  const ids = [
    ...new Set(
      steps
        .filter((s) => ELEMENT_OPS.includes(s.op) && (s as { elementId?: string }).elementId)
        .map((s) => (s as { elementId: string }).elementId),
    ),
  ];
  const elements = ids.length
    ? await prisma.uiElement.findMany({
        where: { id: { in: ids }, projectId, deletedAt: null },
        select: { id: true, name: true, locatorType: true, locator: true },
      })
    : [];
  const byId = new Map(elements.map((e) => [e.id, e]));
  return steps.map((s) => {
    if (!ELEMENT_OPS.includes(s.op)) return s;
    const ref = s as UiStep & { elementId?: string };
    if (!ref.elementId) return s; // 内联 locator 直用
    const el = byId.get(ref.elementId);
    if (!el) {
      // 悬空引用：执行态 CONFIG_ERROR——以 locator 占位空值 + elementName 标注，engine 侧识别
      return {
        ...ref,
        elementName: `${ref.elementId}（元素已删除）`,
        locator: { locatorType: "css" as const, locator: `__missing__:${ref.elementId}` },
      };
    }
    return {
      ...ref,
      elementName: el.name,
      locator: { locatorType: el.locatorType as "css", locator: el.locator },
    };
  });
}

export async function runUiCase(projectId: string, caseId: string, userId: string) {
  const c = await prisma.uiTestCase.findFirst({ where: { id: caseId, projectId, deletedAt: null } });
  if (!c) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  const steps = await resolveUiSteps(projectId, c.steps as unknown as UiStep[]);
  const item = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "ui_case",
        refType: "ui_test_case",
        refId: c.id,
        status: "PENDING",
        poolId: config.defaultPoolId,
        payload: { caseId: c.id, name: c.name },
        createdBy: userId,
      },
      select: { id: true },
    });
    const item = await tx.execItem.create({
      data: { taskId: task.id, refType: "ui_test_case", refId: c.id, status: "PENDING" },
      select: { id: true },
    });
    return { task, item };
  });
  await execQueueFor(config.defaultPoolId).add(
    "exec",
    {
      taskId: item.task.id,
      projectId,
      type: "ui_case",
      itemId: item.item.id,
      caseId: c.id,
      name: c.name,
      steps,
      timeoutMs: c.timeoutMs,
    },
    { jobId: item.task.id, attempts: 1 },
  );
  return { taskId: item.task.id };
}

export async function runUiCaseBatch(projectId: string, caseIds: string[], userId: string) {
  if (caseIds.length > 20) throw new DomainError(ErrCode.UI_BATCH_TOO_MANY, "批量执行最多 20 条用例");
  const cases = await prisma.uiTestCase.findMany({
    where: { id: { in: caseIds }, projectId, deletedAt: null },
  });
  const found = new Set(cases.map((c) => c.id));
  const missing = caseIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, `部分用例不存在：${missing.length} 条`);
  }
  const task = await prisma.execTask.create({
    data: {
      projectId,
      type: "ui_batch",
      refType: "ui_test_case",
      refId: caseIds[0] ?? null,
      status: "PENDING",
      poolId: config.defaultPoolId,
      payload: { caseIds },
      createdBy: userId,
    },
    select: { id: true },
  });
  const items: {
    itemId: string;
    caseId: string;
    name: string;
    steps: UiStep[];
    timeoutMs: number;
  }[] = [];
  for (const c of caseIds
    .map((id) => cases.find((x) => x.id === id))
    .filter((x): x is (typeof cases)[number] => Boolean(x))) {
    const item = await prisma.execItem.create({
      data: { taskId: task.id, refType: "ui_test_case", refId: c.id, status: "PENDING" },
      select: { id: true },
    });
    items.push({
      itemId: item.id,
      caseId: c.id,
      name: c.name,
      steps: await resolveUiSteps(projectId, c.steps as unknown as UiStep[]),
      timeoutMs: c.timeoutMs,
    });
  }
  await execQueueFor(config.defaultPoolId).add(
    "exec",
    {
      taskId: task.id,
      projectId,
      type: "ui_batch",
      stopOnFail: false,
      items,
    },
    { jobId: task.id, attempts: 1 },
  );
  return { taskId: task.id };
}

/** ───────────── 报告（任务详情：帧→步骤视图聚合；事件=报告先例） ───────────── */

/** ui_case/ui_batch 任务详情：ExecItem ×（step-op 帧→步骤行 + ui-screenshot 帧→截图 fileId）。 */
export async function uiTaskDetail(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId, type: { in: ["ui_case", "ui_batch"] } },
    select: { id: true, status: true, durationMs: true, createdAt: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const items = await prisma.execItem.findMany({
    where: { taskId },
    select: { id: true, refId: true, status: true, stepResults: { orderBy: { seq: "asc" } } },
    orderBy: { startedAt: "asc" },
  });
  const caseNames = new Map<string, string>();
  if (items.length > 0) {
    const cases = await prisma.uiTestCase.findMany({
      where: { id: { in: items.map((i) => i.refId) } },
      select: { id: true, name: true },
    });
    for (const c of cases) caseNames.set(c.id, c.name);
  }
  const { eventFrameSchema } = await import("@rabbit/shared");
  return {
    taskId: task.id,
    status: task.status,
    durationMs: task.durationMs,
    createdAt: task.createdAt.toISOString(),
    items: items.map((item) => {
      const frames = item.stepResults
        .map((r) => {
          try {
            return eventFrameSchema.parse(r.frame);
          } catch {
            return null;
          }
        })
        .filter((f): f is NonNullable<typeof f> => f !== null);
      const steps = frames
        .filter((f) => f.type === "step-op")
        .map((f) => {
          const shot = frames.find(
            (s) => s.type === "ui-screenshot" && s.stepSeq === Number(f.stepPath),
          );
          return {
            seq: Number(f.stepPath),
            op: f.stepName.split(" ")[0] ?? f.stepName,
            name: f.stepName,
            status: f.status,
            durationMs: f.durationMs,
            message: f.message,
            screenshotFileId: shot && shot.type === "ui-screenshot" ? shot.fileId : undefined,
          };
        });
      return {
        itemId: item.id,
        name: caseNames.get(item.refId) ?? "UI 用例",
        status: item.status,
        steps,
        frames: frames.filter((f) => f.type === "ui-screenshot"),
      };
    }),
  };
}
