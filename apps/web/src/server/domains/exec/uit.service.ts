/**
 * S11 UIT-002 UI 测试域服务：元素库 CRUD + UI 用例 CRUD（步骤 schema 校验）+
 * 执行（ui_case/ui_batch 入 exec 队列；元素引用预解析内联——engine 无 DB，同 API-006 ref 解析先例）+
 * 报告（复用 exec 事件流：step-op 帧逐步状态 + ui-screenshot 帧 fileId）。
 * S13 UIT-003：+脚本模式（mode=script：script/params 存储、执行走官方 runner 子进程）、
 * 校验干跑（ui_validate 任务）、报告扩展（测试树行 op=script + ui-trace 帧）。
 */
import { DomainError, ErrCode, config, uiCaseCreateSchema } from "@rabbit/shared";
import type {
  UiCaseMode,
  UiCaseParsed,
  UiCaseUpdate,
  UiElementCreate,
  UiElementUpdate,
  UiParam,
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

type UiCaseRowRaw = {
  id: string;
  projectId: string;
  name: string;
  mode: string;
  steps: unknown;
  script: string | null;
  params: unknown;
  timeoutMs: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
};

function serializeCase(c: UiCaseRowRaw) {
  return {
    id: c.id,
    projectId: c.projectId,
    name: c.name,
    mode: c.mode as UiCaseMode,
    steps: c.steps,
    script: c.script ?? "",
    params: Array.isArray(c.params) ? c.params : [],
    timeoutMs: c.timeoutMs,
    createdBy: c.createdBy,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

/** 脚本模式列表摘要：首个 describe/test 标题（静态正则，轻量；精确清单走「校验脚本」干跑）。 */
export function scriptSummary(script: string): string {
  const hit = script.match(/(?:test|describe)\s*(?:\.\w+\s*)*\(\s*['"`]([^'"`\n]{1,64})/);
  if (hit?.[1]) return `「${hit[1]}」`;
  const n = script.trim().length;
  return n === 0 ? "空脚本" : `${n} 字符`;
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
        summary: r.mode === "script" ? scriptSummary(r.script ?? "") : "",
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

export async function createUiCase(projectId: string, userId: string, input: UiCaseParsed) {
  const row = await prisma.uiTestCase.create({
    data: {
      projectId,
      name: input.name,
      mode: input.mode,
      steps: input.steps as object[],
      script: input.mode === "script" ? (input.script ?? "") : null,
      params: input.mode === "script" ? (input.params as object[]) : [],
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
    detail: {
      name: input.name,
      mode: input.mode,
      ...(input.mode === "script"
        ? { scriptChars: input.script?.length ?? 0, paramCount: input.params.length }
        : { stepCount: input.steps.length }),
    },
  });
  return serializeCase(row);
}

export async function updateUiCase(projectId: string, id: string, input: UiCaseUpdate) {
  const existing = await prisma.uiTestCase.findFirst({ where: { id, projectId, deletedAt: null } });
  if (!existing) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  // 合并现值后经 create schema 复核（mode 条件校验：script 模式须有脚本、steps 模式步骤完备）
  const merged = uiCaseCreateSchema.safeParse({
    name: input.name ?? existing.name,
    mode: input.mode ?? existing.mode,
    steps: input.steps ?? (existing.steps as object[]),
    script: input.script ?? existing.script ?? undefined,
    params: input.params ?? (Array.isArray(existing.params) ? existing.params : []),
    timeoutMs: input.timeoutMs ?? existing.timeoutMs,
  });
  if (!merged.success) {
    throw new DomainError(
      ErrCode.UI_SCRIPT_INVALID,
      merged.error.issues[0]?.message ?? "用例载荷非法",
    );
  }
  const row = await prisma.uiTestCase.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.mode !== undefined ? { mode: input.mode } : {}),
      ...(input.steps !== undefined ? { steps: input.steps as object[] } : {}),
      ...(input.script !== undefined ? { script: input.script } : {}),
      ...(input.params !== undefined ? { params: input.params as object[] } : {}),
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
  const c = await prisma.uiTestCase.findFirst({
    where: { id: caseId, projectId, deletedAt: null },
  });
  if (!c) throw new DomainError(ErrCode.UI_CASE_NOT_FOUND, "UI 用例不存在");
  const isScript = c.mode === "script";
  if (isScript && !c.script) {
    throw new DomainError(ErrCode.UI_SCRIPT_INVALID, "脚本用例缺少脚本内容");
  }
  const steps = isScript ? [] : await resolveUiSteps(projectId, c.steps as unknown as UiStep[]);
  const item = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "ui_case",
        refType: "ui_test_case",
        refId: c.id,
        status: "PENDING",
        poolId: config.defaultPoolId,
        payload: { caseId: c.id, name: c.name, mode: c.mode },
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
      ...(isScript
        ? {
            mode: "script" as const,
            steps: [],
            script: c.script ?? "",
            params: Array.isArray(c.params) ? c.params : [],
          }
        : { mode: "steps" as const, steps }),
      timeoutMs: c.timeoutMs,
    },
    { jobId: item.task.id, attempts: 1 },
  );
  return { taskId: item.task.id };
}

/** S13 UIT-003：脚本校验干跑（ui_validate 任务——engine playwright test --list，秒级，不起浏览器）。 */
export async function validateUiScript(
  projectId: string,
  userId: string,
  input: { name?: string; script: string },
) {
  const name = input.name?.trim() || scriptSummary(input.script);
  const item = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "ui_validate",
        refType: null,
        refId: null,
        status: "PENDING",
        poolId: config.defaultPoolId,
        payload: { name, mode: "script" },
        createdBy: userId,
      },
      select: { id: true },
    });
    const item = await tx.execItem.create({
      data: { taskId: task.id, refType: "ui_script_validate", refId: "", status: "PENDING" },
      select: { id: true },
    });
    return { task, item };
  });
  await execQueueFor(config.defaultPoolId).add(
    "exec",
    {
      taskId: item.task.id,
      projectId,
      type: "ui_validate",
      itemId: item.item.id,
      name,
      script: input.script,
    },
    { jobId: item.task.id, attempts: 1 },
  );
  return { taskId: item.task.id };
}

