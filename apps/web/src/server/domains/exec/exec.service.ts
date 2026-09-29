/** EXEC 编排 v3（API-003/006/008/EXEC-002/SYS-006/RPT-002/003/API-010）：任务创建
 * （api_debug/api_case/scenario）→ 入队；回调终态 → 事件流按 item 分组落库 +
 * 误报改判 FAKE_ERROR + 报告聚合；停止/重跑；任务与报告列表；分享；场景树视图。 */
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
  ScenarioItemCommand,
  ScenarioStepNode,
  StepBundle,
} from "@rabbit/shared/execution";
import { eventFrameSchema, execCommandSchema } from "@rabbit/shared";
import { execTaskListQuerySchema, reportListQuerySchema } from "@rabbit/shared";
import type { z } from "zod";
import { prisma } from "@rabbit/db";
import { execQueue, execQueueFor, redis } from "@/server/redis";
import { assertPoolExecutable } from "@/server/domains/system/pool.service";
import { buildEnvSnapshot } from "@/server/domains/project/environment.service";
import { resolveScriptRefs } from "@/server/domains/project/public-script.service";
import { parseCsv, type CsvSource } from "@rabbit/shared/execution";
import {
  matchFalseAlarm,
  type FalseAlarmRuleLike,
  type FailedStepInput,
} from "@rabbit/shared/execution";
import { buildScenarioTree } from "@rabbit/shared/execution";
import { readFileObject } from "@/server/storage";

/** ───────────── 任务创建 ───────────── */

