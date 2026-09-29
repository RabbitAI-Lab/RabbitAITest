import { test, expect, navFromHome } from "./fixtures";
import { loginSeedAdmin, uploadPlugin } from "./s6-helpers";
import { E2E_BASE, MOCK_WS_BASE } from "./env";

/**
 * S-future PLUG-003 e2e（规格 §5 T9/T10）：上传启用 websocket 插件 → 调试页选协议 →
 * 对 mock /ws/echo 执行 → 报告回显；协议下拉切换 http↔websocket 的 HTTP 面显隐。
 * 三类断言：UI + Console + 接口（上传/启用/执行请求负载含 protocol）。
 * 口令口径与 fixtures.authedPage 一致（E2E_USER_PASSWORD 回退）。
 */
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

/** 引擎协议注册表 30s 轮询——启用后执行若 40510 需退避重试（整流程重进，防 goBack 状态丢失） */
async function executeUntilProtocolReady(
  page: import("@playwright/test").Page,
  expectApi: (glob: string) => Promise<{ status: number; code: number; body: unknown }>,
): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) await page.waitForTimeout(10_000);
    await navFromHome(page, "接口调试");
    await page.getByTestId("debug-protocol").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("websocket", { exact: true })
      .click();
    await page.getByTestId("req-tab-protocol").click();
    await page
      .getByTestId("req-protocol-config")
      .fill(
        JSON.stringify(
          { url: `${MOCK_WS_BASE}/ws/echo`, sendText: "hello-ws-rabbit", timeoutMs: 8000 },
          null,
          2,
        ),
      );
    const execApi = expectApi("**/api/v1/projects/*/exec-tasks");
    const reqPromise = page
      .waitForResponse("**/api/v1/projects/*/exec-tasks")
      .then((res) => res.request().postData() ?? "");
    await page.getByTestId("btn-execute").click();
    const exec = await execApi;
    expect(exec.status).toBe(201);
    // 接口断言：执行请求负载含 protocol=websocket（协议在请求侧——响应仅 taskId）
    expect(await reqPromise).toContain('"websocket"');
    await page.waitForURL(/\/reports\//, { timeout: 15_000 });
    const status = await page
      .getByTestId("report-status")
      .textContent({ timeout: 30_000 })
      .catch(() => null);
    if (status === "SUCCESS") return;
    // FAILED（40510 未就绪）→ 下轮重进
  }
  throw new Error("websocket 协议执行在引擎注册表两个轮询周期内未成功（40510 未就绪）");
}

test("PLUG-003-T9 上传启用 websocket → 调试页选协议 → 对 mock ws echo 执行成功", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 前置：管理员上传并启用 websocket 插件（幂等 409 容忍）——request 上下文随登录持管理员会话
  await loginSeedAdmin(request, context);
  const wsPluginId = await uploadPlugin(request, "websocket-1.0.0.tgz");
  const enable = await request.put(`/api/v1/system/plugins/${wsPluginId}`, {
    data: { enabled: true },
  });
  expect(enable.status()).toBe(200);

  // 注册普通用户（浏览器上下文切换为用户会话；request 会话亦随后注册覆盖）
  const email = `e2e-plug003-${Date.now()}@rabbit.test`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { email, password: E2E_PASSWORD },
  });
  expect(reg.status()).toBe(201);
  const ras = (reg.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.clearCookies();
  if (ras) await context.addCookies([{ name: "ras", value: ras, url: E2E_BASE }]);

  // 首次进入：选择器分组态与 HTTP 面折叠（画板一/二；页面行锚点=debug-url——编辑器自带行被页面 CSS 隐藏）
  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-protocol")).toBeVisible();
  await expect(page.getByTestId("debug-url")).toBeVisible(); // 默认 HTTP 面在
  await page.getByTestId("debug-protocol").click();
  await page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("websocket", { exact: true })
    .click();
  await expect(page.getByTestId("debug-url")).toHaveCount(0); // HTTP 面折叠（页面行收起）
  await expect(page.getByTestId("req-tab-protocol")).toBeVisible();

  // 执行（引擎 30s 轮询容错重试；请求负载含 protocol=websocket）
  await executeUntilProtocolReady(page, expectApi);
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 30_000 });
  await expect(page.getByTestId("report-response-body")).toContainText("hello-ws-rabbit");
  await expectNoConsoleErrors();
});

test("PLUG-003-T10 协议下拉切换 http↔websocket：HTTP 面显隐；未启用 mqtt 定义保存 422·40511", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  // 登录 request 会话（authedPage 的注册 cookie 只进了浏览器）
  await request.post("/api/v1/auth/login", {
    data: { email: authedPage.email, password: authedPage.password },
  });

  await navFromHome(page, "接口调试");
  await expect(page.getByTestId("debug-protocol")).toBeVisible();

  // 默认 HTTP：URL 输入可见（既有链路零变化；页面行锚点）
  await expect(page.getByTestId("debug-url")).toBeVisible();
  await expect(page.getByTestId("debug-method")).toBeVisible();

  // mqtt 未启用（本用例不启用）→ 保存含 mqtt 协议的定义 422·40511（画板四；接口断言=API 上下文响应）
  const modules = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const mb = (await modules.json()) as { code: number; data: { items: Array<{ id: string }> } };
  expect(mb.code).toBe(0);
  const moduleId = mb.data.items[0]!.id;
  const save = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId,
      name: "mqtt 未启用保存",
      status: "DEBUG",
      request: {
        spec: {
          method: "GET",
          url: "mqtt://config",
          protocol: "mqtt",
          protocolConfig: { host: "127.0.0.1", topic: "demo/a" },
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
          timeoutMs: 60000,
          followRedirects: false,
          skipPre: false,
          skipPost: false,
        },
        asserts: [],
        pre: [],
        post: [],
        extracts: [],
      },
    },
  });
  expect(save.status()).toBe(422);
  const saveBody = (await save.json()) as { code: number; message: string };
  expect(saveBody.code).toBe(40511);
  expect(saveBody.message).toContain("mqtt");

  // websocket（若 T9 已启用则在插件分组）切换显隐容错验证（页面行锚点）
  await page.getByTestId("debug-protocol").click();
  const wsOption = page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
    .getByText("websocket", { exact: true });
  if (await wsOption.isVisible().catch(() => false)) {
    await wsOption.click();
    await expect(page.getByTestId("debug-url")).toHaveCount(0);
    await page.getByTestId("debug-protocol").click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden)")
      .getByText("HTTP", { exact: true })
      .click();
    await expect(page.getByTestId("debug-url")).toBeVisible();
  }
  await expectNoConsoleErrors();
});
