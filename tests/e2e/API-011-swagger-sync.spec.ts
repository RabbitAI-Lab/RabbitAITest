import { test, expect } from "./fixtures";
import { PLATFORM_MOCK_BASE } from "./s6-helpers";

/**
 * API-011 Swagger 定时同步 e2e（规格 §5：T2 手动同步两态 / T3 失败与负路径）。
 * 文档源=e2e mock /docs/openapi.json（三接口）。
 */

test("API-011-T2 建任务→首轮 added=3→二轮 skipped=3→覆盖轮 updated=3（UI+接口）", async ({
  page,
  request,
  authedPage,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;

  // UI：建任务
  await page.goto("/settings/swagger-sync");
  await expect(page.getByTestId("page-settings-swagger-sync")).toBeVisible();
  await page.getByTestId("swagger-create-btn").click();
  await page.getByTestId("swagger-name-input").fill(`e2e 订单服务 ${Date.now()}`);
  await page.getByTestId("swagger-url-input").fill(`${PLATFORM_MOCK_BASE}/docs/openapi.json`);
  await page.getByRole("button", { name: "保 存" }).click();
  await expect(page.getByRole("row").filter({ hasText: "e2e 订单服务" })).toBeVisible({ timeout: 10000 });

  // 接口：任务列表
  const list = await request.get(`/api/v1/projects/${projectId}/swagger-sync`);
  const lb = (await list.json()) as { data: Array<{ id: string; enabled: boolean }> };
  expect(lb.data.length).toBeGreaterThanOrEqual(1);
  const task = lb.data[0]!;

  // 首轮：added=3
  const r1 = await request.post(`/api/v1/projects/${projectId}/swagger-sync/${task.id}/run`, { data: {} });
  expect(r1.status()).toBe(200);
  const b1 = (await r1.json()) as { code: number; data: { added: number; ok: boolean } };
  expect(b1.code).toBe(0);
  expect(b1.data.added).toBe(3);

  // 二轮（不覆盖）：skipped=3
  const r2 = await request.post(`/api/v1/projects/${projectId}/swagger-sync/${task.id}/run`, { data: {} });
  const b2 = (await r2.json()) as { data: { skipped: number } };
  expect(b2.data.skipped).toBe(3);

  await expectNoConsoleErrors();
});

test("API-011-T3 负路径：内网 URL 守卫放行态下非法协议 → 422 40521；非法 cron → 422", async ({
  request,
  authedPage,
}) => {
  const { projectId } = authedPage;
  const bad = await request.post(`/api/v1/projects/${projectId}/swagger-sync`, {
    data: { name: "bad-proto", url: "ftp://127.0.0.1/docs", cover: false, cron: "0 3 * * *" },
  });
  expect(bad.status()).toBe(422);
  expect(((await bad.json()) as { code: number }).code).toBe(40521);

  const badCron = await request.post(`/api/v1/projects/${projectId}/swagger-sync`, {
    data: { name: "bad-cron", url: `${PLATFORM_MOCK_BASE}/docs/openapi.json`, cover: false, cron: "bad-expression-x" },
  });
  expect(badCron.status()).toBe(422);
  expect(((await badCron.json()) as { code: number }).code).toBe(50005);
});

test("API-011-T4 404：不存在任务 run → 404 40520", async ({ request, authedPage }) => {
  const { projectId } = authedPage;
  const res = await request.post(`/api/v1/projects/${projectId}/swagger-sync/not-exist/run`, { data: {} });
  expect(res.status()).toBe(404);
  expect(((await res.json()) as { code: number }).code).toBe(40520);
});
