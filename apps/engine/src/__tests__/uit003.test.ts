/** UIT-003-T2~T5：config 生成 + report.json 解析（纯函数）+ 官方 runner 子进程真执行（成/败/超时/停止/校验干跑）。 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EventWriter } from "../events";
import {
  buildPlaywrightConfig,
  buildStepMessage,
  extractCodeFrame,
  mapPwStatus,
  parsePlaywrightReport,
  runUiScriptCase,
  runUiScriptValidate,
} from "../uit/script-runner";

const UUID = "00000000-0000-4000-8000-0000000000aa";

describe("UIT-003-T2 playwright.config 生成（纯函数）", () => {
  it("关键字段齐：timeout/retries/workers/trace/screenshot/reporter/launchOptions", () => {
    const cfg = buildPlaywrightConfig(30000);
    expect(cfg).toContain("timeout: 30000");
    expect(cfg).toContain("retries: 0");
    expect(cfg).toContain("workers: 1");
    expect(cfg).toContain("trace: 'on'");
    expect(cfg).toContain("screenshot: 'only-on-failure'");
    expect(cfg).toContain("outputFile: 'report.json'");
    expect(cfg).toContain("--no-sandbox");
    // 幂等
    expect(buildPlaywrightConfig(30000)).toBe(cfg);
    expect(buildPlaywrightConfig(45000)).toContain("timeout: 45000");
  });
});

describe("UIT-003-T3 report.json 解析与映射（四状态 fixture）", () => {
  const report = [
    {
      file: "case.spec.ts",
      suites: [
        {
          title: "演示页 · 提交表单",
          specs: [
            {
              title: "正确用户名提交成功",
              tests: [
                {
                  results: [
                    {
                      status: "passed",
                      duration: 1200,
                      attachments: [
                        {
                          name: "trace",
                          path: "test-results/.../trace.zip",
                          contentType: "application/zip",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              title: "空用户名提交被拦截",
              tests: [
                {
                  results: [
                    {
                      status: "failed",
                      duration: 800,
                      errors: [
                        {
                          message:
                            'Error: expect(locator).toHaveText(expected)\nExpected string: "用户名不能为空"\nReceived string: "提交成功，guest"',
                          location: { file: "case.spec.ts", line: 17, column: 5 },
                        },
                      ],
                      attachments: [
                        {
                          name: "screenshot",
                          path: "test-results/.../test-failed-1.png",
                          contentType: "image/png",
                        },
                        {
                          name: "trace",
                          path: "test-results/.../trace.zip",
                          contentType: "application/zip",
                        },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              title: "长等待用例",
              tests: [
                {
                  results: [
                    {
                      status: "timedOut",
                      duration: 30000,
                      errors: [{ message: "Test timeout of 30000ms exceeded." }],
                    },
                  ],
                },
              ],
            },
            {
              title: "跳过用例",
              tests: [{ results: [{ status: "skipped", duration: 0 }] }],
            },
          ],
          suites: [
            {
              title: "嵌套组",
              specs: [
                {
                  title: "嵌套用例",
                  tests: [{ results: [{ status: "passed", duration: 50 }] }],
                },
              ],
            },
          ],
        },
      ],
      specs: [],
    },
  ];

  it("递归展开 suites 树（含嵌套；文件名 suite 不入 describe 链），状态/时长/附件/错误 location 齐全", () => {
    const rows = parsePlaywrightReport(report);
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      title: "正确用户名提交成功",
      status: "passed",
      durationMs: 1200,
      suitePath: ["演示页 · 提交表单"],
    });
    expect(rows[1]!.status).toBe("failed");
    expect(rows[1]!.error?.line).toBe(17);
    expect(rows[1]!.attachments).toHaveLength(2);
    expect(rows[4]).toMatchObject({
      title: "嵌套用例",
      suitePath: ["演示页 · 提交表单", "嵌套组"],
    });
  });

  it("状态映射：passed/flaky→SUCCESS；skipped/listed→SKIPPED；failed/timedOut/interrupted→FAILED", () => {
    expect(mapPwStatus("passed")).toBe("SUCCESS");
    expect(mapPwStatus("flaky")).toBe("SUCCESS");
    expect(mapPwStatus("skipped")).toBe("SKIPPED");
    expect(mapPwStatus("listed")).toBe("SKIPPED");
    expect(mapPwStatus("failed")).toBe("FAILED");
    expect(mapPwStatus("timedOut")).toBe("FAILED");
    expect(mapPwStatus("interrupted")).toBe("FAILED");
  });

  it("代码帧：±3 行 + 出错行「>」标记（line 1 基——PW errors[].location 口径）", () => {
    const src = ["a", "b", "c", "d", "e", "f", "g", "h"].join("\n");
    const frame = extractCodeFrame(src, 4); // 第 4 行
    expect(frame.split("\n")).toEqual([
      " 1 | a",
      " 2 | b",
      " 3 | c",
      ">4 | d",
      " 5 | e",
      " 6 | f",
      " 7 | g",
    ]);
    expect(extractCodeFrame(src, undefined)).toBe("");
    expect(extractCodeFrame(src, 0)).toBe("");
    // 行号贴边裁剪（不越界）
    expect(extractCodeFrame("x\ny", 1).split("\n")[0]).toBe(">1 | x");
  });

  it("buildStepMessage：ANSI 剥离 + 无帧时按 location 自建 + 超长头尾截取（≤2000）", () => {
    const rows = parsePlaywrightReport(report);
    const src =
      "const a = 1;\nawait page.goto('x');\nawait expect(page.locator('y')).toBeVisible();\nconst z = 3;\n";
    // fixture 的 location.line 对齐样例源第 3 行（await expect 行）
    const msg = buildStepMessage({ ...rows[1]!.error!, line: 3 }, src);
    expect(msg).toContain('Expected string: "用户名不能为空"');
    expect(msg).toContain(">3 | await expect(page.locator('y')).toBeVisible();");
    expect(msg.length).toBeLessThanOrEqual(2000);
    expect(buildStepMessage(undefined, "src")).toBe("");
    // PW 自带帧（「> N |」）优先，不重复追加
    const withFrame = buildStepMessage(
      { message: "Error: x failed\n  2 | b\n> 3 | c\n  4 | d", line: 3 },
      "a\nb\nc\nd",
    );
    expect(withFrame.match(/> 3 \| c/g)).toHaveLength(1);
    // ANSI 色码剥离
    const ansi = buildStepMessage(
      { message: `${String.fromCharCode(27)}[31mRed${String.fromCharCode(27)}[0m text` },
      "",
    );
    expect(ansi).not.toContain(String.fromCharCode(27));
    expect(ansi).toContain("Red");
  });

  it("非数组输入容错（空集）", () => {
    expect(parsePlaywrightReport(null)).toEqual([]);
    expect(parsePlaywrightReport({})).toEqual([]);
  });
});

describe("UIT-003-T4/T5 官方 runner 子进程真执行（内嵌静态页）", () => {
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
    const emitted: Record<string, unknown>[] = [];
    const writer = {
      emit: async (f: Record<string, unknown>) => {
        emitted.push(f);
      },
    } as unknown as EventWriter;
    return { writer, emitted };
  };
  const script3 = (base: string) => `import { test, expect } from '@playwright/test';
test.describe('演示组', () => {
  test('正确用户名提交成功', async ({ page }) => {
    await page.goto('${base}');
    await page.getByTestId('demo-username').fill('rabbit-e2e');
    await page.getByTestId('demo-submit').click();
    await expect(page.getByTestId('demo-result')).toHaveText('提交成功，rabbit-e2e');
  });
  test('断言失败示例', async ({ page }) => {
    await page.goto('${base}');
    await page.getByTestId('demo-submit').click();
    await expect(page.getByTestId('demo-result')).toHaveText('不会出现的文案');
  });
  test('元素可见', async ({ page }) => {
    await page.goto('${base}');
    await expect(page.getByTestId('demo-username')).toBeVisible();
  });
});`;

  it("T4 三 test 脚本（2 成 1 败）：测试树行+错误定位+step-op 帧", async () => {
    const { writer, emitted } = mkWriter();
    const r = await runUiScriptCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "三测试",
        script: script3(`http://127.0.0.1:${port}/`),
        params: [],
        timeoutMs: 10000,
      },
      async () => false,
    );
    expect(r.status).toBe("FAILED");
    expect(r.failureKind).toBe("ASSERT_FAILED");
    expect(r.steps.map((s) => s.status)).toEqual(["SUCCESS", "FAILED", "SUCCESS"]);
    expect(r.steps[1]!.message).toContain("不会出现的文案");
    const stepOps = emitted.filter((f) => f.type === "step-op");
    expect(stepOps).toHaveLength(3);
    expect(stepOps[0]).toMatchObject({
      op: "script",
      stepName: "正确用户名提交成功",
      status: "SUCCESS",
    });
  }, 60000);

  it("T5a test 级超时：timeoutMs=5000 卡死用例→FAILED", async () => {
    const { writer } = mkWriter();
    const r = await runUiScriptCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "超时",
        script: `import { test } from '@playwright/test';
test('卡死用例', async ({ page }) => {
  await page.waitForTimeout(60000);
});`,
        params: [],
        timeoutMs: 5000,
      },
      async () => false,
    );
    expect(r.status).toBe("FAILED");
    expect(r.steps[0]!.status).toBe("FAILED");
    expect(r.steps[0]!.message).toContain("timeout");
  }, 60000);

  it("T5b 执行中停止：isStopped 翻真→子进程被杀→STOPPED", async () => {
    const { writer } = mkWriter();
    let stop = false;
    setTimeout(() => {
      stop = true;
    }, 2500);
    const r = await runUiScriptCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "停止",
        script: `import { test } from '@playwright/test';
test('慢用例1', async ({ page }) => { await page.waitForTimeout(20000); });
test('慢用例2', async ({ page }) => { await page.waitForTimeout(20000); });`,
        params: [],
        timeoutMs: 30000,
      },
      async () => stop,
    );
    expect(r.status).toBe("STOPPED");
  }, 60000);

  it("T4b 校验干跑：合法脚本→ok+3 标题；语法错误→ok=false 且错误含定位", async () => {
    const { writer } = mkWriter();
    const ok = await runUiScriptValidate(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "校验",
        script: script3("http://127.0.0.1:1/"),
      },
      async () => false,
    );
    expect(ok.ok).toBe(true);
    expect(ok.titles).toEqual(["正确用户名提交成功", "断言失败示例", "元素可见"]);

    const { writer: w2 } = mkWriter();
    const bad = await runUiScriptValidate(
      fakeRedis,
      w2,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "坏脚本",
        script: "test('x', async () => { syntax error here });",
      },
      async () => false,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toBeTruthy();
  }, 60000);

  it("T4c 空脚本（无 test）→CONFIG_ERROR 引导校验", async () => {
    const { writer } = mkWriter();
    const r = await runUiScriptCase(
      fakeRedis,
      writer,
      {
        taskId: UUID,
        projectId: UUID,
        itemId: UUID,
        name: "空脚本",
        script: "export const nothing = 1;",
        params: [],
        timeoutMs: 10000,
      },
      async () => false,
    );
    expect(r.status).toBe("FAILED");
    expect(r.failureKind).toBe("CONFIG_ERROR");
    expect(r.message).toContain("未收集到任何测试");
  }, 60000);
});
