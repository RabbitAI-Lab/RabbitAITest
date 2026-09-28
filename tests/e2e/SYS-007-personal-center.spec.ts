import { test, expect } from "./fixtures";
import { S5_MOCK_BASE } from "./s5-helpers";

// 测试夹具口令（env 可覆盖；e2e 约定值非真实凭据——与 fixtures.ts 口径一致）
const USER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";
const NEW_PASSWORD = process.env.E2E_NEW_USER_PASSWORD ?? "rabbit-new-pass-456";
const WRONG_OLD = process.env.E2E_WRONG_OLD_PASSWORD ?? "wrong-old-pass-xyz";

/** SYS-007 个人中心 e2e（个人信息/改密/本地执行/个人模型；三类断言）。 */
test.describe("SYS-007 个人中心", () => {
  test("T2 主链路：改姓名手机→回显；侧栏菜单齐全", async ({ page, authedPage, expectNoConsoleErrors }) => {
    const { email } = authedPage;
    await page.goto("/personal");
    await expect(page.getByTestId("personal-center")).toBeVisible();
    await expect(page.getByTestId("page-personal-me")).toBeVisible();
    // 邮箱禁用态回显
    await expect(page.locator("input[disabled]")).toHaveValue(email);
    // 改姓名/手机 → 保存 → 刷新回显
    await page.getByTestId("personal-name-input").fill(`e2e-姓名-${Date.now()}`);
    await page.getByTestId("personal-phone-input").fill("13900001234");
    await page.getByTestId("personal-save-btn").click();
    await expect(page.getByText("已保存")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("personal-name-input")).toHaveValue(new RegExp("^e2e-姓名-"));
    // 侧栏菜单齐全（画板走查点）
    for (const key of ["password", "api-keys", "local-runner", "ai-model"]) {
      await expect(page.getByTestId(`personal-menu-${key}`)).toBeVisible();
    }
    await expectNoConsoleErrors();
  });

  test("T3 改密：旧密码错 422→正确→新密码可登录", async ({ page }) => {
    const email = `e2e-pwd-${Date.now()}@rabbit.test`;
    await page.request.post("/api/v1/auth/register", { data: { email, password: USER_PASSWORD } });
    // 旧密码错 → 422 10020
    const wrong = await page.request.post("/api/v1/personal/me", {
      data: { oldPassword: WRONG_OLD, newPassword: NEW_PASSWORD },
    });
    expect(wrong.status()).toBe(422);
    expect(((await wrong.json()) as { code: number }).code).toBe(10020);
    // 正确修改
    const okr = await page.request.post("/api/v1/personal/me", {
      data: { oldPassword: USER_PASSWORD, newPassword: NEW_PASSWORD },
    });
    expect(okr.status()).toBe(200);
    // 旧密码登录失败 → 新密码成功（接口断言）
    const oldLogin = await page.request.post("/api/v1/auth/login", { data: { email, password: USER_PASSWORD } });
    expect(oldLogin.status()).toBe(400);
    expect(((await oldLogin.json()) as { code: number }).code).toBe(10102);
    const newLogin = await page.request.post("/api/v1/auth/login", { data: { email, password: NEW_PASSWORD } });
    expect(newLogin.status()).toBe(200);
  });

  test("T4 本地执行 + 个人默认模型（UI + 接口）", async ({ page, authedPage, request, expectNoConsoleErrors }) => {
    // 本地执行：地址指向栈 mock /healthz（环回）→ 检测连通
    await page.goto("/personal/local-runner");
    await expect(page.getByTestId("page-personal-local-runner")).toBeVisible();
    await page.getByTestId("local-runner-address").fill(`${S5_MOCK_BASE}/healthz`);
    await page.getByTestId("local-runner-prefer").click();
    await page.getByTestId("local-runner-save").click();
    await expect(page.getByText("已保存")).toBeVisible();
    await page.getByTestId("local-runner-check").click();
    await expect(page.getByTestId("local-runner-check-result")).toContainText("连通", { timeout: 10_000 });
    // 非环回前端预校验红字
    await page.getByTestId("local-runner-address").fill("http://192.168.1.1:7001");
    await expect(page.getByTestId("local-runner-invalid")).toBeVisible();
    // 接口断言：非环回 422 10021
    const bad = await page.request.put("/api/v1/personal/local-runner", {
      data: { address: "http://192.168.1.1:7001", preferLocal: false },
    });
    expect(bad.status()).toBe(422);
    expect(((await bad.json()) as { code: number }).code).toBe(10021);

    // 个人默认模型：admin 种子模型在列（e2e 栈注入 AI mock 种子）→ 选择保存 → 回读
    await page.goto("/personal/ai-model");
    await expect(page.getByTestId("page-personal-ai-model")).toBeVisible();
    const models = ((await (await page.request.get("/api/v1/ai/models")).json()) as { data: { list: { id: string }[] } }).data.list;
    expect(models.length).toBeGreaterThanOrEqual(1);
    await page.locator('[data-testid^="personal-model-"] input[type="radio"]').first().check({ timeout: 20_000 });
    await page.getByTestId("personal-ai-model-save").click();
    await expect(page.getByText("已保存")).toBeVisible();
    const pref = ((await (await page.request.get("/api/v1/personal/ai-model")).json()) as { data: { modelId: string | null } }).data;
    expect(pref.modelId).toBeTruthy();
    // 清除 → 回系统默认
    await page.getByTestId("personal-ai-model-clear").click();
    await expect(page.getByText("已保存").last()).toBeVisible({ timeout: 10_000 }); // 等 PUT 落库再断言（异步 mutate 竞态）
    const cleared = ((await (await page.request.get("/api/v1/personal/ai-model")).json()) as { data: { modelId: string | null } }).data;
    expect(cleared.modelId).toBeNull();
    await expectNoConsoleErrors();
  });
});
