/** S4 PLAN-003 计划执行：引擎任务构造（点配置继承链）+ 回调回写（PlanCaseRef 状态/自动更新/计划刷新）。
 * 子命令复用 exec.service 构造器（buildApiCaseCommands/buildScenarioCommands——引用解析/CSV 预解析同源）。 */
import { DomainError, ErrCode, resolvePointChain } from "@rabbit/shared";
import type { PointConfig } from "@rabbit/shared";
import type {
  ExecItemCommand,
  PlanItemCommand,
  ScenarioItemCommand,
} from "@rabbit/shared/execution";
import { prisma } from "@rabbit/db";
import { execQueueFor } from "@/server/redis";
import { assertPoolExecutable } from "@/server/domains/system/pool.service";
import { buildEnvSnapshot } from "@/server/domains/project/environment.service";
import { buildApiCaseCommands, buildScenarioCommands } from "@/server/domains/exec/exec.service";

export interface PlanExecuteInput {
  pointId?: string;
  mode?: "serial" | "parallel";
  stopOnFail?: boolean;
  envId?: string | null;
  poolId?: string | null;
}

/** 显式入参 > 点生效配置（继承链）> 计划默认（settings.execConfig）。 */
function pickEnv(
  explicit: PlanExecuteInput,
  chain: PointConfig | undefined,
  planDefault: PointConfig,
): string | undefined {
  if (explicit.envId !== undefined && explicit.envId !== null) return explicit.envId;
  if (chain?.envId !== undefined && chain?.envId !== null) return chain.envId;
  return planDefault.envId ?? undefined;
}

function pickStopOnFail(
  explicit: PlanExecuteInput,
  chain: PointConfig | undefined,
  planDefault: PointConfig,
): boolean {
  if (explicit.stopOnFail !== undefined) return explicit.stopOnFail;
  if (chain?.stopOnFail !== undefined) return chain.stopOnFail;
  return planDefault.stopOnFail ?? false;
}

