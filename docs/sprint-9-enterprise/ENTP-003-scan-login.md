# 扫码登录（企微 / 钉钉 / 飞书）

| 字段         | 内容                                                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-003                                                                                                                                                                                                                                                                  |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                                                                                                     |
| 优先级       | P3（迭代内 P2）                                                                                                                                                                                                                                                           |
| 所属模块     | auth 域（扫码流程）；复用 ENTP-002 AuthSource/回调/find-or-create 基建                                                                                                                                                                                                    |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                                                                                              |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                                                                                                |
| 上游依赖     | ENTP-002（AuthSource 表/sso-flow 服务/state 机制/find-or-create）、ENTP-007（SSO 特性门控——扫码归 SSO 特性位）                                                                                                                                                            |
| 下游消费     | —                                                                                                                                                                                                                                                                         |
| 上游依据     | 需求文档 §三 M10；功能清单 §十二 12.4 扫码三方式                                                                                                                                                                                                                          |
| 对标基线     | 功能清单 12.4：企业微信扫码（AgentId/Secret/企业 ID、授权回调域、企业可信 IP、weComQrCode.vue）；钉钉扫码（Client ID/AgentId/Client Secret、回调域名、服务器出口 IP 白名单、dingTalkQrCode.vue）；飞书扫码（企业自建应用、网页应用、重定向 URL、H5 可信域名、通讯录权限） |
| 关联架构文档 | rbac-permission-model.md §6；rules/security.md（secret 加密/出站守卫）                                                                                                                                                                                                    |
| 高保真确认   | 待确认（原型 docs/design/ENTP-003-scan-login/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                                                                                                                               |
| 工作量估算   | 后端 1.5 人日 / 前端 1 人日 / 联调 1 人日                                                                                                                                                                                                                                 |

## 1. 概述

### 1.1 功能定位

三平台扫码登录：认证源配置企微/钉钉/飞书应用凭据 → 登录页扫码入口 → 302 平台扫码授权页（真实环境）→ 用户扫码确认 → 平台回调本站 → code 换 access_token → 拉取用户身份 → 属性映射 find-or-create → 会话。复用 ENTP-002 全部基建（AuthSource 行、state、callback 骨架、find-or-create、mock 授权链），仅新增三平台的 URL 构造与 token/user 端点形状。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                                                                                                                                                                       | P1 ✅    | 后续                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------ |
| 三平台配置表单：企微（corpId/agentId/secret/回调域）；钉钉（clientId/agentId/clientSecret/回调域名）；飞书（appId/appSecret/redirectUrl）；secret AES-GCM 掩码                                                                                                                                                             | ✅       | 企业可信 IP/出口 IP 白名单/通讯录权限侧配置提示（展示文案，不做校验面）Backlog |
| 授权 URL 构造：企微 `open.weixin.qq.com/connect/qrconnect`（appid/agentid/redirect_uri/state/scope=snsapi_privateinfo）；钉钉 `login.dingtalk.com/oauth2/auth`（client_id/redirect_uri/state/responseType=code/scope=openid/prompt=consent）；飞书 `open.feishu.cn/open-apis/authen/v1/index`（app_id/redirect_uri/state） | ✅       | 内嵌二维码组件（基线 weComQrCode.vue 形态——跳转式等价）Backlog                 |
| 回调换身份：企微 code→userid（gettoken+getuserinfo）；钉钉 code→openid→用户信息（POST user/get）；飞书 code→access_token→用户信息（authen/v1/access_token+user_info）                                                                                                                                                      | ✅       | —                                                                              |
| 属性映射：三平台统一映射 {username=userid/openid/open_id, name, email=平台邮箱或合成 `{username}@sso.scan`}                                                                                                                                                                                                                | ✅       | 企业通讯录匹配既有账号（邮箱合成账号不与本地账号自动合并）Backlog              |
| 登录页扫码入口：启用的扫码源渲染按钮（平台图标+名称），与其他 SSO 方式并列                                                                                                                                                                                                                                                 | ✅       | —                                                                              |
| mock 扫码授权链：mock `/sso/{wecom                                                                                                                                                                                                                                                                                         | dingtalk | feishu}/{authId}/*` 全链（authorize 自动 302 回调/token/user）                 | ✅  | —   |
| 门控：扫码源写端点+入口经 SSO 特性（ENTP-002 同门）                                                                                                                                                                                                                                                                        | ✅       | —                                                                              |

### 1.3 前置依赖

- `auth_sources` 表与 sso-flow 基建（ENTP-002 先行交付；本规格扩展同表 type=WECOM/DINGTALK/FEISHU 判别配置）
- 三平台真实域名的出站放行：safe-fetch 走公网（测试全走 mock，不出公网）

### 1.4 对标基线核对

