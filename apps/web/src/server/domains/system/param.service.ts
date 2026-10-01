/** SYS-005：系统参数（基础/SMTP/文件/数据清理）——站点 URL、SMTP 测试连接、附件上限、保留时长。 */
import { createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { DomainError, ErrCode, config } from "@rabbit/shared";
import { prisma } from "@rabbit/db";
import type { Prisma } from "@rabbit/db";

const toJson = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v ?? {})) as Prisma.InputJsonValue;

const DEFAULTS = {
  base: { siteUrl: "http://localhost:3000", loginBanner: "" },
  smtp: { host: "", port: 465, user: "", pass: "", ssl: true, from: "" },
  file: { maxSizeMb: 50 },
  cleanup: {
    logRetentionDays: 90,
    changeLogRetentionDays: 90,
    lastRunAt: null as string | null,
    lastRunCount: 0,
  },
  /** S9 ENTP-004 界面设置（默认=现状视觉；图片字段空串=用默认） */
  theme: {
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
  },
  /** S13 SCM-001 系统级代码平台 OAuth 应用（clientSecret 存 enc: 密文；GET 视图转 hasSecret） */
  scm: {
    github: { clientId: "", clientSecret: "", baseUrl: "", enabled: false },
    gitee: { clientId: "", clientSecret: "", baseUrl: "", enabled: false },
    gitlab: { clientId: "", clientSecret: "", baseUrl: "https://gitlab.com", enabled: false },
  },
} as const;

/** SMTP 密码 AES-256-GCM 加密（rules/security：密钥不出现在源码/日志）。 */
function paramKey(): Buffer {
  return createHash("sha256").update(`${config.sessionSecret}:param`).digest();
}

