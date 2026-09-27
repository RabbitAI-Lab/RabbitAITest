import { test, expect } from "./fixtures";
import { uploadPlugin, enablePlugin, newAdminContext, PLATFORM_MOCK_BASE } from "./s6-helpers";
import { navFromHome } from "./fixtures";

/**
 * INTG-001 Jira 对接 e2e（规格 §5：T2 推送端到端 / T3 拉取回写 / T4 断链）。
 * 前置：管理员上传+启用 jira-platform 插件；组织配置集成指向 e2e mock-jira。
 * 凭据经 env 注入（E2E_PLATFORM_USER/PASS——mock 校验非空制）。
 */
const PLATFORM_USER = process.env.E2E_PLATFORM_USER ?? "platform-e2e-user";
const PLATFORM_PASS = process.env.E2E_PLATFORM_PASS ?? "platform-e2e-pass";

async function setupJiraIntegration(
  request: import("@playwright/test").APIRequestContext,
  orgId: string,
): Promise<void> {
  const res = await request.put(`/api/v1/orgs/${orgId}/integrations`, {
    data: {
      platform: "jira",
      address: `${PLATFORM_MOCK_BASE}/mock-jira`,
      authType: "BASIC",
      username: PLATFORM_USER,
      password: PLATFORM_PASS,
    },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { code: number; data: { ok: boolean } };
  expect(body.code).toBe(0);
  expect(body.data.ok).toBe(true);
}

test("INTG-001-T2 集成配置→测试连接→推送缺陷（platformKey 回写+UI 徽标）", async ({
  page,
  request,
  playwright,
  authedPage,
  expectNoConsoleErrors,
}) => {
  // 管理员前置：独立 adminCtx（不覆盖浏览器用户会话）
  const admin = await newAdminContext(playwright);
  const pluginId = await uploadPlugin(admin, "jira-platform-1.0.2.tgz");
  await enablePlugin(admin, pluginId);
  await admin.dispose();

  const { projectId } = authedPage;
  // 组织 id
  const info = await request.get(`/api/v1/projects/${projectId}/info`);
  const ib = (await info.json()) as { data: { org: { id: string } } };
  const orgId = ib.data.org.id;

  // 项目关联 + 组织集成
  await setupJiraIntegration(request, orgId);
  const cfg = await request.put(`/api/v1/projects/${projectId}/integration`, {
    data: { platform: "jira", projectKey: "RABBIT", bugTypes: [], statusMapping: [], mode: "INCREMENT", enabled: true },
  });
  expect(cfg.status()).toBe(200);

  // 测试连接（经 runner → mock-jira myself）
  const tc = await request.post(`/api/v1/orgs/${orgId}/integrations/test`, {
    data: { platform: "jira" },
  });
  expect(tc.status(), `测试连接响应：${(await tc.text()).slice(0, 300)}`).toBe(200);
  const tcb = (await tc.json()) as { code: number; data: { account?: string } };
  expect(tcb.code).toBe(0);
  expect(tcb.data.account).toContain("Mock Jira User");

  // 建缺陷 → 推送 → platformKey 回写
  const bug = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: `e2e 推送缺陷 ${Date.now()}`, description: "INTG T2", tags: [], fields: {} },
  });
  expect(bug.status()).toBe(201);
  const bugId = ((await bug.json()) as { data: { id: string } }).data.id;
  const sync = await request.post(`/api/v1/projects/${projectId}/bugs/${bugId}/sync`, { data: {} });
  expect(sync.status(), `推送响应：${(await sync.text()).slice(0, 300)}`).toBe(200);
  const sb = (await sync.json()) as { code: number; data: { platformKey: string } };
  expect(sb.code).toBe(0);
  expect(sb.data.platformKey).toContain("RABBIT-");

  // UI：缺陷列表显示 JIRA 徽标与平台 key（经首页导航进——store 项目上下文初始化，与 BUG-001 同模式）
  await navFromHome(page, "缺陷管理");
  await expect(page.getByText("RABBIT-", { exact: false }).first()).toBeVisible({ timeout: 15000 });

  await expectNoConsoleErrors();
});

test("INTG-001-T3 拉取回写两态：平台 done → 本地已解决", async ({
  request,
  playwright,
  authedPage,
}) => {
  const admin = await newAdminContext(playwright);
  const pluginId = await uploadPlugin(admin, "jira-platform-1.0.2.tgz");
  await enablePlugin(admin, pluginId);
  await admin.dispose();
  const { projectId } = authedPage;
  const info = await request.get(`/api/v1/projects/${projectId}/info`);
  const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
  await setupJiraIntegration(request, orgId);
  await request.put(`/api/v1/projects/${projectId}/integration`, {
    data: { platform: "jira", projectKey: "RABBIT", bugTypes: [], statusMapping: [], mode: "INCREMENT", enabled: true },
  });

  // 建+推送缺陷
  const bug = await request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: `e2e 拉取缺陷 ${Date.now()}`, description: "INTG T3", tags: [], fields: {} },
  });
  const bugId = ((await bug.json()) as { data: { id: string } }).data.id;
  const sync = await request.post(`/api/v1/projects/${projectId}/bugs/${bugId}/sync`, { data: {} });
  const platformKey = ((await sync.json()) as { data: { platformKey: string } }).data.platformKey;

  // 平台状态推进 done（mock 控制面）→ 拉取 → 本地已解决
  const setRes = await request.post(`${PLATFORM_MOCK_BASE}/mock-jira/_test/set-status`, {
    data: { key: platformKey, status: "done" },
  });
  expect(setRes.status()).toBe(200);
  const pull = await request.post(`/api/v1/projects/${projectId}/integration/pull`, { data: {} });
  expect(pull.status(), `拉取响应：${(await pull.text()).slice(0, 300)}`).toBe(200);
  const pb = (await pull.json()) as { code: number; data: { pulled: number; updated: number } };
  expect(pb.code).toBe(0);
  expect(pb.data.updated).toBeGreaterThanOrEqual(1);

  const detail = await request.get(`/api/v1/projects/${projectId}/bugs/${bugId}`);
  const db = (await detail.json()) as { data: { status: string; platform: string } };
  expect(db.data.status).toBe("已解决");
  expect(db.data.platform).toBe("jira");
});

test("INTG-001-T4 断链保护：未配置平台的项目关联 → 422 70012", async ({
  request,
  authedPage,
}) => {
  const { projectId } = authedPage;
  // tapd 组织未配置 → 项目关联被拒
  const res = await request.put(`/api/v1/projects/${projectId}/integration`, {
    data: { platform: "tapd", projectKey: "123", bugTypes: [], statusMapping: [], mode: "INCREMENT", enabled: false },
  });
  expect(res.status()).toBe(422);
  const body = (await res.json()) as { code: number; message: string };
  expect(body.code).toBe(70012);
  expect(body.message).toContain("tapd");
});
