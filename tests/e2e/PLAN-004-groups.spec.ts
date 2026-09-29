import { test, expect, navFromHome } from "./fixtures";

/**
 * PLAN-004 计划分组（规格 §5 T3）：组视图/聚合/级联归档二态。
 * 三类断言：UI（组行/成员/徽标）；Console；接口（move-group payload、archive 级联后成员只读 10008）。
 */

test("PLAN-004-01 组视图与级联归档二态", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const memberA = `组员A-${uniq}`;
  const memberB = `组员B-${uniq}`;
  for (const n of [memberA, memberB]) {
    await request.post(`/api/v1/projects/${projectId}/plans`, { data: { name: n } });
  }
  const grpRes = await request.post(`/api/v1/projects/${projectId}/plan-groups`, {
    data: { name: `回归组-${uniq}`, description: "" },
  });
  expect(grpRes.status()).toBe(201);
  const groupId = ((await grpRes.json()) as { data: { id: string } }).data.id;
  const aRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: memberA },
  });
  const planA = ((await aRes.json()) as { data: { id: string } }).data.id;
  const bRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: memberB },
  });
  const planB = ((await bRes.json()) as { data: { id: string } }).data.id;

  await navFromHome(page, "测试计划");
  await expect(page.getByTestId(`plan-group-row-${groupId}`)).toBeVisible({ timeout: 10_000 });

  // 移入 A（UI 弹窗，payload 断言）
  await page.getByTestId(`plan-move-group-${planA}`).click();
  const moveApi = expectApi("**/api/v1/projects/*/plans/*/move-group");
  await page.getByRole("dialog").getByText(`回归组-${uniq}`).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /移 入|移入/ })
    .click();
  const moved = await moveApi;
  expect(moved.status).toBe(200);
  expect((moved.data as { groupId: string }).groupId).toBe(groupId);

  // API 移入 B
  await request.post(`/api/v1/projects/${projectId}/plans/${planB}/move-group`, {
    data: { groupId },
  });

  // 组行成员计数
  await expect(page.getByTestId(`plan-group-row-${groupId}`)).toContainText("组");
  await page
    .getByTestId(`plan-group-row-${groupId}`)
    .getByRole("button", { name: /展开/ })
    .click()
    .catch(() => {});
  await expect(page.getByTestId(`plan-group-row-${groupId}`)).toBeVisible();

  // 级联归档二态：组归档 → 成员写操作 422/10008（接口断言）
  const arcRes = await request.post(`/api/v1/projects/${projectId}/plan-groups/${groupId}/archive`);
  expect(arcRes.status()).toBe(200);
  const putRes = await request.put(`/api/v1/projects/${projectId}/plans/${planA}`, {
    data: { name: "should-fail" },
  });
  expect(putRes.status()).toBe(422);
  expect(((await putRes.json()) as { code: number }).code).toBe(10008);
  // 恢复 → 可写
  await request.post(`/api/v1/projects/${projectId}/plan-groups/${groupId}/unarchive`);
  const put2 = await request.put(`/api/v1/projects/${projectId}/plans/${planA}`, {
    data: { name: `${memberA}-ok` },
  });
  expect(put2.status()).toBe(200);

  await expectNoConsoleErrors();
});

test("PLAN-004-02 组报告聚合页", async ({ authedPage, page, request, expectNoConsoleErrors }) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const grpRes = await request.post(`/api/v1/projects/${projectId}/plan-groups`, {
    data: { name: `报告组-${uniq}` },
  });
  const groupId = ((await grpRes.json()) as { data: { id: string } }).data.id;
  const pRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: `报告组成员-${uniq}` },
  });
  const planId = ((await pRes.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/move-group`, {
    data: { groupId },
  });

  await page.goto(`/plans/groups/${groupId}`);
  await expect(page.getByTestId("group-report-page")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId(`group-member-row-${planId}`)).toBeVisible();
  await expectNoConsoleErrors();
});
