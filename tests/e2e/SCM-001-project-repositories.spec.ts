import { test, expect, navFromHome } from "./fixtures";
import { MOCK_BASE } from "./env";

// 白名单：store 水合前 /projects/null 首帧竞态（S1 以来既有面，FILE-001 同款登记）
const hydrateRace = {
  pageUrlPattern: "/settings/code-repos|/settings/integrations",
  textPattern: "projects/null|Failed to load resource",
  reason: "store 水合前 projectId=null 的首帧查询",
};

/** SCM-001-03 主动制造凭据失效（401→422 40473）：预期业务失败响应（expectNoConsoleErrors 白名单口径） */
const expectedVerifyFail = {
  pageUrlPattern: "/settings/code-repos",
  textPattern: "http 422.*scm-repos/.+/verify",
  reason: "本用例主动触发验证失败（坏 Token→平台 401→422 40473）",
};

/** 测试凭据假值（mock 桩口径，非真实凭据；口令沿 fixtures/seed 的 env 优先口径） */
const TOKEN_OK = "e2e-scm-token";
const TOKEN_BAD = "e2e-scm-token-bad";
const USER_PASS = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";
const ADMIN_EMAIL = process.env.E2E_SEED_ADMIN_EMAIL ?? "admin@rabbit.test";
const ADMIN_PASS = process.env.RABBIT_SEED_ADMIN_PASSWORD ?? "rabbit-admin-123";

async function orgIdOf(request: import("@playwright/test").APIRequestContext, projectId: string) {
  const res = await request.get(`/api/v1/projects/${projectId}/info`);
  const body = (await res.json()) as { data: { org: { id: string } } };
  return body.data.org.id;
}

