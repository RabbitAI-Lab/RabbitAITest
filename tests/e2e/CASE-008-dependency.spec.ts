import { test, expect, navFromHome } from "./fixtures";

/**
 * CASE-008 依赖与历史（规格 §5 T2/T3）：环检测 UI + blockedBy 执行联动。
 * 三类断言：UI（Toast/黄条提示）；Console；接口（dependencies 422/30484、exec blockedBy）。
 */

test("CASE-008-01 环检测与执行联动 blockedBy", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const nameA = `依赖A-${uniq}`;
  const nameB = `依赖B-${uniq}`;
  const aRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: nameA, precondition: "", steps: [{ desc: "s", expect: "e" }] },
  });
  const caseA = ((await aRes.json()) as { data: { id: string } }).data.id;
  const bRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: nameB, precondition: "", steps: [{ desc: "s", expect: "e" }] },
  });
  const caseB = ((await bRes.json()) as { data: { id: string } }).data.id;

  // A→B 建立
  const depRes = await request.post(`/api/v1/projects/${projectId}/cases/${caseB}/dependencies`, {
    data: { preCaseId: caseA, postCaseId: caseB },
  });
  expect(depRes.status()).toBe(201);

  // 反向成环 422/30484（接口断言）
  const cycRes = await request.post(`/api/v1/projects/${projectId}/cases/${caseA}/dependencies`, {
    data: { preCaseId: caseB, postCaseId: caseA },
  });
  expect(cycRes.status()).toBe(422);
  expect(((await cycRes.json()) as { code: number }).code).toBe(30484);

  // UI：依赖 Tab 双列表可见
  await navFromHome(page, "测试用例");
  await page.getByRole("link", { name: nameB }).click();
  await page.getByTestId("tab-dependencies").click();
  await expect(page.getByTestId("tab-dependencies")).toBeVisible();
  await expect(page.locator("body")).toContainText(nameA, { timeout: 10_000 });

  // 执行联动：计划内 A FAIL → 标记 B 响应含 blockedBy（接口断言）
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: `联动计划-${uniq}` },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseA, caseB] },
  });
  const detRes = await request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
  const cases = ((await detRes.json()) as { data: { cases: { caseId: string; refId: string }[] } })
    .data.cases;
  const refA = cases.find((c) => c.caseId === caseA)!.refId;
  const refB = cases.find((c) => c.caseId === caseB)!.refId;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases/${refA}/exec`, {
    data: { status: "FAIL", actualResult: "A 失败", comment: "" },
  });
  const bExec = await request.post(
    `/api/v1/projects/${projectId}/plans/${planId}/cases/${refB}/exec`,
    {
      data: { status: "BLOCKED", actualResult: "前置未过", comment: "" },
    },
  );
  const bBody = (await bExec.json()) as {
    code: number;
    data: { blockedBy?: { caseId: string }[] };
  };
  expect(bBody.code).toBe(0);
  expect(bBody.data.blockedBy?.[0]?.caseId).toBe(caseA);

  await expectNoConsoleErrors();
});
