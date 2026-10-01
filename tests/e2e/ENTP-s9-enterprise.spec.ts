import { test, expect } from "./fixtures";
import {
  addLicense,
  removeLicense,
  loginSeedAdmin,
  issueDevLicense,
  resetTheme,
  MOCK_URL,
  sweepSsoSources,
  sweepPools,
} from "./s9-helpers";
import { readUnreadTitles } from "./s5-helpers";
import { createScenario, saveSteps, scriptStep, clickRetry } from "./s3-helpers";
import { E2E_BASE, E2E_HOST, E2E_REDIS } from "./env";

/**
 * Sprint 9 ENTP 全量 e2e（8 用例，单文件串行——License/主题为全局态，跨文件并行 workers=4 会互踩；
 * 全局 afterEach：License 移除；ENTP-004 用例内自恢复主题默认）。
 * 覆盖：ENTP-007 授权管理、ENTP-001 多组织+切换器、ENTP-002 OIDC mock 全链、ENTP-003 钉钉扫码 mock 全链、
 * ENTP-006 多池+engine2 绑定执行、ENTP-008 部门树+容量条、ENTP-004 主题品牌应用、ENTP-005 模板渲染事件链。
 * E NTP-009（2026-09-30 开源全功能）：原「社区版锁定二态」断言全部翻转为「无 License 可用」；
 * License 添加/移除仍验证授权信息链（徽标/矩阵/到期条/校验文案）。
 */

// ═══════ ENTP-007 License 体系 ═══════

test("ENTP-007-01 添加→企业版徽标+六特性矩阵→移除回社区版", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
  expectApi,
}) => {
  await loginSeedAdmin(request, context);
  await addLicense(request);
  const apiP = expectApi("**/api/v1/system/license");

  await page.goto("/system/license");
  await expect(page.getByTestId("license-status-card")).toBeVisible();
  // 企业版态（三类断言之 UI）
  await expect(page.getByTestId("license-badge-enterprise")).toBeVisible();
  await expect(page.getByTestId("license-feature-matrix")).toContainText("已授权");
  await expect(page.getByTestId("license-status-sub")).toContainText("序列号");

  // 接口断言：POST license 的 payload 与响应（enterprise）
  const api = await apiP;
  expect(api.status).toBe(200);
  expect(api.code).toBe(0);

  // 移除 → 社区版徽标 + 开源全功能清单（ENTP-009：容量清单翻转为全能力口径）
  await page.getByTestId("btn-remove-license").click();
  await page.getByRole("button", { name: /OK|确 定|是/ }).click();
  await expect(page.getByTestId("license-badge-community")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("community-limits")).toContainText("用户数不限");
  await expect(page.getByTestId("license-status-sub")).toContainText("开源全功能");

  await expectNoConsoleErrors();
});

test("ENTP-007-02 到期提醒黄条 + 校验失败文案回显", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // 黄条：5 天后到期
  await addLicense(
    request,
    issueDevLicense({ expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString() }),
  );
  await page.goto("/system/license");
  await expect(page.getByTestId("license-status-card")).toBeVisible();
  await expect(page.getByTestId("license-expire-banner")).toContainText("5 天");
  await removeLicense(request);

  // 篡改 License：422 90003 文案回显（经页面的预期负路径探测——422 响应按白名单登记）
  await page.reload();
  await expect(page.getByTestId("btn-add-license")).toBeVisible();
  const code = issueDevLicense();
  const tampered = `${code.slice(0, -6)}AAAAAA`;
  await page.getByTestId("btn-add-license").click();
  await page.getByTestId("input-license-code").fill(tampered);
  await page.getByRole("button", { name: "校验并添加" }).click();
  // 断言错误 message 本体（弹窗脚注提示也含「90003」字样——须锚定 antd message 避免误匹配）
  await expect(page.locator(".ant-message").getByText(/验签失败/)).toBeVisible({ timeout: 10_000 });

  await expectNoConsoleErrors([
    {
      pageUrlPattern: "system/license",
      textPattern: `POST ${E2E_BASE}/api/v1/system/license|Failed to load resource.*422`,
      reason: "篡改 License 提交是经页面的预期负路径探测（422 90003 回显断言即其 UI 证据）",
    },
  ]);
});

// ═══════ ENTP-001 多组织 ═══════
const E2E_PASSWORD = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";

