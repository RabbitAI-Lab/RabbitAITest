/** S6 单测：凭据加密矩阵 + runner 基址守卫 + APIKEY 头解析/格式 + 平台状态映射。 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  encryptCredential,
  decryptCredential,
  integrationSecretConfigured,
  maskCredential,
} from "../credential-crypto";
import { assertRunnerBaseUrl } from "@/server/plugin-runner.client";
import { parseAuthHeader } from "../apikey.service";
import {
  PLATFORM_STATUS_DEFAULT_MAPPING,
  PLATFORM_META,
  pluginManifestSchema,
} from "@rabbit/shared";

const SECRET = "x".repeat(32);

describe("credential-crypto（INTG-001 §2）", () => {
  beforeEach(() => {
    process.env.RABBIT_INTEGRATION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.RABBIT_INTEGRATION_SECRET;
  });

  it("加密往返（不同平台密钥派生隔离）", () => {
    const enc1 = encryptCredential("jira", "secret-token-value");
    const enc2 = encryptCredential("zentao", "secret-token-value");
    expect(enc1).not.to.equal(enc2); // 平台间密文不同（HKDF info 派生）
    expect(decryptCredential("jira", enc1)).toBe("secret-token-value");
    expect(decryptCredential("zentao", enc2)).toBe("secret-token-value");
  });

  it("密文不含明文（base64 非直存）", () => {
    const enc = encryptCredential("jira", "very-secret-plaintext");
    expect(enc).not.toContain("very-secret");
  });

  it("篡改密文 → 解密失败（GCM 完整性）", () => {
    const enc = encryptCredential("jira", "abc");
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1]! ^= 0xff;
    expect(() => decryptCredential("jira", raw.toString("base64"))).toThrow();
  });

  it("跨平台密钥不可互解", () => {
    const enc = encryptCredential("jira", "value");
    expect(() => decryptCredential("tapd", enc)).toThrow();
  });

  it("env 未配置 → 保存面报 SECRET_MISSING", () => {
    delete process.env.RABBIT_INTEGRATION_SECRET;
    expect(integrationSecretConfigured()).toBe(false);
    expect(() => encryptCredential("jira", "v")).toThrow("INTEGRATION_SECRET_MISSING");
  });

  it("掩码不泄漏前段", () => {
    expect(maskCredential("abcdefghijklmnop")).toBe("••••••••••mnop");
    expect(maskCredential("ab")).toBe("****");
  });
});

describe("runner 基址守卫（PLUG-001 §4 SSRF 边界）", () => {
  it("loopback/私网放行", () => {
    expect(assertRunnerBaseUrl("http://127.0.0.1:4010").port).toBe("4010");
    expect(assertRunnerBaseUrl("http://localhost:4010").hostname).toBe("localhost");
    expect(assertRunnerBaseUrl("http://10.1.2.3:4010").hostname).toBe("10.1.2.3");
    expect(assertRunnerBaseUrl("http://192.168.1.5:4010").hostname).toBe("192.168.1.5");
    expect(assertRunnerBaseUrl("http://172.16.0.1:4010").hostname).toBe("172.16.0.1");
  });

  it("公网/非 http 拒绝", () => {
    expect(() => assertRunnerBaseUrl("http://8.8.8.8:4010")).toThrow();
    expect(() => assertRunnerBaseUrl("ftp://127.0.0.1:4010")).toThrow();
    expect(() => assertRunnerBaseUrl("not-a-url")).toThrow();
  });
});

describe("APIKEY 头解析（INTG-003 §2）", () => {
  it("Basic 通道", () => {
    const header = `Basic ${Buffer.from("rakABC123:sk_secret").toString("base64")}`;
    expect(parseAuthHeader(header)).toEqual({ accessKey: "rakABC123", secretKey: "sk_secret" });
  });

  it("Bearer 通道（ak.sk 点分隔）", () => {
    expect(parseAuthHeader("Bearer rakABC.skXYZ")).toEqual({
      accessKey: "rakABC",
      secretKey: "skXYZ",
    });
  });

  it("非法形态 → null", () => {
    expect(parseAuthHeader(null)).toBeNull();
    expect(parseAuthHeader("Token abc")).toBeNull();
    expect(parseAuthHeader("Basic !!!not-base64!!!")).toBeNull();
    expect(parseAuthHeader("Basic " + Buffer.from("no-colon").toString("base64"))).toBeNull();
    expect(parseAuthHeader("Bearer nokdot")).toBeNull();
  });
});

describe("插件清单与平台元数据（PLUG-001/INTG-002）", () => {
  it("manifest 校验矩阵", () => {
    const valid = {
      name: "jira-platform",
      kind: "platform",
      version: "1.0.0",
      spiVersion: "1.0",
      entry: "index.js",
    };
    expect(pluginManifestSchema.safeParse(valid).success).toBe(true);
    expect(pluginManifestSchema.safeParse({ ...valid, name: "Bad_Name" }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ ...valid, kind: "other" }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ ...valid, version: "1.0" }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ ...valid, spiVersion: "1" }).success).toBe(false);
    expect(pluginManifestSchema.safeParse({ ...valid, entry: "" }).success).toBe(false);
  });

  it("三平台元数据完整（projectKeyLabel/authFields）", () => {
    for (const p of ["jira", "zentao", "tapd"] as const) {
      expect(PLATFORM_META[p].projectKeyLabel.length).toBeGreaterThan(0);
      expect(PLATFORM_META[p].authFields.length).toBeGreaterThan(0);
    }
    // 禅道/TAPD 固定 BASIC（无 token 字段）
    expect(PLATFORM_META.zentao.authTypeFixed).toBe("BASIC");
    expect(PLATFORM_META.tapd.authTypeFixed).toBe("BASIC");
    expect(PLATFORM_META.jira.authTypeFixed).toBeUndefined();
  });

  it("平台状态默认映射覆盖终态（done/resolved/closed 家族）", () => {
    expect(PLATFORM_STATUS_DEFAULT_MAPPING.jira.done).toBe("已解决");
    expect(PLATFORM_STATUS_DEFAULT_MAPPING.jira.closed).toBe("已关闭");
    expect(PLATFORM_STATUS_DEFAULT_MAPPING.zentao.resolved).toBe("已解决");
    expect(PLATFORM_STATUS_DEFAULT_MAPPING.tapd.rejected).toBe("已关闭");
  });
});
