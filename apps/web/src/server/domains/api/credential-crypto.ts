/**
 * 三方平台凭据加密（INTG-001 §2）：AES-256-GCM；密钥从 env RABBIT_INTEGRATION_SECRET（32B）
 * 经 HKDF 按平台派生。密文形态 base64(iv|tag|cipher)。测试与种子只从 env 读（源码零字面量凭据）。
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const SECRET_ENV = "RABBIT_INTEGRATION_SECRET";

export function integrationSecretConfigured(): boolean {
  return Boolean(process.env[SECRET_ENV] && process.env[SECRET_ENV]!.length >= 32);
}

function deriveKey(platform: string): Buffer {
  const secret = Buffer.from(process.env[SECRET_ENV]!, "utf8");
  // HKDF-SHA256 → 32B 派生密钥（info=平台名，平台间密钥隔离）
  return Buffer.from(hkdfSync("sha256", secret, Buffer.from("rabbit-integration"), Buffer.from(platform), 32));
}

export function encryptCredential(platform: string, plaintext: string): string {
  if (!integrationSecretConfigured()) {
    throw new Error("INTEGRATION_SECRET_MISSING");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(platform), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptCredential(platform: string, payload: string): string {
  if (!integrationSecretConfigured()) {
    throw new Error("INTEGRATION_SECRET_MISSING");
  }
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(platform), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/** GET 视图永不回显明文（INTG-001 §1.2）：仅是否有凭据 + 掩码 */
export function maskCredential(plaintext: string): string {
  if (plaintext.length <= 4) return "****";
  return `${"•".repeat(Math.min(10, plaintext.length - 4))}${plaintext.slice(-4)}`;
}
