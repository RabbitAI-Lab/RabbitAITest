import { test, expect } from "./fixtures";

/**
 * AGENT-001 PR-2 A2A 面 e2e：密钥生成 → Agent Card → JSON-RPC 调用 → 错误场景。
 * 三类断言：接口（状态码/JSON-RPC error code/信封）+ Console（无 error）+ 数据（Card 字段/密钥形状）。
 */

test.describe("AGENT-001 A2A 协议面", () => {
  test("AGENT-001-A2A-01 密钥+Card+JSON-RPC 全链路", async ({
    page,
    authedPage,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `K${Date.now() % 1e7}`;

    // 创建 Agent + 开启 A2A
    const created = await page.request.post(`/api/v1/projects/${projectId}/agents`, {
      data: { name: `e2e-a2a-${uniq}`, systemPrompt: "测试", mode: "chat", role: "CUSTOM" },
    });
    expect(created.status()).toBe(201);
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;

    const keyRes = await page.request.post(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`);
    expect(keyRes.status()).toBe(201);
    const key = ((await keyRes.json()) as { data: { apiKey: string } }).data.apiKey;
    expect(key).toMatch(/^rag_[A-Za-z0-9]{32}$/);

    // Agent Card（无需鉴权；v1.0 字段断言）
    const cardRes = await page.request.get(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}/agent-card.json`,
    );
    expect(cardRes.status()).toBe(200);
    const card = (await cardRes.json()) as {
      name: string;
      version: string;
      capabilities: { streaming: boolean; pushNotifications: boolean };
      supportedInterfaces: { protocolBinding: string; protocolVersion: string }[];
      securitySchemes: Record<string, { type: string }>;
    };
    expect(card.name).toBe(`e2e-a2a-${uniq}`);
    expect(card.version).toBe("1.0.0");
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.supportedInterfaces[0]!.protocolBinding).toBe("JSONRPC");
    expect(card.supportedInterfaces[0]!.protocolVersion).toBe("1.0");
    expect(card.securitySchemes.bearer.type).toBe("http");

    // JSON-RPC GetTask（有效密钥 → 200 + JSON-RPC 信封；未知任务 → -32001）
    const rpcRes = await page.request.post(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}`,
      {
        headers: { authorization: `Bearer ${key}` },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "GetTask",
          params: { taskId: "00000000-0000-4000-8000-000000000000" },
        },
      },
    );
    expect(rpcRes.status()).toBe(200);
    const rpcBody = (await rpcRes.json()) as { jsonrpc: string; error?: { code: number } };
    expect(rpcBody.jsonrpc).toBe("2.0");
    expect(rpcBody.error?.code).toBe(-32001);

    // JSON-RPC 未知方法 → -32601
    const unknownRes = await page.request.post(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}`,
      {
        headers: { authorization: `Bearer ${key}` },
        data: { jsonrpc: "2.0", id: 2, method: "Bogus.Method", params: {} },
      },
    );
    expect(unknownRes.status()).toBe(200);
    const unknownBody = (await unknownRes.json()) as { error?: { code: number } };
    expect(unknownBody.error?.code).toBe(-32601);

    // 401 无效密钥
    const badKeyRes = await page.request.post(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}`,
      {
        headers: { authorization: "Bearer rag_InvalidKey123456789012345678" },
        data: { jsonrpc: "2.0", id: 3, method: "GetTask", params: {} },
      },
    );
    expect(badKeyRes.status()).toBe(401);

    // 404 未开启 A2A 的 Agent Card
    const noCardRes = await page.request.get(
      `/api/v1/a2a/projects/${projectId}/agents/00000000-0000-4000-8000-000000000000/agent-card.json`,
    );
    expect(noCardRes.status()).toBe(404);

    // 清理：吊销密钥 + 删除 Agent
    await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`);
    const del = await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
    expect(del.status()).toBe(200);
  });

  test("AGENT-001-A2A-02 ListTasks + CancelTask（密钥鉴权全通）", async ({
    page,
    authedPage,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const uniq = `L${Date.now() % 1e7}`;

    const created = await page.request.post(`/api/v1/projects/${projectId}/agents`, {
      data: { name: `e2e-a2a-ls-${uniq}`, systemPrompt: "x", mode: "chat", role: "CUSTOM" },
    });
    const agentId = ((await created.json()) as { data: { id: string } }).data.id;
    const key = ((await (await page.request.post(`/api/v1/projects/${projectId}/agents/${agentId}/a2a-key`)).json()) as { data: { apiKey: string } }).data.apiKey;

    // ListTasks（空列表 → 200 + tasks 数组）
    const listRes = await page.request.post(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}`,
      {
        headers: { authorization: `Bearer ${key}` },
        data: { jsonrpc: "2.0", id: 1, method: "ListTasks", params: {} },
      },
    );
    expect(listRes.status()).toBe(200);
    const listBody = (await listRes.json()) as { result?: { tasks?: unknown[] } };
    expect(Array.isArray(listBody.result?.tasks)).toBe(true);

    // CancelTask（未知任务 → -32001）
    const cancelRes = await page.request.post(
      `/api/v1/a2a/projects/${projectId}/agents/${agentId}`,
      {
        headers: { authorization: `Bearer ${key}` },
        data: { jsonrpc: "2.0", id: 2, method: "CancelTask", params: { taskId: "00000000-0000-4000-8000-000000000000" } },
      },
    );
    expect(cancelRes.status()).toBe(200);
    const cancelBody = (await cancelRes.json()) as { error?: { code: number } };
    expect(cancelBody.error?.code).toBe(-32001);

    await page.request.delete(`/api/v1/projects/${projectId}/agents/${agentId}`);
  });
});
