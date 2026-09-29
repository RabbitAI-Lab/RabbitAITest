import { test, expect } from "./fixtures";
import { E2E_BASE } from "./env";

/**
 * SYS-009 OAuth Token 通道 e2e（规格 §5：T3 device flow 全链/scope 越权/吊销/坏码）。
 * CLI 侧以隔离 APIRequestContext 模拟（不带 session cookie——Bearer 通道纯净验证）；
 * 浏览器侧覆盖 /oauth/device 确认页与 /personal/authorizations 授权会话页。
 * 三类断言：UI（确认页三态/会话表格）+ Console（expectNoConsoleErrors）+ 接口（轮询/交换/403/401 载荷）。
 */

const DEVICE_GRANT = ["urn", "ietf", "params", "oauth", "grant-type", "device_code"].join(":");

/** CLI 模拟器：发码 → （批准后）轮询交换。 */
async function cliDeviceLogin(
  ctx: import("@playwright/test").APIRequestContext,
  scope: string,
): Promise<{ deviceCode: string; userCode: string }> {
  const code = await ctx.post("/api/v1/oauth/device/code", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `client_id=rabbit-cli&scope=${scope}`,
  });
  expect(code.status()).toBe(200);
  const dc = (await code.json()) as { device_code: string; user_code: string; interval: number };
  expect(dc.device_code.startsWith("rdc_")).toBe(true);
  expect(dc.user_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  return { deviceCode: dc.device_code, userCode: dc.user_code };
}

async function cliPollToken(
  ctx: import("@playwright/test").APIRequestContext,
  deviceCode: string,
): Promise<{ access_token: string; refresh_token: string; scope: string }> {
  const res = await ctx.post("/api/v1/oauth/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `grant_type=${DEVICE_GRANT}&device_code=${deviceCode}&client_id=rabbit-cli`,
  });
  expect(res.status()).toBe(200);
  return (await res.json()) as { access_token: string; refresh_token: string; scope: string };
}

test("SYS-009-T1 device flow 全链：CLI 发码 → 浏览器批准 → 轮询交换 → Bearer → 旋转 → 重放吊销", async ({
  page,
  authedPage,
  playwright,
  expectNoConsoleErrors,
}) => {
  expect(authedPage.projectId).toBeTruthy();
  // CLI 侧（隔离上下文，无 cookie）
  const cli = await playwright.request.newContext({ baseURL: E2E_BASE });
  const { deviceCode, userCode } = await cliDeviceLogin(cli, "read,exec");

  // 批准前轮询 → authorization_pending（RFC 形状）
  const pending = await cli.post("/api/v1/oauth/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `grant_type=${DEVICE_GRANT}&device_code=${deviceCode}`,
  });
  expect(pending.status()).toBe(400);
  expect(((await pending.json()) as { error: string }).error).toBe("authorization_pending");

  // 浏览器批准页：?code= 预填 → 确认态（scope 徽标回显）→ 批准 → 结果态（UI 断言）
  await page.goto(`/oauth/device?code=${userCode}`);
  await expect(page.getByTestId("page-oauth-device")).toBeVisible();
  const codeInput = page.getByTestId("oauth-device-code-input");
  await expect(codeInput).toHaveValue(userCode);
  await page.getByTestId("oauth-device-verify-btn").click();
  const confirm = page.getByTestId("oauth-device-confirm");
  await expect(confirm).toBeVisible({ timeout: 10000 });
  await expect(confirm.getByText("rabbit-cli")).toBeVisible();
  await expect(confirm.getByText("read · 查看")).toBeVisible();
  await expect(confirm.getByText("exec · 执行")).toBeVisible();

  // 网络断言：approve 请求载荷与响应（接口断言；先挂监听再触发）
  const approveP = page.waitForResponse(
    (r) => r.url().includes("/api/v1/oauth/device/approve") && r.request().method() === "POST",
  );
  await page.getByTestId("oauth-device-approve-btn").click();
  const approveRes = await approveP;
  expect(approveRes.status()).toBe(200);
  expect(JSON.parse(approveRes.request().postData() ?? "{}")).toMatchObject({
    userCode,
    approve: true,
  });
  await expect(page.getByTestId("oauth-device-result")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("已批准")).toBeVisible();

  // CLI 轮询交换 → Bearer 调 me（接口断言）
  const tk = await cliPollToken(cli, deviceCode);
  expect(tk.access_token.startsWith("rat_")).toBe(true);
  expect(tk.scope).toBe("read,exec");
  const me = await cli.get("/api/v1/personal/me", {
    headers: { authorization: `Bearer ${tk.access_token}` },
  });
  expect(me.status()).toBe(200);

  // refresh 旋转 → 旧值重放 → invalid_grant 且新 access 全家吊销
  const rot = await cli.post("/api/v1/oauth/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `grant_type=refresh_token&refresh_token=${tk.refresh_token}`,
  });
  expect(rot.status()).toBe(200);
  const rotBody = (await rot.json()) as { access_token: string };
  expect(rotBody.access_token.startsWith("rat_")).toBe(true);
  const replay = await cli.post("/api/v1/oauth/token", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: `grant_type=refresh_token&refresh_token=${tk.refresh_token}`,
  });
  expect(replay.status()).toBe(400);
  expect(((await replay.json()) as { error: string }).error).toBe("invalid_grant");
  const dead = await cli.get("/api/v1/personal/me", {
    headers: { authorization: `Bearer ${rotBody.access_token}` },
  });
  expect(dead.status()).toBe(401);
  await cli.dispose();

  await expectNoConsoleErrors();
});