async function createByUrl(
  request: import("@playwright/test").APIRequestContext,
  projectId: string,
  repoUrl: string,
  token?: string,
) {
  const res = await request.post(`/api/v1/projects/${projectId}/scm-repos`, {
    data: {
      source: "url",
      provider: "gitea",
      repoUrl,
      authType: token ? "token" : "none",
      ...(token ? { token } : {}),
    },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { data: { id: string } }).data;
}

/** SCM-001 项目代码仓库 e2e：URL 直填+验证 / OAuth 全流 / 凭据失效与脱敏 / 默认互斥与删除 / 越域与配置继承。 */
test.describe("SCM-001 项目代码仓库", () => {
  test("SCM-001-01 URL 直填绑定→验证成功→元信息（空态/有态二态）", async ({
    page,
    authedPage,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    await navFromHome(page, "代码仓库");
    await expect(page.getByTestId("page-settings-code-repos")).toBeVisible();
    // 空态
    await expect(page.getByTestId("empty-code-repos")).toBeVisible();

    // 添加仓库 → 仓库地址 tab → gitea + Token
    await page.getByTestId("btn-add-repo").click();
    await expect(page.getByTestId("drawer-add-repo")).toBeVisible();
    await page.getByRole("tab", { name: "仓库地址" }).click();
    await page.getByTestId("input-repo-url").fill(`${MOCK_BASE}/qa/scm-demo.git`);
    await page.getByTestId("select-scm-provider").click();
    await page.getByTitle("Gitea").click();
    await page.getByRole("radio", { name: "Token" }).click();
    await page.getByTestId("input-scm-token").fill(TOKEN_OK);

    // 接口断言：创建请求负载（source=url/authType=token）与响应信封
    const createdPromise = page.waitForResponse("**/api/v1/projects/*/scm-repos");
    await page.getByTestId("btn-confirm-add-repo").click();
    const created = await createdPromise;
    expect(created.status()).toBe(201);
    expect(JSON.parse(created.request().postData() ?? "{}")).toMatchObject({
      source: "url",
      provider: "gitea",
      authType: "token",
    });
    expect(((await created.json()) as { code: number }).code).toBe(0);

    // 卡片（首个绑定自动默认）
    await expect(page.getByTestId("repo-card-qa-scm-demo")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("repo-card-qa-scm-demo")).toContainText("默认");
    await expect(page.getByText("还没有绑定代码仓库")).toBeHidden();

    // 验证 → 已连接 + 元信息（默认分支/可见性/最近提交）
    const verifyPromise = expectApi("**/api/v1/projects/*/scm-repos/*/verify", "POST");
    await page.getByTestId("btn-verify-scm-demo").click();
    const verified = await verifyPromise;
    expect(verified.status).toBe(200);
    expect(verified.code).toBe(0);
    expect(verified.data).toMatchObject({
      status: "OK",
      defaultBranch: "main",
      visibility: "private",
    });
    await expect(page.getByTestId("repo-card-qa-scm-demo").getByText("已连接")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("repo-card-qa-scm-demo")).toContainText("默认分支 main");
    await expect(page.getByText("仓库已绑定")).toBeVisible();
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("SCM-001-02 OAuth 全流：组织覆盖→浏览器授权（mock 平台）→选仓绑定", async ({
    page,
    authedPage,
    request,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const orgId = await orgIdOf(request, projectId);

    // 组织级 OAuth App 覆盖（org 管理员权限；clientId/secret 为 mock 平台测试假值）
    const putApp = await request.put(`/api/v1/orgs/${orgId}/scm-apps/github`, {
      data: { clientId: "e2e-mock-client", clientSecret: "e2e-mock-secret", enabled: true },
    });
    expect(putApp.status()).toBe(200);
    const resolved = (
      (await (await request.get(`/api/v1/orgs/${orgId}/scm-apps`)).json()) as {
        data: { items: { provider: string; source: string; clientId: string }[] };
      }
    ).data.items;
    expect(resolved.find((r) => r.provider === "github")).toMatchObject({
      source: "org",
      clientId: "e2e-mock-client",
    });

    // 授权账号弹窗 → 授权 GitHub（浏览器跟随 start→mock authorize→callback→回前端）
    await navFromHome(page, "代码仓库");
    await page.getByTestId("btn-manage-accounts").click();
    await expect(page.getByText("授权新账号（跳转平台授权页）")).toBeVisible();
    // 重定向链（start→mock→callback→前端）在满载栈上可能 >10s：noWaitAfter 跳过 click 的隐式导航等待
    await page.getByTestId("btn-authorize-new-github").click({ noWaitAfter: true });
    await page.waitForURL(/\/settings\/code-repos\?oauth=github/, { timeout: 30_000 });
    await expect(page.getByText("GitHub 授权成功")).toBeVisible({ timeout: 10_000 });

    // 账号入库（接口断言：login=mock-github-user，token 不回显）
    const accounts = (
      (await (await request.get(`/api/v1/orgs/${orgId}/scm-accounts`)).json()) as {
        data: { items: { id: string; login: string; provider: string }[] };
      }
    ).data.items;
    expect(accounts.length).toBe(1);
    expect(accounts[0]).toMatchObject({ login: "mock-github-user", provider: "github" });

    // 添加仓库 → 平台授权 tab（账号自动选中）→ 选 RabbitAI-Lab/rabbit-web
    await page.getByTestId("btn-add-repo").click();
    await expect(page.getByTestId("drawer-add-repo")).toBeVisible();
    await expect(page.getByTestId("select-oauth-account")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("oauth-repo-RabbitAI-Lab-rabbit-web")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByTestId("oauth-repo-RabbitAI-Lab-rabbit-web").click();
    const createdPromise = page.waitForResponse("**/api/v1/projects/*/scm-repos");
    await page.getByTestId("btn-confirm-add-repo").click();
    const created = await createdPromise;
    expect(created.status()).toBe(201);
    expect(JSON.parse(created.request().postData() ?? "{}")).toMatchObject({
      source: "oauth",
      owner: "RabbitAI-Lab",
      repo: "rabbit-web",
    });

    // 卡片：OAuth 认证方式 tag 展示平台登录名
    await expect(page.getByTestId("repo-card-RabbitAI-Lab-rabbit-web")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("repo-card-RabbitAI-Lab-rabbit-web")).toContainText(
      "OAuth · mock-github-user",
    );
    void expectApi;
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("SCM-001-03 凭据二态与脱敏：验证成功→换坏 Token→凭据失效（响应体无明文）", async ({
    page,
    authedPage,
    request,
    expectApi,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    // owner=secure：mock 校验 Basic token（正确→200；错误/缺失→401）
    await createByUrl(request, projectId, `${MOCK_BASE}/secure/scm-locked.git`, TOKEN_OK);

    await navFromHome(page, "代码仓库");
    await expect(page.getByTestId("repo-card-secure-scm-locked")).toBeVisible({ timeout: 10_000 });

    // 首次验证：OK
    const v1 = expectApi("**/scm-repos/*/verify", "POST");
    await page.getByTestId("btn-verify-scm-locked").click();
    expect((await v1).data).toMatchObject({ status: "OK" });
    await expect(page.getByTestId("repo-card-secure-scm-locked").getByText("已连接")).toBeVisible({
      timeout: 10_000,
    });

    // 编辑换坏 Token（同型换凭据：提供新值即替换，留空=不更新）
    await page.getByTestId("btn-edit-scm-locked").click();
    // 弹窗内容级断言（Modal 根节点为 0×0 容器，不可作可见性断言目标）
    await expect(page.getByText("不可修改；如需更换请删除后重新绑定")).toBeVisible();
    // 脱敏断言（UI）：编辑弹窗不回显已存 token
    await expect(page.getByTestId("input-edit-token")).toHaveValue("");
    await page.getByTestId("input-edit-token").fill(TOKEN_BAD);
    await page.getByRole("button", { name: "保 存" }).click();
    await expect(page.getByText("已保存")).toBeVisible({ timeout: 10_000 });

    // 再验证：401 → INVALID_CRED（422 code 40473）+ 红徽标
    const v2 = expectApi("**/scm-repos/*/verify", "POST");
    await page.getByTestId("btn-verify-scm-locked").click();
    const failed = await v2;
    expect(failed.status).toBe(422);
    expect(failed.code).toBe(40473);
    await expect(
      page.getByTestId("repo-card-secure-scm-locked").getByText("凭据失效", { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });

    // 脱敏断言（接口）：列表响应体不含 token 明文
    const listBody = JSON.stringify(
      await (await request.get(`/api/v1/projects/${projectId}/scm-repos`)).json(),
    );
    expect(listBody).not.toContain(TOKEN_OK);
    expect(listBody).not.toContain(TOKEN_BAD);
    expect(listBody).toContain('"hasSecret":true');
    await expectNoConsoleErrors([hydrateRace, expectedVerifyFail]);
  });

  test("SCM-001-04 默认仓库互斥→删除默认自动补位→删空回空态", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const first = await createByUrl(request, projectId, `${MOCK_BASE}/qa/scm-a.git`);
    await createByUrl(request, projectId, `${MOCK_BASE}/qa/scm-b.git`);
    const list = () =>
      request.get(`/api/v1/projects/${projectId}/scm-repos`).then(async (r) => {
        const b = (await r.json()) as { data: { items: { id: string; isDefault: boolean }[] } };
        return b.data.items;
      });

    await navFromHome(page, "代码仓库");
    await expect(page.getByTestId("repo-card-qa-scm-a")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("repo-card-qa-scm-b")).toBeVisible();

    // 首个自动默认；把默认切给 scm-b → 互斥（a 失默认）
    expect((await list()).find((r) => r.id === first.id)?.isDefault).toBe(true);
    await page.getByTestId("btn-set-default-scm-b").click();
    await expect(page.getByText("已设为默认仓库")).toBeVisible();
    await expect
      .poll(async () => (await list()).find((r) => r.id === first.id)?.isDefault)
      .toBe(false);
    await expect.poll(async () => (await list()).filter((r) => r.isDefault).length).toBe(1);

    // 删除默认（scm-b）→ 剩余最早一条自动补默认
    await page.getByTestId("btn-delete-scm-b").click();
    await page
      .locator(".ant-popover .ant-btn-primary, .ant-tooltip .ant-btn-primary")
      .last()
      .click();
    await expect(page.getByText("已删除")).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => (await list()).find((r) => r.id === first.id)?.isDefault)
      .toBe(true);

    // 删空 → 回空态
    await page.getByTestId("btn-delete-scm-a").click();
    await page
      .locator(".ant-popover .ant-btn-primary, .ant-tooltip .ant-btn-primary")
      .last()
      .click();
    await expect(page.getByTestId("empty-code-repos")).toBeVisible({ timeout: 10_000 });
    expect((await list()).length).toBe(0);
    await expectNoConsoleErrors([hydrateRace]);
  });

  test("SCM-001-05 越域 404 + 系统级配置被组织继承（三态）", async ({
    page,
    authedPage,
    request,
    expectNoConsoleErrors,
  }) => {
    const { projectId } = authedPage;
    const orgId = await orgIdOf(request, projectId);
    await createByUrl(request, projectId, `${MOCK_BASE}/qa/scm-isolated.git`);

    // 组织解析视图：gitee 初始 none（系统/组织均未配置；github 覆盖态由 02 场景族覆盖，本用例独用 gitee）
    const apps0 = (
      (await (await request.get(`/api/v1/orgs/${orgId}/scm-apps`)).json()) as {
        data: { items: { provider: string; source: string }[] };
      }
    ).data.items;
    expect(apps0.find((a) => a.provider === "gitee")?.source).toBe("none");

    // 系统管理员配置系统级 gitee（seed admin；登录态切到 admin 的 request 上下文）
    const login = await request.post("/api/v1/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
    });
    expect(login.status()).toBe(200);
    const putSys = await request.put("/api/v1/system/params/scm", {
      data: {
        group: "scm",
        value: {
          github: { clientId: "" },
          gitee: { clientId: "sys-gitee-client", enabled: true },
          gitlab: { clientId: "" },
        },
      },
    });
    expect(putSys.status()).toBe(200);

    // 组织视角（浏览器=项目用户）：integrations 页 scm-apps-block 显示「继承系统级」
    await navFromHome(page, "服务集成");
    await expect(page.getByTestId("scm-apps-block")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("scm-apps-block")).toContainText("继承系统级");

    // 越域：新注册用户（替换 request 登录态）访问他人项目 → 404 防枚举
    const otherEmail = `e2e-scm-other-${Date.now()}@rabbit.test`;
    await request.post("/api/v1/auth/register", {
      data: { email: otherEmail, password: USER_PASS },
    });
    await request.post("/api/v1/auth/login", {
      data: { email: otherEmail, password: USER_PASS },
    });
    const cross = await request.get(`/api/v1/projects/${projectId}/scm-repos`);
    expect(cross.status()).toBe(404);
    const crossWrite = await request.post(`/api/v1/projects/${projectId}/scm-repos`, {
      data: {
        source: "url",
        provider: "gitea",
        repoUrl: `${MOCK_BASE}/qa/x.git`,
        authType: "none",
      },
    });
    expect(crossWrite.status()).toBe(404);

    // 清场（系统级回未配置，防常驻库污染后续断言）
    await request.post("/api/v1/auth/login", {
      data: { email: ADMIN_EMAIL, password: ADMIN_PASS },
    });
    await request.put("/api/v1/system/params/scm", {
      data: {
        group: "scm",
        value: { github: { clientId: "" }, gitee: { clientId: "" }, gitlab: { clientId: "" } },
      },
    });
    await expectNoConsoleErrors([hydrateRace]);
  });
});
