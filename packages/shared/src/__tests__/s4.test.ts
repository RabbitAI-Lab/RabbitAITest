/** S4 单测：测试点继承链 / 组聚合 / 一键总结草稿 / CSV / 脑图保存契约 / 执行契约 v4 plan 命令。 */
import { describe, expect, it } from "vitest";
import {
  buildPlanReportCsv,
  buildPlanSummaryDraft,
  csvEscape,
  mindmapSaveSchema,
  planCasesAddV2Schema,
  planGroupAggregate,
  pointUpsertSchema,
  resolvePointChain,
} from "../plan/schemas2";
import { execCommandSchema, eventFrameSchema, EXEC_CONTRACT_VERSION } from "../execution/schemas";

const CFG = (o: Record<string, unknown>) => o as never;

describe("resolvePointChain（PLAN-002 配置继承链）", () => {
  const planDefault = { envId: "env-plan", serial: true, stopOnFail: false } as never;

  it("inheritConfig=false 的显式配置截断继承", () => {
    const chain = resolvePointChain(
      [
        { id: "p1", parentId: null, inheritConfig: false, config: { envId: "env-a" } as never },
        { id: "p2", parentId: "p1", inheritConfig: true, config: {} as never },
      ],
      planDefault,
    );
    expect(chain.get("p1")?.envId).toBe("env-a");
    expect(chain.get("p2")?.envId).toBe("env-a"); // 沿链取最近显式（p1）
  });

  it("链尾无显式配置回退计划默认", () => {
    const chain = resolvePointChain(
      [
        { id: "p1", parentId: null, inheritConfig: true, config: {} as never },
        { id: "p2", parentId: "p1", inheritConfig: true, config: {} as never },
      ],
      planDefault,
    );
    expect(chain.get("p2")?.envId).toBe("env-plan");
    expect(chain.get("p2")?.serial).toBe(true);
  });

  it("环防御：parent 互指不栈溢出，回退默认", () => {
    const chain = resolvePointChain(
      [
        { id: "a", parentId: "b", inheritConfig: true, config: {} as never },
        { id: "b", parentId: "a", inheritConfig: true, config: {} as never },
      ],
      planDefault,
    );
    expect(chain.get("a")?.envId).toBe("env-plan");
  });

  it("深层链深度上限 20 生效不抛错", () => {
    const points = Array.from({ length: 30 }, (_, i) => ({
      id: `n${i}`,
      parentId: i === 0 ? null : `n${i - 1}`,
      inheritConfig: true,
      config: {} as never,
    }));
    const chain = resolvePointChain(points, planDefault);
    expect(chain.get("n29")?.envId).toBe("env-plan");
  });
});

describe("planGroupAggregate（PLAN-004 组聚合）", () => {
  it("空成员聚合为零值", () => {
    const agg = planGroupAggregate([]);
    expect(agg).toEqual({
      memberCount: 0,
      totalRefs: 0,
      executed: 0,
      passRate: null,
      thresholdMetCount: 0,
    });
  });

  it("progress/passRate/阈值 AND 口径", () => {
    const agg = planGroupAggregate([
      { id: "m1", name: "A", refs: [{ status: "PASS" }, { status: "PASS" }], threshold: 80 },
      { id: "m2", name: "B", refs: [{ status: "PASS" }, { status: "FAIL" }], threshold: 80 },
    ]);
    expect(agg.memberCount).toBe(2);
    expect(agg.totalRefs).toBe(4);
    expect(agg.passRate).toBe(75); // 3/4（planPassRate 同口径：skipped 不计分母）
    expect(agg.thresholdMetCount).toBe(1); // A 100%≥80 达标；B 50% 未达
  });
});

describe("buildPlanSummaryDraft / CSV（PLAN-005）", () => {
  it("草稿含达标判定与最薄弱点", () => {
    const draft = buildPlanSummaryDraft({
      planName: "回归V1",
      total: 10,
      executed: 8,
      passRate: 75,
      threshold: 80,
      fail: 2,
      blocked: 0,
      fakeError: 1,
      weakestPoint: "余额支付",
      lastRunAt: "2026-09-27T10:00:00Z",
    });
    expect(draft).toContain("未达标");
    expect(draft).toContain("最薄弱测试点：余额支付");
    expect(draft).toContain("误报 1 条");
  });

  it("无数据时通过率口径为暂无", () => {
    const draft = buildPlanSummaryDraft({
      planName: "空计划",
      total: 0,
      executed: 0,
      passRate: null,
      threshold: 100,
      fail: 0,
      blocked: 0,
      fakeError: 0,
      weakestPoint: null,
      lastRunAt: null,
    });
    expect(draft).toContain("暂无");
  });

  it("csvEscape 转义逗号/引号/换行", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape("l1\nl2")).toBe('"l1\nl2"');
    expect(csvEscape(null)).toBe("");
  });

  it("buildPlanReportCsv 输出 BOM 外的 CSV 体（BOM 路由层附加）", () => {
    const csv = buildPlanReportCsv([
      {
        point: "扫码",
        refType: "接口",
        name: "扫码下单,正向",
        executor: "张三",
        status: "通过",
        actualResult: "",
        lastRunAt: "t1",
        reportUrl: "/reports/x",
      },
    ]);
    expect(csv.split("\r\n")[0]).toBe(
      "测试点,用例类型,名称,执行人,状态,实际结果,最近执行,执行报告",
    );
    expect(csv).toContain('"扫码下单,正向"');
  });
});

