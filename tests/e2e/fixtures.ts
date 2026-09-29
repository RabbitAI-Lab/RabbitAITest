import { test as base, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

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
      await context.addCookies([
        { name: "ras", value: ras, url: process.env.E2E_BASE_URL ?? "http://localhost:3100" },
      ]);
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
        errors.push(`[http ${res.status()}] ${res.request().method()} ${res.url()} @ ${page.url()}`);
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
 */
export async function navFromHome(
  page: import("@playwright/test").Page,
  linkName: string,
): Promise<void> {
  await page.goto("/");
  // 限定左侧导航作用域：避免与工作台快捷卡等同名链接冲突（strict mode）
  await page.getByTestId("leftnav").getByRole("link", { name: linkName }).click();
}