/** S6 PLUG-002：定义协议（ApiDefinition.protocol，默认 HTTP）≠ http(s) 时注入 request.protocol/protocolConfig */
function withProtocol(definitionProtocol: string, spec: RequestSpec): RequestSpec {
  const p = (definitionProtocol ?? "HTTP").toLowerCase();
  if (p === "http" || p === "https") return spec;
  return {
    ...spec,
    protocol: p,
    protocolConfig: (spec as { protocolConfig?: Record<string, unknown> }).protocolConfig ?? {},
  };
}

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
    if (input.clientTaskId && err instanceof Error && (err as { code?: string }).code === "P2002") {
      const winner = await prisma.execTask.findFirst({
        where: { projectId, clientTaskId: input.clientTaskId },
        select: { id: true },
      });
      if (winner) return { taskId: winner.id };
    }
    throw err;
  }
  await execQueueFor(config.defaultPoolId).add(
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

/** api_case 条目命令构造（S4 PLAN-003 复用：计划任务的 api_case 子命令；itemId 由调用方回填）。 */
export async function buildApiCaseCommands(
  projectId: string,
  caseIds: string[],
): Promise<(Omit<ExecItemCommand, "itemId"> & { apiProtocol: string })[]> {
  const cases = await prisma.apiCase.findMany({
    where: { id: { in: caseIds }, projectId, deletedAt: null },
    include: {
      api: {
        select: { id: true, moduleId: true, method: true, path: true, num: true, protocol: true },
      },
    },
  });
  const found = new Set(cases.map((c) => c.id));
  const missing = caseIds.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError(ErrCode.API_CASE_NOT_FOUND, `部分用例不存在：${missing.length} 条`);
  const resolved = caseIds
    .map((id) => cases.find((c) => c.id === id))
    .filter((c): c is (typeof cases)[number] => Boolean(c))
    .map((c) => {
      const bundle = c.request as {
        spec: RequestSpec;
        asserts?: AssertSpec[];
        pre?: Processor[];
        post?: Processor[];
        extracts?: Extractor[];
      };
      return {
        caseId: c.id,
        name: c.name,
        moduleId: c.api.moduleId,
        apiProtocol: c.api.protocol,
        request: bundle.spec,
        asserts: bundle.asserts ?? [],
        pre: bundle.pre ?? [],
        post: bundle.post ?? [],
        extracts: bundle.extracts ?? [],
      };
    });
  // S5 PROJ-005：scriptRef 构建期展开（engine 无感知）
  return Promise.all(
    resolved.map(async (cmd) => ({
      ...cmd,
      pre: await resolveScriptRefs(projectId, cmd.pre),
      post: await resolveScriptRefs(projectId, cmd.post),
    })),
  );
}

/** api_case 批量任务：预建 ExecItem（id 即 engine 侧 itemId）→ 入队（API-003 §2）。 */
export async function createApiCaseTask(
  projectId: string,
  userId: string,
  input: ApiCaseTaskInput,
) {
  const commands = await buildApiCaseCommands(projectId, input.caseIds);
  if (commands.length === 0)
    throw new DomainError(ErrCode.API_CASE_NOT_FOUND, "接口用例不存在或已删除");

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
          caseIds: commands.map((c) => c.caseId),
          items: commands.map((c) => ({
            caseId: c.caseId,
            name: c.name,
            bundle: {
              spec: c.request,
              asserts: c.asserts,
              pre: c.pre,
              post: c.post,
              extracts: c.extracts,
            },
          })),
        },
        createdBy: userId,
      },
      select: { id: true },
    });
    for (const c of commands) {
      const item = await tx.execItem.create({
        data: { taskId: task.id, refType: "api_case", refId: c.caseId, status: "PENDING" },
        select: { id: true },
      });
      items.push({
        itemId: item.id,
        caseId: c.caseId,
        name: c.name,
        moduleId: c.moduleId,
        // S6 PLUG-002：定义协议 ≠ HTTP 时透传协议插件标识与配置（engine 注册表采样）
        request: withProtocol(c.apiProtocol ?? "HTTP", c.request),
        asserts: c.asserts,
        pre: c.pre,
        post: c.post,
        extracts: c.extracts,
      });
    }
    return task;
  });

  await execQueueFor(config.defaultPoolId).add(
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

/** 单步调试（API-006 §2）：以该步骤为根的临时场景执行，不入 Scenario 表。 */
export async function createAdhocScenarioTask(
  projectId: string,
  userId: string,
  input: {
    name: string;
    steps: ScenarioStepNode[];
    params: ScenarioItemCommand["params"];
    settings: ScenarioItemCommand["settings"];
    envId?: string;
  },
) {
  const envSnapshot = await buildEnvSnapshot(projectId, input.envId);
  const adhocId = "00000000-0000-0000-0000-000000000000";
  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "scenario",
        status: "PENDING",
        poolId: config.defaultPoolId,
        envId: input.envId ?? null,
        payload: { adhoc: true, stepDebug: true, scenarioIds: [adhocId] },
        createdBy: userId,
      },
      select: { id: true },
    });
    const item = await tx.execItem.create({
      data: { taskId: task.id, refType: "scenario", refId: `adhoc:${userId}`, status: "PENDING" },
      select: { id: true },
    });
    return { taskId: task.id, itemId: item.id };
  });
  const commandItem: ScenarioItemCommand = {
    itemId: created.itemId,
    scenarioId: adhocId,
    name: input.name,
    params: input.params,
    settings: input.settings,
    pre: [],
    post: [],
    asserts: [],
    steps: input.steps,
  };
  await execQueueFor(config.defaultPoolId).add(
    "exec",
    {
      taskId: created.taskId,
      projectId,
      type: "scenario",
      stopOnFail: true,
      mode: "serial",
      items: [commandItem],
      ...(envSnapshot ? { envSnapshot } : {}),
    },
    { jobId: created.taskId, attempts: 1 },
  );
  return { taskId: created.taskId };
}

/** ───────────── 回调（engine → web）：终态幂等 + item 分组落库 + 报告聚合 ───────────── */

export interface ScenarioTaskInput {
  scenarioIds: string[];
  envId?: string;
  poolId?: string;
  stopOnFail: boolean;
  mode: "serial" | "parallel";
  clientTaskId?: string;
  createdBySystem?: boolean;
}

