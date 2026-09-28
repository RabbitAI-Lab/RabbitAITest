import { test, expect, navFromHome } from "./fixtures";

/**
 * PLAN-002 测试规划与测试点（规格 §5 T2/T3）
 * 三类断言：UI（点树/计数/未分组）；Console（expectNoConsoleErrors）；接口（points/cases move payload）。
 */

test("PLAN-002-01 测试点树与挂载移动", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const caseName = `规划挂点用例-${uniq}`;
  const planName = `规划计划-${uniq}`;

  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName, precondition: "", steps: [{ desc: "s", expect: "e" }] },
  });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;

  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: planName }).click();
  await page.getByTestId("plan-points-tab").click();
  await expect(page.getByTestId("plan-points-panel")).toBeVisible();

  // 建父点 → 子点（显式配置）
  await page.getByTestId("btn-add-point").click();
  await page.getByRole("dialog").getByPlaceholder("测试点名称").fill(`支付域-${uniq}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确 定|确定/ })
    .click();
  await expect(page.getByTestId("plan-points-panel")).toContainText(`支付域-${uniq}`);

  // 接口断言：关联挂点 payload 带 pointId
  await page.getByTestId("btn-link-to-point").click();
  await page.getByTestId("link-candidates").getByText(caseName).click();
  const linkApi = expectApi("**/api/v1/projects/*/plans/*/cases");
  await page.getByTestId("btn-confirm-link").click();
  const linked = await linkApi;
  expect(linked.status).toBe(200);
  expect(linked.code).toBe(0);

  // 未分组视图兜底：切到未分组应为空
  await page.getByTestId("point-ungrouped").click();
  await expect(page.getByTestId("plan-points-panel")).toContainText("暂无挂载用例");

  await expectNoConsoleErrors();
});

test("PLAN-002-02 删除非空点被拒绝（UI Toast + 接口 422）", async ({
  authedPage,
  page,
  request,
  expectApi,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: `非空点用例-${uniq}`, precondition: "", steps: [] },
  });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: `非空点计划-${uniq}` },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  const ptRes = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/points`, {
    data: { name: `非空点-${uniq}` },
  });
  expect(ptRes.status()).toBe(201);
  const pointId = ((await ptRes.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId], pointId },
  });

  // 接口断言：30455 POINT_NOT_EMPTY
  const delRes = await request.delete(
    `/api/v1/projects/${projectId}/plans/${planId}/points/${pointId}`,
  );
  expect(delRes.status()).toBe(422);
  expect(((await delRes.json()) as { code: number }).code).toBe(30455);

  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: `非空点计划-${uniq}` }).click();
  await page.getByTestId("plan-points-tab").click();
  await expect(page.getByTestId("plan-points-panel")).toContainText(`非空点-${uniq}`);
  await expectNoConsoleErrors();
});
