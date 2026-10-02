import { test, expect, navFromHome } from "./fixtures";

/**
 * AGENT-001 项目级 Agent e2e：管理 CRUD / 技能库引用 409 / 调试台发起运行（工作目录准备帧）
 * 三类断言：UI（卡片/抽屉/弹窗/轨迹）+ Console（无 error 白名单）+ 接口（POST/GET/DELETE 状态码与信封）。
 */

test.describe("AGENT-001 项目级 Agent", () => {
  test("AGENT-001-01 管理：新建/编辑/密钥一次显示/技能库引用与 409/删除", async ({
    page,
    authedPage,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    await navFromHome(page, "Agent");
    await expect(page.getByTestId("agents-page")).toBeVisible({ timeout: 15000 });

    // 新建（modelId 留空=系统默认模型——e2e 环境种子 mock 模型）
    await page.getByTestId("agent-create").click();
    await expect(page.getByTestId("agent-edit-drawer")).toBeVisible();
    const uniq = `A${Date.now() % 1e7}`;
    await page.getByTestId("agent-form-name").fill(`e2e-助手-${uniq}`);
    await page.locator("#systemPrompt").fill("你是测试专家，按等价类与边界值设计用例。");
    const created = page.waitForResponse("**/api/v1/projects/*/agents");
    await page.getByTestId("agent-edit-save").click();
    const res = await created;
    expect(res.status()).toBe(201);
    const createdBody = (await res.json()) as { code: number; data: { id: string; mode: string } };
    expect(createdBody.code).toBe(0);
    expect(createdBody.data.mode).toBe("chat");
    const agentId = createdBody.data.id;
    await expect(page.getByTestId(`agent-card-${agentId}`)).toBeVisible();
    await expect(page.getByTestId(`agent-card-${agentId}`)).toContainText(`e2e-助手-${uniq}`);

    // 密钥：开启即生成 → 明文仅一次（接口断言 rag_ 形状）
    const keyWait = expectApi(`**/api/v1/projects/*/agents/${agentId}/a2a-key`, "POST");
    const keyBody = (await (
      await page.request.post(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`)
    ).json()) as { code: number; data: { apiKey: string; prefix: string } };
    const keyApi = await keyWait;
    expect(keyApi.status).toBe(201);
    expect(keyBody.code).toBe(0);
    expect(keyBody.data.apiKey).toMatch(/^rag_[A-Za-z0-9]{32}$/);
    // 吊销（避免密钥长期存续）
    const revoked = await page.request.delete(
      `/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`,
    );
    expect(revoked.status()).toBe(200);

    // 技能库：新建技能 → Agent 引用 → 被引用删除 409
    const skillRes = await page.request.post(`/api/v1/projects/${projectId}/agent-skills`, {
      data: {
        name: `e2e-技能-${uniq}`,
        description: "生成用例时按等价类划分并补边界值",
        content: "## 边界值\n- 数值边界取 min-1/min/max/max+1",
        enabled: true,
      },
    });
    expect(skillRes.status()).toBe(201);
    const skill = ((await skillRes.json()) as { data: { id: string } }).data;
    await page.getByRole("tab", { name: "技 能" }).click();
    await expect(page.getByText(`e2e-技能-${uniq}`).first()).toBeVisible();

    // 编辑 Agent：改描述 → 保存（UI 断言）；技能引用走 API（Select 下拉交互走查项）
    await page.getByRole("tab", { name: "Agent" }).click();
    await page.getByTestId(`agent-card-${agentId}`).getByText("编辑").click();
    await expect(page.getByTestId("agent-edit-drawer")).toBeVisible();
    await page.getByTestId("agent-edit-drawer").getByLabel("描述").fill("e2e 编辑过");
    const updated = page.waitForResponse(`**/api/v1/projects/*/agents/${agentId}`, { timeout: 15000 });
    await page.getByTestId("agent-edit-save").click();
    expect((await updated).status()).toBe(200);

    // 技能引用走 API（PUT skillIds → 被引用删除 409 验证引用生效）
    const refRes = await page.request.put(`/api/v1/projects/${projectId}/agents/${agentId}`, {
      data: { skillIds: [skill.id] },
    });
    expect(refRes.status()).toBe(200);

    // 被引用删除 → 409 AGENT_SKILL_IN_USE（70624）
    const delSkill = await page.request.delete(
      `/api/v1/projects/${projectId}/agent-skills/${skill.id}`,
    );
    expect(delSkill.status()).toBe(409);
    expect(((await delSkill.json()) as { code: number }).code).toBe(70624);

    // 删除 Agent（清理）
    const del = page.waitForResponse(`**/api/v1/projects/*/agents/${agentId}`);
    await page.getByTestId(`agent-card-${agentId}`).getByText("删除").click();
    await page
      .getByRole("button", { name: "OK", exact: true })
      .click()
      .catch(() => {});
    expect((await del).status()).toBe(200);
    await expect(page.getByTestId(`agent-card-${agentId}`)).toHaveCount(0);
  });

  test("AGENT-001-02 调试台：发起运行（工作目录准备帧 + 终态）+ 运行记录", async ({
    page,
    authedPage,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `D${Date.now() % 1e7}`;
    // 建一个 chat Agent（API 直建，走默认 mock 模型）
    const created = await page.request.post(`/api/v1/projects/${projectId}/agents`, {
      data: {
        name: `e2e-调试-${uniq}`,
        systemPrompt: "你是测试专家。",
        toolKeys: ["module.tree"],
        mode: "chat",
        role: "CUSTOM",
      },
    });
    expect(created.status()).toBe(201);
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;

    await page.goto(`/settings/agents/${agentId}/debug`);
    await expect(page.getByTestId("agent-debug-page")).toBeVisible();
    await expect(page.getByTestId("agent-debug-page")).toContainText("调试台");

    // 发起运行（三类断言之接口：201 + 信封 runId；SSE：ws-step/final 帧渲染）
    const runPosted = page.waitForResponse(`**/api/v1/projects/*/agents/${agentId}/run`);
    await page.getByTestId("agent-debug-input").fill("查询模块树并给出一句话总结");
    await page.getByTestId("agent-debug-send").click();
    const runRes = await runPosted;
    expect(runRes.status()).toBe(201);
    const runBody = (await runRes.json()) as { code: number; data: { runId: string } };
    expect(runBody.code).toBe(0);

    // 工作目录准备帧（platform-docs 同步/任务目录——无仓库绑定也至少 docs_sync+task_dir）
    await expect(page.getByText(/platform-docs 同步|任务目录 tasks\//).first()).toBeVisible({
      timeout: 60_000,
    });

    // 终态（COMPLETED 文本气泡 或 FAILED/CANCELED 红条——取决于 mock 模型对 pi 协议的兼容，皆为合法终态）
    await expect
      .poll(
        async () => {
          const ended = await page.getByText("运行结束").count();
          const answered = await page.locator("div.whitespace-pre-wrap").count();
          return ended > 0 || answered > 0;
        },
        { timeout: 120_000 },
      )
      .toBeTruthy();

    // 运行记录 tab 有行（goto 后等 agents 列表加载完成再切 tab——antd Tabs 重渲染卸载竞态）
    await page.goto("/settings/agents");
    await page.getByTestId("agents-page").waitFor({ state: "visible" });
    await page.waitForTimeout(500);
    await page.getByRole("tab", { name: "运行记录" }).click();
    await expect(page.getByText(`e2e-调试-${uniq}`).first()).toBeVisible();

    // 清理
    await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
  });
});
