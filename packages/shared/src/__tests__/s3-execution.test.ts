/** S3 shared 纯函数单测：函数库（EXEC-003）/ CSV（API-007）/ 误报匹配（API-010）/ 报告树聚合（RPT-003）/ jmx 映射（API-009）。 */
import { describe, expect, it } from "vitest";
import { renderFunctions, FUNCTION_CATALOG, type FunctionCtx } from "../execution/functions";
import { parseCsv } from "../execution/csv";
import {
  matchFalseAlarm,
  ruleMatchesStep,
  type FalseAlarmRuleLike,
} from "../execution/false-alarm";
import { buildScenarioTree, type TreeFrameInput } from "../execution/scenario-tree";
import { parseJmx } from "../execution/jmx";

function fixedCtx(vars: Record<string, string> = {}): FunctionCtx {
  // 固定随机源（确定性单测）
  let seed = 42;
  const random = (n: number) => {
    const out = Buffer.alloc(n);
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      out[i] = seed % 256;
    }
    return out;
  };
  return { vars: new Map(Object.entries(vars)), counter: new Map(), random };
}

describe("EXEC-003 函数库 renderFunctions", () => {
  it("纯变量渲染与未定义原样保留", () => {
    const w = { warnings: [] };
    expect(renderFunctions("hello ${name}", fixedCtx({ name: "rabbit" }), w)).toBe("hello rabbit");
    expect(renderFunctions("${missing}", fixedCtx(), w)).toBe("${missing}");
    expect(w.warnings).toContain("未定义变量 missing，原样保留");
  });

  it("点路径变量（row.col）与四级链由调用方合并后取值", () => {
    expect(renderFunctions("${row.name}", fixedCtx({ "row.name": "alice" }))).toBe("alice");
  });

  it("引擎函数：__counter 任务内连续 / __random 区间 / __UUID 形态 / __digest", () => {
    const ctx = fixedCtx();
    expect(renderFunctions("${__counter(order)}", ctx)).toBe("1");
    expect(renderFunctions("${__counter(order)}", ctx)).toBe("2");
    const r = Number(renderFunctions("${__random(1,9)}", ctx));
    expect(r).toBeGreaterThanOrEqual(1);
    expect(r).toBeLessThanOrEqual(9);
    expect(renderFunctions("${__UUID()}", ctx)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(renderFunctions("${__digest(md5,abc)}", ctx)).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("管道叠加：md5/base64/substr/toUpperCase/default", () => {
    const ctx = fixedCtx({ token: "abc", host: "", name: "rabbit" });
    expect(renderFunctions("${token|md5}", ctx)).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(renderFunctions("${token|base64}", ctx)).toBe("YWJj");
    expect(renderFunctions("${name|substr(0,3)}", ctx)).toBe("rab");
    expect(renderFunctions("${name|toUpperCase}", ctx)).toBe("RABBIT");
    expect(renderFunctions("${host|default(localhost)}", ctx)).toBe("localhost");
  });

  it("数据函数 @mock 与转义 \\${ @@、未知函数容忍", () => {
    const ctx = fixedCtx();
    expect(renderFunctions("@integer(5,5)", ctx)).toBe("5");
    expect(renderFunctions("@pick(A,B)", ctx)).toBe("A");
    expect(renderFunctions("@email()", ctx)).toMatch(/@/);
    const id = renderFunctions("@idcard()", ctx);
    expect(id).toMatch(/^\d{17}[\dX]$/); // 18 位含校验位
    expect(renderFunctions("\\${var}", ctx)).toBe("${var}");
    expect(renderFunctions("a@@b()", ctx)).toBe("a@b()");
    const w = { warnings: [] };
    expect(renderFunctions("${__nope()}", ctx, w)).toBe("${__nope()}");
    expect(w.warnings.join()).toContain("未知函数");
  });

  it("目录契约冻结：引擎 10 + 数据 12 + 管道 8", () => {
    expect(FUNCTION_CATALOG.filter((f) => f.group === "engine")).toHaveLength(10);
    expect(FUNCTION_CATALOG.filter((f) => f.group === "data")).toHaveLength(12);
    expect(FUNCTION_CATALOG.filter((f) => f.group === "pipe")).toHaveLength(8);
  });
});

describe("API-007 parseCsv", () => {
  it("表头/分隔符/引号转义/坏行跳过", () => {
    const r = parseCsv('name,email\nalice,"a,@x.io"\nbob,b@x.io\nbadrow\n', {
      delimiter: ",",
      hasHeader: true,
    });
    expect(r.columns).toEqual(["name", "email"]);
    expect(r.rows).toEqual([
      ["alice", "a,@x.io"],
      ["bob", "b@x.io"],
    ]);
    expect(r.skippedRows).toBe(1); // badrow 列数不一致
  });

  it("无表头 col1..colN 与分号分隔", () => {
    const r = parseCsv("a;b;c\n1;2;3\n", { delimiter: ";", hasHeader: false });
    expect(r.columns).toEqual(["col1", "col2", "col3"]);
    expect(r.rows).toHaveLength(2);
  });
});

describe("API-010 误报匹配", () => {
  const step = {
    status: 502,
    bodyText: "known-issue gateway",
    headers: [{ key: "X-Trace", value: "t1" }],
    responseTimeMs: 120,
  };
  const rule = (over: Partial<FalseAlarmRuleLike> = {}): FalseAlarmRuleLike => ({
    id: "r1",
    name: "网关抖动",
    enabled: true,
    matcher: { status: 502, bodyContains: "known-issue" },
    ...over,
  });

  it("AND 语义：全条件成立才命中", () => {
    expect(ruleMatchesStep(rule(), step)).toBe(true);
    expect(ruleMatchesStep(rule({ matcher: { status: 502, bodyContains: "other" } }), step)).toBe(
      false,
    );
    expect(ruleMatchesStep(rule({ matcher: { status: 500 } }), step)).toBe(false);
  });

  it("头包含与耗时上限", () => {
    expect(ruleMatchesStep(rule({ matcher: { headerContains: "X-Trace=t1" } }), step)).toBe(true);
    expect(ruleMatchesStep(rule({ matcher: { responseTimeGt: 100 } }), step)).toBe(true);
    expect(ruleMatchesStep(rule({ matcher: { responseTimeGt: 200 } }), step)).toBe(false);
  });

  it("多规则任一命中、停用规则跳过", () => {
    const hits = matchFalseAlarm(
      [rule(), rule({ id: "r2", name: "慢", matcher: { responseTimeGt: 10000 }, enabled: false })],
      [step],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ruleId: "r1", ruleName: "网关抖动" });
  });
});

describe("RPT-003 buildScenarioTree", () => {
  it("stepPath 树 + 迭代分组 + vars-final", () => {
    const frames: TreeFrameInput[] = [
      { type: "item-start", name: "s1" },
      {
        type: "step-result",
        stepPath: "0.0",
        stepName: "注册",
        iteration: 1,
        status: 200,
        durationMs: 10,
        asserts: [{ passed: true }],
      },
      {
        type: "step-result",
        stepPath: "0.0",
        stepName: "注册",
        iteration: 2,
        status: 200,
        durationMs: 12,
        asserts: [{ passed: true }],
      },
      {
        type: "step-result",
        stepPath: "0.0",
        stepName: "注册",
        iteration: 3,
        status: 200,
        durationMs: 5,
        asserts: [{ passed: false }],
      },
      { type: "step-skip", stepPath: "0.1", stepName: "条件组", reason: "condition" },
      {
        type: "step-op",
        stepPath: "0.2",
        stepName: "脚本",
        op: "script",
        status: "SUCCESS",
        durationMs: 3,
      },
      { type: "log", kind: "vars-final", message: JSON.stringify({ token: "t" }) },
    ];
    const tree = buildScenarioTree("item-1", "s1", "FAILED", frames);
    const loop = tree.tree[0];
    expect(loop?.kind).toBe("loop"); // 迭代帧父路径推断
    expect(loop?.iterations).toHaveLength(3);
    expect(loop?.iterations?.[2]?.children[0]?.status).toBe("FAILED");
    // 非迭代子级（stepPath 兄弟）留在 loop.children：条件跳过 + script
    const cond = loop?.children.find((n) => n.skipReason === "condition");
    expect(cond?.status).toBe("SKIPPED");
    const scriptNode = loop?.children.find((n) => n.kind === "script");
    expect(scriptNode?.status).toBe("SUCCESS");
    expect(tree.varsFinal).toEqual({ token: "t" });
    expect(tree.stats).toMatchObject({ total: 4, success: 3, failed: 1, skipped: 1 });
  });
});

describe("API-009 jmx 映射", () => {
  const jmx = `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2">
  <TestPlan testname="下单流程" enabled="true">
    <stringProp name="TestPlan.comments"></stringProp>
  </TestPlan>
  <hashTree>
    <ThreadGroup testname="TG" enabled="true">
      <LoopController>
        <stringProp name="LoopController.loops">3</stringProp>
      </LoopController>
    </ThreadGroup>
    <hashTree>
      <CSVDataSet testname="users" enabled="true">
        <stringProp name="filename"></stringProp>
        <stringProp name="variableNames">name,email</stringProp>
        <stringProp name="delimiter">,</stringProp>
      </CSVDataSet>
      <hashTree>
        <HTTPSamplerProxy testname="注册" enabled="true">
          <stringProp name="HTTPSampler.method">POST</stringProp>
          <stringProp name="HTTPSampler.domain">127.0.0.1</stringProp>
          <stringProp name="HTTPSampler.port">4000</stringProp>
          <stringProp name="HTTPSampler.path">/mock/10001/users</stringProp>
          <stringProp name="Argument.value">{"a":1}</stringProp>
        </HTTPSamplerProxy>
        <hashTree/>
      </hashTree>
      <ConstantTimer testname="等待" enabled="true">
        <stringProp name="ConstantTimer.delay">300</stringProp>
      </ConstantTimer>
    </hashTree>
  </hashTree>
</jmeterTestPlan>`;

  it("采样器/循环/CSV/等待映射与 warning", () => {
    const r = parseJmx(jmx);
    expect(r.scenarioName).toBe("下单流程");
    expect(r.csv?.columns).toEqual(["name", "email"]);
    const loop = r.steps.find((s) => s.stepType === "loop");
    expect(loop).toBeTruthy();
    const req = loop?.children.find((s) => s.stepType === "custom");
    const bundle = req?.config.bundle as { request: { url: string; body: { kind: string } } };
    expect(bundle.request.url).toBe("http://127.0.0.1:4000/mock/10001/users");
    expect(bundle.request.body.kind).toBe("raw_json");
    const hasWait = (nodes: { stepType: string; children: unknown[] }[]): boolean =>
      nodes.some(
        (s) =>
          s.stepType === "wait" ||
          hasWait((s.children ?? []) as { stepType: string; children: unknown[] }[]),
      );
    expect(hasWait(r.steps)).toBe(true);
    expect(r.warnings.join()).toContain("filename");
  });
});