describe("S4 契约 schema 校验", () => {
  it("planCasesAddV2Schema：三类至少一非空 + pointId", () => {
    expect(planCasesAddV2Schema.safeParse({ caseIds: [] }).success).toBe(false);
    const ok = planCasesAddV2Schema.safeParse({
      scenarioIds: ["00000000-0000-4000-8000-000000000001"],
      pointId: null,
    });
    expect(ok.success).toBe(true);
  });

  it("pointUpsertSchema 校验名称与 config 形状", () => {
    expect(pointUpsertSchema.safeParse({ name: "" }).success).toBe(false);
    expect(
      pointUpsertSchema.safeParse({ name: "点", inheritConfig: false, config: { serial: true } })
        .success,
    ).toBe(true);
  });

  it("mindmapSaveSchema：空提交合法（幂等）；坏 tmpId 拒绝", () => {
    expect(mindmapSaveSchema.safeParse({}).success).toBe(true);
    expect(
      mindmapSaveSchema.safeParse({ cases: { created: [{ tmpId: "", name: "x" }] } }).success,
    ).toBe(false);
  });

  it("执行契约 v4→v6：plan 命令解析（additive；旧分支不受影响；v5=S11 ui_case/ui_batch+ui-screenshot 帧；v6=S13 ui_validate+script 模式+ui-trace 帧）", () => {
    expect(EXEC_CONTRACT_VERSION).toBe(6);
    const UUID = "00000000-0000-4000-8000-000000000001";
    const cmd = execCommandSchema.safeParse({
      taskId: UUID,
      projectId: UUID,
      type: "plan",
      planId: UUID,
      stopOnFail: true,
      mode: "serial",
      items: [
        {
          refKind: "api_case",
          command: {
            itemId: UUID,
            caseId: UUID,
            name: "接口用例",
            moduleId: UUID,
            request: {
              method: "GET",
              url: "https://x",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
            },
          },
        },
      ],
    });
    expect(cmd.success).toBe(true);
    if (cmd.success && cmd.data.type === "plan") {
      expect(cmd.data.items[0]!.refKind).toBe("api_case");
      expect(cmd.data.stopOnFail).toBe(true);
    }
    // 旧 api_case 分支依旧可解析（additive 兼容）
    expect(
      execCommandSchema.safeParse({
        taskId: UUID,
        projectId: UUID,
        type: "api_case",
        items: [
          {
            itemId: UUID,
            caseId: UUID,
            name: "c",
            moduleId: UUID,
            request: {
              method: "GET",
              url: "https://x",
              headers: [],
              query: [],
              body: { kind: "none" },
              auth: { kind: "none" },
            },
          },
        ],
      }).success,
    ).toBe(true);
    // v6（S13 UIT-003）：ui_case script 模式分支 + ui_validate 命令 + ui-trace 帧
    const scriptCmd = execCommandSchema.safeParse({
      taskId: UUID,
      projectId: UUID,
      type: "ui_case",
      itemId: UUID,
      caseId: UUID,
      name: "脚本用例",
      mode: "script",
      steps: [],
      script: "import { test } from '@playwright/test';\n",
      params: [{ key: "BASEURL", value: "http://127.0.0.1:1" }],
      timeoutMs: 30000,
    });
    expect(scriptCmd.success).toBe(true);
    if (scriptCmd.success && scriptCmd.data.type === "ui_case") {
      expect(scriptCmd.data.mode).toBe("script");
      expect(scriptCmd.data.steps).toEqual([]);
    }
    // v5 ui_case steps 模式缺省兼容（mode/steps 缺省）
    const stepsCmd = execCommandSchema.safeParse({
      taskId: UUID,
      projectId: UUID,
      type: "ui_case",
      itemId: UUID,
      caseId: UUID,
      name: "步骤用例",
      steps: [{ op: "goto", url: "http://127.0.0.1:1/x" }],
      timeoutMs: 15000,
    });
    expect(stepsCmd.success && stepsCmd.data.type === "ui_case" && stepsCmd.data.mode).toBe(
      "steps",
    );
    expect(
      execCommandSchema.safeParse({
        taskId: UUID,
        projectId: UUID,
        type: "ui_validate",
        itemId: UUID,
        name: "校验",
        script: "test('x', async () => {});",
      }).success,
    ).toBe(true);
    expect(
      eventFrameSchema.safeParse({
        taskId: UUID,
        seq: 1,
        ts: Date.now(),
        type: "ui-trace",
        itemId: UUID,
        fileId: UUID,
        name: "trace.zip",
      }).success,
    ).toBe(true);
  });
});
