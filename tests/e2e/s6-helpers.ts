import {
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Playwright,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

/** S6 e2e 公共：管理员独立 API context（不覆盖浏览器 cookie——避免项目上下文丢失）+ 插件上传。 */

export const E2E_BASE = process.env.E2E_BASE_URL ?? "http://localhost:3100";

/** 浏览器会话注入管理员（仅系统页面 UI 用例） */
export async function loginSeedAdmin(
  request: APIRequestContext,
  context: BrowserContext,
): Promise<void> {
  const res = await request.post("/api/v1/auth/login", {
    data: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
  });
  expect(res.status()).toBe(200);
  const ras = (res.headers()["set-cookie"] ?? "").split("ras=")[1]?.split(";")[0];
  expect(ras, "登录响应应下发 ras 会话 cookie").toBeTruthy();
  await context.addCookies([{ name: "ras", value: ras!, url: E2E_BASE }]);
}

/** 管理员独立 API context（与浏览器/用户会话完全隔离；用后须 dispose） */
export async function newAdminContext(playwright: Playwright): Promise<APIRequestContext> {
  const ctx = await playwright.request.newContext({ baseURL: E2E_BASE });
  const res = await ctx.post("/api/v1/auth/login", {
    data: { email: "admin@rabbit.test", password: "rabbit-admin-123" },
  });
  expect(res.status()).toBe(200);
  return ctx;
}

/** 允许上传的插件包白名单（构建产物目录固定四个；防路径穿越——basename 严格匹配） */
const PLUGIN_TGZ_WHITELIST = new Set([
  "jira-platform-1.0.2.tgz",
  "zentao-platform-1.0.1.tgz",
  "tapd-platform-1.0.1.tgz",
  "tcp-conn-1.0.1.tgz",
]);

/** 白名单内读插件包 base64（防路径穿越：basename 严格匹配 + 根边界校验） */
export function readPluginB64(tgzName: string): string {
  expect(PLUGIN_TGZ_WHITELIST.has(tgzName), "插件包名必须在白名单内").toBe(true);
  const distRoot = path.resolve(process.cwd(), "plugins", "dist");
  const tgzPath = path.resolve(distRoot, tgzName);
  expect(tgzPath.startsWith(distRoot + path.sep), "路径不得越出 dist 根").toBe(true);
  return readFileSync(tgzPath).toString("base64");
}

/** 上传插件 tarball（JSON base64 形态；201 或 409（已存在幂等））。返回插件 id。 */
export async function uploadPlugin(request: APIRequestContext, tgzName: string): Promise<string> {
  const b64 = readPluginB64(tgzName);
  const res = await request.post("/api/v1/system/plugins", {
    data: { filename: tgzName, contentBase64: b64, orgScope: "ALL" },
  });
  expect([201, 409], `上传 ${tgzName} 应 201/409（幂等）`).toContain(res.status());
  if (res.status() === 201) {
    const body = (await res.json()) as {
      code: number;
      data: { id: string; manifest: { name: string } };
    };
    expect(body.code).toBe(0);
    expect(body.data.manifest.name).toBe(tgzName.replace(/-\d+\.\d+\.\d+\.tgz$/, ""));
    return body.data.id;
  }
  // 409：按名回查
  const list = await request.get("/api/v1/system/plugins");
  const lb = (await list.json()) as { data: { list: Array<{ id: string; name: string }> } };
  const found = lb.data.list.find((p) => p.name === tgzName.replace(/-\d+\.\d+\.\d+\.tgz$/, ""));
  expect(found, "409 后列表应含既有插件").toBeTruthy();
  return found!.id;
}

/** 启用插件（幂等；失败消息带响应体便于定位 runner 状态） */
export async function enablePlugin(request: APIRequestContext, id: string): Promise<void> {
  const res = await request.put(`/api/v1/system/plugins/${id}`, { data: { enabled: true } });
  expect(
    res.status(),
    `启用插件应 200（实际 ${res.status()}：${(await res.text()).slice(0, 200)}）`,
  ).toBe(200);
  const body = (await res.json()) as { code: number; data: { ok: boolean } };
  expect(body.code).toBe(0);
  expect(body.data.ok).toBe(true);
}

/** e2e mock 三平台基址（:4001 与 MOCK_BASE 同进程——platform-mocks 与规则 mock 同端口） */
export const PLATFORM_MOCK_BASE = process.env.E2E_MOCK_URL_BASE ?? "http://127.0.0.1:4001";
