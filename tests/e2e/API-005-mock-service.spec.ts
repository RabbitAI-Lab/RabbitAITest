import { test, expect, navFromHome } from "./fixtures";
import { createApiDef, createMockRule, getMockUrl, ok } from "./s2-helpers";

/** 剪贴板权限：btn-copy-mock-url 的 navigator.clipboard.writeText 在无头浏览器需显式授权 */
test.use({ permissions: ["clipboard-write"] });

/**
 * API-005 Mock 服务（规格：docs/sprint-2-api-core/API-005-mock-service.md）。
 * 覆盖：规则创建→地址→复制→真实命中（page.request 直发 mock 服务）；二态：未命中 40401 /
 * 禁用透明下线 / 热更新改响应体 / followApi 跟随定义默认响应。
 * 三类断言：UI（mock-url-box / mock-rule-table / mock-debug-result）+ Console + 接口
 * （mocks POST payload、mock 服务真实响应体与状态码、PUT enabled payload）。
 */

test("API-005-01 Mock 主链路：建规则→地址→复制→直发命中→UI 调试弹窗", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `M5${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `宠物查询定义-${uniq}`;
  const ruleName = `狗查询规则-${uniq}`;
  const hitBody = '{"mock":"hit-dog","rule":"kind=dog"}';

  // 数据准备：定义 /pets/{id}（默认响应体供 followApi 用）
  const def = await createApiDef(request, projectId, {
    name: defName,
    path: "/pets/{id}",
    respBody: '{"code":0,"data":{"kind":"def-default"}}',
  });

  // ── 用户路径：接口定义 → 详情 → MOCK 页签 → 新建规则 ──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await expect(page.getByTestId("input-api-name")).toHaveValue(defName);
  await page.getByTestId("api-tab-mock").click();
  await expect(page.getByTestId("mock-url-box")).toBeVisible();

  await page.getByTestId("btn-new-mock").click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByTestId("input-mock-name").fill(ruleName);
  // 匹配区 Query KV：kind=dog（「Query KV」标题后的 kvEditor 区）
  const querySection = modal.getByText("Query KV", { exact: true }).locator("xpath=following-sibling::div[1]");
  await querySection.getByText("＋ 添加").click();
  await querySection.locator('input[placeholder="kind"]').fill("kind");
  await querySection.locator('input[placeholder="value"]').fill("dog");
  // 响应体
  await modal.getByPlaceholder('{"code": 0}').fill(hitBody);

  const createApi = expectApi("**/api/v1/projects/*/apis/*/mocks");
  const createRaw = page.waitForResponse("**/api/v1/projects/*/apis/*/mocks");
  await modal.getByRole("button", { name: /保\s*存/ }).click();
  const created = await createApi;
  expect(created.status).toBe(201);
  expect(created.code).toBe(0);
  const rawRes = await createRaw;
  const payload = rawRes.request().postDataJSON() as {
    name: string;
    matchers: { query: { key: string; value: string }[] };
    response: { body: string };
  };
  expect(payload.name).toBe(ruleName);
  expect(payload.matchers.query).toEqual([{ key: "kind", value: "dog" }]);
  expect(payload.response.body).toBe(hitBody);

  // mock-url-box 显示地址 + 复制成功
  const urlBox = page.getByTestId("mock-url-box");
  await expect(urlBox).toContainText("/mock/");
  await expect(urlBox).toContainText("/pets/{id}");
  await page.getByTestId("btn-copy-mock-url").click();
  await expect(page.getByText("Mock 地址已复制")).toBeVisible();

  // 规则表出现行
  const ruleRow = page.getByTestId("mock-rule-table").getByRole("row", { name: new RegExp(ruleName) });
  await expect(ruleRow).toBeVisible();

  // ── page.request 直发 mock 服务：命中（体+200+x-mock-rule 头）──
  const mockUrl = await getMockUrl(page.request, projectId, def.id);
  const hit = await page.request.get(mockUrl.replace("{id}", "9") + "?kind=dog");
  expect(hit.status()).toBe(200);
  expect(await hit.text()).toBe(hitBody);
  expect(hit.headers()["x-mock-rule"]).toBeTruthy();

  // ── UI 调试弹窗：命中显示 ──
  const mockList = await page.request.get(`/api/v1/projects/${projectId}/apis/${def.id}/mocks`);
  const mockId = (await ok<{ items: { id: string; name: string }[] }>(mockList)).items.find(
    (m) => m.name === ruleName,
  )!.id;
  await ruleRow.getByTestId(`btn-debug-mock-${mockId}`).click();
  const dbgModal = page.getByRole("dialog");
  await expect(dbgModal).toBeVisible();
  // 调试弹窗预填 matchers query（kind=dog）
  await expect(dbgModal.locator('input[placeholder="kind"]')).toHaveValue("kind");
  await expect(dbgModal.locator('input[placeholder="value"]').first()).toHaveValue("dog");
  await dbgModal.getByTestId("btn-send-mock-debug").click();
  await expect(dbgModal.getByTestId("mock-debug-result")).toBeVisible();
  await expect(dbgModal.getByTestId("mock-debug-result")).toContainText(`命中规则：${ruleName}`);
  await expect(dbgModal.getByTestId("mock-debug-result")).toContainText(hitBody);

  await expectNoConsoleErrors();
});

test("API-005-02 二态与热更新：未命中 40401 / 禁用下线 / 改体生效 / followApi 跟随定义", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `N5${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const defName = `二态定义-${uniq}`;
  const ruleName = `二态规则-${uniq}`;
  const defRespBody = '{"code":0,"data":{"kind":"def-default"}}';

  const def = await createApiDef(request, projectId, {
    name: defName,
    path: "/pets/{id}",
    respBody: defRespBody,
  });
  const mockId = await createMockRule(request, projectId, def.id, {
    name: ruleName,
    query: [{ key: "kind", value: "dog" }],
    respBody: '{"mock":"v1"}',
  });
  const mockUrl = (await getMockUrl(page.request, projectId, def.id)).replace("{id}", "9");

  // ── 未命中二态：kind=cat → 404 + 业务码 40401 ──
  const miss = await page.request.get(`${mockUrl}?kind=cat`);
  expect(miss.status()).toBe(404);
  expect(((await miss.json()) as { code: number }).code).toBe(40401);

  // ── 用户路径：MOCK 页签 → 禁用规则（透明下线）──
  await navFromHome(page, "接口定义");
  await page.getByRole("link", { name: defName }).click();
  await page.getByTestId("api-tab-mock").click();
  const ruleRow = page.getByTestId("mock-rule-table").getByRole("row", { name: new RegExp(ruleName) });
  await expect(ruleRow).toBeVisible();

  const toggleApi = expectApi("**/api/v1/projects/*/apis/*/mocks/*");
  const toggleRaw = page.waitForResponse(
    (r) => r.url().includes("/mocks/") && r.request().method() === "PUT",
  );
  await ruleRow.locator(".ant-switch").click();
  const toggled = await toggleApi;
  expect(toggled.status).toBe(200);
  expect(toggled.code).toBe(0);
  const toggleRawRes = await toggleRaw;
  expect((toggleRawRes.request().postDataJSON() as { enabled: boolean }).enabled).toBe(false);
  await expect(ruleRow.getByText("（禁用=透明下线）")).toBeVisible();

  // 禁用后原命中 URL 未命中（40401）
  const disabled = await page.request.get(`${mockUrl}?kind=dog`);
  expect(disabled.status()).toBe(404);
  expect(((await disabled.json()) as { code: number }).code).toBe(40401);

  // ── 重新启用 + 热更新改响应体 → 立即生效 ──
  const enableApi = expectApi("**/api/v1/projects/*/apis/*/mocks/*");
  await ruleRow.locator(".ant-switch").click();
  const enabled = await enableApi;
  expect(enabled.code).toBe(0);
  const putResp = await page.request.put(`/api/v1/projects/${projectId}/apis/${def.id}/mocks/${mockId}`, {
    data: {
      name: ruleName,
      enabled: true,
      followApi: false,
      matchers: { headers: [], query: [{ key: "kind", value: "dog" }] },
      response: { status: 200, headers: [], body: '{"mock":"v2-hot"}', delayMs: 0 },
    },
  });
  expect(putResp.status()).toBe(200);
  expect(((await putResp.json()) as { code: number }).code).toBe(0);
  const hot = await page.request.get(`${mockUrl}?kind=dog`);
  expect(hot.status()).toBe(200);
  expect(await hot.text()).toBe('{"mock":"v2-hot"}');

  // ── followApi 开启 → 返回定义默认响应（断言响应体=定义 response.body）──
  const followResp = await page.request.put(`/api/v1/projects/${projectId}/apis/${def.id}/mocks/${mockId}`, {
    data: {
      name: ruleName,
      enabled: true,
      followApi: true,
      matchers: { headers: [], query: [{ key: "kind", value: "dog" }] },
      response: { status: 200, headers: [], body: '{"mock":"v2-hot"}', delayMs: 0 },
    },
  });
  expect(followResp.status()).toBe(200);
  const followed = await page.request.get(`${mockUrl}?kind=dog`);
  expect(followed.status()).toBe(200);
  expect(await followed.text()).toBe(defRespBody);

  await expectNoConsoleErrors();
});
