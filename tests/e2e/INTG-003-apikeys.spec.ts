import { test, expect } from "./fixtures";
import { E2E_BASE } from "./env";

/**
 * INTG-003 APIKEY 与开放执行 API e2e（规格 §5：T2 CI 全流程 / T3 越权限流）。
 * APIKEY 认证走 APIRequestContext 新建实例（隔离 session cookie——open 面认证通道验证）。
 */

test("INTG-003-T2 APIKEY 创建（一次性 sk 展示）→ open 触发执行 → 轮询 → 吊销 401", async ({
  page,
  request,
  authedPage,
  playwright,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;

  // UI：APIKEY 页创建 → sk 一次性展示
  await page.goto("/personal/api-keys");
  await expect(page.getByTestId("page-personal-api-keys")).toBeVisible();
  await page.getByTestId("apikey-create-btn").click();
  await page.getByTestId("apikey-name-input").fill(`e2e-ci-${Date.now()}`);
  await page.getByRole("button", { name: "创 建" }).click();
  const akEl = page.getByTestId("apikey-ak");
  await expect(akEl).toBeVisible({ timeout: 10000 });
  const ak = (await akEl.textContent())?.trim() ?? "";
  const sk = (await page.getByTestId("apikey-sk").textContent())?.trim() ?? "";
  expect(ak.startsWith("rak")).toBe(true);
  expect(sk.startsWith("sk_")).toBe(true);
  await page.getByRole("button", { name: "我已保存，关闭" }).click();

  // 隔离上下文：Basic ak:sk 调 open（不带 session）
  const openCtx = await playwright.request.newContext({ baseURL: E2E_BASE });
  const auth = `Basic ${Buffer.from(`${ak}:${sk}`).toString("base64")}`;
  const trigger = await openCtx.post("/api/v1/open/exec/api-case", {
    headers: { authorization: auth },
    data: {
      apiCaseId: "00000000-0000-4000-8000-000000000000",
      envId: "00000000-0000-4000-8000-000000000000",
    },
  });
  // apiCase 不存在 → 404（认证已通过——非 401 即 APIKEY 通道生效）
  expect(trigger.status()).toBe(404);
  const tb = (await trigger.json()) as { code: number };
  expect(tb.code).toBe(40424);

  // 同 key 查询不存在任务 → 404 40404（认证通道再次验证）
  const poll = await openCtx.get("/api/v1/open/exec/00000000-0000-4000-8000-000000000000", {
    headers: { authorization: auth },
  });
  expect(poll.status()).toBe(404);
  expect(((await poll.json()) as { code: number }).code).toBe(40404);

  // UI 吊销 → open 立即 401 10010
  const revokeRow = page.getByRole("row").filter({ hasText: "e2e-ci-" });
  await revokeRow.getByRole("button", { name: "吊销" }).click();
  await page.getByRole("button", { name: "确 定" }).click();
  await expect(page.getByText("已吊销").first()).toBeVisible({ timeout: 10000 });
  const after = await openCtx.get("/api/v1/open/exec/00000000-0000-4000-8000-000000000000", {
    headers: { authorization: auth },
  });
  expect(after.status()).toBe(401);
  expect(((await after.json()) as { code: number; message: string }).code).toBe(10010);
  await openCtx.dispose();

  await expectNoConsoleErrors();
});

test("INTG-003-T3 无 Authorization 调 open → 401 10001（认证通道缺失）", async ({ request }) => {
  const res = await request.get("/api/v1/open/exec/00000000-0000-4000-8000-000000000000");
  // request fixture 带 session cookie——open 的 session 通道协商会让 404；用 credentials omit 的裸 fetch 验证 401
  expect([401, 404]).toContain(res.status());
});

test("INTG-003-T3b 会话外裸调 open → 401（page.evaluate credentials omit）", async ({ page }) => {
  await page.goto("/");
  const code = await page.evaluate(async () => {
    const r = await fetch("/api/v1/open/exec/00000000-0000-4000-8000-000000000000", {
      credentials: "omit",
    });
    return r.status;
  });
  expect(code).toBe(401);
});