/** 计划引擎执行任务（PLAN-003 §2）：refType∈{api_case, scenario} 的 refs → ExecTask(type=plan) + plan_case items → 入队。 */
export async function createPlanTask(
  projectId: string,
  planId: string,
  userId: string,
  input: PlanExecuteInput,
) {
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, projectId, deletedAt: null },
    select: { id: true, name: true, archivedAt: true, settings: true },
  });
  if (!plan) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "计划不存在或已删除");
  if (plan.archivedAt) throw new DomainError(ErrCode.PLAN_ARCHIVED, "计划已归档，只读");
  // 范围点先校验存在性（坏 pointId → 404 POINT_NOT_FOUND，先于空集 50012 判定）
  if (input.pointId) {
    const point = await prisma.testPoint.findFirst({
      where: { id: input.pointId, planId },
      select: { id: true },
    });
    if (!point) throw new DomainError(ErrCode.POINT_NOT_FOUND, "测试点不存在");
  }

  const refs = await prisma.planCaseRef.findMany({
    where: {
      planId,
      refType: { in: ["api_case", "scenario"] },
      ...(input.pointId ? { pointId: input.pointId } : {}),
    },
    orderBy: { id: "asc" },
    select: { id: true, refType: true, refId: true, pointId: true },
  });
  if (refs.length === 0)
    throw new DomainError(
      ErrCode.PLAN_NO_EXECUTABLE,
      "计划内没有可引擎执行的用例（接口用例/场景）",
    );

  const settings = (plan.settings ?? {}) as {
    threshold?: number;
    autoUpdateStatus?: boolean;
    execConfig?: PointConfig;
  };
  const planDefault: PointConfig = (settings.execConfig ?? {}) as PointConfig;
  const points = await prisma.testPoint.findMany({
    where: { planId },
    select: { id: true, parentId: true, inheritConfig: true, config: true },
  });
  const chain = resolvePointChain(
    points.map((p) => ({
      id: p.id,
      parentId: p.parentId,
      inheritConfig: p.inheritConfig,
      config: (p.config ?? {}) as PointConfig,
    })),
    planDefault,
  );

  const mode = input.mode ?? (planDefault.serial === false ? "parallel" : "serial");
  const stopOnFail = pickStopOnFail(input, undefined, planDefault);
  const taskEnvId = input.envId ?? planDefault.envId ?? undefined;
  const taskEnv = await buildEnvSnapshot(projectId, taskEnvId);
  // 点级 env 快照缓存（同 envId 复用；未配置点回落任务级）
  const envCache = new Map<string, Awaited<ReturnType<typeof buildEnvSnapshot>>>();
  const envOf = async (envId: string | null | undefined) => {
    if (!envId) return undefined;
    if (!envCache.has(envId)) envCache.set(envId, await buildEnvSnapshot(projectId, envId));
    return envCache.get(envId);
  };

  // 子命令构造（批量复用构造器；空集跳过——构造器对空集抛 NOT_FOUND）
  const apiRefs = refs.filter((r) => r.refType === "api_case");
  const scenarioRefs = refs.filter((r) => r.refType === "scenario");
  const apiCommands = new Map(
    apiRefs.length > 0
      ? (
          await buildApiCaseCommands(
            projectId,
            apiRefs.map((r) => r.refId),
          )
        ).map((c) => [c.caseId, c])
      : [],
  );
  const { commands: scenarioCommands, warnings } =
    scenarioRefs.length > 0
      ? await buildScenarioCommands(
          projectId,
          scenarioRefs.map((r) => r.refId),
        )
      : { commands: [], warnings: [] };
  const scenarioCommandMap = new Map(scenarioCommands.map((c) => [c.scenarioId, c]));
  // ENTP-006：池校验 + 回落默认池（旧行为 null → 默认池；单池语义不变）
  const planOrg = await prisma.project.findUnique({
    where: { id: projectId },
    select: { orgId: true },
  });
  const poolId = await assertPoolExecutable(
    input.poolId ?? planDefault.poolId ?? null,
    planOrg?.orgId ?? null,
  );

  const created = await prisma.$transaction(async (tx) => {
    const task = await tx.execTask.create({
      data: {
        projectId,
        type: "plan",
        refType: "plan",
        refId: planId,
        status: "PENDING",
        // ENTP-006：入口池校验（存在/ACTIVE/应用组织）→ 未配置回落默认池（旧行为：null）
        poolId,
        envId: taskEnvId ?? null,
        payload: {
          planId,
          planName: plan.name,
          pointId: input.pointId ?? null,
          mode,
          stopOnFail,
          refIds: refs.map((r) => r.id),
          warnings,
        },
        createdBy: userId,
      },
      select: { id: true },
    });
    const items: PlanItemCommand[] = [];
    for (const ref of refs) {
      const pointCfg = ref.pointId ? chain.get(ref.pointId) : undefined;
      const refEnvId = pickEnv(input, pointCfg, planDefault) ?? null;
      const itemEnv = refEnvId && refEnvId !== taskEnvId ? await envOf(refEnvId) : undefined;
      const item = await tx.execItem.create({
        data: { taskId: task.id, refType: "plan_case", refId: ref.id, status: "PENDING" },
        select: { id: true },
      });
      if (ref.refType === "api_case") {
        const c = apiCommands.get(ref.refId) as Omit<ExecItemCommand, "itemId"> | undefined;
        if (c)
          items.push({
            refKind: "api_case",
            ...(itemEnv ? { envSnapshot: itemEnv } : {}),
            command: { itemId: item.id, ...c },
          });
      } else {
        const c = scenarioCommandMap.get(ref.refId) as
          | Omit<ScenarioItemCommand, "itemId">
          | undefined;
        if (c)
          items.push({
            refKind: "scenario",
            ...(itemEnv ? { envSnapshot: itemEnv } : {}),
            command: { itemId: item.id, ...c },
          });
      }
    }
    return { taskId: task.id, items };
  });

  if (created.items.length === 0)
    throw new DomainError(
      ErrCode.PLAN_NO_EXECUTABLE,
      "计划内没有可引擎执行的用例（接口用例/场景）",
    );

  await execQueueFor(poolId).add(
    "exec",
    {
      taskId: created.taskId,
      projectId,
      type: "plan",
      planId,
      stopOnFail,
      mode,
      items: created.items,
      ...(taskEnv ? { envSnapshot: taskEnv } : {}),
    },
    { jobId: created.taskId, attempts: 2, backoff: { type: "exponential", delay: 2000 } },
  );
  return { taskId: created.taskId, itemCount: created.items.length, warnings };
}

/** 单条引擎执行（refType 限 api_case/scenario；构造单项 plan 任务——报告与计划链路一致）。 */
export async function runPlanCaseRef(
  projectId: string,
  planId: string,
  refId: string,
  userId: string,
) {
  const ref = await prisma.planCaseRef.findFirst({
    where: { id: refId, planId, refType: { in: ["api_case", "scenario"] } },
    select: { id: true, pointId: true },
  });
  if (!ref) throw new DomainError(ErrCode.PLAN_NOT_FOUND, "关联记录不存在或不支持引擎执行");
  return createPlanTask(projectId, planId, userId, {
    pointId: ref.pointId ?? undefined,
    mode: "serial",
    stopOnFail: false,
  });
}

