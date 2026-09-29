import { describe, expect, it, vi, beforeEach } from "vitest";
import type Redis from "ioredis";
import type { ScenarioItemCommand, ScenarioStepNode } from "@rabbit/shared/execution";
import type { EventWriter } from "../events.js";
import { runScenarioItem } from "../kernel/scenario.js";

/** runStep 打桩：记录调用（stepPath/iteration/tempVars 快照），url 含 "fail" 返回失败。 */
vi.mock("../runner/step.js", () => ({ runStep: vi.fn() }));
import { runStep } from "../runner/step.js";
const runStepMock = vi.mocked(runStep);

interface Call {
  url: string;
  stepPath: string | undefined;
  iteration: number | undefined;
  vars: Record<string, string>;
}

const UUID = "00000000-0000-4000-8000-000000000001";

function customStep(name: string, url: string): ScenarioStepNode {
  return {
    uid: `u-${name}`,
    stepType: "custom",
    name,
    enabled: true,
    config: {
      bundle: {
        request: {
          method: "GET",
          url,
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
        },
        asserts: [],
        pre: [],
        post: [],
        extracts: [],
      },
    },
    children: [],
  };
}

function makeItem(
  over: Partial<ScenarioItemCommand> & { steps: ScenarioStepNode[] },
): ScenarioItemCommand {
  return {
    itemId: UUID,
    scenarioId: UUID,
    name: "场景",
    params: { constants: [], lists: [], csv: { columns: [], rows: [] } },
    settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "abort" },
    pre: [],
    post: [],
    asserts: [],
    ...over,
  };
}

function makeDeps(vars: Record<string, string> = {}) {
  const frames: { type: string }[] = [];
  const writer = {
    emit: vi.fn(async (f: { type: string }) => {
      frames.push(f);
    }),
  } as unknown as EventWriter;
  const redis = { exists: vi.fn(async () => 0) } as unknown as Redis;
  return {
    redis,
    writer,
    env: undefined,
    tempVars: { ...vars },
    envVarUpdates: [],
    counter: new Map(),
    frames,
  };
}

beforeEach(() => {
  runStepMock.mockReset();
});

