/** S9 单测（shared）：特性目录 / 队列名路由 / License payload / 池 orgScope / theme schema / 模板变量与渲染。 */
import { describe, expect, it } from "vitest";
import {
  ENTP_FEATURES,
  ENTP_FEATURE_KEYS,
  execQueueNameFor,
  config,
  licensePayloadSchema,
  poolOrgScopeSchema,
  themeParamSchema,
  MESSAGE_EVENTS,
  TEMPLATE_VARS,
  TEMPLATE_COMMON_VARS,
  renderMessageTemplate,
  authSourceUpsertSchema,
  SCAN_PROVIDERS,
  buildScanAuthorizeUrl,
} from "../index";

describe("ENTP_FEATURES（六特性目录，ENTP-007）", () => {
  it("六特性与 rbac §6 枚举一致", () => {
    expect(ENTP_FEATURE_KEYS).toEqual([
      "MULTI_ORG",
      "SSO",
      "MULTI_POOL",
      "THEME",
      "MSG_TEMPLATE",
      "USER_SCALE",
    ]);
    expect(ENTP_FEATURES).toHaveLength(6);
  });
});

describe("execQueueNameFor（ENTP-006 按池队列路由）", () => {
  it("默认池/空 → exec（单引擎零回归）", () => {
    expect(execQueueNameFor(undefined)).toBe("exec");
    expect(execQueueNameFor(null)).toBe("exec");
    expect(execQueueNameFor(config.defaultPoolId)).toBe("exec");
  });
  it("非默认池 → exec-pool-{poolId} 隔离队列（BullMQ 禁冒号）", () => {
    expect(execQueueNameFor("11111111-2222-3333-4444-555555555555")).toBe(
      "exec-pool-11111111-2222-3333-4444-555555555555",
    );
  });
});

describe("licensePayloadSchema（ENTP-007）", () => {
  const base = {
    lic: "RAB-2026-ENT-0001",
    edition: "ENTERPRISE",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  it("合法（features/maxUsers 缺省）", () => {
    const r = licensePayloadSchema.parse(base);
    expect(r.features).toBeUndefined();
    expect(r.maxUsers).toBeUndefined();
  });
  it("edition 仅 ENTERPRISE", () => {
    expect(licensePayloadSchema.safeParse({ ...base, edition: "COMMUNITY" }).success).toBe(false);
  });
  it("features 限六特性子集", () => {
    expect(licensePayloadSchema.safeParse({ ...base, features: ["MULTI_ORG"] }).success).toBe(true);
    expect(licensePayloadSchema.safeParse({ ...base, features: ["NOPE"] }).success).toBe(false);
  });
});

describe("poolOrgScopeSchema（ENTP-006）", () => {
  it("ALL 或非空 uuid 数组", () => {
    expect(poolOrgScopeSchema.parse("ALL")).toBe("ALL");
    expect(poolOrgScopeSchema.parse(["11111111-1111-1111-1111-111111111111"])).toHaveLength(1);
    expect(poolOrgScopeSchema.safeParse([]).success).toBe(false);
    expect(poolOrgScopeSchema.safeParse("XX").success).toBe(false);
  });
});

describe("themeParamSchema（ENTP-004）", () => {
  it("默认值=现状视觉", () => {
    const r = themeParamSchema.parse({});
    expect(r.primaryColor).toBe("#574BFF");
    expect(r.siteName).toBe("RabbitAITest");
    expect(r.followPrimary).toBe(true);
  });
  it("色值 hex 强校验 + dataUrl 前缀 + 空串", () => {
    expect(themeParamSchema.safeParse({ primaryColor: "#ZZZZZZ" }).success).toBe(false);
    expect(themeParamSchema.safeParse({ loginLogo: "data:image/png;base64,AAAA" }).success).toBe(
      true,
    );
    expect(themeParamSchema.safeParse({ loginLogo: "https://x/y.png" }).success).toBe(false);
    expect(themeParamSchema.safeParse({ loginLogo: "" }).success).toBe(true);
  });
});

describe("TEMPLATE_VARS + renderMessageTemplate（ENTP-005）", () => {
  it("11 事件变量目录完备：公共三变量恒在", () => {
    expect(MESSAGE_EVENTS).toHaveLength(11);
    for (const e of MESSAGE_EVENTS) {
      const names = (TEMPLATE_VARS[e.key] ?? []).map((v) => v.name);
      for (const c of TEMPLATE_COMMON_VARS) expect(names).toContain(c.name);
    }
  });
  it("渲染：全插 / 部分缺 / 未知变量保留原样", () => {
    expect(
      renderMessageTemplate("[${project}] ${actorName}", { project: "P", actorName: "张三" }),
    ).toBe("[P] 张三");
    expect(renderMessageTemplate("${a}-${b}", { a: 1 })).toBe("1-${b}");
    expect(renderMessageTemplate("无变量", {})).toBe("无变量");
    expect(renderMessageTemplate("${n}", { n: null })).toBe("${n}");
  });
});

describe("authSourceUpsertSchema（ENTP-002 判别式）", () => {
  const oidc = {
    type: "OIDC",
    name: "k",
    enabled: true,
    config: {
      authEndpoint: "https://idp/a",
      tokenEndpoint: "https://idp/t",
      userinfoEndpoint: "https://idp/u",
      clientId: "c",
      clientSecret: "s",
    },
  };
  it("OIDC 合法（propMapping 缺省）", () => {
    expect(
      (authSourceUpsertSchema.parse(oidc).config as { propMapping: unknown }).propMapping,
    ).toEqual({
      username: "preferred_username",
      name: "name",
      email: "email",
    });
  });
  it("LDAP 缺 bindDn 拒绝", () => {
    expect(
      authSourceUpsertSchema.safeParse({
        type: "LDAP",
        name: "l",
        enabled: true,
        config: { host: "h", port: 389, bindPassword: "p", userOu: "ou" },
      }).success,
    ).toBe(false);
  });
});

describe("buildScanAuthorizeUrl（ENTP-003）", () => {
  const ctx = { authId: "a1", state: "st", redirectUri: "https://app/cb", config: {} };
  it("三平台 URL 形态", () => {
    expect(
      buildScanAuthorizeUrl("WECOM", { ...ctx, config: { corpId: "corp", agentId: "ag" } }),
    ).toContain("open.weixin.qq.com/connect/qrconnect?appid=corp&agentid=ag");
    expect(buildScanAuthorizeUrl("DINGTALK", { ...ctx, config: { clientId: "ci" } })).toContain(
      "login.dingtalk.com/oauth2/auth?redirect_uri=",
    );
    expect(buildScanAuthorizeUrl("DINGTALK", { ...ctx, config: { clientId: "ci" } })).toContain(
      "client_id=ci&scope=openid",
    );
    expect(buildScanAuthorizeUrl("FEISHU", { ...ctx, config: { appId: "ai" } })).toContain(
      "open.feishu.cn/open-apis/authen/v1/index?app_id=ai",
    );
  });
  it("SCAN_PROVIDERS 三平台", () => {
    expect(SCAN_PROVIDERS).toEqual(["WECOM", "DINGTALK", "FEISHU"]);
  });
});
