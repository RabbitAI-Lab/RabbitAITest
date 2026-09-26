import { test, expect } from "./fixtures";

/**
 * DASH-001 工作台首页（规格：docs/sprint-1-mvp-test-mgmt/DASH-001-workbench-home.md §5 T2/T3）
 * 三类断言（rules/testing.md §3.1）：
 * - UI：dash-card-* 四卡 / dash-value-* 数字 / dash-item 待办列表 / dash-card-setting 卡片设置布局记忆
 * - Console：expectNoConsoleErrors
 * - 接口：expectApi（overview?range=3d、todo?kind=bug、preferences/dash_cards 的 status + code + data）
 * 工作台即首页（路由 /，用户路径例外允许 page.goto('/')）。
 */

test("DASH-001-01 看板与待办（我的缺陷出现→处理后消失）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `T${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const bugTitle = `待办缺陷-${uniq}`;

  // 首页 = 工作台（接口断言聚合 overview 信封）
  const overviewApi = expectApi("**/api/v1/projects/*/dashboard/overview*");
  await page.goto("/");
  const overview = await overviewApi;
  expect(overview.status).toBe(200);
  expect(overview.code).toBe(0);
  expect((overview.data as Record<string, unknown>).bugCard).toBeTruthy();

  // UI：四卡可见（case/review/plan/bug）且主数字元素在
  await expect(page.getByTestId("dash-home")).toBeVisible();
  for (const key of ["case", "review", "plan", "bug"] as const) {
    await expect(page.getByTestId(`dash-card-${key}`)).toBeVisible();
    await expect(page.getByTestId(`dash-value-${key}`)).toBeVisible();
  }
  await expect(page.getByTestId("dash-tab-todo")).toBeVisible();

  // 造数：API 建 1 条处理人=自己的缺陷（待办口径：handle_user=me 且状态非结束态，dash.service.ts）
  const meRes = await request.get("/api/v1/personal/me");
  expect(meRes.status()).toBe(200);
  const me = ((await meRes.json()) as { code: number; data: { userId: string } }).data;
  const bugRes = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: bugTitle, handleUserId: me.userId },
  });
  expect(bugRes.status()).toBe(201);
  const bug = ((await bugRes.json()) as { code: number; data: { id: string } }).data;

  // 刷新 → 我的待办切「我的缺陷」（dash-todo-bug）→ 该缺陷出现（接口 kind=bug + UI dash-item）
  await page.reload();
  await expect(page.getByTestId("dash-home")).toBeVisible();
  const todoBugApi1 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=bug*");
  await page.getByTestId("dash-todo-bug").click();
  const todo1 = await todoBugApi1;
  expect(todo1.status).toBe(200);
  expect(todo1.code).toBe(0);
  const total1 = (todo1.data as { total: number }).total;
  expect(total1).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("dash-item").filter({ hasText: bugTitle })).toBeVisible();

  // 处理它：API 流转到已关闭（待处理→处理中→已关闭，预置工作流）
  for (const toState of ["处理中", "已关闭"]) {
    const tr = await request.post(`/api/v1/projects/${projectId}/bugs/${bug.id}/transition`, {
      data: { toState, comment: "e2e 处理" },
    });
    expect(tr.status()).toBe(200);
    expect(((await tr.json()) as { code: number }).code).toBe(0);
  }

  // 刷新断言待办消失（total -1，列表无该条）
  await page.reload();
  await expect(page.getByTestId("dash-home")).toBeVisible();
  const todoBugApi2 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=bug*");
  await page.getByTestId("dash-todo-bug").click();
  const todo2 = await todoBugApi2;
  expect(todo2.code).toBe(0);
  expect((todo2.data as { total: number }).total).toBe(total1 - 1);
  await expect(page.getByTestId("dash-item").filter({ hasText: bugTitle })).toHaveCount(0);

  await expectNoConsoleErrors();
});

test("DASH-001-02 时间筛选与卡片设置（布局记忆）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `F${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const caseName = `看板用例-${uniq}`;

  // 造数：API 造 1 用例（新项目内用例总数=1）
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName },
  });
  expect(caseRes.status()).toBe(201);
  expect(((await caseRes.json()) as { code: number }).code).toBe(0);

  // 首页记 dash-value-case 数字 X（UI 断言）
  await page.goto("/");
  await expect(page.getByTestId("dash-card-case")).toBeVisible();
  await expect(page.getByTestId("dash-value-case")).toHaveText("1");
  const x = await page.getByTestId("dash-value-case").innerText();

  // 切近 3 天：请求必须带 range=3d（接口断言，URL glob）；数字变化或不变均以 UI 断言收口
  const rangeApi = expectApi("**/api/v1/projects/*/dashboard/overview?range=3d*");
  await page.getByTestId("dash-range").getByText("近 3 天").click();
  const ranged = await rangeApi;
  expect(ranged.status).toBe(200);
  expect(ranged.code).toBe(0);
  expect((ranged.data as { caseCard: { total: number } }).caseCard.total).toBe(1);
  const y = await page.getByTestId("dash-value-case").innerText();
  expect(y).toMatch(/^\d+$/); // 与 X 相同或变化均可，但必须是数字
  expect(x).toMatch(/^\d+$/);

  // 卡片设置：评审卡设为不展示（接口断言 user_preference 持久化 + UI 立即隐藏）
  await page.getByTestId("dash-card-setting").click();
  await expect(page.getByTestId("dash-card-popover")).toBeVisible();
  const prefApi = expectApi("**/api/v1/personal/preferences/dash_cards*");
  const reviewRow = page
    .getByTestId("dash-card-popover")
    .getByText("评审卡", { exact: true })
    .locator("..");
  await reviewRow.getByText("不展示").click();
  const pref = await prefApi;
  expect(pref.status).toBe(200);
  expect(pref.code).toBe(0);
  expect((pref.data as { value: Record<string, string> }).value.review).toBe("hidden");
  await expect(page.getByTestId("dash-card-review")).toHaveCount(0);

  // 刷新断言布局记忆：评审卡仍不展示，其余卡仍在
  await page.reload();
  await expect(page.getByTestId("dash-card-case")).toBeVisible();
  await expect(page.getByTestId("dash-card-review")).toHaveCount(0);

  await expectNoConsoleErrors();
});