test("ENTP-001-01 建组织→切换器→项目过滤→结束消失；社区版按钮禁用", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  // 第二用户（将任新组织管理员）+ 种子管理员
  const ownerEmail = `e2e-org-owner-${Date.now()}@rabbit.test`;
  const ownerRes = await request.post("/api/v1/auth/register", {
    data: { email: ownerEmail, password: E2E_PASSWORD },
  });
  expect(ownerRes.status()).toBe(201);

  // ── 开源全功能二态（ENTP-009）：无 License 新建组织即可用 ──
  await loginSeedAdmin(request, context);
  await page.goto("/system/orgs");
  await expect(page.getByTestId("orgs-table")).toBeVisible();
  await expect(page.getByTestId("btn-new-org")).toBeEnabled();

  // ── 授权信息链仍通（License 加载态与功能态解耦）──
  await addLicense(request);
  await page.reload();
  await expect(page.getByTestId("orgs-table")).toBeVisible();
  const newBtn = page.getByTestId("btn-new-org");
  await expect(newBtn).toBeEnabled();
  await newBtn.click();
  const orgName = `电商事业部E2E${Date.now().toString(36)}`;
  await page.getByTestId("input-org-name").fill(orgName);
  await page.getByTestId("select-org-owner").click();
  // antd Select 下拉搜索既有用户
  await page.keyboard.type(ownerEmail.slice(0, 12));
  await page.waitForTimeout(400);
  await page.keyboard.press("Enter"); // antd Select 回车选中首项（浮层重渲染致点击不稳定）
  await page.getByRole("button", { name: /创 建/ }).click();
  await expect(page.getByTestId("orgs-table")).toContainText(orgName, { timeout: 10_000 });
  const orgsRes = await request.get("/api/v1/system/orgs");
  const orgs = ((await orgsRes.json()) as { data: { items: { id: string; name: string }[] } }).data
    .items;
  const orgId = orgs.find((o) => o.name === orgName)!.id;

  // ── 第二用户视角：顶栏组织切换器出现 → 切换 → 项目过滤为空 ──
  const ownerLogin = await request.post("/api/v1/auth/login", {
    data: { email: ownerEmail, password: E2E_PASSWORD },
  });
  const ras = (ownerLogin.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  await context.clearCookies();
  await context.addCookies([{ name: "ras", value: ras!, url: E2E_BASE }]);
  await page.goto("/");
  await expect(page.getByTestId("org-switcher")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("org-switcher").click();
  await page.getByRole("menuitem", { name: orgName }).click();
  // 项目切换器空态（新组织无项目）——通过 API 断言过滤
  const projectsRes = await request.get(`/api/v1/personal/projects?orgId=${orgId}`);
  const projects = ((await projectsRes.json()) as { data: unknown[] }).data;
  expect(projects).toHaveLength(0);

  // ── 结束组织 → 切换器消失（该用户回单组织）──
  await loginSeedAdmin(request, context);
  await request.patch(`/api/v1/orgs/${orgId}`, { data: { status: "ENDED" } });
  await context.clearCookies();
  await context.addCookies([{ name: "ras", value: ras!, url: E2E_BASE }]);
  await page.goto("/");
  await expect(page.getByTestId("org-switcher")).toHaveCount(0, { timeout: 15_000 });

  // 清理：恢复后删除（级联）
  await loginSeedAdmin(request, context);
  const del = await request.delete(`/api/v1/orgs/${orgId}?needConfirm=true`);
  expect(((await del.json()) as { code: number }).code).toBe(0);

  // 白名单：切换用户会话后，浏览器仍持旧项目上下文 → /info、/dashboard/* 404（防枚举）属预期切换噪声
  await expectNoConsoleErrors([
    {
      pageUrlPattern: `${E2E_HOST}/`,
      textPattern: "/api/v1/projects/.+/(info|dashboard/.+) @ |Failed to load resource.*404",
      reason: "组织切换后旧项目上下文 404（防枚举），切换器刷新即恢复",
    },
  ]);
});

// ═══════ ENTP-002 SSO 认证源 ═══════
const MOCK_CLIENT_ID = process.env.E2E_SSO_CLIENT_ID ?? "e2e-mock-client";
const MOCK_CLIENT_SECRET = process.env.E2E_SSO_CLIENT_SECRET ?? "e2e-mock-secret";

test("ENTP-002-01 OIDC mock 全链：配置→登录页入口→授权→回调登录", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // ── 社区版：无入口 ──
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("login-form")).toBeVisible();
  await expect(page.getByTestId("sso-methods")).toHaveCount(0);

  // ── 企业版：清扫残留 → 建 OIDC 源（两步：占位端点 → PATCH 带 authId 的 mock 端点）──
  await loginSeedAdmin(request, context);
  await addLicense(request);
  await sweepSsoSources(request);
  const created = await request.post("/api/v1/system/sso", {
    data: {
      type: "OIDC",
      name: "e2e-Keycloak",
      enabled: true,
      config: {
        authEndpoint: `${MOCK_URL}/sso/oidc/placeholder/authorize`,
        tokenEndpoint: `${MOCK_URL}/sso/oidc/placeholder/token`,
        userinfoEndpoint: `${MOCK_URL}/sso/oidc/placeholder/userinfo`,
        clientId: MOCK_CLIENT_ID,
        clientSecret: MOCK_CLIENT_SECRET,
      },
    },
  });
  expect(created.status()).toBe(201);
  const authId = ((await created.json()) as { data: { id: string } }).data.id;
  const patched = await request.patch(`/api/v1/system/sso/${authId}`, {
    data: {
      type: "OIDC",
      name: "e2e-Keycloak",
      enabled: true,
      config: {
        authEndpoint: `${MOCK_URL}/sso/oidc/${authId}/authorize`,
        tokenEndpoint: `${MOCK_URL}/sso/oidc/${authId}/token`,
        userinfoEndpoint: `${MOCK_URL}/sso/oidc/${authId}/userinfo`,
        clientId: MOCK_CLIENT_ID,
        clientSecret: "******", // 掩码=保留原值
      },
    },
  });
  expect(patched.status()).toBe(200);

  // mock 控面预设 userinfo
  const preset = await request.post(`${MOCK_URL}/sso/_test/config`, {
    data: {
      authId,
      userinfo: {
        preferred_username: "e2e-sso-user",
        name: "E2E SSO 用户",
        email: `e2e-sso-${Date.now()}@idp.test`,
      },
    },
  });
  expect(preset.status()).toBe(200);

  // ── 配置页 UI：列表行 + 测试连接（secret 掩码经 API 断言——表格不渲染 secret 列）──
  await page.goto("/system/sso");
  await expect(page.getByTestId("sso-sources-table")).toContainText("e2e-Keycloak");
  const listJson = (
    (await (await request.get("/api/v1/system/sso")).json()) as {
      data: { items: { config: Record<string, unknown> }[] };
    }
  ).data;
  expect(String(listJson.items[0]!.config.clientSecret)).toBe("******");
  await page.getByTestId(`btn-test-sso-${authId}`).click();
  await expect(page.getByText("连接成功").first()).toBeVisible({ timeout: 10_000 });

  // ── 登出 → 登录页「更多登录方式」→ 点击 → mock 自动授权 → 回调 → 会话建立 ──
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("sso-methods")).toBeVisible();
  const ssoBtn = page.getByTestId("sso-method-OIDC");
  await expect(ssoBtn).toContainText("e2e-Keycloak");
  // 接口断言：authorize 302 → callback（浏览器自动跟随；断言最终登录态）
  await ssoBtn.click();
  await expect(page.getByTestId("topbar")).toBeVisible({ timeout: 20_000 });
  const me = await page.request.get("/api/v1/personal/me");
  const meBody = (await me.json()) as { data: { email: string } | null };
  expect(meBody.data?.email).toContain("@idp.test");

  // 清理：删源 → 登录页入口消失
  await loginSeedAdmin(request, context);
  await request.delete(`/api/v1/system/sso/${authId}`);
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("sso-methods")).toHaveCount(0);

  // 白名单：SSO 登录为新用户后，浏览器旧项目上下文 /info、/dashboard/* 404（防枚举）预期噪声
  await expectNoConsoleErrors([
    {
      pageUrlPattern: `${E2E_HOST}/`,
      textPattern: "/api/v1/projects/.+/(info|dashboard/.+) @ |Failed to load resource.*404",
      reason: "SSO 新用户会话下旧项目上下文 404（防枚举）",
    },
  ]);
});

