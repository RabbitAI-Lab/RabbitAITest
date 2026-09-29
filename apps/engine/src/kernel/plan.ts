/** S4 PLAN-003 计划执行内核：plan 任务逐 item 分派（api_case→单步管线；scenario→场景内核）。
 * 纯执行语义（无 DB）；串行/并行与失败停止循环在 runner/worker.ts（与 scenario 分支同构）。 */
import type Redis from "ioredis";
import type { EnvSnapshot, PlanItemCommand } from "@rabbit/shared/execution";
import type { EventWriter } from "../events.js";
import { runScenarioItem } from "./scenario.js";
import { runStep } from "../runner/step.js";

export interface PlanItemDeps {
  redis: Redis;
  writer: EventWriter;
  envVarUpdates: { name: string; value: string }[];
  /** 任务级 __counter（跨 item 连续） */
  counter: Map<string, number>;
}

export interface PlanItemOutcome {
  status: "SUCCESS" | "FAILED" | "STOPPED";
  message: string;
}

/** 单个 plan item：env 优先级=item 级（点配置）> 任务级；tempVars item 级隔离（与 scenario 批量同口径）。 */
export async function runPlanItem(
  deps: PlanItemDeps,
  taskEnv: EnvSnapshot | undefined,
  item: PlanItemCommand,
): Promise<PlanItemOutcome> {
  const env = item.envSnapshot ?? taskEnv;
  if (item.refKind === "scenario") {
    const r = await runScenarioItem(
      {
        redis: deps.redis,
        writer: deps.writer,
        env,
        tempVars: {},
        envVarUpdates: deps.envVarUpdates,
        counter: deps.counter,
      },
      item.command,
    );
    return { status: r.status, message: r.message };
  }
  const c = item.command;
  await deps.writer.emit({ type: "item-start", itemId: c.itemId, name: c.name });
  const r = await runStep(
    deps.redis,
    deps.writer,
    env,
    {},
    {
      itemId: c.itemId,
      name: c.name,
      moduleId: c.moduleId,
      request: c.request,
      asserts: c.asserts,
      pre: c.pre,
      post: c.post,
      extracts: c.extracts,
      counter: deps.counter,
    },
    deps.envVarUpdates,
  );
  await deps.writer.emit({
    type: "item-final",
    itemId: c.itemId,
    status: r.status,
    message: r.message ?? "",
  });
  return { status: r.status, message: r.message };
}
