import { test, expect, navFromHome } from "./fixtures";
import { MOCK_BASE } from "./env";

/**
 * PLAN-003 计划执行（规格 §5 T2/T3/T5）
 * 三类断言：UI（执行态/状态徽标/脑图执行）；Console（expectNoConsoleErrors）；接口（execute 201/回写 FAIL）。
 * mock 口径与 S3 一致（e2e 栈 mock 随槽位，env.ts MOCK_BASE）。
 */

const mockUrl = `${MOCK_BASE}/hello`;
const apiSpec = () => ({
  spec: {
    method: "GET" as const,
    url: mockUrl,
    headers: [],
    query: [],
    body: { kind: "none" as const },
    auth: { kind: "none" as const },
  },
  asserts: [],
  pre: [],
  post: [],
  extracts: [],
});

test("PLAN-003-01 引擎执行主链路（关联→执行→回写→报告）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const planName = `执行计划-${uniq}`;

  const modRes = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await modRes.json()) as { data: { items: { id: string }[] } }).data.items[0]!.id;
  const apiRes = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: { moduleId: modId, name: `执行接口-${uniq}`, request: apiSpec() },
  });
  expect(apiRes.status()).toBe(201);
  const apiId = ((await apiRes.json()) as { data: { id: string } }).data.id;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/cases`, {
    data: {
      name: `必败用例-${uniq}`,
      level: "P2",
      status: "UNDERWAY",
      tags: [],
      request: {
        ...apiSpec(),
        asserts: [{ kind: "status_code", path: "", op: "eq", expected: "500" }],
      },
    },
  });
  expect(caseRes.status()).toBe(201);
  const acaseId = ((await caseRes.json()) as { data: { id: string } }).data.id;

  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: planName },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;

  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: planName }).click();

  // 规划 Tab 关联接口用例（三页签）
  await page.getByTestId("plan-points-tab").click();
  await page.getByTestId("btn-link-to-point").click();
  await page.getByRole("tab", { name: "接口用例" }).click();
  await page.getByRole("dialog").getByRole("combobox").first().click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.getByTestId("link-candidates").getByText(`必败用例-${uniq}`).click();
  const linkApi = expectApi("**/api/v1/projects/*/plans/*/cases");
  await page.getByTestId("btn-confirm-link").click();
  const linked = await linkApi;
  expect(linked.status).toBe(200);
  expect((linked.data as { added: number }).added).toBe(1);

  // 用例清单 Tab：执行全部（串行）
  await page.getByTestId("plan-cases-tab").click();
  const execApi = expectApi("**/api/v1/projects/*/plans/*/execute");
  await page.getByTestId("btn-execute-plan").click();
  const exec = await execApi;
  expect(exec.status).toBe(201);
  expect(exec.code).toBe(0);
  const taskId = (exec.data as { taskId: string }).taskId;

  // 等待回写：详情轮询至 FAIL（必败用例）
  await expect
    .poll(
      async () => {
        const d = await request.get(`/api/v1/projects/${projectId}/plans/${planId}`);
        const body = (await d.json()) as { data: { cases: { name: string; status: string }[] } };
        return body.data.cases.find((c) => c.name.includes(`必败用例-${uniq}`))?.status;
      },
      { timeout: 30_000 },
    )
    .toBe("FAIL");

  // 报告 Tab：type=plan 报告可读（跳转报告页）
  await page.goto(`/reports/${taskId}`);
  await expect(page.getByText(/计划执行/)).toBeVisible({ timeout: 15_000 });
  await expectNoConsoleErrors();
});

test("PLAN-003-02 脑图执行 S/E/B 标记与列表同步", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const caseName = `脑图执行用例-${uniq}`;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/cases`, {
    data: { name: caseName, precondition: "", steps: [{ desc: "s1", expect: "e1" }] },
  });
  const caseId = ((await caseRes.json()) as { data: { id: string } }).data.id;
  const planRes = await request.post(`/api/v1/projects/${projectId}/plans`, {
    data: { name: `脑图执行计划-${uniq}` },
  });
  const planId = ((await planRes.json()) as { data: { id: string } }).data.id;
  await request.post(`/api/v1/projects/${projectId}/plans/${planId}/cases`, {
    data: { caseIds: [caseId] },
  });

  await navFromHome(page, "测试计划");
  await page.getByRole("link", { name: `脑图执行计划-${uniq}` }).click();
  await page.getByTestId("plan-mindmap-tab").click();
  await expect(page.getByTestId("plan-mindmap-exec")).toBeVisible();
  await page.getByRole("button", { name: new RegExp(caseName) }).click();
  await expect(page.getByTestId("mindmap-exec-panel")).toContainText(caseName);

  // S 键标记 → 接口断言 status=PASS
  const markApi = expectApi("**/api/v1/projects/*/plans/*/cases/*/exec");
  await page.keyboard.press("s");
  const marked = await markApi;
  expect(marked.status).toBe(200);
  expect((marked.data as { status: string }).status).toBe("PASS");

  // 列表 Tab 状态同步（通过）
  await page.getByTestId("plan-cases-tab").click();
  await expect(page.getByTestId("plan-cases-table")).toContainText("通过");
  await expectNoConsoleErrors();
});