test("ENTP-002-02 坏 state 回调 422 90012（直发 callback）", async ({ request, context }) => {
  await loginSeedAdmin(request, context);
  await addLicense(request);
  // 无 state：consumeState(null) → 90012（浏览器直发时返回 JSON）
  const res = await request.get(
    `/api/v1/auth/sso/00000000-0000-0000-0000-000000000092/oidc/callback?code=x`,
  );
  const body = (await res.json()) as { code: number };
  expect(body.code).toBe(90012);
});

// ═══════ ENTP-003 扫码登录 ═══════

test("ENTP-003-01 钉钉扫码 mock 全链：入口→授权→回调登录（合成账号幂等）", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);
  await addLicense(request);
  await sweepSsoSources(request);

  // 建钉钉源：先占位（AUTH_ID 自引用不可用）→ PATCH 注入 mock apiBase/authorizeBase
  const created = await request.post("/api/v1/system/sso", {
    data: {
      type: "DINGTALK",
      name: "e2e-钉钉扫码",
      enabled: true,
      config: { clientId: MOCK_CLIENT_ID, agentId: "e2e-agent", clientSecret: MOCK_CLIENT_SECRET },
    },
  });
  expect(created.status()).toBe(201);
  const authId = ((await created.json()) as { data: { id: string } }).data.id;
  const patched = await request.patch(`/api/v1/system/sso/${authId}`, {
    data: {
      type: "DINGTALK",
      name: "e2e-钉钉扫码",
      enabled: true,
      config: {
        clientId: MOCK_CLIENT_ID,
        agentId: "e2e-agent",
        clientSecret: "******",
        apiBase: `${MOCK_URL}/sso/dingtalk/${authId}`,
        authorizeBase: `${MOCK_URL}/sso`,
      },
    },
  });
  expect(patched.status()).toBe(200);
  // mock 控面：钉钉 userinfo（无 email → 合成 @sso.scan）
  await request.post(`${MOCK_URL}/sso/_test/config`, {
    data: { authId, userinfo: { openId: `e2e-open-${Date.now().toString(36)}`, nick: "扫码用户" } },
  });

  // 登录页：扫码按钮 → mock 授权（302 自动）→ 回调 → 登录成功
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("sso-method-DINGTALK")).toBeVisible();
  await page.getByTestId("sso-method-DINGTALK").click();
  await expect(page.getByTestId("topbar")).toBeVisible({ timeout: 20_000 });
  const me = (await (await page.request.get("/api/v1/personal/me")).json()) as {
    data: { email: string } | null;
  };
  expect(me.data?.email).toContain("@sso.scan");

  // 幂等：再走一遍 → 同一账号
  await context.clearCookies();
  await page.goto("/login");
  await page.getByTestId("sso-method-DINGTALK").click();
  await expect(page.getByTestId("topbar")).toBeVisible({ timeout: 20_000 });
  const me2 = (await (await page.request.get("/api/v1/personal/me")).json()) as {
    data: { email: string } | null;
  };
  expect(me2.data?.email).toBe(me.data?.email);

  // 清理
  await loginSeedAdmin(request, context);
  await request.delete(`/api/v1/system/sso/${authId}`);

  await expectNoConsoleErrors();
});

