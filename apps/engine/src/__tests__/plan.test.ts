import { describe, expect, it, vi } from "vitest";
import type Redis from "ioredis";
import type { PlanItemCommand } from "@rabbit/shared/execution";
import type { EventWriter } from "../events.js";
import { runPlanItem } from "../kernel/plan.js";
import type { ScenarioItemOutcome } from "../kernel/scenario.js";

/** runStep / runScenarioItem 打桩：api_case 走 runStep（url 含 "fail" 失败）；scenario 走内核桩。 */
vi.mock("../runner/step.js", () => ({ runStep: vi.fn() }));
vi.mock("../kernel/scenario.js", () => ({ runScenarioItem: vi.fn() }));
import { runStep } from "../runner/step.js";
import { runScenarioItem } from "../kernel/scenario.js";
const runStepMock = vi.mocked(runStep);
const runScenarioMock = vi.mocked(runScenarioItem);

const UUID1 = "00000000-0000-4000-8000-000000000001";
const UUID2 = "00000000-0000-4000-8000-000000000002";

function apiCaseItem(url: string): PlanItemCommand {
  return {
    refKind: "api_case",
    command: {
      itemId: UUID1,
      caseId: UUID2,
      name: `接口用例 ${url}`,
      moduleId: UUID2,
      request: {
        method: "GET",
        url,
        headers: [],
        query: [],
        body: { kind: "none" },
        auth: { kind: "none" },
        timeoutMs: 10000,
        followRedirects: false,
        skipPre: false,
        skipPost: false,
      } as never,
      asserts: [],
      pre: [],
      post: [],
      extracts: [],
    } as never,
  };
}

function scenarioItem(): PlanItemCommand {
  return {
    refKind: "scenario",
    command: {
      itemId: UUID1,
      scenarioId: UUID2,
      name: "场景",
      params: { constants: [], lists: [], csv: { columns: [], rows: [] } },
      settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
      pre: [],
      post: [],
      asserts: [],
      steps: [],
    },
  };
}

function makeDeps() {
  const frames: { type: string; itemId?: string }[] = [];
  const writer = {
    taskIdValue: UUID1,
    emit: vi.fn(async (f: { type: string; itemId?: string }) => {
      frames.push(f);
    }),
  } as unknown as EventWriter;
  const redis = { exists: vi.fn(async () => 0) } as unknown as Redis;
  return { redis, writer, envVarUpdates: [], counter: new Map<string, number>(), frames };
}

function stepOutcome(status: "SUCCESS" | "FAILED" | "STOPPED") {
  return { status, message: status === "SUCCESS" ? "" : "boom" };
}

describe("runPlanItem（PLAN-003 计划内核分派）", () => {
  it("api_case：item-start → runStep → item-final 透传状态", async () => {
    runStepMock.mockResolvedValueOnce(stepOutcome("FAILED"));
    const deps = makeDeps();
    const out = await runPlanItem(deps, undefined, apiCaseItem("https://x/fail"));
    expect(out.status).toBe("FAILED");
    expect(runStepMock).toHaveBeenCalledTimes(1);
    const stepArg = runStepMock.mock.calls[0]![4] as { itemId: string; name: string };
    expect(stepArg.itemId).toBe(UUID1);
    const types = deps.frames.map((f) => f.type);
    expect(types[0]).toBe("item-start");
    expect(types[types.length - 1]).toBe("item-final");
  });

  it("scenario：分派 runScenarioItem（含 item 级 tempVars 隔离入参）", async () => {
    runScenarioMock.mockResolvedValueOnce({
      status: "SUCCESS",
      message: "",
    } satisfies ScenarioItemOutcome);
    const deps = makeDeps();
    const out = await runPlanItem(deps, undefined, scenarioItem());
    expect(out.status).toBe("SUCCESS");
    expect(runScenarioMock).toHaveBeenCalledTimes(1);
    const scenarioDeps = runScenarioMock.mock.calls[0]![0] as { tempVars: Record<string, string> };
    expect(scenarioDeps.tempVars).toEqual({}); // item 级隔离（不跨计划用例共享 temp）
  });

  it("env 优先级：item 级（点配置）覆盖任务级", async () => {
    runScenarioMock.mockReset();
    runScenarioMock.mockResolvedValue({
      status: "SUCCESS",
      message: "",
    } satisfies ScenarioItemOutcome);
    runScenarioMock.mockResolvedValueOnce({
      status: "SUCCESS",
      message: "",
    } satisfies ScenarioItemOutcome);
    const deps = makeDeps();
    const taskEnv = { name: "task" } as never;
    const itemEnv = { name: "point" } as never;
    await runPlanItem(deps, taskEnv, { ...scenarioItem(), envSnapshot: itemEnv });
    const scenarioDeps = runScenarioMock.mock.calls.at(-1)![0] as unknown as {
      env: { name: string };
    };
    expect(scenarioDeps.env?.name).toBe("point");
    // 缺省回落任务级
    await runPlanItem(deps, taskEnv, scenarioItem());
    const fallback = runScenarioMock.mock.calls.at(-1)![0] as unknown as { env: { name: string } };
    expect(fallback.env?.name).toBe("task");
  });

  it("api_case STOPPED 透传（协作式停止）", async () => {
    runStepMock.mockResolvedValueOnce(stepOutcome("STOPPED"));
    const deps = makeDeps();
    const out = await runPlanItem(deps, undefined, apiCaseItem("https://x/ok"));
    expect(out.status).toBe("STOPPED");
  });
});