/** coverage-audit 回补：DASH-001 §1.2 行 5「我的待办：待我评审、我的计划执行、我的缺陷」——规格 §5 T2 声明
 *  三域（评审/执行/缺陷），现有用例只覆盖缺陷域；本用例补「待我评审」「我的执行」两域的出现→处理后消失。
 *  期望值溯源规格 §2 待办判定：待我评审=ReviewCase.reviewers∋me 且 result=pending 且评审未结束；
 *  我的执行=PlanCaseRef.executor=me 且 exec=pending 且计划未归档。 */
test("DASH-001-03 待办：待我评审与我的计划执行（出现→处理后消失）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `R${Date.now() % 1e7}${Math.floor(Math.random() * 1e3)}`;
  const caseName = `待办评审用例-${uniq}`;
  const reviewName = `待办评审-${uniq}`;
  const planName = `待办执行计划-${uniq}`;

  // 造数①：用例 + multi 评审（评审人=我，result=pending）→ 待我评审 1 条
  const meRes = await request.get("/api/v1/personal/me");
  expect(meRes.status()).toBe(200);
  const me = ((await meRes.json()) as { data: { userId: string } }).data;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName },
  });
  expect(caseRes.status()).toBe(201);
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const reviewRes = await request.post(`/api/v1/projects/${projectId}/reviews`, {
    data: { name: reviewName, reviewMode: "MULTI", reviewers: [me.userId], caseIds: [caseId] },
  });
  expect(reviewRes.status()).toBe(201);
  const reviewId = ((await reviewRes.json()) as { data: { id: string } }).data.id;

  // 造数②：计划 + 关联用例 + 执行人=我（batch-executor）→ 我的执行 1 条（pending）
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  expect(planRes.status()).toBe(201);
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  const linkRes = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId], execUserId: me.userId },
  });
  expect(((await linkRes.json()) as { data: { added: number } }).data.added).toBe(1);

  // 用户路径：首页（工作台）→ 我的待办
  await page.goto("/");
  await expect(page.getByTestId("dash-home")).toBeVisible();

  // 待我评审域：kind=review 出现该评审（接口 + UI）
  // 默认 Tab=待办且 kind=review 已随首屏发出，重复点击不重发——先切 exec 触发重挂载再回 review
  await page.getByTestId("dash-todo-exec").click();
  await page.waitForResponse("**/api/v1/projects/*/dashboard/todo?kind=exec*");
  const todoReviewApi1 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=review*");
  await page.getByTestId("dash-todo-review").click();
  const reviewTodo1 = await todoReviewApi1;
  expect(reviewTodo1.status).toBe(200);
  expect(reviewTodo1.code).toBe(0);
  expect((reviewTodo1.data as { total: number }).total).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("dash-item").filter({ hasText: reviewName })).toBeVisible();

  // 我的执行域：kind=exec 出现该计划（接口 + UI）
  const todoExecApi1 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=exec*");
  await page.getByTestId("dash-todo-exec").click();
  const execTodo1 = await todoExecApi1;
  expect(execTodo1.status).toBe(200);
  expect((execTodo1.data as { total: number }).total).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("dash-item").filter({ hasText: planName })).toBeVisible();

  // 处理①：API 标记评审 PASS → 待我评审 -1
  const judgeRes = await request.post(
    `/api/v1/projects/${projectId}/reviews/${reviewId}/cases/${caseId}/judge`,
    { data: { result: "PASS", comment: "" } },
  );
  expect(judgeRes.status()).toBe(200);
  // 处理②：API 标记计划执行 PASS → 我的执行 -1
  const planDetail = await request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
  const refId = (
    (await planDetail.json()) as { data: { cases: { refId: string }[] } }
  ).data.cases[0].refId;
  const execRes = await request.post(
    `/api/v1/projects/${projectId}/plans/${planId}/cases/${refId}/exec`,
    { data: { status: "PASS" } },
  );
  expect(execRes.status()).toBe(200);

  // 刷新后两域条目消失（口径：pending 清空 → total 归零回基线，列表无该条目）
  await page.reload();
  await expect(page.getByTestId("dash-home")).toBeVisible();
  const todoReviewApi2 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=review*");
  await page.getByTestId("dash-todo-review").click();
  const reviewTodo2 = await todoReviewApi2;
  expect(reviewTodo2.code).toBe(0);
  expect((reviewTodo2.data as { total: number }).total).toBe(
    (reviewTodo1.data as { total: number }).total - 1,
  );
  await expect(page.getByTestId("dash-item").filter({ hasText: reviewName })).toHaveCount(0);
  const todoExecApi2 = expectApi("**/api/v1/projects/*/dashboard/todo?kind=exec*");
  await page.getByTestId("dash-todo-exec").click();
  const execTodo2 = await todoExecApi2;
  expect(execTodo2.code).toBe(0);
  expect((execTodo2.data as { total: number }).total).toBe(
    (execTodo1.data as { total: number }).total - 1,
  );
  await expect(page.getByTestId("dash-item").filter({ hasText: planName })).toHaveCount(0);

  await expectNoConsoleErrors();
});