// ═══════ ENTP-006 多资源池 ═══════
const DEFAULT_POOL_ID = "00000000-0000-0000-0000-000000000001";

test("ENTP-006-01 建池→engine2 绑定（POOL_ID）→场景选池执行→默认池保护", async ({
  page,
  context,
  browser,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // ── 开源全功能（ENTP-009）：无 License 新建池即可用 ──
  await page.goto("/system/pools");
  await expect(page.getByTestId("pool-nodes")).toBeVisible();
  await expect(page.getByTestId("btn-new-pool")).toBeEnabled();

  // ── 清扫残留池 → 建池（License 加载不改变可用性）──
  await addLicense(request);
  await sweepPools(request);
  await page.reload();
  const poolName = `企业池E2E${Date.now().toString(36)}`;
  await page.getByTestId("btn-new-pool").click();
  await page.getByTestId("input-pool-name").fill(poolName);
  await page.getByTestId("input-new-pool-concurrency").fill("4");
  await page.getByRole("button", { name: /创 建/ }).click();
  await expect(page.getByTestId("pool-nodes")).toBeVisible();
  const pools = (
    (await (await request.get("/api/v1/system/pools")).json()) as {
      data: { items: { id: string; name: string }[] };
    }
  ).data.items;
  const poolId = pools.find((p) => p.name === poolName)!.id;
  await expect(page.getByTestId(`pool-card-${poolId}`)).toContainText("尚无节点");

  // ── 场景与项目（执行素材）：项目用户走独立 context——register 的 Set-Cookie 会覆盖主 jar
  //   （主 jar 须保持 admin 供池端点轮询；S9 勘误 2）
  const userCtx = await browser.newContext();
  const userReq = userCtx.request;
  const reg = await userReq.post("/api/v1/auth/register", {
    data: { email: `e2e-pool-${Date.now()}@rabbit.test`, password: E2E_PASSWORD },
  });
  const projectId = ((await reg.json()) as { data: { projectId: string } }).data.projectId;
  const scenario = await createScenario(userReq, projectId, { name: "选池场景" });
  await saveSteps(userReq, projectId, scenario.id, [scriptStep("自检", "1 + 1")]);

  // ── 起 engine2：POOL_ID 绑定新池（消费 exec:{poolId} 队列 + 按池心跳）──
  const { spawn } = await import("node:child_process");
  const engine2 = spawn("pnpm", ["--filter", "engine", "start"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      POOL_ID: poolId,
      REDIS_URL: E2E_REDIS,
      WEB_URL: E2E_BASE,
      INTERNAL_TOKEN: process.env.INTERNAL_TOKEN ?? "dev-internal-token",
    },
    stdio: "ignore",
    detached: false,
  });
  try {
    // 心跳注册：池出现 ONLINE 节点（10s 心跳周期，宽限 25s）
    await expect
      .poll(
        async () => {
          const p = (
            (await (await request.get(`/api/v1/system/pools/${poolId}`)).json()) as {
              data: { nodes: { state: string }[] };
            }
          ).data;
          return p.nodes.some((n) => n.state === "ONLINE");
        },
        { timeout: 25_000, interval: 2_000 },
      )
      .toBe(true);

    // ── 场景选新池执行：batch execute 带 poolId → 仅 engine2 消费该队列 → SUCCESS 即路由证明 ──
    const exec = await userReq.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenario.id], poolId, stopOnFail: true, mode: "serial" },
    });
    expect(exec.status()).toBe(201);
    const taskId = ((await exec.json()) as { data: { taskId: string } }).data.taskId;
    let finalState = "";
    for (let i = 0; i < 40; i++) {
      const rep = (
        (await (await userReq.get(`/api/v1/projects/${projectId}/reports/${taskId}`)).json()) as {
          data?: { status: string };
        }
      ).data;
      finalState = rep?.status ?? "";
      if (["SUCCESS", "FAILED", "STOPPED"].includes(finalState)) break;
      await page.waitForTimeout(1000);
    }
    expect(finalState).toBe("SUCCESS");

    // ── 默认池保护（API 二态）──
    const delDefault = await request.delete(`/api/v1/system/pools/${DEFAULT_POOL_ID}`);
    expect(((await delDefault.json()) as { code: number }).code).toBe(90030);
    const disDefault = await request.patch(`/api/v1/system/pools/${DEFAULT_POOL_ID}`, {
      data: { status: "DISABLED" },
    });
    expect(((await disDefault.json()) as { code: number }).code).toBe(90031);

    // ── 禁用新池 → 执行选池 422 90032 ──
    await request.patch(`/api/v1/system/pools/${poolId}`, { data: { status: "DISABLED" } });
    const execDisabled = await userReq.post(`/api/v1/projects/${projectId}/scenarios/execute`, {
      data: { scenarioIds: [scenario.id], poolId, stopOnFail: true, mode: "serial" },
    });
    expect(((await execDisabled.json()) as { code: number }).code).toBe(90032);
    await request.patch(`/api/v1/system/pools/${poolId}`, { data: { status: "ACTIVE" } });

    // 有历史任务的池删除 → 409 90036
    const delNew = await request.delete(`/api/v1/system/pools/${poolId}`);
    expect(((await delNew.json()) as { code: number }).code).toBe(90036);
  } finally {
    engine2.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!engine2.killed) engine2.kill("SIGKILL");
    await userCtx.close().catch(() => undefined);
  }

  await expectNoConsoleErrors();
});

