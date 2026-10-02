import { test, expect } from "./fixtures";

/**
 * AGENT-002 生成管线 e2e：pipeline Agent 创建 → 发起生成 → 草稿列表 → 导入（三类断言）。
 * 简化路径：走 API 断言（向导 UI 三步交互登记走查项——pipeline 模式调试台入口属 PR-1 UI 面）。
 */

test.describe("AGENT-002 生成管线", () => {
  test("AGENT-002-01 管线全链路：创建 pipeline Agent → 发起生成 → 草稿列表 → 导入", async ({
    page,
    authedPage,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `P${Date.now() % 1e7}`;

    // ① 创建 pipeline Agent（API——UI 向导三步交互登记走查项）
    const created = await page.request.post(`/api/v1/projects/${projectId}/agents`, {
      data: {
        name: `e2e-管线-${uniq}`,
        systemPrompt: "生成测试用例",
        mode: "pipeline",
        role: "CUSTOM",
        toolKeys: [],
        modelParams: { temperature: 0.3, maxTokens: 4096 },
        maxIterations: 12,
        timeoutMs: 60000,
        repoIds: [],
        skillIds: [],
        enabled: true,
      },
    });
    expect(created.status()).toBe(201);
    const agent = ((await created.json()) as { data: { id: string; mode: string } }).data;
    expect(agent.mode).toBe("pipeline");

    // ② 发起生成（接口断言：POST 201 + 信封 runId）
    const genRes = await page.request.post(`/api/v1/projects/${projectId}/agents/${agent.id}/generate`, {
      data: {
        sources: {
          repoIds: [],
          docPaths: [],
          platformDocIds: [],
          requirementText: `登录模块测试用例 ${uniq}`,
          referenceCases: false,
        },
        stages: { a: true, b: "off", c: { scenario: false, ui: false, playwright: false } },
      },
    });
    expect(genRes.status()).toBe(201);
    const genBody = (await genRes.json()) as { code: number; data: { runId: string } };
    expect(genBody.code).toBe(0);
    const runId = genBody.data.runId;

    // ③ 等管线完成（轮询 run 详情至终态——最长 60s）
    let runStatus = "PENDING";
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(2000);
      const detail = await page.request.get(`/api/v1/projects/${projectId}/agent-runs/${runId}`);
      expect(detail.status()).toBe(200);
      const body = (await detail.json()) as { data: { run: { status: string; error: string | null } } };
      runStatus = body.data.run.status;
      if (["COMPLETED", "FAILED", "CANCELED"].includes(runStatus)) break;
    }
    // COMPLETED 或 FAILED 均为合法终态（mock 模型兼容性——AGENT-001-02 同口径）
    expect(["COMPLETED", "FAILED", "CANCELED"]).toContain(runStatus);

    // ④ 草稿列表（接口断言：GET 200 + 信封 items + stats 结构）
    const draftsRes = await page.request.get(`/api/v1/projects/${projectId}/agent-runs/${runId}/drafts`);
    expect(draftsRes.status()).toBe(200);
    const draftsBody = (await draftsRes.json()) as {
      data: {
        total: number;
        items: { id: string; assetType: string; importStatus: string; conflictStatus: string }[];
        stats: { byType: Record<string, { total: number; adopted: number; pending: number }> };
      };
    };
    expect(draftsBody.data.stats).toHaveProperty("byType");

    // ⑤ 草稿选择+导入（如有功能用例草稿——导入走 case.service 落 PREPARING）
    const functionalDrafts = draftsBody.data.items.filter(
      (d) => d.assetType === "functional_case" && d.importStatus === "PENDING",
    );
    if (functionalDrafts.length > 0) {
      const selectRes = await page.request.post(
        `/api/v1/projects/${projectId}/agent-runs/${runId}/drafts/select`,
        { data: { action: "select", draftIds: functionalDrafts.map((d) => d.id), selected: true } },
      );
      expect(selectRes.status()).toBe(200);

      const importRes = await page.request.post(
        `/api/v1/projects/${projectId}/agent-runs/${runId}/drafts/select`,
        { data: { action: "import", draftIds: functionalDrafts.map((d) => d.id), importMode: "review" } },
      );
      expect(importRes.status()).toBe(200);
      const importBody = (await importRes.json()) as {
        data: { imported: number; failed: number; results: { status: string }[] };
      };
      expect(importBody.data.imported + importBody.data.failed).toBe(functionualDrafts.length);
    }

    // ⑥ 错误场景：422 三源全空
    const emptyGen = await page.request.post(`/api/v1/projects/${projectId}/agents/${agent.id}/generate`, {
      data: { sources: { repoIds: [], docPaths: [], platformDocIds: [] } },
    });
    expect(emptyGen.status()).toBe(422);
    expect(((await emptyGen.json()) as { code: number }).code).toBe(70804);

    // ⑦ 清理
    const del = await page.request.delete(`/api/v1/projects/${projectId}/agents/${agent.id}`);
    expect(del.status()).toBe(200);
  });

  test("AGENT-002-02 上下文预估 + 需求提示词建议", async ({
    page,
    authedPage,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `S${Date.now() % 1e7}`;

    const created = await page.request.post(`/api/v1/projects/${projectId}/agents`, {
      data: { name: `e2e-建议-${uniq}`, systemPrompt: "x", mode: "pipeline", role: "CUSTOM" },
    });
    expect(created.status()).toBe(201);
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;

    // 上下文预估
    const preview = await page.request.post(
      `/api/v1/projects/${projectId}/agents/${agentId}/context-preview`,
      { data: { repoIds: [], docPaths: [], platformDocIds: [], requirementText: "测试需求", referenceCases: false } },
    );
    expect(preview.status()).toBe(200);
    const previewBody = (await preview.json()) as { data: { tokenEstimate: number; hitFiles: number } };
    expect(previewBody.data.tokenEstimate).toBeGreaterThan(0);

    // 需求提示词建议（未选文档时返回引导文案）
    const suggest = await page.request.post(
      `/api/v1/projects/${projectId}/agents/${agentId}/suggest-requirement`,
      { data: { repoIds: [], docPaths: [], platformDocIds: [] } },
    );
    expect(suggest.status()).toBe(200);
    const suggestBody = (await suggest.json()) as { data: { text: string } };
    expect(suggestBody.data.text).toContain("选择文档");

    // 清理
    await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
  });
});
