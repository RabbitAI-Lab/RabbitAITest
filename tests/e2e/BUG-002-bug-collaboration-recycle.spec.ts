import { test, expect } from "./fixtures";
import { readUnreadTitles } from "./s5-helpers";

const MEMBER_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";
// 白名单：project store（zustand persist）水合前的 /projects/null 查询 404——首帧竞态（S1 以来既有面，S5 §7.2 登记）
const hydrateRace = { pageUrlPattern: "/bugs", textPattern: "projects/null|Failed to load resource", reason: "store 水合前 projectId=null 的首帧查询" };

/** BUG-002 缺陷协作与回收站 e2e（回收站 Tab/批量操作 + @提及通知；三类断言）。 */
test.describe("BUG-002 缺陷协作与回收站", () => {
  test("T2 主链路：删除→回收站 Tab→批量恢复→彻底删除（UI+Console+接口）", async ({ page, authedPage, request, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    const mk = async (title: string) => {
      const r = await page.request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title } });
      expect(r.status()).toBe(201);
      return ((await r.json()) as { data: { id: string } }).data.id;
    };
    const a = await mk("e2e-回收站A");
    const b = await mk("e2e-回收站B");
    expect((await page.request.delete(`/api/v1/projects/${projectId}/bugs/${a}`)).status()).toBe(200);
    expect((await page.request.delete(`/api/v1/projects/${projectId}/bugs/${b}`)).status()).toBe(200);

    // UI：回收站 Tab 可见两条 → 勾选 → 批量彻底删除（红色二次确认）
    // 白名单：project store（zustand persist）水合前的 /projects/null 查询 404——首帧竞态（S1 以来既有面，S5 §7.2 登记）
    const hydrateRace = { pageUrlPattern: "/bugs", textPattern: "projects/null|Failed to load resource", reason: "store 水合前 projectId=null 的首帧查询（S1 既有面）" };
    await page.goto("/bugs");
    await page.getByTestId("tab-recycle").click();
    await expect(page.getByText("e2e-回收站A").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("e2e-回收站B").first()).toBeVisible();
    await page.getByRole("row", { name: /e2e-回收站A/ }).getByRole("checkbox").check();
    await page.getByRole("row", { name: /e2e-回收站B/ }).getByRole("checkbox").check();
    await page.getByTestId("btn-batch-purge-bugs").click();
    await page.locator(".ant-popover .ant-btn-dangerous, .ant-tooltip .ant-btn-dangerous").last().click();
    await expect(page.getByText(/已彻底删除 2 条缺陷/)).toBeVisible({ timeout: 10_000 });
    // 接口断言：回收站清空、正常列表亦无
    const recycled = await page.request.get(`/api/v1/projects/${projectId}/bugs?recycled=true`);
    expect(((await recycled.json()) as { data: { total: number } }).data.total).toBe(0);
    const normal = await page.request.get(`/api/v1/projects/${projectId}/bugs?keyword=e2e-回收站`);
    expect(((await normal.json()) as { data: { total: number } }).data.total).toBe(0);

    // 恢复路径（API 断言）：建 C → 软删 → batch-restore → 正常列表回归
    const c = await mk("e2e-回收站C");
    await page.request.delete(`/api/v1/projects/${projectId}/bugs/${c}`);
    const restore = await page.request.post(`/api/v1/projects/${projectId}/bugs/batch-restore`, { data: { ids: [c] } });
    expect(restore.status()).toBe(200);
    expect(((await restore.json()) as { data: { affected: number } }).data.affected).toBe(1);
    const back = await page.request.get(`/api/v1/projects/${projectId}/bugs?keyword=e2e-回收站C`);
    expect(((await back.json()) as { data: { total: number } }).data.total).toBe(1);
    // 批量恢复的校验面：恢复不在回收站的 id → 422
    const bad = await page.request.post(`/api/v1/projects/${projectId}/bugs/batch-restore`, { data: { ids: [c] } });
    expect(bad.status()).toBe(422);
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("T3 协作：评论 @提及 → 被提及人站内信；提及非成员 422", async ({ page, browser, authedPage, request, expectNoConsoleErrors }) => {
    const { projectId } = authedPage;
    const bug = ((await (
      await page.request.post(`/api/v1/projects/${projectId}/bugs`, { data: { title: "e2e-提及缺陷" } })
    ).json()) as { data: { id: string } }).data.id;

    // 开 BUG_COMMENT 事件（提及人必收的前提：总闸开 + inapp 机器人）
    const inappRobot = ((await (
      await page.request.post(`/api/v1/projects/${projectId}/robots`, {
        data: { name: "e2e-提及站内信", channel: "inapp", enabled: true },
      })
    ).json()) as { data: { id: string } }).data;
    await page.request.put(`/api/v1/projects/${projectId}/message-config`, {
      data: { BUG_COMMENT: { enabled: true, robotIds: [inappRobot.id], receiverUserIds: [] } },
    });

    // 造成员 B（被提及人）：先取 org（admin）→注册（jar 切换）→login 回 admin→加入
    const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
    const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
    const memberEmail = `e2e-mention-${Date.now()}@rabbit.test`;
    const reg = await page.request.post("/api/v1/auth/register", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    const member = ((await reg.json()) as { data: { userId: string } }).data;
    await page.request.post("/api/v1/auth/login", { data: { email: authedPage.email, password: MEMBER_PASSWORD } });
    await page.request.post(`/api/v1/orgs/${orgId}/members-add`, { data: { userIds: [member.userId] } });
    await page.request.post(`/api/v1/projects/${projectId}/members`, { data: { userIds: [member.userId] } });

    // UI：详情页评论 Tab → 提交评论（渲染断言）；@提及经 API 提交（提及通知链路接口断言）
    await page.goto(`/bugs/${bug}`);
    await page.getByTestId("tab-comments").click();
    await expect(page.getByTestId("comment-composer")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("comment-input").fill("UI 提交的普通评论");
    await page.getByTestId("comment-submit").click();
    await expect(page.getByTestId("comment-content").first()).toContainText("UI 提交的普通评论");
    const mentioned = await page.request.post(`/api/v1/projects/${projectId}/comments?entity=bug:${bug}`, {
      data: { content: `@${memberEmail} 麻烦看下这个问题`, mentions: [member.userId] },
    });
    expect(mentioned.status()).toBe(201);

    // 接口断言：被提及人收到站内信（S8 改造：独立浏览器上下文承载 member 会话——
    // cookie 由 jar 自动管理，无响应 cookie 流入网络调用的显式污点链，Mimosa high 根因消除）
    const memberCtx = await browser.newContext();
    const memberLogin = await memberCtx.request.post("/api/v1/auth/login", { data: { email: memberEmail, password: MEMBER_PASSWORD } });
    expect(memberLogin.status()).toBe(200);
    const titles = await readUnreadTitles(memberCtx.request);
    await memberCtx.close();
    expect(titles.some((t) => t.includes("提到了你") && t.includes("e2e-提及缺陷"))).toBeTruthy();
    // 提及非成员 → 422
    const bad = await page.request.post(`/api/v1/projects/${projectId}/comments?entity=bug:${bug}`, {
      data: { content: "hi", mentions: ["00000000-0000-0000-0000-0000000000ee"] },
    });
    expect(bad.status()).toBe(422);
    await expectNoConsoleErrors([hydrateRace]);
  });
});
