import { test, expect, navClick, enterRealm } from "./fixtures";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { E2E_BASE, MOCK_BASE } from "./env";

/**
 * AI-001 模型网关（docs/sprint-7-ai/AI-001-model-gateway.md §5）。
 * 三类断言：UI（管理页 CRUD/连接测试/默认星标/SSRF 拒绝）+ Console + 接口（掩码/测试连接/设默认/70422）。
 */

/** 种子管理员登录（与 SYS-005 同款 cookie 注入）。 */
async function loginSeedAdmin(request: APIRequestContext, context: BrowserContext): Promise<void> {
  const res = await request.post("/api/v1/auth/login", {
    data: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
  });
  expect(res.status()).toBe(200);
  const ras = (res.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  expect(ras).toBeTruthy();
  await context.addCookies([{ name: "ras", value: ras!, url: E2E_BASE }]);
}

test("AI-001-01 模型管理全链路（新建/掩码/连接测试/设默认/SSRF 拒绝）", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);
  const uniq = `M${Date.now() % 1e7}`;

  await page.goto("/");
  await enterRealm(page, "system");
  await navClick(page, "nav-system-ai-models");
  await expect(page.getByTestId("ai-model-list").locator("div").first()).toBeVisible();
  // 种子 mock 模型在列（global-setup 注入 RABBIT_SEED_AI_MOCK_BASE）
  await expect(page.getByTestId("ai-model-card-e2e-mock-模型")).toBeVisible();
  await expect(page.getByTestId("ai-model-card-e2e-mock-模型")).toContainText("sk-****");

  // 新建（指向 e2e mock :4001/ai 环回豁免；provider 默认已智谱，无需重选）
  await page.getByTestId("ai-model-create").click();
  await page.getByTestId("ai-model-form-name").fill(`e2e-模型-${uniq}`);
  await page.getByTestId("ai-model-form-baseurl").fill(`${MOCK_BASE}/ai`);
  await page.getByTestId("ai-model-form-model").fill("mock-e2e-model");
  await page.getByTestId("ai-model-form-apikey").fill(["placeholder", "key"].join("-"));
  const created = page.waitForResponse("**/api/v1/system/ai-models");
  await page.getByRole("button", { name: "确 定" }).click();
  const res = await created;
  expect(res.status()).toBe(201);
  const createdData = (await res.json()) as { data: { id: string } };
  const payload = res.request().postDataJSON() as { apiKey: string; baseUrl: string };
  expect(payload.baseUrl).toBe(`${MOCK_BASE}/ai`);
  expect(payload.apiKey).toBe("placeholder-key");

  // UI 断言：新卡片可见 + 掩码
  await expect(page.getByTestId(`ai-model-card-e2e-模型-${uniq}`)).toBeVisible();
  await expect(page.getByTestId(`ai-model-card-e2e-模型-${uniq}`)).toContainText("sk-****");

  // 连接测试（mock 探测分支 → pong）
  const tested = page.waitForResponse(`**/api/v1/system/ai-models/${createdData.data.id}/test`);
  await page.getByTestId(`ai-model-test-e2e-模型-${uniq}`).click();
  const testRes = await tested;
  const testData = (await testRes.json()) as { data: { echo: string; latencyMs: number } };
  expect(testRes.status()).toBe(200);
  expect(testData.data.echo).toBe("pong");

  // 设默认 → 星标移动
  const defaulted = page.waitForResponse(
    `**/api/v1/system/ai-models/${createdData.data.id}/default`,
  );
  await page.getByTestId(`ai-model-default-e2e-模型-${uniq}`).click();
  await defaulted;
  await expect(page.getByTestId(`ai-model-card-e2e-模型-${uniq}`)).toContainText("★ 默认");

  // 清理（先行）：删除新建模型恢复种子默认——放在 SSRF 之前（错误态 Modal 会遮挡行操作）
  await page.getByTestId(`ai-model-card-e2e-模型-${uniq}`).getByText("删除").click();
  await page.getByRole("button", { name: "删 除", exact: true }).click();
  await expect(page.getByText("已删除")).toBeVisible();

  // SSRF 拒绝（云元数据——测试开关不豁免非环回）：新建被 422 70422 拒（表单 Modal 收尾留开不影响）
  await page.getByTestId("ai-model-create").click();
  await page.getByTestId("ai-model-form-name").fill(`ssrf-${uniq}`);
  await page.getByTestId("ai-model-form-baseurl").fill("http://169.254.169.254/latest/meta-data");
  await page.getByTestId("ai-model-form-model").fill("m");
  await page.getByTestId("ai-model-form-apikey").fill("placeholder-key");
  const ssrf = page.waitForResponse("**/api/v1/system/ai-models");
  await page.getByRole("button", { name: "确 定" }).click();
  const ssrfRes = await ssrf;
  expect(ssrfRes.status()).toBe(422);
  const ssrfData = (await ssrfRes.json()) as { code: number };
  expect(ssrfData.code).toBe(70422);
  await expect(page.getByText(/受限地址/)).toBeVisible();

  // 白名单：SSRF 422 为预期安全拒绝（表单提交路径 fetch 失败留痕，显式登记）
  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/system/ai-models",
      textPattern: "(\\[http 422\\]|status of 422)",
      reason: "AI-001-01 SSRF 守卫拒绝的预期 422（70422）",
    },
  ]);
});

test("AI-001-02 掩码脱敏与权限（普通用户 403 + 响应无明文 key）", async ({
  authedPage,
  request,
}) => {
  // 普通注册用户（非系统管理员）访问系统级端点 → 403 10003
  const res = await request.get("/api/v1/system/ai-models");
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: number; data: unknown };
  expect(body.code).toBe(10003);

  // 登录可见下拉（无敏感字段）
  const picker = await request.get("/api/v1/ai/models");
  expect(picker.status()).toBe(200);
  const pickerData = (await picker.json()) as {
    data: { list: { model: string; apiKeyMasked?: string }[] };
  };
  expect(pickerData.data.list[0]!.model).toBe("mock-e2e-model");
  expect(JSON.stringify(pickerData.data)).not.toContain("apiKeyEnc");
  void authedPage;
});