function encryptSecret(plain: string): string {
  const iv = createHash("md5").update(`iv:${plain.length}:${Date.now()}`).digest().subarray(0, 12);
  const cipher = createCipheriv("aes-256-gcm", paramKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function decryptSecret(stored: string): string | null {
  if (!stored.startsWith("enc:")) return null;
  try {
    const parts = stored.split(":");
    const ivB64 = parts[1] ?? "";
    const tagB64 = parts[2] ?? "";
    const dataB64 = parts[3] ?? "";
    const decipher = createDecipheriv("aes-256-gcm", paramKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

export async function readParam<K extends keyof typeof DEFAULTS>(
  group: K,
): Promise<Record<string, unknown>> {
  const row = await prisma.systemParam.findUnique({ where: { key: group } });
  const value = (row?.value ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = {
    ...(DEFAULTS[group] as Record<string, unknown>),
    ...value,
  };
  if (group === "smtp" && typeof merged.pass === "string" && merged.pass) {
    merged.pass = decryptSecret(merged.pass) ?? "******"; // 无法解密则视为已脱敏
  }
  return merged;
}

/** 全量读取（SMTP 密码脱敏为 ******；SCM clientSecret 转 hasSecret 布尔）。 */
export async function getParams() {
  const [base, smtp, file, cleanup, theme, scm] = await Promise.all([
    readParam("base"),
    readParam("smtp"),
    readParam("file"),
    readParam("cleanup"),
    readParam("theme"),
    readParam("scm"),
  ]);
  return {
    base,
    smtp: { ...smtp, pass: smtp.pass ? "******" : "" },
    file,
    cleanup,
    theme,
    scm: scmParamsView(scm),
  };
}

/** SCM-001：存储视图（clientSecret=enc: 密文或空）→ 回显视图（hasSecret 布尔，永不回显明文/密文）。 */
function scmParamsView(scm: Record<string, unknown>) {
  const out: Record<
    string,
    { clientId: string; hasSecret: boolean; baseUrl: string; enabled: boolean }
  > = {};
  for (const p of ["github", "gitee", "gitlab"] as const) {
    const v = (scm[p] ?? {}) as Record<string, unknown>;
    out[p] = {
      clientId: String(v.clientId ?? ""),
      hasSecret: typeof v.clientSecret === "string" && v.clientSecret.startsWith("enc:"),
      baseUrl: String(v.baseUrl ?? ""),
      enabled: v.enabled === true,
    };
  }
  return out;
}

export async function updateParam(
  group: "basic" | "smtp" | "file" | "cleanup" | "theme" | "scm",
  value: Record<string, unknown>,
): Promise<void> {
  let stored: Record<string, unknown> = { ...value };
  if (group === "smtp") {
    // 密码为 ****** 表示未修改，保留原值
    const prev = await readParam("smtp");
    const prevRow = await prisma.systemParam.findUnique({ where: { key: "smtp" } });
    const prevRawPass = ((prevRow?.value ?? {}) as Record<string, unknown>).pass;
    const pass = value.pass;
    if (pass === "******" || pass === "") {
      stored.pass = prevRawPass ?? "";
    } else {
      stored.pass = encryptSecret(String(pass));
    }
    void prev;
  }
  if (group === "scm") {
    // SCM-001：三平台逐个处理——clientId 空=整组重置（清 secret）；
    // clientSecret 空/******=保留原密文；否则 enc: 加密（沿 SMTP pass 语义）
    const prevRow = await prisma.systemParam.findUnique({ where: { key: "scm" } });
    const prevRaw = ((prevRow?.value ?? {}) as Record<string, unknown>) ?? {};
    stored = {};
    for (const p of ["github", "gitee", "gitlab"] as const) {
      const v = (value[p] ?? {}) as Record<string, unknown>;
      const prevV = (prevRaw[p] ?? {}) as Record<string, unknown>;
      const clientId = String(v.clientId ?? "");
      const secretInput = v.clientSecret;
      const prevSecret = typeof prevV.clientSecret === "string" ? prevV.clientSecret : "";
      if (!clientId) {
        stored[p] = {
          clientId: "",
          clientSecret: "",
          baseUrl: p === "gitlab" ? "https://gitlab.com" : "",
          enabled: false,
        };
        continue;
      }
      const secret =
        secretInput && secretInput !== "******" ? encryptSecret(String(secretInput)) : prevSecret;
      stored[p] = {
        clientId,
        clientSecret: secret,
        baseUrl: String(v.baseUrl ?? "") || (p === "gitlab" ? "https://gitlab.com" : ""),
        enabled: v.enabled === true,
      };
    }
  }
  if (group === "cleanup") {
    const days = Number(value.logRetentionDays);
    const changeDays = Number(value.changeLogRetentionDays);
    if (!(days >= 7) || !(changeDays >= 7)) {
      throw new DomainError(ErrCode.VALIDATION_FAILED, "保留天数下限为 7 天（防误配全清）");
    }
    // 保留上次运行信息
    const prev = await readParam("cleanup");
    stored = { ...value, lastRunAt: prev.lastRunAt, lastRunCount: prev.lastRunCount };
  }
  if (group === "theme") {
    // ENTP-004：dataUrl 图片二进制上限 200KB（base64 解码后计）
    for (const key of ["loginLogo", "loginBg", "icon", "platformLogo"] as const) {
      const v = String(stored[key] ?? "");
      if (v.startsWith("data:")) {
        const b64 = v.slice(v.indexOf(",") + 1);
        const bytes = Math.floor((b64.length * 3) / 4);
        if (bytes > 200 * 1024)
          throw new DomainError(ErrCode.THEME_IMAGE_TOO_LARGE, "图片不能超过 200KB");
      }
    }
  }
  await prisma.systemParam.upsert({
    where: { key: group === "basic" ? "base" : group },
    update: { value: toJson(stored) },
    create: { key: group === "basic" ? "base" : group, value: toJson(stored) },
  });
}

/** SMTP 测试连接：nodemailer verify()，结果与错误明细回显（不落历史）。 */
export async function testSmtp(input: {
  host: string;
  port: number;
  user: string;
  pass: string;
  ssl: boolean;
  from: string;
}) {
  const { createTransport } = await import("nodemailer");
  const pass = input.pass === "******" ? String((await readParam("smtp")).pass ?? "") : input.pass;
  const transport = createTransport({
    host: input.host,
    port: input.port,
    secure: input.ssl,
    auth: input.user ? { user: input.user, pass } : undefined,
    connectionTimeout: 8000,
  });
  try {
    await transport.verify();
    return { ok: true, message: "连接成功" };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    transport.close();
  }
}

/** 附件大小上限（MB）——BUG-001 等上传统一读取。 */
export async function fileMaxSizeMb(): Promise<number> {
  const file = await readParam("file");
  return Number(file.maxSizeMb) || 50;
}

export async function siteUrl(): Promise<string> {
  const base = await readParam("base");
  return String(base.siteUrl || "http://localhost:3000");
}

export { encryptSecret, decryptSecret };

/** 登录页横幅（公开端点消费，P-1；无敏感信息）。 */
export async function publicLoginBanner(): Promise<string> {
  const base = await readParam("base");
  return String(base.loginBanner ?? "");
}

/** 公开主题（ENTP-004：登录页/控制台品牌消费；未配置=默认值）。 */
export async function publicTheme(): Promise<Record<string, unknown>> {
  return readParam("theme");
}
