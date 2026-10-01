/** UIT-003-T1：脚本模式 schema 矩阵（mode 二态条件校验/params/上限；存量 steps 语义零回归）。 */
import { describe, expect, it } from "vitest";
import {
  uiCaseCreateSchema,
  uiCaseUpdateSchema,
  uiCaseItemCommandSchema,
  uiParamEnvKey,
  uiParamSchema,
  uiStepsSchema,
  UIT_SCRIPT_LIMITS,
} from "../uit/schemas";

const UUID = "00000000-0000-4000-8000-000000000001";
const SCRIPT = `import { test, expect } from '@playwright/test';
test('demo', async ({ page }) => {
  await page.goto('http://127.0.0.1:1/');
  await expect(page.locator('body')).toBeVisible();
});`;

describe("UIT-003-T1 脚本模式 schema（mode 二态条件校验）", () => {
  it("script 模式：合法载荷（script/params/timeoutMs）解析通过并保留缺省", () => {
    const c = uiCaseCreateSchema.parse({
      name: "脚本用例",
      mode: "script",
      script: SCRIPT,
      params: [{ key: "BASEURL", value: "http://127.0.0.1:4000" }],
      timeoutMs: 30000,
    });
    expect(c.mode).toBe("script");
    expect(c.steps).toEqual([]);
    expect(c.params).toHaveLength(1);
    expect(c.timeoutMs).toBe(30000);
  });

  it("script 模式：缺 script / 空 script / 超长 script 均拒绝", () => {
    expect(uiCaseCreateSchema.safeParse({ name: "x", mode: "script" }).success).toBe(false);
    expect(uiCaseCreateSchema.safeParse({ name: "x", mode: "script", script: "  " }).success).toBe(
      false,
    );
    expect(
      uiCaseCreateSchema.safeParse({
        name: "x",
        mode: "script",
        script: "a".repeat(UIT_SCRIPT_LIMITS.scriptMaxChars + 1),
      }).success,
    ).toBe(false);
    // script 模式超时上限 300s（步骤模式 60s 由 superRefine 单独卡）
    expect(
      uiCaseCreateSchema.safeParse({ name: "x", mode: "script", script: SCRIPT, timeoutMs: 300001 })
        .success,
    ).toBe(false);
  });

  it("steps 模式（缺省）：存量语义零回归（空步骤/悬空元素引用/超时>60s 拒绝）", () => {
    expect(uiCaseCreateSchema.safeParse({ name: "x", steps: [] }).success).toBe(false);
    expect(uiCaseCreateSchema.safeParse({ name: "x", steps: [{ op: "click" }] }).success).toBe(
      false,
    );
    expect(
      uiCaseCreateSchema.safeParse({
        name: "x",
        steps: [{ op: "wait", ms: 100 }],
        timeoutMs: 60001,
      }).success,
    ).toBe(false);
    const ok = uiCaseCreateSchema.parse({ name: "x", steps: [{ op: "wait", ms: 100 }] });
    expect(ok.mode).toBe("steps");
    expect(ok.timeoutMs).toBe(15000);
    expect(uiStepsSchema.safeParse([{ op: "goto", url: "http://a.b/" }]).success).toBe(true);
  });

  it("params：非法键（非标识符/超长）/超 20 组/值超 2048 拒绝；env 键大写化", () => {
    expect(uiParamSchema.safeParse({ key: "1BAD", value: "x" }).success).toBe(false);
    expect(uiParamSchema.safeParse({ key: "has space", value: "x" }).success).toBe(false);
    expect(uiParamSchema.safeParse({ key: "a".repeat(65), value: "x" }).success).toBe(false);
    expect(uiParamSchema.safeParse({ key: "OK_KEY1", value: "x" }).success).toBe(true);
    expect(uiParamSchema.safeParse({ key: "K", value: "v".repeat(2049) }).success).toBe(false);
    expect(
      uiCaseCreateSchema.safeParse({
        name: "x",
        mode: "script",
        script: SCRIPT,
        params: Array.from({ length: 21 }, (_, i) => ({ key: `K${i}`, value: "" })),
      }).success,
    ).toBe(false);
    expect(uiParamEnvKey("baseUrl")).toBe("RABBIT_PARAM_BASEURL");
    expect(uiParamEnvKey("USER_NAME")).toBe("RABBIT_PARAM_USER_NAME");
  });

  it("update partial：字段级校验，mode 缺省不翻转（不会把 script 用例更新成 steps）", () => {
    const u = uiCaseUpdateSchema.parse({ name: "仅改名" });
    expect(u.mode).toBeUndefined();
    expect(u.script).toBeUndefined();
    const u2 = uiCaseUpdateSchema.parse({ mode: "script", script: SCRIPT });
    expect(u2.mode).toBe("script");
  });

  it("引擎命令条目：script 模式缺 script 拒绝；steps 模式空 steps 拒绝", () => {
    expect(
      uiCaseItemCommandSchema.safeParse({
        itemId: UUID,
        caseId: UUID,
        name: "x",
        mode: "script",
        steps: [],
        timeoutMs: 30000,
      }).success,
    ).toBe(false);
    expect(
      uiCaseItemCommandSchema.safeParse({
        itemId: UUID,
        caseId: UUID,
        name: "x",
        mode: "steps",
        steps: [],
        timeoutMs: 15000,
      }).success,
    ).toBe(false);
    expect(
      uiCaseItemCommandSchema.safeParse({
        itemId: UUID,
        caseId: UUID,
        name: "x",
        mode: "script",
        script: SCRIPT,
        params: [{ key: "A", value: "1" }],
        timeoutMs: 30000,
      }).success,
    ).toBe(true);
  });
});
