import { test, expect, navFromHome } from "./fixtures";
import {
  bundle,
  createApiCase,
  createApiDef,
  createEnv,
  executeCases,
  pickOption,
  pollTask,
  submitDebugTask,
} from "./s2-helpers";

/**
 * API-004 请求参数体系（规格：docs/sprint-2-api-core/API-004-request-params.md）。
 * 覆盖：变量链路（${var} 渲染 + setVar + 提取写回）、断言失败二态、脚本失败二态。
 * 三类断言：UI + Console + 接口（exec-tasks payload 含 pre/envId；环境变量写回断言）。
 */

test("API-004-01 变量链路：${base} 渲染 + 前置 setVar + 变量断言 + 提取写回环境", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `V4${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const envName = `变量环境-${uniq}`;
  const envId = await createEnv(request, projectId, envName);

  // ── 用户路径：接口调试 → 选环境 → ${base}/hello → 前置脚本 setVar → 提取 → 变量断言 ──
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await pickOption(page, page.getByTestId("env-select"), envName);
  // 相对路径 + 环境域名（注：调试页客户端校验暂拒 ${var} 形态 URL——占位符却宣称支持，已记录产品问题清单；
  // 变量渲染链路经 ${base} 由 api_case 路径覆盖（下方钻取断言））
  await page.getByTestId("debug-url").fill("/hello");

  // 前置脚本：setVar("who","smoke")
  await page.getByTestId("req-tab-pre").click();
  await page.getByTestId("req-panel-pre").getByRole("button", { name: "＋ 添加处理器" }).click();
  await page.getByTestId("processor-row-1").locator("textarea").fill('setVar("who", "smoke")');

  // 提取：$.status → svcState（作用域=环境，执行后写回）
  await page.getByTestId("req-tab-post").click();
  await page.getByTestId("req-panel-post").getByRole("button", { name: "＋ 添加提取" }).click();
  const extractRow = page.getByTestId("extract-row").first();
  await extractRow.locator('input[placeholder^="表达式"]').fill("$.status");
  await extractRow.locator('input[placeholder="变量名"]').fill("svcState");
  await pickOption(page, extractRow.locator(".ant-select").last(), "环境");

  // 断言：变量 who eq smoke（保留默认状态码 200 断言）
  await page.getByTestId("btn-add-assert").click();
  const assertRows = page.getByTestId("debug-asserts").locator("> div");
  await assertRows.nth(1).locator(".ant-select").first().click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("变量", { exact: true })
    .click();
  await assertRows.nth(1).locator('input[placeholder="$.url"]').fill("who");
  await assertRows.nth(1).locator('input[placeholder="期望值"]').fill("smoke");

  // ── 执行：payload 含 envId / pre 脚本 / 提取器 ──
  const execApi = expectApi("**/api/v1/projects/*/exec-tasks");
  const execRaw = page.waitForResponse("**/api/v1/projects/*/exec-tasks");
  await page.getByTestId("btn-execute").click();
  const submitted = await execApi;
  expect(submitted.status).toBe(201);
  expect(submitted.code).toBe(0);
  const execRawRes = await execRaw;
  const payload = execRawRes.request().postDataJSON() as {
    envId: string;
    request: { url: string };
    pre: { kind: string; script?: string }[];
    extracts: { expression: string; variable: string; scope: string }[];
  };
  expect(payload.envId).toBe(envId);
  expect(payload.request.url).toBe("/hello");
  expect(payload.pre[0]).toMatchObject({ kind: "script", script: 'setVar("who", "smoke")' });
  expect(payload.extracts[0]).toMatchObject({
    expression: "$.status",
    variable: "svcState",
    scope: "env",
  });

  // ── 报告：SUCCESS + 双断言通过（含变量断言 who=smoke；单请求视图展示原始 URL）──
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30000 });
  await expect(page.getByTestId("report-request")).toContainText("/hello");
  await expect(page.getByTestId("assert-pass")).toHaveCount(2);

  // ── 提取值表（api_case 报告钻取）+ 环境变量写回（接口断言）──
  const defName = `提取定义-${uniq}`;
  const caseName = `提取用例-${uniq}`;
  const def = await createApiDef(request, projectId, {
    name: defName,
    path: "/hello",
    request: bundle("GET", "${base}/hello"),
  });
  const cs = await createApiCase(request, projectId, def.id, {
    name: caseName,
    request: bundle("GET", "${base}/hello", {
      extracts: [
        {
          source: "body",
          kind: "jsonpath",
          expression: "$.status",
          match: "first",
          variable: "svcState2",
          scope: "env",
        },
      ],
    }),
  });
  const taskId = await executeCases(request, projectId, def.id, { caseIds: [cs.id], envId });
  const final = await pollTask(request, projectId, taskId);
  expect(final.status).toBe("SUCCESS");

  await navFromHome(page, "接口报告");
  const reportRow = page
    .getByTestId("report-list-table")
    .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(reportRow).toBeVisible();
  await reportRow.getByTestId("report-name-link").click();
  await expect(
    page.getByTestId("report-items-table").getByRole("row", { name: new RegExp(caseName) }),
  ).toBeVisible();
  await page
    .getByTestId("report-items-table")
    .getByRole("row", { name: new RegExp(caseName) })
    .click();
  await expect(page.getByTestId("item-drilldown")).toBeVisible();
  // 渲染后 URL（请求快照）：${base} 已替换为真实 mock 地址
  await expect(page.getByTestId("drill-request")).toContainText("http://127.0.0.1:4001/hello");
  await expect(page.getByTestId("drill-request")).not.toContainText("${base}");
  await expect(page.getByTestId("extracts-table")).toContainText("svcState2");
  await expect(
    page.getByTestId("extracts-table").locator("td").filter({ hasText: "UP" }),
  ).toHaveCount(1);

  // 环境写回（接口断言）：svcState2=UP 落库
  const envRes = await page.request.get(`/api/v1/projects/${projectId}/environments/${envId}`);
  const envBody = (await envRes.json()) as {
    code: number;
    data: { config: { vars: { key: string; value: string }[] } };
  };
  expect(envBody.code).toBe(0);
  expect(envBody.data.config.vars.find((v) => v.key === "svcState2")?.value).toBe("UP");

  await expectNoConsoleErrors();
});

test("API-004-02 断言失败二态：body_jsonpath 不存在值 → FAILED + 断言表红行实际值", async ({
  authedPage,
  page,
  expectNoConsoleErrors,
}) => {
  void authedPage;
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await page.getByTestId("debug-url").fill("http://127.0.0.1:4001/hello");

  // 断言：body_jsonpath $.nope eq xyz（不存在 → 失败）
  await page.getByTestId("btn-add-assert").click();
  const assertRows = page.getByTestId("debug-asserts").locator("> div");
  await assertRows.nth(1).locator(".ant-select").first().click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("响应体 JSONPath", { exact: true })
    .click();
  await assertRows.nth(1).locator('input[placeholder="$.url"]').fill("$.nope");
  await assertRows.nth(1).locator('input[placeholder="期望值"]').fill("xyz");

  await page.getByTestId("btn-execute").click();
  await expect(page).toHaveURL(/\/reports\//, { timeout: 15000 });
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  // UI 断言：断言表红行（实际值列展示，期望 xyz）
  await expect(page.getByTestId("assert-fail").first()).toBeVisible();
  await expect(page.getByTestId("report-asserts")).toContainText("等于 xyz");
  await expect(page.getByTestId("report-asserts").locator("tr.bg-red-50").first()).toBeVisible();

  await expectNoConsoleErrors();
});

test("API-004-03 脚本失败二态：前置 throw → FAILED + SCRIPT_ERROR 留痕", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  // 直接 API 起一个前置脚本抛错的任务（UI 侧脚本编辑已由 API-004-01 覆盖）
  const taskId = await submitDebugTask(request, projectId, {
    url: "http://127.0.0.1:4001/hello",
    pre: [{ kind: "script", script: 'throw new Error("boom-script")' }],
  });
  const final = await pollTask(request, projectId, taskId);
  expect(final.status).toBe("FAILED");

  // 用户路径：接口报告列表 → 详情
  await navFromHome(page, "接口报告");
  const reportRow = page
    .getByTestId("report-list-table")
    .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(reportRow).toBeVisible();
  await reportRow.getByTestId("report-name-link").click();
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 15000 });
  // UI 断言：failureKind 徽标 SCRIPT_ERROR + 日志流含脚本失败原因
  await expect(page.getByText("SCRIPT_ERROR").first()).toBeVisible();
  await expect(page.getByTestId("report-logs")).toContainText("脚本执行失败");
  await expect(page.getByTestId("report-logs")).toContainText("boom-script");

  await expectNoConsoleErrors();
});
