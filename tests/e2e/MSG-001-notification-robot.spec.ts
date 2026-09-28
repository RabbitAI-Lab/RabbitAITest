import { test, expect } from "./fixtures";
import { robotWebhookUrl, robotCalls, clearRobotCalls, fetchUnreadTitles } from "./s5-helpers";

const MEMBER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

/**
 * MSG-001 通知机器人 e2e（三类断言：UI + Console 无错 + 接口/mock 收包）。
 * 链路：建钉钉机器人(指向栈 mock)→测试发送→事件配置→建缺陷触发→站内信+webhook。
 * webhook 指向 e2e 栈 mock 为被测行为（栈注入 OUTBOUND_ALLOW_PRIVATE=1，e2e 口径；
 * 生产面出站守卫由单测/422 用例覆盖——规格 §1.2）。
 */
test.describe("MSG-001 通知机器人", () => {
  test("T2 主链路：机器人 CRUD + 测试发送（mock 收包）+ 铃铛通知", async ({ page, authedPage, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    // ① 接口断言：创建机器人（webhook→mock）
    const created = await page.request.post(`/api/v1/projects/${projectId}/robots`, {
      data: { name: "e2e-钉钉机器人", channel: "dingtalk", webhook: robotWebhookUrl("dingtalk"), enabled: true },
    });
    expect(created.status()).toBe(201);
    const robot = ((await created.json()) as { code: number; data: { id: string } }).data;
    expect(robot.id).toBeTruthy();

    // ② UI：消息管理页可见机器人 + 测试发送
    await page.goto("/settings/messages");
    await expect(page.getByTestId("page-settings-messages")).toBeVisible();
    await expect(page.getByText("e2e-钉钉机器人")).toBeVisible();
    await page.getByTestId("robot-test-e2e-钉钉机器人").click();
    await expect(page.getByText(/测试消息已送达/)).toBeVisible({ timeout: 10_000 });
    // ③ mock 收包断言（钉钉平台收到 webhook）
    const calls = await robotCalls();
    expect(calls.some((c) => c.text.includes("测试消息"))).toBeTruthy();

    // ④ 站内信：建站内信机器人并测试发送（落 ROBOT_TEST 通知给自己）
    const inapp = await page.request.post(`/api/v1/projects/${projectId}/robots`, {
      data: { name: "e2e-站内信", channel: "inapp", enabled: true },
    });
    expect(inapp.status()).toBe(201);
    const inappId = ((await inapp.json()) as { data: { id: string } }).data.id;
    const tested = await page.request.post(`/api/v1/projects/${projectId}/robots/${inappId}/test`, { data: {} });
    expect(tested.status()).toBe(200);
    await page.goto("/");
    await page.getByTestId("header-bell").click();
    await expect(page.getByTestId("bell-dropdown")).toBeVisible();
    await expect(page.getByText("机器人测试消息").first()).toBeVisible();
    await expectNoConsoleErrors();
  });

  test("T3 事件链路：BUG_CREATED → 站内信（接收人；操作人去重）+ mock webhook", async ({ page, authedPage, request, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    // 造另一成员（接收人）：先取 org（admin 会话）→注册 member（jar 切换）→login 回 admin→加组织/项目
    const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
    const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
    const memberEmail = `e2e-msg-member-${Date.now()}@rabbit.test`;
    const reg = await page.request.post("/api/v1/auth/register", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    const member = ((await reg.json()) as { data: { userId: string } }).data;
    await page.request.post("/api/v1/auth/login", { data: { email: authedPage.email, password: MEMBER_PASSWORD } });
    expect((await page.request.post(`/api/v1/orgs/${orgId}/members-add`, { data: { userIds: [member.userId] } })).status()).toBe(201);
    expect((await page.request.post(`/api/v1/projects/${projectId}/members`, { data: { userIds: [member.userId] } })).status()).toBe(201);

    // 清 mock 收包场 + 建机器人与事件配置
    await clearRobotCalls();
    const robot = ((await (
      await page.request.post(`/api/v1/projects/${projectId}/robots`, {
        data: { name: "e2e-event-robot", channel: "wecom", webhook: robotWebhookUrl("wecom"), enabled: true },
      })
    ).json()) as { data: { id: string } }).data;
    const inapp = ((await (
      await page.request.post(`/api/v1/projects/${projectId}/robots`, {
        data: { name: "e2e-event-inapp", channel: "inapp", enabled: true },
      })
    ).json()) as { data: { id: string } }).data;
    const cfg = await page.request.put(`/api/v1/projects/${projectId}/message-config`, {
      data: { BUG_CREATED: { enabled: true, robotIds: [robot.id, inapp.id], receiverUserIds: [member.userId] } },
    });
    expect(cfg.status()).toBe(200);

    // UI：事件配置页行可见（画板二走查点；先切「事件配置」Tab）
    await page.goto("/settings/messages");
    await page.getByRole("tab", { name: "事件配置" }).click();
    await expect(page.getByTestId("event-row-BUG_CREATED")).toBeVisible({ timeout: 10_000 });
    await expectNoConsoleErrors();

    // 触发事件：admin 建缺陷
    const bug = await page.request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title: "e2e-通知触发缺陷" } });
    expect(bug.status()).toBe(201);

    // ① member 收到站内信（API 断言）
    const memberLogin = await request.post("/api/v1/auth/login", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    const rasCookie = (memberLogin.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0] ?? "";
    const titles = await fetchUnreadTitles(process.env.E2E_BASE_URL ?? "http://localhost:3100", rasCookie);
    expect(titles.some((t) => t.includes("e2e-通知触发缺陷") && t.includes("新建"))).toBeTruthy();
    // ② 操作人（admin）本人不收（同人去重）
    const own = await page.request.get("/api/v1/personal/notifications?unread=true");
    const ownItems = ((await own.json()) as { data: { items: { title: string }[] } }).data.items;
    expect(ownItems.some((n) => n.title.includes("e2e-通知触发缺陷"))).toBeFalsy();
    // ③ mock webhook 收到（企微渠道广播）
    const calls = await robotCalls();
    expect(calls.some((c) => c.text.includes("e2e-通知触发缺陷"))).toBeTruthy();
  });

  test("T4 二态：总闸关不投递；无权限成员 403", async ({ page, authedPage, request }) => {
    const { projectId } = authedPage;
    await clearRobotCalls();
    const robot = ((await (
      await page.request.post(`/api/v1/projects/${projectId}/robots`, {
        data: { name: "e2e-disabled-robot", channel: "dingtalk", webhook: robotWebhookUrl("dingtalk"), enabled: true },
      })
    ).json()) as { data: { id: string } }).data;
    // 总闸关（事件未启用）→ 建缺陷不投递
    await page.request.put(`/api/v1/projects/${projectId}/message-config`, {
      data: { BUG_UPDATED: { enabled: false, robotIds: [robot.id], receiverUserIds: [] } },
    });
    const upd = await page.request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title: "e2e-停用态缺陷" } });
    expect(upd.status()).toBe(201);
    const calls = await robotCalls();
    expect(calls.length).toBe(0);
    // 无 PROJECT_MESSAGE 点：member 创建机器人 403
    const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
    const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
    const memberEmail = `e2e-msg-403-${Date.now()}@rabbit.test`;
    const reg = await page.request.post("/api/v1/auth/register", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    const memberId = ((await reg.json()) as { data: { userId: string } }).data.userId;
    await page.request.post("/api/v1/auth/login", { data: { email: authedPage.email, password: MEMBER_PASSWORD } });
    await page.request.post(`/api/v1/orgs/${orgId}/members-add`, { data: { userIds: [memberId] } });
    await page.request.post(`/api/v1/projects/${projectId}/members`, { data: { userIds: [memberId] } });
    await page.request.post("/api/v1/auth/login", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    const forbidden = await page.request.post(`/api/v1/projects/${projectId}/robots`, {
      data: { name: "x", channel: "inapp", enabled: true },
    });
    expect(forbidden.status()).toBe(403);
    expect(((await forbidden.json()) as { code: number }).code).toBe(10003);
  });
});