// ═══════ ENTP-008 用户扩容与部门 ═══════

test("ENTP-008-01 部门树 CRUD+成员挂载；社区版门控二态；容量条切换", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  // 成员：注册进 admin 组织（挂部门前置）
  const memberEmail = `e2e-dept-${Date.now()}@rabbit.test`;
  const reg = await request.post("/api/v1/auth/register", {
    data: { email: memberEmail, password: E2E_PASSWORD },
  });
  const member = ((await reg.json()) as { data: { userId: string } }).data;
  const projEmail = `e2e-dept-p-${Date.now()}@rabbit.test`;
  const projReg = await request.post("/api/v1/auth/register", {
    data: { email: projEmail, password: E2E_PASSWORD },
  });
  const projectId = ((await projReg.json()) as { data: { projectId: string } }).data.projectId;

  await loginSeedAdmin(request, context);

  // ── 开源全功能二态（ENTP-009）：无 License 部门 API 即可用（原 90001 门控已停用）──
  const myOrgs = (
    (await (await request.get("/api/v1/personal/orgs")).json()) as { data: { id: string }[] }
  ).data;
  const before = await request.get(`/api/v1/orgs/${myOrgs[0]!.id}/departments`);
  expect(((await before.json()) as { code: number }).code).toBe(0);
  const seedOrgId = myOrgs[0]!.id;

  // ── 授权信息链仍通（先清扫部门残留——失败用例遗留会触发重名 422）──
  await addLicense(request);
  const orgId = seedOrgId;
  {
    // 按深度先删子再删根（根先删会 90043 卡住留残留 → 后续重名 422）
    const flat: { id: string; parentId: string | null }[] = [];
    const walk = (nodes: { id: string; parentId: string | null; children?: typeof nodes }[]) => {
      for (const n of nodes) {
        flat.push({ id: n.id, parentId: n.parentId });
        walk(n.children ?? []);
      }
    };
    walk(
      (
        (await (await request.get(`/api/v1/orgs/${orgId}/departments`)).json()) as {
          data?: Parameters<typeof walk>[0];
        }
      ).data ?? [],
    );
    for (const d of flat.reverse()) {
      await request.delete(`/api/v1/orgs/${orgId}/departments/${d.id}`).catch(() => undefined);
    }
  }
  await request.post(`/api/v1/orgs/${orgId}/members-add`, { data: { userIds: [member.userId] } });

  // ── UI：部门页两级树 ──
  await page.goto("/org/departments");
  await expect(page.getByTestId("department-tree")).toBeVisible();
  await page.getByTestId("btn-new-department-root").click();
  await page.getByTestId("input-department-name").fill("质量部E2E");
  await page.getByRole("button", { name: /创 建/ }).click();
  await expect(page.getByTestId("department-tree")).toContainText("质量部E2E", { timeout: 10_000 });
  const tree = (
    (await (await request.get(`/api/v1/orgs/${orgId}/departments`)).json()) as {
      data: { id: string; name: string; children: { id: string; name: string }[] }[];
    }
  ).data;
  const root = tree.find((n) => n.name === "质量部E2E")!;

  // 子部门（API）+ 挂成员
  const sub = await request.post(`/api/v1/orgs/${orgId}/departments`, {
    data: { name: "测试一组", parentId: root.id },
  });
  expect(sub.status()).toBe(201);
  const subId = ((await sub.json()) as { data: { id: string } }).data.id;
  const addMember = await request.post(`/api/v1/orgs/${orgId}/departments/${subId}/members`, {
    data: { userIds: [member.userId] },
  });
  expect(addMember.status()).toBe(201);

  // UI：选中子部门 → 成员表可见（API 建树后 reload 刷新 React Query 缓存）
  await page.reload();
  await expect(page.getByTestId("department-tree")).toBeVisible();
  await page.getByTestId(`department-node-${subId}`).click();
  await expect(page.getByTestId("department-members")).toContainText(memberEmail, {
    timeout: 10_000,
  });

  // 保护：有子部门删除 409 90043（API 二态）
  const delRoot = await request.delete(`/api/v1/orgs/${orgId}/departments/${root.id}`);
  expect(((await delRoot.json()) as { code: number }).code).toBe(90043);

  // 重名 409 90041
  const dup = await request.post(`/api/v1/orgs/${orgId}/departments`, {
    data: { name: "测试一组", parentId: root.id },
  });
  expect(((await dup.json()) as { code: number }).code).toBe(90041);

  // ── 用户管理页容量条（企业版口径）──
  await page.goto("/system/users");
  await expect(page.getByTestId("user-limit-bar")).toBeVisible();
  await expect(page.getByTestId("user-limit-bar")).toContainText("不限");

  // 开源口径（ENTP-009）：移除 license → 容量条仍「不限」（用户上限随门控停用解除）
  await removeLicense(request);
  await page.reload();
  await expect(page.getByTestId("user-limit-bar")).toContainText("不限");

  // 清理：删子部门 → 删根部门（恢复 license 后）
  await addLicense(request);
  await request.delete(`/api/v1/orgs/${orgId}/departments/${subId}`);
  await request.delete(`/api/v1/orgs/${orgId}/departments/${root.id}`);

  await expectNoConsoleErrors();
});

