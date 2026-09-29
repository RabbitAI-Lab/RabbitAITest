/**
 * S9 ENTP e2e 公共助手：
 * - loginSeedAdmin：种子管理员登录（系统级页面）
 * - issueDevLicense：与 web 同密钥（默认开发密钥）签发 License——e2e 栈未设 LICENSE_SIGNING_SECRET
 * - withLicense / cleanupEntp：License 加删（跨文件并行 workers=4 → 用后即删，缩小全局态窗口）
 * - MOCK_URL：mock IdP 基址（global-setup 起 mock，随 worktree 槽位；env.ts 单一来源）
 */
import { createHmac } from "node:crypto";
import { expect, type APIRequestContext, type BrowserContext } from "@playwright/test";
import { E2E_BASE, MOCK_BASE } from "./env";

export const MOCK_URL = MOCK_BASE;

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

/** 与 license.service 同算法签发（开发密钥缺省；e2e 栈未覆盖 env）。 */
export function issueDevLicense(
  over: { expiresAt?: string; features?: string[]; maxUsers?: number } = {},
): string {
  const secret = process.env.LICENSE_SIGNING_SECRET ?? "rabbit-dev-license-secret";
  const payload = {
    lic: `RAB-E2E-${Date.now().toString(36).toUpperCase()}`,
    edition: "ENTERPRISE",
    issuedAt: new Date().toISOString(),
    expiresAt: over.expiresAt ?? new Date(Date.now() + 365 * 86_400_000).toISOString(),
    ...(over.features ? { features: over.features } : {}),
    ...(over.maxUsers ? { maxUsers: over.maxUsers } : {}),
  };
  const seg = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(seg).digest("base64url");
  return `RABBIT-ENT1.${seg}.${sig}`;
}

export async function addLicense(request: APIRequestContext, code?: string): Promise<void> {
  const res = await request.post("/api/v1/system/license", {
    data: { code: code ?? issueDevLicense() },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { code: number; data: { edition: string } };
  expect(body.code).toBe(0);
  expect(body.data.edition).toBe("ENTERPRISE");
}

export async function removeLicense(request: APIRequestContext): Promise<void> {
  await request.delete("/api/v1/system/license").catch(() => undefined);
}

export async function publicLicenseEdition(
  request: APIRequestContext,
): Promise<"COMMUNITY" | "ENTERPRISE"> {
  const res = await request.get("/api/v1/public/license-status");
  const body = (await res.json()) as { data: { edition: "COMMUNITY" | "ENTERPRISE" } };
  return body.data.edition;
}

/** 恢复主题默认（ENTP-004 用后即还，防并行文件视觉污染）。 */
export const THEME_DEFAULTS = {
  primaryColor: "#574BFF",
  followPrimary: true,
  siteName: "RabbitAITest",
  slogan: "",
  loginLogo: "",
  loginBg: "",
  icon: "",
  platformName: "RabbitAITest",
  platformLogo: "",
  helpUrl: "",
};

export async function resetTheme(request: APIRequestContext): Promise<void> {
  await request
    .put("/api/v1/system/params/theme", { data: { group: "theme", value: THEME_DEFAULTS } })
    .catch(() => undefined);
}

/** 开局清扫：认证源/非默认池残留（失败用例可能遗留——全局态实体跨用例防污染）。 */
export async function sweepSsoSources(request: APIRequestContext): Promise<void> {
  const res = await request.get("/api/v1/system/sso");
  if (!res.ok()) return;
  const items = ((await res.json()) as { data?: { items?: { id: string }[] } }).data?.items ?? [];
  for (const it of items)
    await request.delete(`/api/v1/system/sso/${it.id}`).catch(() => undefined);
}

export async function sweepPools(
  request: APIRequestContext,
  defaultPoolId = "00000000-0000-0000-0000-000000000001",
): Promise<void> {
  const res = await request.get("/api/v1/system/pools");
  if (!res.ok()) return;
  const items =
    ((await res.json()) as { data?: { items?: { id: string; isDefault: boolean }[] } }).data
      ?.items ?? [];
  for (const it of items) {
    if (!it.isDefault && it.id !== defaultPoolId)
      await request.delete(`/api/v1/system/pools/${it.id}`).catch(() => undefined);
  }
}
