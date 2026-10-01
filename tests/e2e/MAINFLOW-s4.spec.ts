import { test, expect, navFromHome } from "./fixtures";
import { MOCK_BASE } from "./env";

/**
 * MAINFLOW-s4 主链路（sprint-overview §4 验收 1/2/8/9 压缩）：
 * 建计划 → 测试点挂接口用例 → 引擎执行 → 报告（阈值/点分组）→ CSV → 工作台关注。
 * 三类断言：UI/Console/接口。
 */

const mockUrl = `${MOCK_BASE}/hello`;
const spec = () => ({
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

test("MAINFLOW-s4 计划完整链路", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  // 重负载链路显式放宽用例级超时（PR#41 main 实证：慢共享 runner 上报告聚合两阶段 >60s，
  // 默认 60s 用例超时先于断言超时杀测试且重试同样中招；断言超时 120s 与之匹配）
  test.setTimeout(180_000);
  const { projectId } = authedPage;
  const uniq = `${Date.now() % 1e7}`;
  const planName = `主链路计划-${uniq}`;

  // 造接口用例
  const modRes = await request.get(`/api/v1/projects/${projectId}/modules?scene=api`);
  const modId = ((await modRes.json()) as { data: { items: { id: string }[] } }).data.items[0]!.id;
  const apiRes = await request.post(`/api/v1/projects/${projectId}/apis`, {
    data: { moduleId: modId, name: `主链路接口-${uniq}`, request: spec() },
  });
  const apiId = ((await apiRes.json()) as { data: { id: string } }).data.id;
  const caseRes = await request.post(`/api/v1/projects/${projectId}/apis/${apiId}/cases`, {
    data: {
      name: `主链路用例-${uniq}`,
      level: "P1",
      status: "UNDERWAY",
      tags: [],
      request: spec(),
    },
  });
  const acaseId = ((await caseRes.json()) as { data: { id: string } }).data.id;

  // UI：建计划（阈值 80）
  await navFromHome(page, "测试计划");
  await page.getByTestId("btn-new-plan").click();
  await page.getByTestId("input-plan-name").fill(planName);
  await page.getByTestId("input-threshold").fill("80");
  await page.getByTestId("btn-submit-plan").click();
  await expect(page.getByRole("link", { name: planName })).toBeVisible({ timeout: 10_000 });

  // 进详情 → 规划 Tab：建点（显式配置）+ 挂接口用例
  await page.getByRole("link", { name: planName }).click();
  await page.getByTestId("plan-points-tab").click();
  await page.getByTestId("btn-add-point").click();
  await page.getByRole("dialog").getByPlaceholder("测试点名称").fill(`主链路点-${uniq}`);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /确 定|确定/ })
    .click();
  await expect(page.getByTestId("plan-points-panel")).toContainText(`主链路点-${uniq}`);
  await page.getByTestId("btn-link-to-point").click();
  await page.getByRole("tab", { name: "接口用例" }).click();
  await page.getByRole("dialog").getByRole("combobox").first().click();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  // 候选列表=弹窗内 react-query 首查+过滤，慢机 10s click 超时不够（PR#42 shard1 实证）——
  // 先强等待目标行文本出现（containText 即就绪信号），click 必中
  await expect(page.getByTestId("link-candidates")).toContainText(`主链路用例-${uniq}`, {
    timeout: 20_000,
  });
  await page.getByTestId("link-candidates").getByText(`主链路用例-${uniq}`).click();
  await page.getByTestId("btn-confirm-link").click();

  // 执行全部 → 状态回写 PASS
  await page.getByTestId("plan-cases-tab").click();
  const planPageUrl = page.url(); // 计划详情页 URL（yank 竞态根治的显式回归点，见下）
  const execApi = expectApi("**/api/v1/projects/*/plans/*/execute");
  await page.getByTestId("btn-execute-plan").click();
  const exec = await execApi;
  expect(exec.status).toBe(201);
  const taskId = (exec.data as { taskId: string }).taskId;

  void taskId;
  // 引擎回写断言见 PLAN-003-01（同链路）；本主链路断言执行受理与报告视图

  // 报告 Tab：阈值横幅 + 点分组（主链路点）+ CSV。
  // 自动跳转竞态根治（PR#42 shard1 三重试全灭实证）：PlanExecBar 在 runningTask 轮询命中终态时
  // router.push('/reports/{taskId}') 把页面 yank 走（plan-report-v2 随之卸载，120s 也等不回）——
  // 快机断言先完成、慢机 yank 先到，纯竞态双向都可能输。显式 goto 回计划页 = 组件重挂载
  // runningTask 清空，yank 永不再触发；候选/查询仍在（服务端态）。
  await page.goto(planPageUrl);
  const reportTab = page.getByTestId("plan-report-tab");
  await expect(reportTab).toBeVisible({ timeout: 20_000 });
  await reportTab.click({ timeout: 20_000, force: true });
  await expect(page.getByTestId("plan-report-v2")).toBeVisible({ timeout: 120_000 }); // 引擎回写聚合 + react-query 首查两阶段（CI 高压实证 >40s；慢 runner >60s——PR#41 假红实证）
  await expect(page.getByTestId("plan-report-v2")).toContainText(`主链路点-${uniq}`, {
    timeout: 15_000,
  });
  const listRes = await request.get(`/api/v1/projects/${projectId}/plans?page=1&pageSize=50`);
  const plans = ((await listRes.json()) as { data: { items: { name: string; id: string }[] } }).data
    .items;
  const mainflowPlanId = plans.find((x) => x.name === planName)?.id;
  expect(mainflowPlanId).toBeTruthy();
  const csvRes = await request.get(
    `/api/v1/projects/${projectId}/plans/${mainflowPlanId}/report/export`,
  );
  expect(csvRes.status()).toBe(200);

  // 工作台关注收口
  await navFromHome(page, "测试计划");
  const row = page.locator("tr", { hasText: planName }).first();
  await row
    .getByTestId(/plan-follow-/)
    .click()
    .catch(async () => {
      // 兜底：任何星形
      await row.locator("[data-testid*='plan-follow']").first().click();
    });
  await navFromHome(page, "工作台");
  await page.getByRole("tab", { name: "我关注的" }).click();
  await page.getByTestId("dash-followed-kind-plan").click();
  await expect(page.locator("body")).toContainText(planName, { timeout: 10_000 });

  await expectNoConsoleErrors();
});