// ═══════ ENTP-004 自定义主题 ═══════

test("ENTP-004-01 界面设置：改色+品牌 → 保存并应用 → 登录页/顶栏生效 → 恢复默认", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // ── 开源全功能（ENTP-009）：无 License 表单即可用（原社区版 Tab 禁用态已解除）──
  await page.goto("/system/params");
  await page.getByRole("tab", { name: "界面设置" }).click();
  await expect(page.getByTestId("theme-form")).toBeVisible();
  await expect(page.getByTestId("theme-locked-alert")).toHaveCount(0);

  // ── 授权信息链仍通（License 加载态与功能态解耦）──
  await addLicense(request);
  await page.reload();
  await page.getByRole("tab", { name: "界面设置" }).click();
  await expect(page.getByTestId("theme-form")).toBeVisible();

  // 实时预览随表单联动（UI 断言）
  await page.getByTestId("input-theme-site-name").fill("星舟测试平台");
  await page.getByTestId("input-theme-slogan").fill("质量驱动交付");
  await page.getByTestId("input-theme-platform-name").fill("星舟 QA");
  await expect(page.getByTestId("theme-preview-login")).toContainText("星舟测试平台");

  // 保存并应用（接口断言 PUT payload/响应 + public/theme 生效）
  const saveP = page.waitForResponse(
    (r) => r.url().includes("/api/v1/system/params/theme") && r.request().method() === "PUT",
  );
  await page.getByTestId("btn-theme-save").click();
  const saved = await saveP;
  expect(saved.status()).toBe(200);
  const theme = (await (await request.get("/api/v1/public/theme")).json()) as {
    data: { primaryColor: string; siteName: string; slogan: string; platformName: string };
  };
  expect(theme.data.siteName).toBe("星舟测试平台");
  expect(theme.data.slogan).toBe("质量驱动交付");

  // 控制台顶栏平台名生效（reload 触发 public/theme 重取）
  await page.goto("/");
  await expect(page.getByTestId("topbar-brand")).toContainText("星舟 QA", { timeout: 15_000 });

  // 登录页品牌生效（登出视角）
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("login-brand-name")).toContainText("星舟测试平台");
  await expect(page.getByTestId("login-slogan")).toContainText("质量驱动交付");
  // 注：/login 为静态预渲染页，document.title 不随运行时 theme 变化（品牌名/Slogan/配色已覆盖应用链）

  // 恢复默认 → 登录页回默认品牌
  await loginSeedAdmin(request, context);
  await page.goto("/system/params");
  await page.getByRole("tab", { name: "界面设置" }).click();
  await page.getByTestId("btn-theme-reset").click();
  await page.getByTestId("btn-theme-save").click();
  await page.waitForTimeout(500);
  await context.clearCookies();
  await page.goto("/login");
  await expect(page.getByTestId("login-brand-name")).toContainText("RabbitAI", { timeout: 10_000 });

  await resetTheme(request);
  await expectNoConsoleErrors([
    {
      // 本用例两度 context.clearCookies() 切换登出视角验证登录页品牌——清 cookie 瞬间
      // 页面在途查询（dashboard/permissions/projects）以失效会话补发 401，属预期噪音
      // （CI 慢机窗口放大；SYS-010 前后行为一致，仅时序更易命中）
      pageUrlPattern: ".*",
      textPattern: "\\[http 401\\] GET http://localhost:3100/api/v1/(personal|projects)/",
      reason: "clearCookies 切登出视角期间在途查询 401",
    },
    {
      // 同一竞态的另一半形状：在途 fetch/xhr 401 时 Chrome 原生 console.error（无资源
      // URL，[http 401] 留痕可交叉定位）——上方条目只盖应用侧日志形状，此形状曾漏出，
      // main run 36829380186 慢机三连红实证（INFRA-011 §6.1）
      pageUrlPattern: "^\\[console\\.error\\]",
      textPattern: "Failed to load resource: the server responded with a status of 401",
      reason: "clearCookies 切登出视角期间在途请求的浏览器原生 401 资源日志",
    },
  ]);
});

