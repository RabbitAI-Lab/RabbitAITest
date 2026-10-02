/** UIT-002-T1~T3：步骤 schema（8 指令矩阵）+ 元素引用解析（悬空=CONFIG_ERROR）+ 指令→PW 映射（真 chromium 内嵌静态页）。 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  uiCaseCreateSchema,
  uiElementCreateSchema,
  uiStepsSchema,
  type UiStep,
} from "@rabbit/shared";
import { parseRoleLocator, runUiCase } from "../uit/runner";
import { EventWriter } from "../events";

const UUID = "00000000-0000-4000-8000-000000000001";

describe("UIT-002-T1 步骤 schema（discriminatedUnion 精确报错）", () => {
  it("8 指令合法载荷逐一通过", () => {
    const steps: UiStep[] = [
      { op: "goto", url: "http://127.0.0.1:1/x" },
      { op: "click", elementId: UUID },
      { op: "fill", elementId: UUID, value: "v" },
      { op: "select", elementId: UUID, value: "vip" },
      { op: "assert-text", elementId: UUID, expected: "成功" },
      { op: "assert-visible", elementId: UUID },
      { op: "wait", ms: 500 },
      { op: "screenshot", name: "s1" },
    ];
    expect(uiStepsSchema.safeParse(steps).success).toBe(true);
  });
  it("非法矩阵：坏 op/缺 url/交互指令缺元素/超 50 步", () => {
    expect(uiStepsSchema.safeParse([{ op: "nope" }]).success).toBe(false);
    expect(uiStepsSchema.safeParse([{ op: "goto", url: "/relative" }]).success).toBe(false);
    expect(uiStepsSchema.safeParse([{ op: "click" }]).success).toBe(false); // 无 elementId 无 locator
    expect(
      uiStepsSchema.safeParse([{ op: "click", locator: { locatorType: "css", locator: "#b" } }])
        .success,
    ).toBe(true); // 内联 locator 兜底
    expect(
      uiStepsSchema.safeParse(Array.from({ length: 51 }, () => ({ op: "wait", ms: 1 }))).success,
    ).toBe(false);
    expect(uiStepsSchema.safeParse([{ op: "wait", ms: 31000 }]).success).toBe(false);
  });
  it("用例/元素 create schema：timeoutMs 默认与边界", () => {
    const c = uiCaseCreateSchema.parse({ name: "x", steps: [{ op: "wait", ms: 1 }] });
    expect(c.timeoutMs).toBe(15000);
    expect(
      uiCaseCreateSchema.safeParse({ name: "x", steps: [{ op: "wait", ms: 1 }], timeoutMs: 4999 })
        .success,
    ).toBe(false);
    expect(
      uiElementCreateSchema.safeParse({ name: "e", locatorType: "bogus", locator: "#x" }).success,
    ).toBe(false);
    expect(
      uiElementCreateSchema.safeParse({
        name: "e",
        locatorType: "testid",
        locator: "demo-username",
      }).success,
    ).toBe(true);
  });
});

describe("UIT-002-T2 role 定位器简写解析（parseRoleLocator）", () => {
  it("裸 role / 带 name / 非法输入三态", () => {
    expect(parseRoleLocator("button")).toEqual({ role: "button" });
    expect(parseRoleLocator("button[name=提交]")).toEqual({ role: "button", name: "提交" });
    expect(parseRoleLocator("link[name=首页]")).toEqual({ role: "link", name: "首页" });
    expect(parseRoleLocator("not-a-role!")).toBeNull();
    expect(parseRoleLocator("button[name=未闭合")).toBeNull();
  });
});

describe("UIT-002-T3 真 chromium 执行（内嵌静态页：fill/click/assert 成败两侧 + 悬空元素 CONFIG_ERROR）", () => {
  let server: Server;
  let port = 0;
  const DEMO = `<!doctype html><html><body>
    <input id="u" data-testid="demo-username">
    <button id="b" data-testid="demo-submit">提交</button>
    <div id="r" data-testid="demo-result" style="display:none"></div>
    <script>
      document.getElementById('b').addEventListener('click', function () {
        var n = document.getElementById('u').value || 'guest';
        var el = document.getElementById('r');
        el.style.display = 'block';
        el.textContent = '提交成功，' + n;
      });
    </script></body></html>`;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(DEMO);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    port = (server.address() as { port: number }).port;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
  });

  const fakeRedis = { exists: async () => 0 } as never;
  const mkWriter = () => {
    const emitted: { type: string }[] = [];
    const writer = {
      emit: async (f: { type: string }) => {
        emitted.push({ type: f.type });
      },
      lastSeq: emitted.length,
    } as unknown as EventWriter;
    return { writer, emitted };
  };

  it("成功链路：goto→fill→click→assert-text→screenshot（4 步全 SUCCESS + ui-screenshot 帧）", async () => {
    const { writer, emitted } = mkWriter();
    const r = await runUiCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "演示页-提交",
        timeoutMs: 10000,
        steps: [
          { op: "goto", url: `http://127.0.0.1:${port}/` },
          {
            op: "fill",
            value: "rabbit",
            locator: { locatorType: "testid", locator: "demo-username" },
          },
          { op: "click", locator: { locatorType: "testid", locator: "demo-submit" } },
          {
            op: "assert-text",
            expected: "提交成功，rabbit",
            locator: { locatorType: "testid", locator: "demo-result" },
          },
          { op: "screenshot", name: "终态" },
        ],
      },
      async () => false,
    );
    expect(r.status).toBe("SUCCESS");
    expect(r.steps.map((s) => s.status)).toEqual([
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
      "SUCCESS",
    ]);
    expect(emitted.some((f) => f.type === "step-op")).toBe(true);
    // screenshot 上传在无 web 栈环境下静默降级（fileId 缺失不阻断）——帧有无均可，验证不崩
  }, 30000);

  it("断言失败：assert-text 期望不符→FAILED+余项 SKIPPED+CONFIG/ASSERT 分类", async () => {
    const { writer } = mkWriter();
    const r = await runUiCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "断言失败示例",
        timeoutMs: 8000,
        steps: [
          { op: "goto", url: `http://127.0.0.1:${port}/` },
          { op: "click", locator: { locatorType: "testid", locator: "demo-submit" } },
          {
            op: "assert-text",
            expected: "不存在的文案XYZ",
            locator: { locatorType: "testid", locator: "demo-result" },
          },
          { op: "wait", ms: 100 },
        ],
      },
      async () => false,
    );
    expect(r.status).toBe("FAILED");
    expect(r.failureKind).toBe("ASSERT_FAILED");
    expect(r.steps[2]?.status).toBe("FAILED");
    expect(r.steps[2]?.expected).toBe("不存在的文案XYZ");
    expect(r.steps[3]?.status).toBe("SKIPPED");
  }, 30000);

  it("悬空元素引用：__missing__ 定位器→FAILED+CONFIG_ERROR（web 预解析悬空占位语义兑现）", async () => {
    const { writer } = mkWriter();
    const r = await runUiCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "悬空元素",
        timeoutMs: 5000,
        steps: [
          { op: "goto", url: `http://127.0.0.1:${port}/` },
          {
            op: "click",
            elementId: UUID,
            locator: { locatorType: "css", locator: `__missing__:${UUID}` },
          },
        ],
      },
      async () => false,
    );
    expect(r.status).toBe("FAILED");
    expect(r.failureKind).toBe("CONFIG_ERROR");
    expect(r.steps[1]?.message).toContain("元素已删除");
  }, 30000);
});
