import { test, expect, navFromHome } from "./fixtures";
import { Client } from "pg";
import {
  bundle,
  createApiCase,
  createApiDef,
  createEnv,
  executeCases,
  pollTask,
  submitDebugTask,
} from "./s2-helpers";

/**
 * RPT-002 报告与分享（规格：docs/sprint-2-api-core/RPT-002-report-share.md）。
 * 覆盖：列表行→详情统计三卡→items 钻取（快照/断言/提取/日志）→分享免登只读（新开无 cookie
 * context）→撤销后空态→删除级联；api_debug 兼容单请求视图（旧 testid 保留）。
 * 三类断言：UI + Console + 接口（shares 创建 payload/列表、revoke、删除、免登 404 语义）。
 */

test("RPT-002-01 报告主链路：详情钻取→分享免登→撤销空态→删除", async ({
  authedPage,
  page,
  browser,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `R2${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const passName = `报告通过用例-${uniq}`;
  const failName = `报告失败用例-${uniq}`;

  // 数据准备：1 成功 1 失败的 api_case 任务
  const envId = await createEnv(request, projectId, `报告环境-${uniq}`);
  const def = await createApiDef(request, projectId, {
    name: `报告定义-${uniq}`,
    path: "/hello",
    request: bundle("GET", "${base}/hello"),
  });
  const pass = await createApiCase(request, projectId, def.id, {
    name: passName,
    request: bundle("GET", "${base}/hello", {
      extracts: [
        {
          source: "body",
          kind: "jsonpath",
          expression: "$.status",
          match: "first",
          variable: "svcState",
          scope: "temp",
        },
      ],
    }),
  });
  const fail = await createApiCase(request, projectId, def.id, {
    name: failName,
    request: bundle("GET", "${base}/hello", {
      asserts: [{ kind: "status_code", path: "", op: "eq", expected: "500" }],
    }),
  });
  const taskId = await executeCases(request, projectId, def.id, {
    caseIds: [pass.id, fail.id],
    envId,
    stopOnFail: false,
  });
  expect((await pollTask(request, projectId, taskId)).status).toBe("FAILED");

  // ── 用户路径：接口报告列表 → 详情 ──
  await navFromHome(page, "接口报告");
  const listRow = page
    .getByTestId("report-list-table")
    .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(listRow).toBeVisible();
  await expect(listRow.getByText("失败")).toBeVisible();
  await expect(listRow.getByText("1/2")).toBeVisible(); // 统计列 通过 1/2
  await listRow.getByTestId("report-name-link").click();
  await expect(page).toHaveURL(new RegExp(`/reports/${taskId}`), { timeout: 10000 });

  // ── 详情：统计三卡数字 + items 两行 + 失败行钻取 ──
  await expect(page.getByTestId("report-status")).toHaveText("FAILED", { timeout: 30000 });
  const cards = page.getByTestId("report-summary-cards");
  await expect(cards).toContainText("1 / 2"); // 通过 1/2
  await expect(cards.locator(".rabbit-card", { hasText: "失败" }).locator("p").nth(1)).toHaveText(
    "1",
  );

  const items = page.getByTestId("report-items-table");
  await expect(
    items.getByRole("row", { name: new RegExp(passName) }).getByText("SUCCESS"),
  ).toBeVisible();
  const failRow = items.getByRole("row", { name: new RegExp(failName) });
  await expect(failRow.getByText("FAILED")).toBeVisible();
  await failRow.click();
  await expect(page.getByTestId("item-drilldown")).toBeVisible();
  await expect(page.getByTestId("drill-request")).toContainText("http://127.0.0.1:4001/hello");
  await expect(page.getByTestId("asserts-table").locator("tr.bg-red-50").first()).toContainText(
    "500",
  );
  await expect(page.getByTestId("extracts-table")).toBeVisible();
  await expect(page.getByTestId("drill-logs")).toBeVisible();

  // ── 分享：创建 → 免登只读访问（新开无 cookie context）──
  // POST 按方法圈定（弹窗打开时的 shares 列表 GET 同 URL，glob 会竞态）
  const shareP = page.waitForResponse(
    (r) => /\/shares$/.test(r.url()) && r.request().method() === "POST",
  );
  await page.getByTestId("btn-share-report").click();
  await expect(page.getByTestId("share-report-modal")).toBeVisible();
  await page.getByTestId("btn-create-share").click();
  const sharedRes = await shareP;
  expect(sharedRes.status()).toBe(201);
  const sharedBody = (await sharedRes.json()) as { code: number; data: { token: string } };
  expect(sharedBody.code).toBe(0);
  expect((sharedRes.request().postDataJSON() as { expireHours: number }).expireHours).toBe(24);
  const token = sharedBody.data.token;

  await expect(page.getByTestId("share-links").getByTestId("share-link-row")).toHaveCount(1);
  const shareUrlVal = await page.getByTestId("share-link-url").inputValue();
  expect(shareUrlVal).toContain(`/share/report/${token}`);

  // 新开无 cookie context：免登只读视图 + 无操作按钮
  const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";
  const anonCtx = await browser.newContext();
  const anonPage = await anonCtx.newPage();
  await anonPage.goto(`${BASE}/share/report/${token}`);
  await expect(anonPage.getByTestId("share-report-view")).toBeVisible({ timeout: 15000 });
  await expect(anonPage.getByTestId("share-banner")).toContainText("只读分享");
  await expect(anonPage.getByTestId("btn-share-report")).toHaveCount(0);
  await expect(anonPage.getByTestId("btn-delete-report")).toHaveCount(0);
  await expect(anonPage.getByTestId("btn-rerun-report")).toHaveCount(0);
  // 只读 item 表（无钻取）
  await expect(
    anonPage.getByTestId("report-items-table").getByRole("row", { name: new RegExp(passName) }),
  ).toBeVisible();
  await expect(anonPage.getByText("步骤钻取需登录后在报告详情页查看")).toBeVisible();
  await anonCtx.close();

  // ── 撤销 → 再访空态 ──
  const revokeApi = expectApi("**/api/v1/projects/*/reports/*/shares/*");
  await page.getByTestId("btn-revoke-share").click();
  const revoked = await revokeApi;
  expect(revoked.status).toBe(200);
  expect(revoked.code).toBe(0);
  await expect(page.getByText("链接已撤销")).toBeVisible();
  await expect(page.getByTestId("share-links").getByTestId("share-link-row")).toHaveCount(0);

  const anonCtx2 = await browser.newContext();
  const anonPage2 = await anonCtx2.newPage();
  await anonPage2.goto(`${BASE}/share/report/${token}`);
  await expect(anonPage2.getByTestId("share-expired")).toBeVisible({ timeout: 15000 });
  await anonCtx2.close();

  // ── 过期二态（门禁 8 回补，RPT-002 §5 T3）：分享弹窗仍开着，再建一枚分享，直改库把 expire_at 置为过去 → 免登访问同样 404 ──
  const shareP2 = page.waitForResponse(
    (r) => /\/shares$/.test(r.url()) && r.request().method() === "POST",
  );
  await expect(page.getByTestId("share-report-modal")).toBeVisible();
  await page.getByTestId("btn-create-share").click();
  const shared2 = await shareP2;
  expect(shared2.status()).toBe(201);
  const token2 = ((await shared2.json()) as { data: { token: string } }).data.token;
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  // 库内时间戳为 naive-UTC 约定（Prisma 读写一致）；裸 SQL 的 now() 带会话时区，必须显式转 UTC
  await pg.query(
    "UPDATE report_shares SET expire_at = (now() at time zone 'utc') - interval '1 hour' WHERE token = $1",
    [token2],
  );
  await pg.end();
  const anonCtx3 = await browser.newContext();
  const anonPage3 = await anonCtx3.newPage();
  await anonPage3.goto(`${BASE}/share/report/${token2}`);
  await expect(anonPage3.getByTestId("share-expired")).toBeVisible({ timeout: 15000 });
  await anonCtx3.close();
  await page.locator(".ant-modal-close").click(); // 关闭分享弹窗，回到删除报告流程

  // ── 删除报告 → 列表消失（级联）──
  const delApi = expectApi("**/api/v1/projects/*/reports/*");
  await page.getByTestId("btn-delete-report").click();
  await page
    .locator(".ant-popover")
    .getByRole("button", { name: /删\s*除/ })
    .click();
  const deleted = await delApi;
  expect(deleted.status).toBe(200);
  expect(deleted.code).toBe(0);
  await expect(page).toHaveURL(/\/reports$/, { timeout: 10000 });
  await expect(
    page
      .getByTestId("report-list-table")
      .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) }),
  ).toHaveCount(0, { timeout: 10000 });

  await expectNoConsoleErrors();
});

test("RPT-002-02 api_debug 兼容：单请求视图保留（report-request/response 旧 testid）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const taskId = await submitDebugTask(request, projectId, {
    url: "http://127.0.0.1:4001/hello",
  });
  expect((await pollTask(request, projectId, taskId)).status).toBe("SUCCESS");

  await navFromHome(page, "接口报告");
  const listRow = page
    .getByTestId("report-list-table")
    .getByRole("row", { name: new RegExp(taskId.slice(0, 8)) });
  await expect(listRow).toBeVisible();
  await expect(listRow.getByText("调 试")).toBeVisible();
  await listRow.getByTestId("report-name-link").click();
  await expect(page).toHaveURL(new RegExp(`/reports/${taskId}`), { timeout: 10000 });

  // S0 单请求布局：旧 testid 全保留
  await expect(page.getByTestId("report-status")).toHaveText("SUCCESS", { timeout: 15000 });
  await expect(page.getByTestId("report-request")).toContainText("GET");
  await expect(page.getByTestId("report-request")).toContainText("http://127.0.0.1:4001/hello");
  await expect(page.getByTestId("report-response")).toBeVisible();
  await expect(page.getByTestId("report-response-body")).toContainText("hello");
  await expect(page.getByTestId("assert-pass").first()).toBeVisible();
  await expect(page.getByTestId("report-asserts")).toBeVisible();
  await expect(page.getByTestId("report-logs")).toBeVisible();
  // api_debug 类型无 items 表
  await expect(page.getByTestId("report-items-table")).toHaveCount(0);

  await expectNoConsoleErrors();
});
