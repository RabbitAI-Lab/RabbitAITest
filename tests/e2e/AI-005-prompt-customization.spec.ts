import { test, expect, navFromHome, navClick } from "./fixtures";

/**
 * AI-005 提示词自定义（docs/sprint-7-ai/AI-005-prompt-customization.md §5）。
 * 三类断言：UI（scene Tab/表格/编辑抽屉/默认星标）+ Console + 接口（占位符校验/默认唯一/停用不可默认）。
 */

test("AI-005-01 模板 CRUD 与默认语义（含生成抽屉联动）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  const uniq = `P${Date.now() % 1e7}`;
  const t1 = `边界值侧重-${uniq}`;
  const t2 = `场景法-${uniq}`;

  // 用户路径：首页 → 项目设置 › AI 提示词（PROJ-002 同款 testid 直点）
  await page.goto("/");
  await navClick(page, "nav-settings-ai-prompts");
  await expect(page.getByTestId("ai-prompt-table")).toBeVisible();

  // 新建模板一（设默认）
  await page.getByTestId("ai-prompt-create").click();
  await page.getByTestId("ai-prompt-form-name").fill(t1);
  await page
    .getByTestId("ai-prompt-form-template")
    .fill("用 {{design_method}} 覆盖 {{requirement}}，目标模块 {{module}}");
  await page.getByTestId("ai-prompt-form-design").fill("边界值分析");
  const saved1 = page.waitForResponse(`**/api/v1/projects/${pid}/ai/prompt-templates`);
  await page.getByTestId("ai-prompt-save").click();
  const res1 = await saved1;
  expect(res1.status()).toBe(201);
  await expect(page.getByTestId(`ai-prompt-row-${t1}`)).toBeVisible();

  // 新建模板二（设默认 → 默认唯一，星标转移）；定位「设为默认」表单项内的开关（避免 nth 序号漂移）
  await page.getByTestId("ai-prompt-create").click();
  await page.getByTestId("ai-prompt-form-name").fill(t2);
  await page.getByTestId("ai-prompt-form-template").fill("按场景法梳理 {{requirement}}");
  await page.getByTestId("ai-prompt-form-design").fill("场景法");
  await page.getByRole("switch", { name: "设为该场景默认（同场景唯一）" }).click();
  const saved2 = page.waitForResponse(`**/api/v1/projects/${pid}/ai/prompt-templates`);
  await page.getByTestId("ai-prompt-save").click();
  await saved2;
  // 接口断言：默认唯一（列表中 t1 不再 isDefault）
  const list = await request.get(`/api/v1/projects/${pid}/ai/prompt-templates`);
  const listData = (await list.json()) as {
    data: { list: { name: string; isDefault: boolean }[] };
  };
  expect(listData.data.list.find((x) => x.name === t2)?.isDefault).toBe(true);
  expect(listData.data.list.find((x) => x.name === t1)?.isDefault).toBe(false);

  // 未知占位符 422 70505（接口断言 + UI 错误提示）
  await page.getByTestId("ai-prompt-create").click();
  await page.getByTestId("ai-prompt-form-name").fill(`bad-${uniq}`);
  await page.getByTestId("ai-prompt-form-template").fill("{{requirment}} 拼写错误");
  const bad = page.waitForResponse(`**/api/v1/projects/${pid}/ai/prompt-templates`);
  await page.getByTestId("ai-prompt-save").click();
  const badRes = await bad;
  expect(badRes.status()).toBe(422);
  expect(((await badRes.json()) as { code: number }).code).toBe(70505);
  await page.keyboard.press("Escape");

  // 生成抽屉联动：默认模板预选（AI-002 抽屉下拉首项含 ★ 新默认）
  await navFromHome(page, "测试用例");
  await page.getByTestId("btn-ai-generate").click();
  await expect(page.getByTestId("ai-case-generate-drawer")).toBeVisible();
  await expect(page.getByTestId("ai-case-template")).toContainText(t2);

  // 白名单：T5 未知占位符 422 为预期业务拒绝（表单提交路径 fetch 失败留痕，显式登记）
  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/settings/ai-prompts",
      textPattern: "(\\[http 422\\]|status of 422)",
      reason: "AI-005-01 占位符校验 422 的预期拒绝（70505）",
    },
  ]);
});

test("AI-005-02 模板二态（停用不出现在生成抽屉）", async ({ authedPage, page, request }) => {
  const pid = authedPage.projectId;
  const uniq = `S${Date.now() % 1e7}`;
  const name = `停用验证-${uniq}`;

  // 建模板（启用）→ 停用（接口）
  const created = await request.post(`/api/v1/projects/${pid}/ai/prompt-templates`, {
    data: {
      name,
      scene: "case_gen",
      template: "覆盖 {{requirement}}",
      isDefault: false,
      enabled: true,
    },
  });
  const { data } = (await created.json()) as { data: { id: string } };
  const disabled = await request.put(`/api/v1/projects/${pid}/ai/prompt-templates/${data.id}`, {
    data: {
      name,
      scene: "case_gen",
      template: "覆盖 {{requirement}}",
      isDefault: false,
      enabled: false,
    },
  });
  expect(disabled.status()).toBe(200);

  // 生成抽屉模板下拉不含停用模板（UI 断言）
  await navFromHome(page, "测试用例");
  await page.getByTestId("btn-ai-generate").click();
  await expect(page.getByTestId("ai-case-generate-drawer")).toBeVisible();
  await expect(page.getByTestId("ai-case-template")).not.toContainText(name);

  // 停用模板设默认 → 422（schema refine）
  const badDefault = await request.put(`/api/v1/projects/${pid}/ai/prompt-templates/${data.id}`, {
    data: {
      name,
      scene: "case_gen",
      template: "覆盖 {{requirement}}",
      isDefault: true,
      enabled: false,
    },
  });
  expect(badDefault.status()).toBe(422);
});
