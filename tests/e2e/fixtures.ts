import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { E2E_BASE } from "./env";

/**
 * rules/testing.md §3.1 三类断言公共夹具：
 * - expectNoConsoleErrors：全程 console.error / pageerror 收集（白名单显式登记）
 * - expectApi：关键链路网络断言（状态码 + 响应体 code/data + 请求负载可校验）
 * - authedPage：API 注册 + 会话 cookie 注入 + 默认项目上下文
 */

export interface ConsoleNoise {
  pageUrlPattern: string;
  textPattern: string;
  reason: string;
}

export const test = base.extend<{
  /** page 重载：每条 UI 用例结束自动整页截屏（rules/testing §3.6；fixture teardown 时机稳定生效） */
  page: import("@playwright/test").Page;
  authedPage: { email: string; password: string; projectId: string };
  expectNoConsoleErrors: (whitelist?: ConsoleNoise[]) => Promise<void>;
  expectApi: (
    urlGlob: string,
    method?: string,
  ) => Promise<{ status: number; code: number; data: unknown; body: unknown }>;
}>({
  page: async ({ page: basePage }, use, testInfo) => {
    await use(basePage);
    try {
      if (!testInfo.titlePath.some((t) => String(t).includes("SYS-002-01"))) {
        const dir = path.join(process.cwd(), "test-results", "screenshots");
        mkdirSync(dir, { recursive: true });
        const name = testInfo.titlePath
          .slice(1)
          .join("-")
          .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
          .slice(0, 120);
        await basePage.screenshot({ path: path.join(dir, `${name}.png`), fullPage: true });
      }
    } catch {
      /* 页面已关闭等场景忽略 */
    }
  },
  authedPage: async ({ request, context }, use) => {
    const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e6)}@rabbit.test`;
    const password = process.env.E2E_USER_PASSWORD ?? "rabbit-pass-123";
    const res = await request.post("/api/v1/auth/register", { data: { email, password } });
    expect(res.status()).toBe(201);
    const body = (await res.json()) as { code: number; data: { projectId: string } };
    expect(body.code).toBe(0);
    // 会话 cookie 注入浏览器上下文
    const cookieHeader = res.headers()["set-cookie"] ?? "";
    const ras = cookieHeader.split("ras=")[1]?.split(";")[0];
    if (ras) {
      await context.addCookies([{ name: "ras", value: ras, url: E2E_BASE }]);
    }
    await use({ email, password, projectId: body.data.projectId });
  },
  expectNoConsoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`[console.error] ${page.url()} ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[pageerror] ${page.url()} ${err.message}`));
    // 页面上下文 4xx/5xx 一并留痕（含资源 URL——console.error 不带 URL，排障盲区）
    page.on("response", (res) => {
      if (res.status() >= 400 && ["xhr", "fetch"].includes(res.request().resourceType())) {
        errors.push(
          `[http ${res.status()}] ${res.request().method()} ${res.url()} @ ${page.url()}`,
        );
      }
    });
    await use(async (whitelist: ConsoleNoise[] = []) => {
      const filtered = errors.filter(
        (e) =>
          !whitelist.some(
            (w) => new RegExp(w.textPattern).test(e) && new RegExp(w.pageUrlPattern).test(e),
          ),
      );
      expect(filtered, `页面存在 console 错误（未入白名单）：\n${filtered.join("\n")}`).toEqual([]);
    });
  },
  expectApi: async ({ page }, use) => {
    await use(async (urlGlob: string, method?: string) => {
      // waitForResponse 匹配本用例触发的接口（断言作用域化 rules/testing §3.5.1）。
      // method：集合 URL（同路径 GET 列表刷新与 POST 创建并存）必须钉住方法——8 workers 高压下
      // 模块树 GET 刷新曾抢先进队被误捕（200 冒充 201，CASE-002-01/MAINFLOW-s1 CI 实证）
      let res = await page.waitForResponse(urlGlob);
      while (method && res.request().method() !== method) {
        res = await page.waitForResponse(urlGlob);
      }
      const body = (await res.json().catch(() => ({}))) as { code?: number; data?: unknown };
      return { status: res.status(), code: body.code ?? -1, data: body.data ?? null, body };
    });
  },
});

export { expect };

/**
 * 用户路径导航（rules/testing §3.2.2）：从首页经左侧菜单进入功能页，录屏呈现真实入口。
 * SYS-010：菜单可能在折叠分组内——不可见时先展开全部折叠分组再点击。
 */
export async function navFromHome(
  page: import("@playwright/test").Page,
  linkName: string,
): Promise<void> {
  await page.goto("/");
  await ensureNavVisible(page, linkName);
  // 限定左侧导航作用域：避免与工作台快捷卡等同名链接冲突（strict mode）
  await page.getByTestId("leftnav").getByRole("link", { name: linkName }).click();
}

/** SYS-010：展开左侧栏全部折叠分组（分组头 aria-expanded=false）。
 *  逐个重新解析 locator 点击——.all() 快照在点击重渲染后失效（元素 detach）。 */
export async function expandNavGroups(page: import("@playwright/test").Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const head = page.getByTestId("leftnav").locator("button[aria-expanded=false]").first();
    if (!(await head.isVisible())) break;
    await head.click();
  }
}

/** SYS-010：确保左导航链接可见（折叠组内则先展开）。
 *  权限数据可能晚于侧栏挂载（CI 慢机：canGlobal 未就绪时组内项为空、整组不渲染，
 *  展开动作会扑空）——轮询「点一个折叠头→等一会」直至链接可见，waitFor 兜底。 */
export async function ensureNavVisible(
  page: import("@playwright/test").Page,
  linkName: string,
): Promise<void> {
  const link = page.getByTestId("leftnav").getByRole("link", { name: linkName });
  await page.getByTestId("leftnav").waitFor({ state: "visible" });
  for (let i = 0; i < 10 && !(await link.isVisible()); i++) {
    await page
      .getByTestId("leftnav")
      .locator("button[aria-expanded=false]")
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(400);
  }
  await link.waitFor({ state: "visible" });
}

/** SYS-010：testid 版菜单点击（折叠组内自动展开；域内菜单需先 enterRealm）。
 *  同 ensureNavVisible 的轮询展开（CI 慢机权限晚到时序）。 */
export async function navClick(
  page: import("@playwright/test").Page,
  testid: string,
): Promise<void> {
  const link = page.getByTestId(testid);
  await page.getByTestId("leftnav").waitFor({ state: "visible" });
  for (let i = 0; i < 10 && !(await link.isVisible()); i++) {
    await page
      .getByTestId("leftnav")
      .locator("button[aria-expanded=false]")
      .first()
      .click({ timeout: 2000 })
      .catch(() => {});
    await page.waitForTimeout(400);
  }
  await link.click();
}

/** SYS-010：经头像下拉进入组织/系统域（与侧栏三域隔离配套的真实用户路径）；已在目标域则幂等跳过。 */
export async function enterRealm(
  page: import("@playwright/test").Page,
  realm: "org" | "system",
): Promise<void> {
  const inRealm = new RegExp(realm === "org" ? "^/org" : "^/system").test(
    new URL(page.url()).pathname,
  );
  if (inRealm) return;
  await page.getByTestId("user-avatar").click();
  await page
    .getByTestId(realm === "org" ? "menu-org-management" : "menu-system-settings")
    .click();
  await page.waitForURL(realm === "org" ? /\/org\// : /\/system\//);
}
