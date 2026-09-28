/**
 * 扫码登录三平台常量（S9 ENTP-003）。
 * 真实环境端点按平台官方文档；测试全走 mock（apps/mock /sso/{provider}/{authId}/*）。
 */
export const SCAN_PROVIDERS = ["WECOM", "DINGTALK", "FEISHU"] as const;
export type ScanProvider = (typeof SCAN_PROVIDERS)[number];

export const SCAN_PROVIDER_META: Record<
  ScanProvider,
  { label: string; callbackType: "wecom" | "dingtalk" | "feishu"; provider: string }
> = {
  WECOM: { label: "企业微信扫码", callbackType: "wecom", provider: "wecom" },
  DINGTALK: { label: "钉钉扫码", callbackType: "dingtalk", provider: "dingtalk" },
  FEISHU: { label: "飞书扫码", callbackType: "feishu", provider: "feishu" },
};

/** 构造平台扫码授权 URL（redirect_uri 指向本站回调；authorizeBase 可注入 mock，缺省真实平台——查询串在两形态下统一拼接）。 */
export function buildScanAuthorizeUrl(
  provider: ScanProvider,
  ctx: { authId: string; state: string; redirectUri: string; config: Record<string, unknown> },
): string {
  const ru = encodeURIComponent(ctx.redirectUri);
  const st = encodeURIComponent(ctx.state);
  /** mock：`{authorizeBase}/{provider}/{authId}/authorize`；真实：各平台端点。查询串统一追加。 */
  const withQuery = (mockPath: string, realBase: string, query: string, hash = "") => {
    const target = ctx.config.authorizeBase
      ? `${String(ctx.config.authorizeBase).replace(/\/$/, "")}${mockPath}`
      : realBase;
    return `${target}?${query}${hash}`;
  };
  switch (provider) {
    case "WECOM": {
      const appid = String(ctx.config.corpId ?? "");
      const agentid = String(ctx.config.agentId ?? "");
      return withQuery(
        `/wecom/${ctx.authId}/authorize`,
        "https://open.weixin.qq.com/connect/qrconnect",
        `appid=${appid}&agentid=${agentid}&redirect_uri=${ru}&state=${st}&scope=snsapi_privateinfo`,
        "#wechat_redirect",
      );
    }
    case "DINGTALK": {
      const clientId = String(ctx.config.clientId ?? "");
      return withQuery(
        `/dingtalk/${ctx.authId}/authorize`,
        "https://login.dingtalk.com/oauth2/auth",
        `redirect_uri=${ru}&response_type=code&client_id=${clientId}&scope=openid&state=${st}&prompt=consent`,
      );
    }
    case "FEISHU": {
      const appId = String(ctx.config.appId ?? "");
      return withQuery(
        `/feishu/${ctx.authId}/authorize`,
        "https://open.feishu.cn/open-apis/authen/v1/index",
        `app_id=${appId}&redirect_uri=${ru}&state=${st}`,
      );
    }
  }
}

/** 平台回调查询参数名（企微/飞书 code，钉钉 authCode；另含 state）。 */
export function scanCallbackQueryNames(provider: ScanProvider): {
  code: "code" | "authCode";
  state: "state";
} {
  return { code: provider === "DINGTALK" ? "authCode" : "code", state: "state" };
}
