#!/usr/bin/env node
/**
 * ENTP-007 License 签发工具（开发/测试用；生产换 LICENSE_SIGNING_SECRET 后以同算法签发）。
 * 用法：
 *   node scripts/gen-license.mjs                                   # 默认一年有效期·全部六特性
 *   node scripts/gen-license.mjs --expires 2030-01-01 --features MULTI_ORG,SSO --max-users 500 --lic RAB-2026-ENT-0001
 */
import { createHmac, randomUUID } from "node:crypto";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = args[i + 1];
  return v && !v.startsWith("--") ? v : true;
}

const secret = process.env.LICENSE_SIGNING_SECRET ?? "rabbit-dev-license-secret";
const ALL = ["MULTI_ORG", "SSO", "MULTI_POOL", "THEME", "MSG_TEMPLATE", "USER_SCALE"];

const lic = String(
  arg("lic", `RAB-${new Date().getFullYear()}-ENT-${randomUUID().slice(0, 8).toUpperCase()}`),
);
const expiresArg = arg("expires", null);
const expiresAt = expiresArg
  ? new Date(expiresArg).toISOString()
  : new Date(Date.now() + 365 * 86_400_000).toISOString();
const issuedAt = new Date().toISOString();
const featuresArg = arg("features", null);
const features = featuresArg
  ? String(featuresArg)
      .split(",")
      .map((s) => s.trim())
  : undefined;
const maxUsersArg = arg("max-users", null);
const maxUsers = maxUsersArg ? Number(maxUsersArg) : undefined;

const payload = {
  lic,
  edition: "ENTERPRISE",
  issuedAt,
  expiresAt,
  ...(features ? { features } : {}),
  ...(maxUsers ? { maxUsers } : {}),
};
const seg = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(seg).digest("base64url");

console.log(`RABBIT-ENT1.${seg}.${sig}`);
console.error(`-- payload: ${JSON.stringify(payload)}`);
