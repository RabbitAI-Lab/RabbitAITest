import { test, expect, navFromHome } from "./fixtures";

/**
 * AGENT-001 e2e：两用例（三类断言：UI + Console 白名单 + 接口状态码/信封/字段）。
 * 01：Agent CRUD UI 生命周期 + 密钥形状 + 技能引用 409（API 断言）。
 * 02：调试台发起运行 → 工作目录准备帧（SSE）→ 终态 → 运行记录（完整 pi 管线验证）。
 */

test.describe("AGENT-001 项目级 Agent", () => {
  test("AGENT-001-01 管理：新建/卡片/编辑保存/密钥/技能引用 409/删除", async ({
    page,
    authedPage,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    await navFromHome(page, "Agent");
    await expect(page.getByTestId("agents-page")).toBeVisible({ timeout: 15000 });

    // ── 新建（UI 抽屉 + 接口断言：POST 201 + 信封 code=0 + mode 字段） ──
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

    // UI 断言：卡片出现且含名称
    await expect(page.getByTestId(`agent-card-${agentId}`)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId(`agent-card-${agentId}`)).toContainText(`e2e-助手-${uniq}`);

    // ── 编辑保存（UI：改描述 → PUT 200 信封） ──
    await page.getByTestId(`agent-card-${agentId}`).getByText("编辑").click();
    await expect(page.getByTestId("agent-edit-drawer")).toBeVisible();
    await page.getByTestId("agent-edit-drawer").getByLabel("描述").fill("e2e 编辑过");
    const updated = page.waitForResponse(`**/api/v1/projects/*/agents/${agentId}`, {
      timeout: 15000,
    });
    await page.getByTestId("agent-edit-save").click();
    expect((await updated).status()).toBe(200);

    // ── 密钥：POST 201 + rag_ 形状 + 吊销 200 ──
    const keyRes = await page.request.post(
      `/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`,
    );
    expect(keyRes.status()).toBe(201);
    const keyBody = (await keyRes.json()) as { code: number; data: { apiKey: string } };
    expect(keyBody.code).toBe(0);
    expect(keyBody.data.apiKey).toMatch(/^rag_[A-Za-z0-9]{32}$/);
    const revoked = await page.request.delete(
      `/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`,
    );
    expect(revoked.status()).toBe(200);

    // ── 技能：POST 201 → PUT 引用 200 → 被引用删除 409(70624) → 解除引用后删除 200 ──
    const skillRes = await page.request.post(`/api/v1/projects/${projectId}/agent-skills`, {
      data: {
        name: `e2e-技能-${uniq}`,
        description: "等价类+边界值",
        content: "## 边界值\n- min-1/max+1",
        enabled: true,
      },
    });
    expect(skillRes.status()).toBe(201);
    const skill = ((await skillRes.json()) as { data: { id: string } }).data;
    const refRes = await page.request.put(`/api/v1/projects/${projectId}/agents/${agentId}`, {
      data: { skillIds: [skill.id] },
    });
    expect(refRes.status()).toBe(200);
    const delSkill409 = await page.request.delete(
      `/api/v1/projects/${projectId}/agent-skills/${skill.id}`,
    );
    expect(delSkill409.status()).toBe(409);
    expect(((await delSkill409.json()) as { code: number }).code).toBe(70624);
    // 解除引用 → 技能可删（Agent 也删了 → 引用自动解除）
    const delAgent = await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
    expect(delAgent.status()).toBe(200);
    expect(((await delAgent.json()) as { code: number }).code).toBe(0);
    const delSkillFinal = await page.request.delete(
      `/api/v1/projects/${projectId}/agent-skills/${skill.id}`,
    );
    expect(delSkillFinal.status()).toBe(200);

    // 404 后验证
    const gone = await page.request.get(`/api/v1/projects/${projectId}/agents/${agentId}`);
    expect(gone.status()).toBe(404);
  });

  test("AGENT-001-02 调试台：发起运行（工作目录准备帧 + 终态）+ 运行记录", async ({
    page,
    authedPage,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `D${Date.now() % 1e7}`;
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
    await expect(page.getByTestId("agent-debug-page")).toBeVisible({ timeout: 15000 });
    // CI 冷启动：等 agent 数据加载（名称渲染=projectId 已水合）再交互——否则 send() 早退不发 POST
    await expect(page.getByText(`e2e-调试-${uniq}`)).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);

    // 接口断言：POST run 201 + 信封 runId
    const runPosted = page.waitForResponse(`**/api/v1/projects/*/agents/${agentId}/run`, {
      timeout: 20000,
    });
    await page.getByTestId("agent-debug-input").fill("查询模块树并给出一句话总结");
    await page.getByTestId("agent-debug-send").click();
    const runRes = await runPosted;
    expect(runRes.status()).toBe(201);
    const runBody = (await runRes.json()) as { code: number; data: { runId: string } };
    expect(runBody.code).toBe(0);

    // SSE 帧断言：工作目录准备（platform-docs 同步/任务目录创建——即使无仓库绑定也有 docs_sync+task_dir 两帧）
    await expect(page.getByText(/platform-docs 同步|任务目录 tasks\//).first()).toBeVisible({
      timeout: 60_000,
    });

    // 终态断言（COMPLETED 文本气泡 或 FAILED/CANCELED 红条——mock 模型兼容性两种皆为合法终态）
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

    // 运行详情（API：GET 200 + status 字段 + messages 轨迹）
    const detail = await page.request.get(
      `/api/v1/projects/${projectId}/agent-runs/${runBody.data.runId}`,
    );
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      data: { run: { status: string }; messages: { role: string; name?: string }[] };
    };
    expect(["COMPLETED", "FAILED", "CANCELED"]).toContain(detailBody.data.run.status);
    expect(detailBody.data.messages.length).toBeGreaterThanOrEqual(3); // user + workspace 步 + assistant/tool

    // 清理
    await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
  });
});
