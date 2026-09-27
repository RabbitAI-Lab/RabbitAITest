/** AI apiKey 加密（AI-001 §2）：AES-256-GCM，密钥自 SESSION_SECRET 派生（scrypt），不落库不进日志。 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

function deriveKey(): Buffer {
  return scryptSync(process.env.SESSION_SECRET ?? "dev-only-session-secret-32chars!!", "rabbit-ai-key", 32);
}

/** 密文格式 v1:base64(iv):base64(tag):base64(ct)；随机 iv 保证同明文不同密文 */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptSecret(enc: string): string {
  const [v, ivB64, tagB64, ctB64] = enc.split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("密文格式非法");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}
