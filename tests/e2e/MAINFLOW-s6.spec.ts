import { test, expect } from "./fixtures";
import {
  uploadPlugin,
  enablePlugin,
  newAdminContext,
  loginSeedAdmin,
  PLATFORM_MOCK_BASE,
} from "./s6-helpers";

/**
 * MAINFLOW-s6：S6 主链路（插件上传启用 → 集成配置 → 缺陷推送拉取 → APIKEY CI → 审计留痕）。
 * 规格依据：sprint-overview §1 端到端演示路径。
 * 会话纪律：用户态 API（步骤 2-4）先于 loginSeedAdmin（其覆盖 request/context 为管理员）；
 * 管理员 API 全程走独立 adminCtx；系统页面 UI 在覆盖之后。
 */
const PLATFORM_USER = process.env.E2E_PLATFORM_USER ?? "platform-e2e-user";
const PLATFORM_PASS = process.env.E2E_PLATFORM_PASS ?? "platform-e2e-pass";

test("MAINFLOW-s6 插件→集成→同步→APIKEY→审计 全链路", async ({
  page,
  context,
  request,
  authedPage,
  playwright,
  expectNoConsoleErrors,
}) => {
  // 1. 管理员上传并启用 jira 插件（独立 adminCtx——步骤 5 的审计查询亦用它）
  const admin = await newAdminContext(playwright);
  const pluginId = await uploadPlugin(admin, "jira-platform-1.0.2.tgz");
  await enablePlugin(admin, pluginId);

  // 2. 项目 owner 配置组织集成 + 项目关联（用户态 request）
  const { projectId } = authedPage;
  const info = await request.get(`/api/v1/projects/${projectId}/info`);
  const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
  const integ = await request.put(`/api/v1/orgs/${orgId}/integrations`, {
    data: {
      platform: "jira",
      address: `${PLATFORM_MOCK_BASE}/mock-jira`,
      authType: "BASIC",
      username: PLATFORM_USER,
      password: PLATFORM_PASS,
    },
  });
  expect(integ.status()).toBe(200);
  const cfg = await request.put(`/api/v1/projects/${projectId}/integration`, {
    data: {
      platform: "jira",
      projectKey: "RABBIT",
      bugTypes: [],
      statusMapping: [],
      mode: "INCREMENT",
      enabled: true,
    },
  });
  expect(cfg.status()).toBe(200);

  // UI：服务集成页三卡片含 Jira（仍用户态）
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("integration-card-jira")).toBeVisible({ timeout: 15000 });

  // 3. 缺陷推送 + 平台 done + 拉取回写（用户态）
  const bug = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: `MAINFLOW 缺陷 ${Date.now()}`, description: "s6", tags: [], fields: {} },
  });
  const bugId = ((await bug.json()) as { data: { id: string } }).data.id;
  const sync = await request.post(`/api/v1/projects/${projectId}/bugs/${bugId}/sync`, { data: {} });
  const platformKey = ((await sync.json()) as { data: { platformKey: string } }).data.platformKey;
  expect(platformKey).toContain("RABBIT-");
  await request.post(`${PLATFORM_MOCK_BASE}/mock-jira/_test/set-status`, {
    data: { key: platformKey, status: "done" },
  });
  const pull = await request.post(`/api/v1/projects/${projectId}/integration/pull`, { data: {} });
  expect(
    ((await pull.json()) as { data: { updated: number } }).data.updated,
  ).toBeGreaterThanOrEqual(1);

  // 4. APIKEY → open 触发（认证通道验证）→ 吊销（用户态）
  const key = await request.post("/api/v1/personal/api-keys", { data: { name: "MAINFLOW" } });
  const kb = (await key.json()) as { data: { accessKey: string; secretKey: string; id: string } };
  const openCtx = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
  });
  const auth = `Basic ${Buffer.from(`${kb.data.accessKey}:${kb.data.secretKey}`).toString("base64")}`;
  const probe = await openCtx.get("/api/v1/open/exec/00000000-0000-4000-8000-000000000000", {
    headers: { authorization: auth },
  });
  expect(probe.status()).toBe(404); // 认证通过（非 401）
  await request.put(`/api/v1/personal/api-keys/${kb.data.id}/revoke`, { data: {} });
  await openCtx.dispose();

  // 5. 审计留痕：open.exec 动作可查（管理员 adminCtx）
  await page.waitForTimeout(2500);
  const audit = await admin.get("/api/v1/system/audit-logs?action=open");
  const ab = (await audit.json()) as { data: { list: Array<{ action: string }> } };
  expect(ab.data.list.some((l) => l.action === "open.exec")).toBe(true);

  // UI：插件管理页（此时才覆盖浏览器为管理员；此后无用户态 API）
  await loginSeedAdmin(request, context);
  await page.goto("/system/plugins");
  const jiraRow = page.getByRole("row").filter({ hasText: "jira-platform" });
  await expect(jiraRow).toBeVisible({ timeout: 15000 });
  await expect(jiraRow.getByText("运行中", { exact: false }).first()).toBeVisible({
    timeout: 20000,
  });
  await admin.dispose();

  // 白名单：loginSeedAdmin 切换会话瞬间，旧页面（用户项目上下文）在飞请求以管理员会话
  // 访问用户项目 → 防枚举 401/403/404 属合规行为（非应用缺陷）
  await expectNoConsoleErrors([
    {
      textPattern: "http (401|403|404)",
      pageUrlPattern: "personal/permissions|projects/[a-f0-9-]{36}/info|system/plugins",
    },
    { textPattern: "404", pageUrlPattern: "system/plugins" },
  ]);
});
