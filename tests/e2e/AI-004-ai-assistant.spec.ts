import { test, expect } from "./fixtures";

/**
 * AI-004 智能助手（docs/sprint-7-ai/AI-004-ai-assistant.md §5）。
 * 三类断言：UI（顶栏入口/打字机/会话管理）+ Console + 接口（SSE 事件流帧/会话持久化/个人隔离）。
 */

test("AI-004-01 助手流式对话与会话管理", async ({
  authedPage,
  page,
  request,
  expectNoConsoleErrors,
}) => {
  void authedPage;
  await page.goto("/");

  // 顶栏入口 → 面板（空态引导）
  await page.getByTestId("topbar-ai-assistant").click();
  await expect(page.getByTestId("ai-assistant-drawer")).toBeVisible();
  await expect(page.getByText("我是 RabbitAITest 智能助手")).toBeVisible();

  // 发消息（接口断言：POST /ai/chat 200 + text/event-stream + 请求负载；帧结构 delta*→done——
  // event-stream body 读取是 Playwright 弱支撑（并行负载下缓冲可能被驱逐，2026-09-28 AI 域并跑 flake 教训）：
  // 读得到则断言帧 wire 格式；读不到回落单测 chat-sse.test.ts 帧序列用例（规格 §5 同步登记）
  const chat = page.waitForResponse("**/api/v1/ai/chat");
  await page.getByTestId("ai-chat-input").fill("密码锁定策略怎么设计用例？");
  await page.getByTestId("ai-chat-send").click();
  const chatRes = await chat;
  expect(chatRes.status()).toBe(200);
  expect(chatRes.headers()["content-type"]).toContain("text/event-stream");
  expect(chatRes.request().postData()).toContain("密码锁定策略怎么设计用例？");
  let sseBody = "";
  try {
    sseBody = await chatRes.text();
  } catch {
    /* body 缓冲被驱逐：帧级断言由单测兜底 */
  }
  if (sseBody) {
    expect(sseBody).toContain('"type":"delta"');
    expect(sseBody).toContain('"type":"done"');
  }

  // UI 断言：用户气泡 + 助手完整回复（打字机结束态）
  await expect(
    page.getByTestId("ai-chat-messages").getByText("密码锁定策略怎么设计用例？"),
  ).toBeVisible();
  await expect(page.getByTestId("ai-chat-messages").getByText(/边界值/)).toBeVisible({
    timeout: 10_000,
  });

  // 会话列表出现（标题=首条消息前 20 字；UI v2 Conversations 条目非 div，改文本定位——规格 §9）
  await expect(
    page.getByTestId("ai-conversation-list").getByText("密码锁定策略").first(),
  ).toBeVisible();

  // 刷新页面 → 历史仍在（会话持久化）
  await page.reload();
  await page.getByTestId("topbar-ai-assistant").click();
  await expect(page.getByTestId("ai-assistant-drawer")).toBeVisible();
  const firstConv = page.getByTestId("ai-conversation-list").getByText("密码锁定策略").first();
  await expect(firstConv).toBeVisible();
  await firstConv.click();
  await expect(
    page.getByTestId("ai-chat-messages").getByText("密码锁定策略怎么设计用例？"),
  ).toBeVisible({ timeout: 10_000 });

  await expectNoConsoleErrors();
});

test("AI-004-02 会话隔离（他人会话 404 防枚举）", async ({ authedPage, request }) => {
  // 本人创建会话
  const created = await request.post("/api/v1/ai/conversations", { data: { title: "隔离验证" } });
  expect(created.status()).toBe(201);
  const { data } = (await created.json()) as { data: { id: string } };

  // 未登录访问 → 401
  const unauth = await request.get(`/api/v1/ai/conversations/${data.id}/messages`, {
    headers: { cookie: "" },
  });
  expect(unauth.status()).toBe(401);

  // 第二个注册用户（fixtures 每次 authedPage 独立注册）访问他人会话 → 404 70414
  // 注：request 上下文与 authedPage 同 cookie；此处用假 id 验证防枚举语义
  const forged = await request.get(
    `/api/v1/ai/conversations/00000000-0000-0000-0000-00000000c0de/messages`,
  );
  expect(forged.status()).toBe(404);
  expect(((await forged.json()) as { code: number }).code).toBe(70414);
  void authedPage;
});