/** 计划执行历史（ExecTask type=plan 列表）。 */
export async function listPlanExecutions(
  projectId: string,
  planId: string,
  page = 1,
  pageSize = 20,
) {
  const where = { projectId, type: "plan", refType: "plan", refId: planId };
  const [total, tasks] = await Promise.all([
    prisma.execTask.count({ where }),
    prisma.execTask.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        durationMs: true,
        createdBy: true,
        payload: true,
        _count: { select: { items: true } },
      },
    }),
  ]);
  return {
    total,
    items: tasks.map((t) => ({
      taskId: t.id,
      status: t.status,
      itemCount: t._count.items,
      durationMs: t.durationMs,
      createdAt: t.createdAt.toISOString(),
      finishedAt: t.finishedAt?.toISOString() ?? null,
      createdBy: t.createdBy,
    })),
  };
}

const ITEM_STATUS_TO_REF: Record<string, string> = {
  SUCCESS: "PASS",
  FAILED: "FAIL",
  FAKE_ERROR: "FAIL",
  SKIPPED: "SKIPPED",
  STOPPED: "NOT_RUN",
  PENDING: "NOT_RUN",
};

/** 回调回写（handleCallback 事务后调用）：item 状态 → PlanCaseRef + 自动更新状态 + 计划状态/报告刷新。 */
export async function applyPlanTaskResult(
  taskId: string,
  projectId: string,
  items: { id: string; refId: string; status: string }[],
) {
  const task = await prisma.execTask.findFirst({
    where: { id: taskId },
    select: { createdBy: true, payload: true },
  });
  const planId = (task?.payload as { planId?: string } | null)?.planId;
  if (!planId) return;
  const plan = await prisma.testPlan.findFirst({
    where: { id: planId, projectId },
    select: { settings: true },
  });
  if (!plan) return;
  const settings = (plan.settings ?? {}) as { autoUpdateStatus?: boolean };
  const now = new Date().toISOString();

  const passRefIds: string[] = [];
  for (const item of items) {
    const next = ITEM_STATUS_TO_REF[item.status] ?? "NOT_RUN";
    const ref = await prisma.planCaseRef.findFirst({
      where: { id: item.refId, planId },
      select: { id: true, status: true, execHistory: true, refType: true, refId: true },
    });
    if (!ref) continue;
    if (ref.status === next) continue;
    const history = (ref.execHistory ?? []) as {
      ts: string;
      userId: string;
      from: string;
      to: string;
      source?: string;
    }[];
    history.push({
      ts: now,
      userId: task?.createdBy ?? "system",
      from: ref.status,
      to: next,
      source: "engine",
    });
    await prisma.planCaseRef.update({
      where: { id: ref.id },
      data: {
        status: next,
        result: { reportTaskId: taskId, lastRunAt: now },
        execHistory: history,
      },
    });
    if (next === "PASS") passRefIds.push(ref.id);
  }

  // 自动更新状态（PLAN-003 §2：仅 PASS 方向；接口/场景 PASS → CASE-006 关联功能用例自动标 PASS）
  if (settings.autoUpdateStatus && passRefIds.length > 0) {
    const passRefs = await prisma.planCaseRef.findMany({
      where: { id: { in: passRefIds }, planId },
      select: { refType: true, refId: true },
    });
    const caseApiRefs = await prisma.caseApiRef.findMany({
      where: { OR: passRefs.map((r) => ({ refType: r.refType, refId: r.refId })) },
      select: { caseId: true },
    });
    const caseIds = [...new Set(caseApiRefs.map((c) => c.caseId))];
    if (caseIds.length > 0) {
      const fnRefs = await prisma.planCaseRef.findMany({
        where: { planId, refType: "functional_case", refId: { in: caseIds }, status: "NOT_RUN" },
        select: { id: true, execHistory: true },
      });
      for (const fr of fnRefs) {
        const history = (fr.execHistory ?? []) as {
          ts: string;
          userId: string;
          from: string;
          to: string;
          source?: string;
        }[];
        history.push({
          ts: now,
          userId: task?.createdBy ?? "system",
          from: "NOT_RUN",
          to: "PASS",
          source: "auto",
        });
        await prisma.planCaseRef.update({
          where: { id: fr.id },
          data: {
            status: "PASS",
            result: { autoBy: taskId, lastRunAt: now },
            execHistory: history,
          },
        });
      }
    }
  }

  // 计划状态推进 + 报告刷新（plan 域内收敛；报告视图懒构建见 plan-report.service）
  const { refreshPlanStatus } = await import("@/server/domains/plan/plan.service");
  await refreshPlanStatus(planId);
}