/** 步骤树 → 命令树：引用解析（ref_api/ref_case→bundle 快照；ref_scenario 递归展开≤5）+ foreach 迭代预展开。 */
async function resolveScenarioSteps(
  projectId: string,
  steps: ScenarioStepNode[],
  params: {
    lists: { name: string; values: string[] }[];
    csvColumns: string[];
    csvRows: string[][];
  },
  depth: number,
): Promise<ScenarioStepNode[]> {
  if (depth > 5) throw new DomainError(ErrCode.SCENARIO_CIRCULAR_REF, "场景引用链深度超限（≤5）");
  const out: ScenarioStepNode[] = [];
  for (const n of steps) {
    let node: ScenarioStepNode = { ...n, children: [...n.children] };
    if (n.stepType === "ref_api" || n.stepType === "ref_case") {
      const refId = (n.config as { refId?: string }).refId;
      let bundle: StepBundle | undefined;
      let moduleId: string | undefined;
      if (n.stepType === "ref_api" && refId) {
        const api = await prisma.apiDefinition.findFirst({
          where: { id: refId, projectId, deletedAt: null },
          select: { request: true, moduleId: true },
        });
        if (api) {
          const r = api.request as {
            spec: RequestSpec;
            asserts?: AssertSpec[];
            pre?: Processor[];
            post?: Processor[];
            extracts?: Extractor[];
          };
          bundle = {
            request: r.spec,
            asserts: r.asserts ?? [],
            pre: r.pre ?? [],
            post: r.post ?? [],
            extracts: r.extracts ?? [],
          };
          moduleId = api.moduleId;
        }
      } else if (n.stepType === "ref_case" && refId) {
        const c = await prisma.apiCase.findFirst({
          where: { id: refId, projectId, deletedAt: null },
          include: { api: { select: { moduleId: true } } },
        });
        if (c) {
          const r = c.request as {
            spec: RequestSpec;
            asserts?: AssertSpec[];
            pre?: Processor[];
            post?: Processor[];
            extracts?: Extractor[];
          };
          bundle = {
            request: r.spec,
            asserts: r.asserts ?? [],
            pre: r.pre ?? [],
            post: r.post ?? [],
            extracts: r.extracts ?? [],
          };
          moduleId = c.api.moduleId;
        }
      }
      if (bundle) {
        node = {
          ...node,
          config: { ...(n.config as object), bundle, ...(moduleId ? { moduleId } : {}) } as Record<
            string,
            unknown
          >,
        };
      } else {
        // 引用目标已删：降级为断言必失败的占位请求（帧可见，报告留痕）
        node = {
          ...node,
          config: {
            ...(n.config as object),
            bundle: {
              request: {
                method: "GET",
                url: "about:blank",
                headers: [],
                query: [],
                body: { kind: "none" },
                auth: { kind: "none" },
              },
              asserts: [{ kind: "status_code", path: "", op: "eq", expected: "-1" }],
            },
            __unresolvedRef: true,
          } as Record<string, unknown>,
        };
      }
    } else if (n.stepType === "ref_scenario") {
      const refId = (n.config as { refId?: string }).refId;
      if (refId) {
        const sub = await prisma.scenario.findFirst({
          where: { id: refId, projectId, deletedAt: null },
          include: { steps: { orderBy: { order: "asc" } } },
        });
        if (sub) {
          const childTree = buildStepTree(sub.steps);
          node = {
            ...node,
            children: await resolveScenarioSteps(projectId, childTree, params, depth + 1),
          };
        }
      }
    } else if (n.stepType === "loop") {
      const cfg = n.config as { mode?: string; source?: string; var?: string };
      if (cfg.mode === "foreach" && cfg.source) {
        const list = params.lists.find((l) => l.name === cfg.source);
        let iterations: { value: string; row: Record<string, string> }[];
        if (list) {
          iterations = list.values.map((v) => ({ value: v, row: {} }));
        } else {
          // CSV 列迭代：整行注入 row
          const colIdx = params.csvColumns.indexOf(cfg.source);
          iterations = params.csvRows.map((row) => {
            const rowObj: Record<string, string> = {};
            params.csvColumns.forEach((c, i) => {
              rowObj[c] = row[i] ?? "";
            });
            return { value: colIdx >= 0 ? (row[colIdx] ?? "") : "", row: rowObj };
          });
        }
        node = {
          ...node,
          config: { ...(n.config as object), iterations } as Record<string, unknown>,
        };
      }
      node = {
        ...node,
        children: await resolveScenarioSteps(projectId, n.children, params, depth),
      };
    } else if (n.children.length > 0) {
      node = {
        ...node,
        children: await resolveScenarioSteps(projectId, n.children, params, depth),
      };
    }
    // S5 PROJ-005：步骤级处理器 scriptRef 构建期展开（ref 解析后的 bundle 与 custom 步骤 config 两形态）
    const cfg = node.config as Record<string, unknown>;
    const bundle = cfg.bundle as { pre?: unknown[]; post?: unknown[] } | undefined;
    if (Array.isArray(bundle?.pre))
      bundle.pre = await resolveScriptRefs(projectId, bundle.pre as Processor[]);
    if (Array.isArray(bundle?.post))
      bundle.post = await resolveScriptRefs(projectId, bundle.post as Processor[]);
    if (Array.isArray(cfg.pre))
      cfg.pre = await resolveScriptRefs(projectId, cfg.pre as Processor[]);
    if (Array.isArray(cfg.post))
      cfg.post = await resolveScriptRefs(projectId, cfg.post as Processor[]);
    out.push(node);
  }
  return out;
}

