import { test, expect, navFromHome } from "./fixtures";
import { bundle, createApiDef } from "./s2-helpers";

/**
 * AI-003 接口用例 AI 生成（docs/sprint-7-ai/AI-003-api-case-generation.md §5）。
 * 三类断言：UI（行操作入口/单条草稿断言表/批量分组）+ Console + 接口（单条生成/批量解析/导入落库）。
 */

test("AI-003-01 单条生成与导入（按接口定义）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  // 前置：建一条接口定义
  const api = await createApiDef(request, pid, {
    name: "AI生成目标接口",
    method: "POST",
    path: `/api/ai-gen-${Date.now() % 1e6}`,
    request: bundle("POST", `/api/ai-gen-${Date.now() % 1e6}`),
  });
  void api;

  await navFromHome(page, "接口定义");
  // 行操作「AI 生成」→ 抽屉单条模式（顶部展示定义摘要）
  await page.getByTestId("btn-ai-gen-api-1").click();
  await expect(page.getByTestId("ai-apicase-drawer")).toBeVisible();

  const gen = page.waitForResponse(`**/api/v1/projects/${pid}/ai/generate/api-cases`);
  await page.getByTestId("ai-apicase-generate").click();
  const genRes = await gen;
  expect(genRes.status()).toBe(200);
  const genData = (await genRes.json()) as {
    data: {
      drafts: { name: string; assertions: { source: string }[]; request: { bodyJson?: string } }[];
    };
  };
  expect(genData.data.drafts.length).toBe(1);
  expect(genData.data.drafts[0]!.assertions.some((a) => a.source === "status")).toBe(true);

  // UI 断言：草稿卡片（断言表——单元格分格渲染，断 "status" 与算子列）
  await expect(page.getByTestId("ai-apicase-draft")).toBeVisible();
  await expect(page.getByTestId("ai-apicase-draft")).toContainText("status");
  await expect(page.getByTestId("ai-apicase-draft")).toContainText("exists");

  // 导入（走接口用例创建端点）
  const imported = page.waitForResponse(`**/api/v1/projects/${pid}/apis/*/cases`);
  await page.getByTestId("ai-apicase-import").click();
  const impRes = await imported;
  expect(impRes.status()).toBe(201);
  await expect(page.getByText("已导入 1 条接口用例")).toBeVisible();

  await expectNoConsoleErrors();
});

test("AI-003-02 批量生成（OpenAPI 文档）", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  const pid = authedPage.projectId;
  // 独立用例独立项目：先建一条定义（批量导入绑定目标——规格 §6 简化）
  await createApiDef(request, pid, {
    name: "批量目标接口",
    method: "GET",
    path: `/api/batch-target-${Date.now() % 1e6}`,
    request: bundle("GET", `/api/batch-target-${Date.now() % 1e6}`),
  });
  const doc = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "AI批量" },
    paths: {
      "/api/b1": { post: { summary: "批量接口一" } },
      "/api/b2": { get: { summary: "批量接口二" } },
    },
  });

  await navFromHome(page, "接口定义");
  await page.getByTestId("btn-ai-gen-api-1").click();
  await expect(page.getByTestId("ai-apicase-drawer")).toBeVisible();
  await page.getByRole("tab", { name: /批量/ }).click();

  await page.getByTestId("ai-apicase-openapi").fill(doc);
  const gen = page.waitForResponse(`**/api/v1/projects/${pid}/ai/generate/api-cases/batch`);
  await page.getByTestId("ai-apicase-batch-generate").click();
  const genRes = await gen;
  expect(genRes.status()).toBe(200);
  const genData = (await genRes.json()) as {
    data: { apis: { path: string }[]; drafts: { draft: { name: string } }[] };
  };
  expect(genData.data.apis.length).toBe(2);
  expect(genData.data.drafts.length).toBe(2);

  // UI 断言：草稿分组列表
  await expect(page.getByTestId("ai-apicase-batch-result")).toBeVisible();
  await expect(page.getByTestId("ai-apicase-batch-draft-0")).toBeVisible();

  // 非法文档 422 70503（接口断言）
  const bad = await request.post(`/api/v1/projects/${pid}/ai/generate/api-cases/batch`, {
    data: { openapiDoc: "not-json" },
  });
  expect(bad.status()).toBe(422);
  expect(((await bad.json()) as { code: number }).code).toBe(70503);

  await expectNoConsoleErrors();
});
