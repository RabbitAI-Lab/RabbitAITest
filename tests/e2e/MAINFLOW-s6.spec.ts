import { test, expect } from "./fixtures";
import { loginSeedAdmin, uploadPlugin, enablePlugin, PLATFORM_MOCK_BASE } from "./s6-helpers";

/**
 * MAINFLOW-s6：S6 主链路（插件上传启用 → 集成配置 → 缺陷推送拉取 → APIKEY CI → 审计留痕）。
 * 规格依据：sprint-overview §1 端到端演示路径。
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
  // 1. 管理员上传并启用 jira 插件
  await loginSeedAdmin(request, context);
  const pluginId = await uploadPlugin(request, "jira-platform-1.0.0.tgz");
  await enablePlugin(request, pluginId);

  // UI：插件管理页可见运行中
  await page.goto("/system/plugins");
  const jiraRow = page.getByRole("row").filter({ hasText: "jira-platform" });
  await expect(jiraRow).toBeVisible({ timeout: 15000 });
  if (await jiraRow.getByText("已停用").isVisible().catch(() => false)) {
    await jiraRow.getByTestId("plugin-toggle-jira-platform").click();
  }
  await expect(jiraRow.getByText("运行中", { exact: false }).first()).toBeVisible({ timeout: 20000 });

  // 2. 项目 owner 配置组织集成 + 项目关联
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
    data: { platform: "jira", projectKey: "RABBIT", bugTypes: [], statusMapping: [], mode: "INCREMENT", enabled: true },
  });
  expect(cfg.status()).toBe(200);

  // UI：服务集成页三卡片含 Jira
  await page.goto("/settings/integrations");
  await expect(page.getByTestId("integration-card-jira")).toBeVisible({ timeout: 15000 });

  // 3. 缺陷推送 + 平台 done + 拉取回写
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
  expect(((await pull.json()) as { data: { updated: number } }).data.updated).toBeGreaterThanOrEqual(1);

  // 4. APIKEY → open 触发（认证通道验证）→ 吊销
  const key = await request.post("/api/v1/personal/api-keys", { data: { name: "MAINFLOW" } });
  const kb = (await key.json()) as { data: { accessKey: string; secretKey: string; id: string } };
  const openCtx = await playwright.request.newContext({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100" });
  const auth = `Basic ${Buffer.from(`${kb.data.accessKey}:${kb.data.secretKey}`).toString("base64")}`;
  const probe = await openCtx.get("/api/v1/open/exec/00000000-0000-4000-8000-000000000000", {
    headers: { authorization: auth },
  });
  expect(probe.status()).toBe(404); // 认证通过（非 401）
  await request.put(`/api/v1/personal/api-keys/${kb.data.id}/revoke`, { data: {} });
  await openCtx.dispose();

  // 5. 审计留痕：open.exec 动作可查（管理员）
  await page.waitForTimeout(2500);
  const audit = await request.get("/api/v1/system/audit-logs?action=open");
  const ab = (await audit.json()) as { data: { list: Array<{ action: string }> } };
  expect(ab.data.list.some((l) => l.action === "open.exec")).toBe(true);

  await expectNoConsoleErrors();
});