function buildStepTree(
  rows: {
    id: string;
    parentId: string | null;
    stepType: string;
    name: string;
    enabled: boolean;
    config: unknown;
    order: number;
  }[],
): ScenarioStepNode[] {
  const byParent = new Map<string | null, typeof rows>();
  for (const r of rows) {
    if (!byParent.has(r.parentId)) byParent.set(r.parentId, []);
    byParent.get(r.parentId)!.push(r);
  }
  const build = (parent: string | null): ScenarioStepNode[] =>
    (byParent.get(parent) ?? []).map((r) => ({
      uid: r.id,
      stepType: r.stepType as ScenarioStepNode["stepType"],
      name: r.name,
      enabled: r.enabled,
      config: (r.config as Record<string, unknown>) ?? {},
      children: build(r.id),
    }));
  return build(null);
}

/** scenario 条目命令构造（S4 PLAN-003 复用：计划任务的 scenario 子命令；itemId 由调用方回填）。 */
export async function buildScenarioCommands(
  projectId: string,
  scenarioIds: string[],
): Promise<{ commands: Omit<ScenarioItemCommand, "itemId">[]; warnings: string[] }> {
  const scenarios = await prisma.scenario.findMany({
    where: { id: { in: scenarioIds }, projectId, deletedAt: null },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  if (scenarios.length === 0)
    throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, "场景不存在或已删除");
  const found = new Set(scenarios.map((s) => s.id));
  const missing = scenarioIds.filter((id) => !found.has(id));
  if (missing.length > 0)
    throw new DomainError(ErrCode.SCENARIO_NOT_FOUND, `部分场景不存在：${missing.length} 个`);
  const ordered = scenarioIds.map((id) => scenarios.find((s) => s.id === id)!).filter(Boolean);

  const commands: Omit<ScenarioItemCommand, "itemId">[] = [];
  const resolvedWarnings: string[] = [];
  for (const s of ordered) {
    const cfg = (s.config ?? {}) as {
      params?: {
        constants?: { name: string; value: string }[];
        lists?: { name: string; values: string[] }[];
        csv?: CsvSource;
      };
      prePost?: { pre?: Processor[]; post?: Processor[] };
      asserts?: AssertSpec[];
      settings?: {
        cookieMode?: "off" | "keep";
        thinkTimeMs?: number;
        onFailure?: "continue" | "abort";
      };
    };
    const constants = cfg.params?.constants ?? [];
    const lists = (cfg.params?.lists ?? []).map((l) => ({ name: l.name, values: l.values ?? [] }));
    // CSV 预解析（API-007：fileId 读文件管理 / inline 内嵌文本）
    let csvColumns: string[] = [];
    let csvRows: string[][] = [];
    const csvSrc = cfg.params?.csv;
    if (csvSrc) {
      let text = "";
      if (csvSrc.source === "file" && csvSrc.fileId) {
        const f = await prisma.fileItem.findFirst({
          where: { id: csvSrc.fileId, projectId, deletedAt: null },
        });
        if (f) text = (await readFileObject(f.storageKey)).toString("utf8");
        else resolvedWarnings.push(`CSV 文件不存在（fileId=${csvSrc.fileId}），CSV 参数按空表处理`);
      } else if (csvSrc.inlineText) {
        text = csvSrc.inlineText;
      }
      if (text) {
        const parsed = parseCsv(text, {
          delimiter: csvSrc.delimiter ?? ",",
          hasHeader: csvSrc.hasHeader ?? true,
        });
        if (parsed.rows.length >= 10000)
          throw new DomainError(ErrCode.CSV_TOO_LARGE, "CSV 行数超限（≤10000）");
        csvColumns = parsed.columns;
        csvRows = parsed.rows;
        for (const w of parsed.warnings) resolvedWarnings.push(`CSV「${s.name}」：${w}`);
      }
    }
    const resolvedSteps = await resolveScenarioSteps(
      projectId,
      buildStepTree(s.steps),
      { lists, csvColumns, csvRows },
      0,
    );
    commands.push({
      scenarioId: s.id,
      name: s.name,
      params: {
        constants: constants.map((c) => ({ name: c.name, value: c.value, description: "" })),
        lists,
        csv: { columns: csvColumns, rows: csvRows },
      },
      settings: {
        cookieMode: cfg.settings?.cookieMode ?? "off",
        thinkTimeMs: cfg.settings?.thinkTimeMs ?? 0,
        onFailure: cfg.settings?.onFailure ?? "abort",
      },
      pre: await resolveScriptRefs(projectId, (cfg.prePost?.pre ?? []) as Processor[]),
      post: await resolveScriptRefs(projectId, (cfg.prePost?.post ?? []) as Processor[]),
      asserts: (cfg.asserts ?? []) as AssertSpec[],
      steps: resolvedSteps,
    });
  }
  return { commands, warnings: resolvedWarnings };
}

/** scenario 批量任务（API-006 单条 / API-008 批量共用）：引用解析 + CSV 预解析 → ExecItem 预建 → 入队。 */
export async function createScenarioTask(
  projectId: string,
  userId: string,
  input: ScenarioTaskInput,
) {
  const { commands, warnings } = await buildScenarioCommands(projectId, input.scenarioIds);
  const envSnapshot = await buildEnvSnapshot(projectId, input.envId);
  const items: ScenarioItemCommand[] = [];
  // ENTP-006：执行入口池校验（存在/ACTIVE/应用组织）——非默认池任务入 `exec:{poolId}` 隔离队列
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  const poolId = await assertPoolExecutable(input.poolId ?? null, project?.orgId ?? null);

  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "scenario",
        status: "PENDING",
        clientTaskId: input.clientTaskId ?? null,
        poolId,
        envId: input.envId ?? null,
        payload: {
          stopOnFail: input.stopOnFail,
          mode: input.mode,
          scenarioIds: commands.map((c) => c.scenarioId),
          warnings,
        },
        createdBy: userId,
      },
      select: { id: true },
    });
    for (const it of commands) {
      const item = await tx.execItem.create({
        data: { taskId: task.id, refType: "scenario", refId: it.scenarioId, status: "PENDING" },
        select: { id: true },
      });
      items.push({ itemId: item.id, ...it });
    }
    return task;
  });

  await execQueueFor(poolId).add(
    "exec",
    {
      taskId: created.id,
      projectId,
      type: "scenario",
      stopOnFail: input.stopOnFail,
      mode: input.mode,
      items,
      ...(envSnapshot ? { envSnapshot } : {}),
    },
    { jobId: created.id, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  return { taskId: created.id, warnings };
}

/** INFRA-008：从条目帧提取首个错误分类码（engine 错误 log 帧 additive 字段 code；导出供单测）。 */
export function errorCodeOfFrames(
  frames: Array<{ type: string; code?: unknown; [k: string]: unknown }>,
): string | undefined {
  const hit = frames.find((f) => f.type === "log" && typeof f.code === "string");
  return hit ? (hit.code as string) : undefined;
}

export async function handleCallback(taskId: string, cb: ExecCallback) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId },
    select: {
      id: true,
      status: true,
      projectId: true,
      type: true,
      payload: true,
      envId: true,
      createdBy: true,
    },
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
        status:
          cb.outcome === "success" ? "SUCCESS" : cb.outcome === "stopped" ? "STOPPED" : "FAILED",
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
      // api_case/scenario：item 预建，帧按 itemId 分组落库 + item 状态聚合 + 误报改判（API-010）
      // 报告先行创建（hits 的 FK 指向；summary 循环后回填）
      const stepResult = frames.find(
        (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
      );
      const reportName =
        task.type === "api_case"
          ? `批量执行 · ${existingItems.length} 条用例`
          : task.type === "scenario"
            ? `场景执行 · ${existingItems.length} 个场景`
            : task.type === "plan"
              ? `计划执行 · ${existingItems.length} 条用例`
              : stepResult
                ? `${stepResult.requestSnapshot.method} ${shortUrl(stepResult.requestSnapshot.url)}`
                : `任务 ${taskId.slice(0, 8)}`;
      const existingReport = await tx.report.findFirst({ where: { taskId }, select: { id: true } });
      const report =
        existingReport ??
        (await tx.report.create({
          data: {
            taskId,
            projectId: task.projectId,
            reportType: task.type,
            name: reportName,
            summary: JSON.stringify({
              total: existingItems.length,
              passed: 0,
              failed: 0,
              fakeError: 0,
            }),
            createdBy: task.createdBy,
          },
          select: { id: true },
        }));
      const faRules = await loadFalseAlarmRules(task.projectId);
      let fakeErrorCount = 0;
      for (const item of existingItems) {
        const itemFrames = frames.filter((f) => "itemId" in f && f.itemId === item.id);
        const itemFinal = itemFrames.find(
          (f): f is Extract<EventFrame, { type: "item-final" }> => f.type === "item-final",
        );
        let status = itemFinal?.status ?? "FAILED";
        let resultPayload: object = itemFinal
          ? { status: itemFinal.status, message: itemFinal.message }
          : { status: "FAILED", message: "缺少 item 终态帧" };
        // 误报改判：FAILED → 命中规则 → FAKE_ERROR + 留痕（仅新执行报告生效=回调时读当前规则，API-010 §2）
        let fakeHits: { ruleId: string; ruleName: string; stepPath?: string }[] = [];
        if (status === "FAILED" && faRules.length > 0) {
          const failedSteps: FailedStepInput[] = itemFrames
            .filter(
              (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
            )
            .map((f) => ({
              status: f.status,
              bodyText: (f.responseSummary.bodyText ?? "").slice(0, 4096),
              headers: f.responseSummary.headers,
              responseTimeMs: f.durationMs,
              stepPath: f.stepPath,
            }));
          fakeHits = matchFalseAlarm(faRules, failedSteps);
          if (fakeHits.length > 0) {
            status = "FAKE_ERROR";
            fakeErrorCount += 1;
            resultPayload = {
              status: "FAKE_ERROR",
              message: itemFinal?.message ?? "",
              fakeAlarmHits: fakeHits.map((h) => h.ruleName),
            };
          }
        }
        // INFRA-008：步骤错误分类码冗余进 result（FAKE_ERROR 改判后仍保留；指标聚合走 item 行）
        const errCode = errorCodeOfFrames(itemFrames);
        await tx.execItem.update({
          where: { id: item.id },
          data: {
            status,
            result: errCode ? { ...resultPayload, errorCode: errCode } : resultPayload,
            startedAt: startedAt ? new Date(startedAt.ts) : null,
            finishedAt: new Date(),
          },
        });
        if (itemFrames.length > 0) {
          await tx.execStepResult.createMany({
            data: itemFrames.map((f, i) => ({ itemId: item.id, seq: i + 1, frame: f as object })),
          });
        }
        if (fakeHits.length > 0) {
          await tx.falseAlarmHit.createMany({
            data: fakeHits.map((h) => ({
              reportId: report.id,
              taskId,
              ruleId: h.ruleId,
              ruleName: h.ruleName,
              stepPath: h.stepPath ?? null,
            })),
          });
        }
      }
      // summary 回填（含误报单列）+ task 状态修正（FAKE_ERROR 不计失败，API-010 §2）
      const after = await tx.execItem.findMany({ where: { taskId }, select: { status: true } });
      const passed = after.filter((i) => i.status === "SUCCESS").length;
      const failed = after.filter((i) => i.status === "FAILED").length;
      await tx.report.update({
        where: { id: report.id },
        data: {
          summary: JSON.stringify({
            total: after.length,
            passed,
            failed,
            fakeError: fakeErrorCount,
            durationMs,
          }),
        },
      });
      if (failed === 0 && fakeErrorCount > 0 && cb.outcome === "failed") {
        await tx.execTask.update({
          where: { id: taskId },
          data: { status: "SUCCESS", failureKind: null },
        });
      }
      // v4（PLAN-003）：plan 任务报告挂 planId（计划报告列表/详情关联）
      if (task.type === "plan") {
        const planId = (task.payload as { planId?: string }).planId ?? null;
        if (planId) await tx.report.updateMany({ where: { taskId }, data: { planId } });
      }
    } else {
      // api_debug（S0 兼容）：单 item 落库（INFRA-008：result 补齐并携带错误分类码）
      const dbgCode = errorCodeOfFrames(frames);
      const item = await tx.execItem.create({
        data: {
          taskId,
          refType: "api_debug",
          refId: "",
          status: cb.outcome === "success" ? "SUCCESS" : "FAILED",
          result: {
            status: cb.outcome === "success" ? "SUCCESS" : "FAILED",
            message: cb.message ?? "",
            ...(dbgCode ? { errorCode: dbgCode } : {}),
          },
        },
      });
      if (frames.length > 0) {
        await tx.execStepResult.createMany({
          data: frames.map((f, i) => ({ itemId: item.id, seq: i + 1, frame: f as object })),
        });
      }
      // api_debug 报告（items>0 分支的报告已在上文先行创建并回填 summary）
      const stepResultDbg = frames.find(
        (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
      );
      const nameDbg = stepResultDbg
        ? `${stepResultDbg.requestSnapshot.method} ${shortUrl(stepResultDbg.requestSnapshot.url)}`
        : `任务 ${taskId.slice(0, 8)}`;
      await tx.report.create({
        data: {
          taskId,
          projectId: task.projectId,
          reportType: task.type,
          name: nameDbg,
          summary: JSON.stringify({
            total: 1,
            passed: cb.outcome === "success" ? 1 : 0,
            failed: cb.outcome === "success" ? 0 : 1,
            durationMs,
          }),
          createdBy: task.createdBy,
        },
      });
    }
  });
  // v4（PLAN-003）：计划任务回写 PlanCaseRef/自动更新状态/计划状态刷新——事务提交后经 plan 域服务（域边界）
  if (task.type === "plan") {
    const items = await prisma.execItem.findMany({
      where: { taskId, refType: "plan_case" },
      select: { id: true, refId: true, status: true },
    });
    const { applyPlanTaskResult } = await import("@/server/domains/plan/plan-exec.service");
    await applyPlanTaskResult(taskId, task.projectId, items);
  }
  // S5 MSG-001：执行完成通知（SCENARIO_EXEC_COMPLETED / PLAN_EXEC_COMPLETED；定时任务读 notify 标志）
  if (task.type === "scenario" || task.type === "plan") {
    try {
      const finalStatus =
        cb.outcome === "success" ? "SUCCESS" : cb.outcome === "stopped" ? "STOPPED" : "FAILED";
      const payload = (task.payload ?? {}) as { notify?: boolean; scheduleId?: string };
      const isScheduleRun = Boolean(payload.scheduleId);
      if (!isScheduleRun || payload.notify !== false) {
        const { dispatch } = await import("@/server/domains/message/notify.service");
        const after = await prisma.execItem.findMany({
          where: { taskId },
          select: { status: true },
        });
        const passed = after.filter((i) => i.status === "SUCCESS").length;
        const typeName = task.type === "plan" ? "计划执行" : "场景执行";
        const [user, project] = await Promise.all([
          prisma.user.findUnique({ where: { id: task.createdBy }, select: { name: true } }),
          prisma.project.findUnique({ where: { id: task.projectId }, select: { name: true } }),
        ]);
        const time = new Date().toLocaleString("zh-CN");
        const resultText = `${passed}/${after.length} 通过`;
        await dispatch({
          projectId: task.projectId,
          event: task.type === "plan" ? "PLAN_EXEC_COMPLETED" : "SCENARIO_EXEC_COMPLETED",
          vars: {
            project: project?.name ?? "",
            actorName: user?.name ?? task.createdBy.slice(0, 8),
            time,
            name: (task.payload as { planName?: string } | null)?.planName ?? typeName,
            result: resultText,
            passed: String(passed),
            total: String(after.length),
            source: isScheduleRun ? "定时任务" : "手动",
          },
          defaults: {
            title: `[执行] ${typeName}完成（${finalStatus === "SUCCESS" ? "成功" : finalStatus === "STOPPED" ? "已停止" : "失败"}）`,
            content: `时间：${time}\n结果：${resultText}${isScheduleRun ? "\n来源：定时任务" : ""}`,
          },
          actorId: task.createdBy,
        });
      }
    } catch {
      // 通知失败不影响回调主链路（MSG-001 §2）
    }
  }
  return { idempotent: false, frames: frames.length };
}

