import { test, expect, navFromHome } from "./fixtures";

/**
 * AI-002 功能用例 AI 生成（docs/sprint-7-ai/AI-002-case-generation.md §5）。
 * 三类断言：UI（生成抽屉/草稿卡片/勾选导入）+ Console + 接口（生成 payload/草稿确定性/导入落库）。
 * 前置：global-setup 种子 mock 模型（e2e-mock-模型，baseUrl→e2e mock 槽位端口 4100+s）。
 */

test("AI-002-01 AI 生成全链路（生成→勾选→导入用例列表）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;

  await navFromHome(page, "测试用例");
  await page.getByTestId("btn-ai-generate").click();
  await expect(page.getByTestId("ai-case-generate-drawer")).toBeVisible();

  // 输入需求 → 生成（接口断言：payload 含 requirement；mock 确定性 2 条草稿）
  await page
    .getByTestId("ai-case-requirement")
    .fill("用户连续输错密码 5 次应锁定 30 分钟，锁定期间正确密码也不放行");
  const gen = page.waitForResponse(`**/api/v1/projects/${pid}/ai/generate/cases`);
  await page.getByTestId("ai-case-generate").click();
  const genRes = await gen;
  expect(genRes.status()).toBe(200);
  const payload = genRes.request().postDataJSON() as { requirement: string };
  expect(payload.requirement).toContain("锁定");
  const genData = (await genRes.json()) as {
    data: { drafts: { name: string; level: string; steps: unknown[] }[] };
  };
  expect(genData.data.drafts.length).toBe(2);
  expect(genData.data.drafts[0]!.name).toBe("密码错误 5 次后锁定账户");

  // UI 断言：草稿卡片 2 张（mock 确定性）
  await expect(page.getByTestId("ai-case-draft-0")).toBeVisible();
  await expect(page.getByTestId("ai-case-draft-0")).toContainText("密码错误 5 次后锁定账户");
  await expect(page.getByTestId("ai-case-draft-1")).toBeVisible();

  // 取消第 2 条勾选 → 导入 1 条（走用例创建端点）
  await page.getByTestId("ai-case-draft-1").locator("input[type=checkbox]").click();
  const imported = page.waitForResponse(`**/api/v1/projects/${pid}/cases`);
  await page.getByTestId("ai-case-import").click();
  const impRes = await imported;
  expect(impRes.status()).toBe(201);
  const impPayload = impRes.request().postDataJSON() as {
    name: string;
    level: string;
    steps: { desc: string }[];
  };
  expect(impPayload.name).toBe("密码错误 5 次后锁定账户");
  expect(impPayload.level).toBe("P1"); // AI high → 用例域 P1 映射
  expect(impPayload.steps.length).toBeGreaterThanOrEqual(2);

  // UI 断言：抽屉关闭 + 列表新增（列表刷新后含新用例）
  await expect(page.getByText("成功导入 1 条")).toBeVisible();
  await expect(page.getByRole("cell", { name: "密码错误 5 次后锁定账户" })).toBeVisible({
    timeout: 15_000,
  });

  // 接口断言：生成留痕
  const records = await request.get(`/api/v1/projects/${pid}/ai/gen-records`);
  const recordsData = (await records.json()) as {
    data: { list: { scene: string; generatedCount: number }[] };
  };
  expect(recordsData.data.list[0]!.scene).toBe("case_gen");
  expect(recordsData.data.list[0]!.generatedCount).toBe(2);

  await expectNoConsoleErrors();
});