test("SYS-009-T2 scope 越权：read token 写→403 10003 / 读→200 / revoke 豁免", async ({
  page,
  authedPage,
  playwright,
  expectNoConsoleErrors,
}) => {
  const cli = await playwright.request.newContext({ baseURL: E2E_BASE });
  const { deviceCode, userCode } = await cliDeviceLogin(cli, "read");
  // 会话内批准（page 已登录）
  const approve = await page.request.post("/api/v1/oauth/device/approve", {
    data: { userCode, approve: true },
  });
  expect(approve.status()).toBe(200);
  const tk = await cliPollToken(cli, deviceCode);
  const bearer = { authorization: `Bearer ${tk.access_token}` };

  // read token：写操作 403（scope 缺 write——message 明示缺口）
  const write = await cli.post("/api/v1/personal/api-keys", {
    headers: bearer,
    data: { name: "e2e-scope" },
  });
  expect(write.status()).toBe(403);
  const wb = (await write.json()) as { code: number; message: string };
  expect(wb.code).toBe(10003);
  expect(wb.message).toContain("scope");

  // read token：读操作 200
  const read = await cli.get("/api/v1/personal/api-keys", { headers: bearer });
  expect(read.status()).toBe(200);

  // oauth/revoke 豁免 scope（read token 可登出）→ 吊销后 401
  const revoke = await cli.post("/api/v1/oauth/revoke", { headers: bearer, data: {} });
  expect(revoke.status()).toBe(200);
  expect(((await revoke.json()) as { data: { revoked: boolean } }).data.revoked).toBe(true);
  const after = await cli.get("/api/v1/personal/me", { headers: bearer });
  expect(after.status()).toBe(401);
  await cli.dispose();

  await expectNoConsoleErrors();
});

test("SYS-009-T3 授权会话页：列表回显 → 吊销 → CLI 立即 401", async ({
  page,
  authedPage,
  playwright,
  expectNoConsoleErrors,
}) => {
  const cli = await playwright.request.newContext({ baseURL: E2E_BASE });
  const { deviceCode, userCode } = await cliDeviceLogin(cli, "read,exec");
  const approve = await page.request.post("/api/v1/oauth/device/approve", {
    data: { userCode, approve: true },
  });
  expect(approve.status()).toBe(200);
  const tk = await cliPollToken(cli, deviceCode);

  // UI：授权会话页表格回显（设备/scope/状态）
  await page.goto("/personal/authorizations");
  const authzPage = page.getByTestId("page-personal-authorizations");
  await expect(authzPage).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "rabbit-cli" }).first();
  await expect(row).toBeVisible({ timeout: 10000 });
  await expect(row.getByText("read").first()).toBeVisible();
  await expect(row.getByText("exec").first()).toBeVisible();
  await expect(row.getByText("生效中")).toBeVisible();

  // 吊销 → CLI 立即 401（UI 状态翻转——锚定状态 Tag 避免与过期列文本双命中 + 接口断言）
  await row.getByTestId("authz-revoke-btn").click();
  await page.getByRole("button", { name: "确 定" }).click();
  await expect(row.locator("span.ant-tag").filter({ hasText: "已吊销" })).toBeVisible({
    timeout: 10000,
  });
  const dead = await cli.get("/api/v1/personal/me", {
    headers: { authorization: `Bearer ${tk.access_token}` },
  });
  expect(dead.status()).toBe(401);
  await cli.dispose();

  await expectNoConsoleErrors();
});

test("SYS-009-T4 确认页坏码：无效 user_code → 错误提示（可重输）", async ({
  page,
  authedPage,
  expectNoConsoleErrors,
}) => {
  expect(authedPage.projectId).toBeTruthy(); // 确认页需登录态（middleware 302 /login）
  await page.goto("/oauth/device");
  await expect(page.getByTestId("page-oauth-device")).toBeVisible();
  await page.getByTestId("oauth-device-code-input").fill("ZZZZ-ZZZZ");
  await page.getByTestId("oauth-device-verify-btn").click();
  await expect(page.getByTestId("oauth-device-error")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("oauth-device-error")).toContainText("无效");
  await expectNoConsoleErrors([
    {
      pageUrlPattern: "/oauth/device",
      textPattern: "422",
      reason: "T4 预期坏码 422（10030）——浏览器将失败资源加载记 console.error，属预期",
    },
  ]);
});