export async function runUiCaseBatch(projectId: string, caseIds: string[], userId: string) {
  if (caseIds.length > 20)
    throw new DomainError(ErrCode.UI_BATCH_TOO_MANY, "批量执行最多 20 条用例");
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
    mode: "steps" | "script";
    steps: UiStep[];
    script?: string;
    params?: UiParam[];
    timeoutMs: number;
  }[] = [];
  for (const c of caseIds
    .map((id) => cases.find((x) => x.id === id))
    .filter((x): x is (typeof cases)[number] => Boolean(x))) {
    const item = await prisma.execItem.create({
      data: { taskId: task.id, refType: "ui_test_case", refId: c.id, status: "PENDING" },
      select: { id: true },
    });
    if (c.mode === "script") {
      items.push({
        itemId: item.id,
        caseId: c.id,
        name: c.name,
        mode: "script",
        steps: [],
        script: c.script ?? "",
        params: (Array.isArray(c.params) ? c.params : []) as UiParam[],
        timeoutMs: c.timeoutMs,
      });
    } else {
      items.push({
        itemId: item.id,
        caseId: c.id,
        name: c.name,
        mode: "steps",
        steps: await resolveUiSteps(projectId, c.steps as unknown as UiStep[]),
        timeoutMs: c.timeoutMs,
      });
    }
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

/** ui_case/ui_batch/ui_validate 任务详情：ExecItem ×（step-op 帧→步骤/测试行 + ui-screenshot/ui-trace 帧附件）。
 * S13 UIT-003：脚本模式行 op=script（名称=测试标题，message 含错误代码帧）；trace 帧→traceFileId 列表。 */
export async function uiTaskDetail(projectId: string, taskId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId, type: { in: ["ui_case", "ui_batch", "ui_validate"] } },
    select: {
      id: true,
      status: true,
      durationMs: true,
      createdAt: true,
      payload: true,
      type: true,
    },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const items = await prisma.execItem.findMany({
    where: { taskId },
    select: { id: true, refId: true, status: true, stepResults: { orderBy: { seq: "asc" } } },
    orderBy: { startedAt: "asc" },
  });
  const caseMeta = new Map<string, { name: string; mode: string }>();
  if (items.length > 0) {
    const cases = await prisma.uiTestCase.findMany({
      where: { id: { in: items.map((i) => i.refId) } },
      select: { id: true, name: true, mode: true },
    });
    for (const c of cases) caseMeta.set(c.id, { name: c.name, mode: c.mode });
  }
  const validateName = (task.payload as { name?: string } | null)?.name ?? "脚本校验";
  const { eventFrameSchema } = await import("@rabbit/shared");
  return {
    taskId: task.id,
    type: task.type,
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
      const meta = caseMeta.get(item.refId);
      const scriptMode = task.type === "ui_validate" || meta?.mode === "script";
      const steps = frames
        .filter((f) => f.type === "step-op")
        .map((f) => {
          const shot = frames.find(
            (s) => s.type === "ui-screenshot" && s.stepSeq === Number(f.stepPath),
          );
          return {
            seq: Number(f.stepPath),
            op: f.op === "script" ? "script" : (f.stepName.split(" ")[0] ?? f.stepName),
            name: f.stepName,
            status: f.status,
            durationMs: f.durationMs,
            message: f.message,
            screenshotFileId: shot && shot.type === "ui-screenshot" ? shot.fileId : undefined,
          };
        });
      return {
        itemId: item.id,
        name: meta?.name ?? validateName,
        mode: scriptMode ? "script" : "steps",
        status: item.status,
        steps,
        frames: frames.filter((f) => f.type === "ui-screenshot"),
        traces: frames
          .filter((f) => f.type === "ui-trace")
          .map((f) => (f.type === "ui-trace" ? { fileId: f.fileId, name: f.name } : null))
          .filter((t): t is { fileId: string; name: string } => t !== null),
      };
    }),
  };
}