/** 项目级启用中的误报规则（API-010：回调时读当前规则快照——仅对新执行生效）。 */
async function loadFalseAlarmRules(projectId: string): Promise<FalseAlarmRuleLike[]> {
  const rows = await prisma.falseAlarmRule.findMany({
    where: { projectId, enabled: true },
    select: { id: true, name: true, matcher: true },
  });
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      matcher: r.matcher as FalseAlarmRuleLike["matcher"],
      enabled: true,
    }))
    .filter((r) => r.matcher && typeof r.matcher === "object");
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
      reports: {
        select: { name: true, summary: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
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

  // item 汇总（api_case/scenario；按任务载荷顺序呈现——ExecItem 无排序列，uuid 序不稳定）
  const payloadRaw = task.payload as { items?: { caseId: string }[]; scenarioIds?: string[] };
  const payloadOrder = payloadRaw.items?.map((i) => i.caseId) ?? payloadRaw.scenarioIds ?? [];
  const orderedItems = [...items].sort(
    (a, b) => (payloadOrder.indexOf(a.refId) + 1 || 99) - (payloadOrder.indexOf(b.refId) + 1 || 99),
  );
  const reportRow = await prisma.report.findFirst({ where: { taskId }, select: { id: true } });
  const hits = reportRow
    ? await prisma.falseAlarmHit.findMany({
        where: { reportId: reportRow.id },
        select: { ruleName: true, stepPath: true, taskId: true },
      })
    : [];
  const itemViews = orderedItems.map((item) => {
    const frames = stepFrames.filter((s) => s.itemId === item.id).map((s) => s.frame);
    const stepResults = frames.filter(
      (f): f is Extract<EventFrame, { type: "step-result" }> => f.type === "step-result",
    );
    const stepResult = stepResults[0];
    return {
      itemId: item.id,
      refType: item.refType,
      refId: item.refId,
      status: item.status,
      durationMs:
        stepResults.reduce((s, f) => s + f.durationMs, 0) || (stepResult?.durationMs ?? null),
      assertTotal: stepResults.reduce((s, f) => s + f.asserts.length, 0),
      assertPassed: stepResults.reduce((s, f) => s + f.asserts.filter((a) => a.passed).length, 0),
      stepCount: stepResults.length,
      fakeAlarmHits: hits
        .filter((h) => h.taskId === taskId)
        .map((h) => ({ ruleName: h.ruleName, stepPath: h.stepPath ?? undefined })),
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
          body: "content" in payload.request.body ? payload.request.body.content : "(非文本请求体)",
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

function parseSummary(
  raw: string | null | undefined,
):
  | { total?: number; passed?: number; failed?: number; fakeError?: number; durationMs?: number }
  | undefined {
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

/** 场景步骤树视图（RPT-003 §4：帧 → stepPath 树 + 迭代分组 + 变量终值）。 */
export async function scenarioTree(projectId: string, taskId: string, itemId: string) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId, projectId },
    select: { id: true },
  });
  if (!task) throw new DomainError(ErrCode.TASK_NOT_FOUND, "任务不存在或无权访问");
  const item = await prisma.execItem.findFirst({
    where: { id: itemId, taskId },
    select: { id: true, status: true, result: true },
  });
  if (!item) throw new DomainError(ErrCode.TASK_NOT_FOUND, "执行项不存在");
  const name = (item.result as { name?: string } | null)?.name ?? item.id;
  const frames = (
    await prisma.execStepResult.findMany({
      where: { itemId },
      orderBy: { seq: "asc" },
      select: { frame: true },
    })
  ).map((r) => r.frame as unknown as Record<string, unknown>);
  const live = frames.length
    ? frames
    : (await readStream(taskId)).map((f) => f as unknown as Record<string, unknown>);
  return buildScenarioTree(
    item.id,
    name,
    item.status,
    live as unknown as Parameters<typeof buildScenarioTree>[3],
  );
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

export async function createShare(projectId: string, taskId: string, expireHours: number) {
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
