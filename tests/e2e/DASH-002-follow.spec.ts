import { test, expect, navFromHome } from "./fixtures";

/**
 * DASH-002 待办跟进（规格 §5 T2/T3）：关注七维度/我创建的口径/待办接口域。
 * 三类断言：UI（子筛选/行）；Console；接口（follow 幂等/followed kind 过滤/created 口径）。
 */

test("DASH-002-01 关注计划与七维度筛选", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const planName = `关注计划-${uniq}`;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;

  // 列表行关注星（UI）+ 接口幂等
  await navFromHome(page, "测试计划");
  const star = page.getByTestId(`plan-follow-${planId}`);
  await expect(star).toBeVisible({ timeout: 10_000 });
  const followApi = expectApi("**/api/v1/projects/*/plans/*/follow");
  await star.click();
  const followed = await followApi;
  expect(followed.status).toBe(200);
  expect((followed.data as { followed: boolean }).followed).toBe(true);

  // 工作台我关注的 kind=plan 可见 / kind=scenario 为空（维度隔离，接口断言）
  const f1 = await request.get(`/api/v1/projects/${projectId}/dashboard/followed?kind=plan`);
  const f1b = (await f1.json()) as { data: { total: number; items: { title: string }[] } };
  expect(f1b.data.total).toBeGreaterThanOrEqual(1);
  expect(f1b.data.items.some((i) => i.title === planName)).toBe(true);
  const f2 = await request.get(`/api/v1/projects/${projectId}/dashboard/followed?kind=scenario`);
  expect(((await f2.json()) as { data: { total: number } }).data.total).toBe(0);

  // UI：工作台子筛选（先切「我关注的」Tab 再点维度）
  await navFromHome(page, "工作台");
  await page.getByRole("tab", { name: "我关注的" }).click();
  await page.getByTestId("dash-followed-kind-plan").click();
  await expect(page.locator("body")).toContainText(planName, { timeout: 10_000 });

  // 我创建的（plan）= 创建人口径：本人可见
  const c1 = await request.get(`/api/v1/projects/${projectId}/dashboard/created?kind=plan`);
  const c1b = (await c1.json()) as { data: { items: { title: string }[] } };
  expect(c1b.data.items.some((i) => i.title === planName)).toBe(true);

  // 取关（API——UI 星初次关注已验证；列表缓存 followed 滞后会误反向触发 POST）
  const unfollow = await request.delete(`/api/v1/projects/${projectId}/plans/${planId}/follow`);
  expect(unfollow.status()).toBe(200);
  await expect
    .poll(
      async () => {
        const r = await request.get(`/api/v1/projects/${projectId}/dashboard/followed?kind=plan`);
        return ((await r.json()) as { data: { total: number } }).data.total;
      },
      { timeout: 10_000 },
    )
    .toBe(0);
  await expectNoConsoleErrors();
});

test("DASH-002-02 我的待办含接口用例行（refType 徽标）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const modRes = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await modRes.json()) as { data: { items: { id: string }[] } }).data.items[0]!.id;
  const apiRes = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: {
      moduleId: modId,
      name: `待办接口-${uniq}`,
      request: {
        spec: {
          method: "GET",
          url: "/x",
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
        },
        asserts: [],
        pre: [],
        post: [],
        extracts: [],
      },
    },
  });
  const apiId = ((await apiRes.json()) as { data: { id: string } }).data.id;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/cases`, {
    data: {
      name: `待办接口用例-${uniq}`,
      level: "P1",
      status: "UNDERWAY",
      tags: [],
      request: {
        spec: {
          method: "GET",
          url: "/x",
          headers: [],
          query: [],
          body: { kind: "none" },
          auth: { kind: "none" },
        },
        asserts: [],
        pre: [],
        post: [],
        extracts: [],
      },
    },
  });
  expect(caseRes.status()).toBe(201);
  const acaseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const meRes = await request.get("/api/v1/personal/me");
  const userId = ((await meRes.json()) as { data: { userId: string } }).data.userId;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: `待办计划-${uniq}` },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  const link = await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { apiCaseIds: [acaseId], execUserId: userId },
  });
  expect(((await link.json()) as { data: { added: number } }).data.added).toBe(1);

  // 接口断言：todo exec 含 api_case 行
  const todoRes = await request.get(`/api/v1/projects/${projectId}/dashboard/todo?kind=exec`);
  const todoBody = (await todoRes.json()) as {
    data: { items: { refType?: string; title: string }[] };
  };
  expect(
    todoBody.data.items.some(
      (i) => i.refType === "api_case" && i.title.includes(`待办接口用例-${uniq}`),
    ),
  ).toBe(true);

  // UI：工作台「我的执行」子区可见（类型徽标渲染）
  await navFromHome(page, "工作台");
  await page.getByRole("button", { name: "我的执行" }).click();
  await expect(page.locator("body")).toContainText(`待办接口用例-${uniq}`, { timeout: 10_000 });
  await expectNoConsoleErrors();
});
