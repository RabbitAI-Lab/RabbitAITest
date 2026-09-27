import { test, expect } from "./fixtures";
import { loginSeedAdmin, uploadPlugin, readPluginB64, newAdminContext } from "./s6-helpers";

/**
 * PLUG-001 插件框架 e2e（规格 §5：T2 生命周期 / T3 组织范围+越权）。
 * 三类断言：UI（页面元素/开关/行）+ Console（无错误）+ 接口（信封/业务码/负载）。
 */

test("PLUG-001-T2 管理员上传→列表→启用→停用→删除全生命周期", async ({
  page,
  context,
  request,
  expectNoConsoleErrors,
}) => {
  await loginSeedAdmin(request, context);

  // 接口前置：上传 tcp-conn（201/409 幂等）——同时为 PLUG-002 留库
  const pluginId = await uploadPlugin(request, "tcp-conn-1.0.1.tgz");

  // UI：管理页可见插件行 + 启停开关
  await page.goto("/system/plugins");
  const row = page.getByRole("row").filter({ hasText: "tcp-conn" });
  await expect(row).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("page-system-plugins")).toBeVisible();

  // 启用（UI 开关）→ runner 热加载（接口断言 runtimeStatus）
  await row.getByTestId("plugin-toggle-tcp-conn").click();
  await expect(
    page.getByRole("row").filter({ hasText: "tcp-conn" }).getByText("运行中"),
  ).toBeVisible({ timeout: 20000 });
  const list1 = await request.get("/api/v1/system/plugins");
  const lb1 = (await list1.json()) as {
    code: number;
    data: { list: Array<{ name: string; enabled: boolean; runtimeStatus: string }> };
  };
  expect(lb1.code).toBe(0);
  const p1 = lb1.data.list.find((p) => p.name === "tcp-conn");
  expect(p1?.enabled).toBe(true);
  expect(p1?.runtimeStatus).toBe("RUNNING");

  // 停用（UI）→ 状态回收
  await page.getByRole("row").filter({ hasText: "tcp-conn" }).getByTestId("plugin-toggle-tcp-conn").click();
  await expect(
    page.getByRole("row").filter({ hasText: "tcp-conn" }).getByText("已停用"),
  ).toBeVisible({ timeout: 20000 });

  // 删除（接口）→ 列表不含
  const del = await request.delete(`/api/v1/system/plugins/${pluginId}`);
  expect(del.status()).toBe(200);
  const list2 = await request.get("/api/v1/system/plugins");
  const lb2 = (await list2.json()) as { data: { list: Array<{ name: string }> } };
  expect(lb2.data.list.some((p) => p.name === "tcp-conn")).toBe(false);

  await expectNoConsoleErrors();
});

test("PLUG-001-T3 越权两态：普通用户无菜单/403；未登录 401", async ({
  authedPage,
  page,
  request,
}) => {
  const { projectId } = authedPage;
  expect(projectId).toBeTruthy();

  // 注册用户（项目 owner）无系统权限：插件列表 API 403 code=10003
  const res = await request.get("/api/v1/system/plugins");
  expect(res.status()).toBe(403);
  const body = (await res.json()) as { code: number; message: string };
  expect(body.code).toBe(10003);
  expect(body.message).toContain("权限");

  // UI：左侧导航不出现「插件管理」（权限点过滤）
  await page.goto("/");
  await expect(page.getByTestId("leftnav")).toBeVisible();
  await expect(page.getByTestId("leftnav").getByRole("link", { name: "插件管理" })).toHaveCount(0);

  // 未登录（新 context 思路：直接 API 无 cookie 由 request fixture 之外验证——用 page.evaluate fetch）
  const code401 = await page.evaluate(async () => {
    const r = await fetch("/api/v1/system/plugins", { credentials: "omit" });
    return r.status;
  });
  expect(code401).toBe(401);
});

test("PLUG-001-T4 上传负路径：同名同版本 409 70005（版本递增规则）", async ({
  playwright,
}) => {
  const admin = await newAdminContext(playwright);
  // jira-platform 由 INTG-001 用例上传（字母序 PLUG 在 INTG 后跑；若未上传则先上传）
  await uploadPlugin(admin, "jira-platform-1.0.2.tgz");
  // 再次上传同版本 → 409
  const dup = await admin.post("/api/v1/system/plugins", {
    data: { filename: "jira-platform-1.0.2.tgz", contentBase64: readPluginB64("jira-platform-1.0.2.tgz"), orgScope: "ALL" },
  });
  expect(dup.status()).toBe(409);
  const body = (await dup.json()) as { code: number; message: string };
  expect(body.code).toBe(70005);
  expect(body.message).toContain("版本");
});