完全复刻：三平台凭据配置面✓ 跳转扫码授权流✓ 回调换身份登录✓ 登录页入口✓。简化实现：跳转式而非内嵌二维码组件（基线 vue 组件为嵌入渲染——跳转等价，登记）；可信 IP 类侧配置仅展示提示；邮箱缺失时合成账号（基线企业通讯录场景必有邮箱，公网 SaaS 场景不定）。超出基线：mock 三平台授权链（测试基建）。

## 2. 业务逻辑

- **authorize**：`GET /auth/sso/{authId}/authorize`（type∈扫码三）→ state（复用 ENTP-002 Redis 机制）→ 302 平台扫码页（redirect_uri=`{siteUrl}/auth/sso/{platform}/{authId}/callback`）。
- **callback**：`?authCode/?code&state` → state 校验 → 按平台换身份：企微 `gettoken(corpid/secret)→access_token` + `getuserinfo(authCode)→userid`；钉钉 `POST /v1.0/oauth2/userAccessToken` + `GET /v1.0/contact/users/me`；飞书 `POST authen/v1/oidc/access_token` + `GET authen/v1/user_info` → 映射 → find-or-create（source=平台类型）→ 会话 → 302 `/`。
- **平台失败**：任一换身份步骤非 200/业务错 → 502 90013（不泄平台原始响应，日志留痕）。
- **合成邮箱**：平台未返回 email → `userid/openid/open_id@sso.scan`（唯一键稳定，重复登录幂等）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-003-scan-login/）

- 画板一（登录页扫码入口）：「其他登录方式」区块内扫码按钮（企微蓝绿/钉钉蓝/飞书青 图标+文案「企业微信扫码」「钉钉扫码」「飞书扫码」）；hover 提示「将跳转平台扫码授权」。
- 画板二（扫码授权中转·mock 形态）：mock authorize 页形态（二维码占位+「模拟扫码确认」按钮——测试控面；真实环境为平台页面，此处仅示意跳转链路）；回调后登录成功态（回到控制台首页+顶栏用户名=映射名）。
- 空态/二态：无扫码源（区块无扫码按钮）；社区版（无任何 SSO 区块）；禁用即消失。

## 4. 技术架构

- 数据模型：复用 `auth_sources`（零新表）；config 判别式扩展 `wecomAuthConfigSchema{corpId,agentId,secret,redirectDomain?}`、`dingtalkAuthConfigSchema{clientId,agentId,clientSecret,callbackDomain?}`、`feishuAuthConfigSchema{appId,appSecret,redirectUrl?}`。
- 端点：复用 ENTP-002 `GET /auth/sso/{authId}/authorize`（type 路由分发）与 `GET /auth/sso/{wecom|dingtalk|feishu}/{authId}/callback`；认证源 CRUD/test-connection 复用（test=平台 gettoken/app_access_token 探活）。
- 服务：`sso-scan.service.ts`（三平台 URL 构造+换身份，统一经 safeFetch）；平台常量收敛 `packages/shared/src/entp/scan-providers.ts`（端点/形状，前端 mock 复用 provider 名）。
- 错误码：复用 90010-90016；平台失败统一 90013。
- 前端：login/page.tsx 扫码按钮组（sso-methods type 分组渲染图标）；/system/sso 表单三平台分形态。
- mock：`/sso/wecom/{authId}/authorize|gettoken|getuserinfo`、`/sso/dingtalk/{authId}/authorize|token|user`、`/sso/feishu/{authId}/authorize|token|user` + 控面复用 `_test/config`。

## 5. 测试用例

- ENTP-003-T1（jmx 四类）：扫码源 CRUD（建钉钉指向 mock→掩码→测试连接→删；mock authorize 302 直连断言撤除——JMeter 绝对 URL 代理环境不稳，扫码全链由 e2e ENTP-003-01 覆盖）；401/403（无点/无 License）；422（secret 缺失/回调域非 URL）；public/sso-methods 含扫码源。
- ENTP-003-T2（spec 扫码全链）：建钉钉源（mock 控面预设 user）→ 登录页「钉钉扫码」按钮 → 点击 → mock authorize 自动回跳 → 会话建立（source=DINGTALK、合成邮箱形态）→ 重复走一遍登录幂等（同一用户）（UI+Console+接口）。
- ENTP-003-T3（spec 二态）：社区版入口无扫码按钮+authorize 403；坏 state 422 90012；mock userinfo 缺 userid → 502 90013 回显错误页文案。
- 单测（`__tests__/sso-scan.test.ts`）：三平台 URL 构造矩阵；换身份成功/失败（mock fetch 注入）；合成邮箱幂等；映射缺失 90014。

## 6. 竞品深度对标

基线 12.4 扫码三方式核对：凭据面✓ 授权流✓ 回调登录✓。差异：①跳转式非内嵌 QR 组件（登记）；②可信 IP/通讯录权限为提示非校验（平台侧配置，工具无法代验）；③合成邮箱策略（基线企业场景邮箱必有）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：三 provider 常量+callback 形状。联调点：mock 三平台链（T2）。验收=§5 全绿+概览主线「扫码」段。

## 8. 勘误登记

无。