describe("runScenarioItem（API-006 控制器语义）", () => {
  it("顺序执行：两步全成 → SUCCESS，stepPath 按执行序 0/1", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, vars, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: { ...vars },
      });
      return { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({ steps: [customStep("a", "/a"), customStep("b", "/b")] }),
    );
    expect(out.status).toBe("SUCCESS");
    expect(calls.map((c) => c.stepPath)).toEqual(["0.0", "0.1"]);
  });

  it("count 循环：count=2 包 1 子步骤 → 2 次执行，iteration=1/2，stepPath=0.0", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, _v, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: {},
      });
      return { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({
        steps: [
          {
            uid: "u-loop",
            stepType: "loop",
            name: "循环",
            enabled: true,
            config: { mode: "count", count: 2 },
            children: [customStep("s", "/s")],
          },
        ],
      }),
    );
    expect(out.status).toBe("SUCCESS");
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.iteration)).toEqual([1, 2]);
    expect(calls[0]?.stepPath).toBe("0.0.0");
  });

  it("foreach 循环：iterations 3 行逐行注入迭代变量（item=row 值，row 保留字）", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, vars, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: { ...vars },
      });
      return { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({
        steps: [
          {
            uid: "u-fe",
            stepType: "loop",
            name: "遍历",
            enabled: true,
            config: {
              mode: "foreach",
              var: "user",
              source: "users",
              iterations: [
                { value: "alice", row: { users: "alice", email: "a@x.io" } },
                { value: "bob", row: { users: "bob", email: "b@x.io" } },
                { value: "carol", row: { users: "carol", email: "c@x.io" } },
              ],
            },
            children: [customStep("s", "/s")],
          },
        ],
      }),
    );
    expect(out.status).toBe("SUCCESS");
    expect(calls).toHaveLength(3);
    expect(calls.map((c) => c.vars["user"])).toEqual(["alice", "bob", "carol"]);
    expect(calls[1]?.vars["row.email"]).toBe("b@x.io");
  });

  it("失败规则=abort：首步失败 → 余步不执行（SKIPPED），item=FAILED", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, _v, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: {},
      });
      return step.request.url.includes("fail")
        ? { status: "FAILED", message: "断言失败" }
        : { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({ steps: [customStep("bad", "/fail"), customStep("next", "/ok")] }),
    );
    expect(out.status).toBe("FAILED");
    expect(out.failureKind).toBe("ASSERT_FAILED");
    expect(calls).toHaveLength(1);
    const skips = deps.frames.filter((f) => f.type === "step-skip");
    expect(skips.length).toBeGreaterThanOrEqual(1);
  });

  it("失败规则=continue：失败步骤后余步仍执行，item=FAILED（有失败）", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, _v, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: {},
      });
      return step.request.url.includes("fail")
        ? { status: "FAILED", message: "断言失败" }
        : { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({
        settings: { cookieMode: "off", thinkTimeMs: 0, onFailure: "continue" },
        steps: [customStep("bad", "/fail"), customStep("next", "/ok")],
      }),
    );
    expect(out.status).toBe("FAILED");
    expect(calls.map((c) => c.url)).toEqual(["/fail", "/ok"]);
  });

  it("condition 表达式为 false → 子树 SKIPPED，item=SUCCESS", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, _v, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: {},
      });
      return { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps({ flag: "0" });
    const out = await runScenarioItem(
      deps,
      makeItem({
        steps: [
          {
            uid: "u-cond",
            stepType: "condition",
            name: "条件",
            enabled: true,
            config: { expression: 'getVar("flag") === "1"' },
            children: [customStep("inner", "/inner")],
          },
        ],
      }),
    );
    expect(out.status).toBe("SUCCESS");
    expect(calls).toHaveLength(0);
    const skip = deps.frames.find((f) => f.type === "step-skip");
    expect(skip).toBeTruthy();
  });

  it("script 步骤写变量 → 后续步骤 tempVars 可见；wait 步骤不发请求", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, vars, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: { ...vars },
      });
      return { status: "SUCCESS", message: "" };
    });
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({
        steps: [
          {
            uid: "u-sc",
            stepType: "script",
            name: "脚本",
            enabled: true,
            config: { script: 'setVar("token", "abc")' },
            children: [],
          },
          {
            uid: "u-wait",
            stepType: "wait",
            name: "等待",
            enabled: true,
            config: { ms: 5 },
            children: [],
          },
          customStep("use", "/use"),
        ],
      }),
    );
    expect(out.status).toBe("SUCCESS");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.vars["token"]).toBe("abc");
    const stepOps = deps.frames.filter((f) => f.type === "step-op");
    expect(stepOps.length).toBeGreaterThanOrEqual(2); // script + wait
  });

  it("禁用步骤 → 不执行（step-skip reason=disabled）", async () => {
    const calls: Call[] = [];
    runStepMock.mockImplementation(async (_r, _w, _e, _v, step) => {
      calls.push({
        url: step.request.url,
        stepPath: step.stepPath,
        iteration: step.iteration,
        vars: {},
      });
      return { status: "SUCCESS", message: "" };
    });
    const off = customStep("off", "/off");
    off.enabled = false;
    const deps = makeDeps();
    const out = await runScenarioItem(deps, makeItem({ steps: [off, customStep("on", "/on")] }));
    expect(out.status).toBe("SUCCESS");
    expect(calls.map((c) => c.url)).toEqual(["/on"]);
    expect(deps.frames.some((f) => f.type === "step-skip")).toBe(true);
  });

  it("场景变量断言：kind=variable 对终态求值失败 → item=FAILED", async () => {
    runStepMock.mockImplementation(async () => ({ status: "SUCCESS", message: "" }));
    const deps = makeDeps();
    const out = await runScenarioItem(
      deps,
      makeItem({
        asserts: [{ kind: "variable", path: "token", op: "eq", expected: "xyz" }],
        steps: [customStep("s", "/s")],
      }),
    );
    expect(out.status).toBe("FAILED");
    expect(out.failureKind).toBe("ASSERT_FAILED");
  });

  it("vars-final 帧：终态变量合并序列化在 log(kind=vars-final)", async () => {
    runStepMock.mockImplementation(async () => ({ status: "SUCCESS", message: "" }));
    const deps = makeDeps();
    await runScenarioItem(
      deps,
      makeItem({
        params: {
          constants: [{ name: "host", value: "h1", description: "" }],
          lists: [],
          csv: { columns: [], rows: [] },
        },
        steps: [customStep("s", "/s")],
      }),
    );
    const vf = deps.frames.find(
      (f) => f.type === "log" && (f as { kind?: string }).kind === "vars-final",
    ) as { message: string } | undefined;
    expect(vf).toBeTruthy();
    expect(JSON.parse(vf!.message)).toMatchObject({ host: "h1" });
  });
});