// ═══════ ENTP-005 消息模板 ═══════

test("ENTP-005-01 定制缺陷模板 → 触发缺陷创建 → 站内信按模板渲染", async ({
  page,
  browser,
  authedPage,
  request,
  expectNoConsoleErrors,
}) => {
  const { projectId } = authedPage;

  // ── 开源全功能二态（ENTP-009）：无 License 模板 Tab 即可用 ──
  await page.goto("/settings/messages");
  await page.getByRole("tab", { name: "模板" }).click();
  await expect(page.getByTestId("template-events")).toContainText("缺陷创建");

  // 造接收人与事件配置（authedPage 会话）
  const info = await page.request.get(`/api/v1/projects/${projectId}/info`);
  const orgId = ((await info.json()) as { data: { org: { id: string } } }).data.org.id;
  const memberEmail = `e2e-tpl-member-${Date.now()}@rabbit.test`;
  const reg = await page.request.post("/api/v1/auth/register", {
    data: { email: memberEmail, password: E2E_PASSWORD },
  });
  const member = ((await reg.json()) as { data: { userId: string } }).data;
  await page.request.post("/api/v1/auth/login", {
    data: { email: authedPage.email, password: E2E_PASSWORD },
  });
  await page.request.post(`/api/v1/orgs/${orgId}/members-add`, {
    data: { userIds: [member.userId] },
  });
  await page.request.post(`/api/v1/projects/${projectId}/members`, {
    data: { userIds: [member.userId] },
  });
  const robot = (
    (await (
      await page.request.post(`/api/v1/projects/${projectId}/robots`, {
        data: { name: "e2e-tpl-inapp", channel: "inapp", enabled: true },
      })
    ).json()) as { data: { id: string } }
  ).data;
  await page.request.put(`/api/v1/projects/${projectId}/message-config`, {
    data: {
      BUG_CREATED: { enabled: true, robotIds: [robot.id], receiverUserIds: [member.userId] },
    },
  });

  // admin 加 license → 回用户会话
  const adminCtx = await browser.newContext();
  await loginSeedAdmin(adminCtx.request, adminCtx);
  await addLicense(adminCtx.request);
  await adminCtx.close();
  await page.request.post("/api/v1/auth/login", {
    data: { email: authedPage.email, password: E2E_PASSWORD },
  });

  // ── 模板 Tab：定制 BUG_CREATED（UI 表单 + 变量插入 + 预览 + 保存）──
  await page.goto("/settings/messages");
  await page.getByRole("tab", { name: "模板" }).click();
  await expect(page.getByTestId("template-events")).toContainText("缺陷创建");
  await page.getByTestId("template-event-BUG_CREATED").click();
  await page.getByTestId("input-template-title").fill("[${project}] ${actorName} 提交了缺陷");
  await page.getByTestId("input-template-content").fill("缺陷：");
  await page.getByTestId("var-chip-title").click(); // 变量插入（内容尾部）
  // 预览（服务端渲染示例数据）
  await page.getByTestId("btn-template-preview").click();
  await expect(page.getByTestId("template-preview")).toContainText("[演示项目]");
  await expect(page.getByTestId("template-preview")).toContainText("支付下单偶发 500");
  // 保存（接口断言：PUT payload 含模板）
  const saveP = page.waitForResponse(
    (r) => r.url().includes("/message-templates") && r.request().method() === "PUT",
  );
  await page.getByTestId("btn-template-save").click();
  const saved = await saveP;
  expect(saved.status()).toBe(200);
  await expect(page.getByTestId("template-event-BUG_CREATED")).toContainText("已定制", {
    timeout: 10_000,
  });

  // ── 触发真实事件：建缺陷 → 接收人站内信按模板渲染 ──
  const projInfo = (await (
    await page.request.get(`/api/v1/projects/${projectId}/info`)
  ).json()) as {
    data: { name: string };
  };
  const bugTitle = `e2e-模板渲染缺陷${Date.now().toString(36)}`;
  const bug = await page.request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: bugTitle },
  });
  expect(bug.status()).toBe(201);

  const memberCtx = await browser.newContext();
  await memberCtx.request.post("/api/v1/auth/login", {
    data: { email: memberEmail, password: E2E_PASSWORD },
  });
  const titles = await readUnreadTitles(memberCtx.request);
  await memberCtx.close();
  // 模板渲染：标题含项目名前缀（模板 ${project}/${actorName}）
  expect(
    titles.some((t) => t.startsWith(`[${projInfo.data.name}]`) && t.endsWith("提交了缺陷")),
  ).toBeTruthy();

  // ── 回退验证：删除模板 → 默认文案 ──
  await page.request.delete(`/api/v1/projects/${projectId}/message-templates/BUG_CREATED`);
  const bug2 = await page.request.post(`/api/v1/projects/${projectId}/bugs`, {
    data: { title: `${bugTitle}-2` },
  });
  expect(bug2.status()).toBe(201);
  const memberCtx2 = await browser.newContext();
  await memberCtx2.request.post("/api/v1/auth/login", {
    data: { email: memberEmail, password: E2E_PASSWORD },
  });
  const titles2 = await readUnreadTitles(memberCtx2.request);
  await memberCtx2.close();
  expect(titles2.some((t) => t.includes("新建"))).toBeTruthy(); // S5 默认文案（零回归）

  await expectNoConsoleErrors();
});

// ═══════ 全局清理（License 用后即删；主题已由 ENTP-004 用例内恢复）═══════

test.afterEach(async ({ request, context }) => {
  // afterEach 的 request 是无会话新实例——须先登录再删（否则 401 被吞、License 残留污染下游用例）
  await loginSeedAdmin(request, context).catch(() => undefined);
  await removeLicense(request);
  await resetTheme(request).catch(() => undefined);
});
