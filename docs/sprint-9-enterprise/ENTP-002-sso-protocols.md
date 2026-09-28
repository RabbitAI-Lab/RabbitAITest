# SSO 单点认证（LDAP/CAS/OIDC/OAuth2 · 认证源 · 更多登录方式）

| 字段         | 内容                                                                                                                                                                                                                                                                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-002                                                                                                                                                                                                                                                                                                                                       |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                                                                                                                                                                          |
| 优先级       | P3（迭代内 P1）                                                                                                                                                                                                                                                                                                                                |
| 所属模块     | system 域（认证源管理）+ auth（登录流程）；engine/mock 不感知（mock 承担 IdP 桩）                                                                                                                                                                                                                                                              |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                                                                                                                                                                   |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                                                                                                                                                                     |
| 上游依赖     | ENTP-007（SSO 特性门控）、SYS-001（会话/iron-session/register 先例）、SYS-002（middleware 白名单——回调路径免登录）、S6 AES-GCM 密钥加密先例、QA-002（safe-fetch 出站守卫）                                                                                                                                                                     |
| 下游消费     | ENTP-003（扫码登录复用 AuthSource 与回调基建）                                                                                                                                                                                                                                                                                                 |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 系统参数-认证配置、§十二 12.4 单点认证（8 种方式）                                                                                                                                                                                                                                                              |
| 对标基线     | 功能清单 12.4：LDAP（地址 389/636、绑定 DN/密码、用户 OU、过滤器 uid/sAMAccountName/cn、属性映射、测试连接/测试登录）；CAS（服务端地址、serviceValidate、回调 /sso/callback/cas/${authId}）；OIDC（授权/Token/用户信息/注销端点+回调，Keycloak 例）；OAuth2.0（三端点+回调，GitHub 例）；SAML（X-Pack 概述页列明）；登录页「更多登录方式」入口 |
| 关联架构文档 | rbac-permission-model.md §6（SSO 门控+ENTP_SSO 预登记）；api-conventions.md §1；rules/security.md（密钥加密/出站守卫/state 防 CSRF）                                                                                                                                                                                                           |
| 高保真确认   | 待确认（原型 docs/design/ENTP-002-sso-protocols/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                                                                                                                                                                                                 |
| 工作量估算   | 后端 3 人日 / 前端 1.5 人日 / 联调 1.5 人日                                                                                                                                                                                                                                                                                                    |

## 1. 概述

### 1.1 功能定位

系统参数内的「认证配置」：管理员维护认证源（本迭代实现 LDAP/CAS/OIDC/OAuth2 四协议 + 三扫码类型枚举占位给 ENTP-003 + SAML 占位），登录页呈现「更多登录方式」；OAuth2 类协议走标准 authorize→callback 授权码流，LDAP 为账密直登（登录表单切换），回调换用户信息后按属性映射 find-or-create 用户并发本站会话。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                | P1 ✅ | 后续                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| AuthSource 认证源 CRUD：8 类型枚举（LDAP/CAS/OIDC/OAUTH2/SAML/WECOM/DINGTALK/FEISHU），name/enabled；SAML 仅枚举占位（建源允许但标记「未实现」不可启用，422 90015） | ✅    | SAML 协议实现——后续迭代（无可用 IdP 验收环境，登记豁免） |
| OIDC/OAuth2 授权码流：authorize 302（client_id/redirect_uri/state/scope）→ callback code 换 token → userinfo → 属性映射 → find-or-create（source=类型）→ 会话       | ✅    | PKCE、refresh token、注销端点联动 Backlog                |
| CAS 协议：login?service= 跳转 → ticket serviceValidate（XML 解析 attributes）→ 同上映射                                                                             | ✅    | CAS 代理票据/单点登出 Backlog                            |
| LDAP：登录页「LDAP 目录登录」表单（账号+密码）→ bind+search（OU/过滤器）→ 属性映射 → find-or-create                                                                 | ✅    | LDAP over TLS 自动发现/分组同步 Backlog                  |
| 属性映射：{username,name,email} 三键，每键取 IdP 属性名；username/email 缺失→422 90014                                                                              | ✅    | 手机号映射/动态属性 Backlog                              |
| 密钥加密：bindPassword/clientSecret AES-GCM 落库（S6 先例），API 返回掩码 `******`                                                                                  | ✅    | —                                                        |
| 测试连接/测试登录：LDAP bind+search 试连（注入式 client，单测 fake）；OIDC/OAuth2/CAS 对配置端点 GET 探活                                                           | ✅    | IdP 元数据自动发现（.well-known）Backlog                 |
| state 防 CSRF：authorize 时生成 state 存 Redis（5 分钟 TTL），callback 校验（422 90012）                                                                            | ✅    | nonce/JWKS 验签 Backlog（mock 与自建 IdP 场景）          |
| 登录页「更多登录方式」：GET /public/sso-methods（enabled 源）→ 密码表单下方分隔线+方式按钮；LDAP 呈现为表单切换 Tab                                                 | ✅    | 注册页/找回密码页 SSO 入口 Backlog                       |
| 出站守卫：token/userinfo/serviceValidate 请求经 safeFetch（QA-002 统一出站）                                                                                        | ✅    | —                                                        |
| 门控：认证源写端点+登录入口经 SSO 特性；社区版 /public/sso-methods 返回空列表                                                                                       | ✅    | —                                                        |

### 1.3 前置依赖

- `auth_sources` 新表（门禁 3 例外登记：协议配置形状依赖本规格定型——与 S7 ai 域同类）
- SYS-002 middleware matcher 放行 `/sso` 回调路径（未登录可达）
- SYS-001 registerUser 先例（find-or-create 用户初始化：默认组织挂载策略——SSO 用户不自动建组织，挂 seed 公共组织「SSO 用户」？**决策：不挂任何组织**，首次登录后由管理员加入组织/项目；personal/projects 空态引导）
- Redis 可用（state 存储）

### 1.4 对标基线核对

完全复刻：LDAP 配置面五要素+测试连接/测试登录✓ CAS serviceValidate+回调路径形态✓ OIDC/OAuth2 三端点+授权码流+属性映射（Keycloak/GitHub 例）✓ 登录页「更多登录方式」✓ 认证配置入口在系统参数✓。简化实现：SAML 占位（基线列明但本项目无验收 IdP——登记）；注销端点联动不做；find-or-create 不自动入组织（基线未明示默认组织语义）。超出基线，自主设计：AuthSource 统一表+类型判别式配置（基线各协议独立配置面——本项目收敛一表多形态）；mock IdP（测试基建）。

## 2. 业务逻辑

- **认证源生命周期**：enabled 才出现在登录页；同类型可多源（多租户 IdP）；删除源=登录页入口即时消失。
- **OAuth2 类流程**（OIDC/OAUTH2 同构，端点配置化）：`GET /auth/sso/{authId}/authorize` → 生成 state（Redis `sso:state:{state}`=authId+redirect，TTL 300s）→ 302 IdP；`GET /auth/sso/{authId}/{type}/callback?code&state`（slug 序=authId 在前，与 authorize 同层一致） → state 校验（缺失/过期 90012）→ POST tokenEndpoint（code/client_id/client_secret/redirect_uri）→ GET userinfoEndpoint（Bearer）→ 映射 → 用户落库（email 唯一冲突=同源更新 name、异源拒绝 409 90016）→ session save → 302 `/`。
- **CAS**：authorize=302 `{serverUrl}/login?service={site}/auth/sso/{authId}/cas/callback`；callback?ticket → GET `{serverUrl}/serviceValidate?service&ticket` → XML 解析成功+attributes → 同上映射。
- **LDAP**：`POST /auth/login` 扩展 `{authId, username, password, mode:"ldap"}` → bindDN+bindPassword 连接 → search（userOu+filter 模板 `({filterKey}={username})`）→ 用结果 DN+用户密码二次 bind 验证 → 属性映射 → find-or-create+会话；失败 401 10001（与本地口令失败同码，防枚举）。
- **find-or-create**：以映射 email 查 User——存在且 source=LOCAL：更新 source=类型（绑定）；存在且 source=其他 SSO 类型：409 90016；不存在：创建（passwordHash=随机不可登录值、source=类型、name 取映射或 username）。
- **mock IdP**（apps/mock，验收基建）：`GET /sso/{provider}/{authId}/authorize?redirect_uri&state` → 302 `redirect_uri?code=mock-code-{authId}&state`；`POST /sso/{provider}/{authId}/token` → `{access_token:"mock-token"}`；`GET /sso/{provider}/{authId}/userinfo` → 控面配置的用户信息；CAS `serviceValidate` 返回成功 XML；控面 `POST /sso/_test/config`（{authId, userinfo}）/`GET /sso/_test/config`。provider∈oidc|oauth2|cas。
- **审计**：认证源 CRUD+SSO 登录成功/失败（action=sso.login，含 authId 不含口令）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-002-sso-protocols/）

- 画板一（认证配置页 `/system/sso`）：认证源表格（名称/类型 tag 八色/启用开关/操作：编辑·测试连接·删除）；「新建认证源」→ 类型选择（八宫格图标，SAML 灰置「未实现」）→ 按类型分形态表单：OIDC/OAuth2（授权/Token/用户信息端点+clientId+clientSecret 掩码+scope+属性映射三键）；CAS（服务端地址+属性映射）；LDAP（地址+端口 389/636+绑定 DN/密码+用户 OU+过滤器键下拉 uid/sAMAccountName/cn+属性映射）；扫码三类表单占位（ENTP-003 接管，本页只读提示「扫码源在扫码登录配置」——简化：同表单由 ENTP-003 扩展字段）。底部「回调地址」展示（可复制：`{siteUrl}/auth/sso/{authId}/{type}/callback`）。
- 画板二（登录页更多登录方式）：密码表单下方「—— 其他登录方式 ——」分隔+按钮排（启用的 OAuth2/CAS 源：类型图标+源名称）；LDAP 源存在时顶部 Tab 切换「账号登录 / LDAP 目录登录」（LDAP Tab=账号+密码+提交）；扫码源按钮归 ENTP-003 呈现。
- 空态/二态：无源（登录页无该区块）；禁用源（即时消失）；社区版（/system/sso 入口隐藏+API 403 90001）；测试连接成功/失败回显（绿✓/红✗+原因）。

## 4. 技术架构

- 数据模型：`auth_sources`（id/type VarChar(16)/name/enabled Boolean/config Json——判别式存各协议字段，secrets 字段 AES-GCM 密文/createdAt/updatedAt）。例外登记 test-domain-model §6。
- 契约（packages/shared/src/entp/schemas.ts）：`authSourceUpsertSchema`（type 判别联合：ldapAuthConfigSchema/oidcAuthConfigSchema/oauth2AuthConfigSchema/casAuthConfigSchema + scan 占位三态由 ENTP-003 扩展同表）、`authSourceItemSchema`（secrets 掩码）、`ssoMethodItemSchema`（public：{authId,type,name}）、`propMappingSchema`（{username,name,email}→属性名，username/email 必填）。
- 端点：
  - `GET/POST /api/v1/system/sso`（ENTP_SSO:READ/CREATE，门控）
  - `PATCH/DELETE /api/v1/system/sso/{authId}`（UPDATE/DELETE，门控）
  - `POST /api/v1/system/sso/{authId}/test-connection`（UPDATE）——LDAP bind+search / HTTP 端点探活
  - `GET /api/v1/public/sso-methods`（无鉴权）→ enabled 源列表（社区版空数组）
  - `GET /api/v1/auth/sso/{authId}/authorize`（withAuth?——**未登录可达**：白名单直通，仅校验源存在+enabled+门控）
  - `GET /api/v1/auth/sso/{authId}/{type}/callback`（白名单直通；type∈oidc|oauth2|cas|wecom|dingtalk|feishu）
  - `POST /api/v1/auth/login` 扩展 mode:"ldap"+authId（SYS-001 兼容：无 mode 走本地口令不动）
- 服务：`apps/web/src/server/domains/entp/sso.service.ts`（CRUD+加密/掩码+测试连接）、`sso-flow.service.ts`（state 生成校验/token 交换/XML 解析/映射/find-or-create/会话）、`ldap-client.ts`（注入式接口 `LdapClientAdapter`：生产实现基于 `ldapts`，单测 fake）。
- 出站：token/userinfo/serviceValidate/探活全走 safeFetch（QA-002）。
- 错误码：`SSO_SOURCE_NOT_FOUND 90010`（404）、`SSO_SOURCE_DISABLED 90011`（422）、`SSO_STATE_INVALID 90012`（422）、`SSO_PROVIDER_ERROR 90013`（502 IdP 侧失败）、`SSO_USER_MAPPING_FAILED 90014`（422）、`SSO_CONFIG_INVALID 90015`（422 含 SAML 未实现）、`SSO_ACCOUNT_CONFLICT 90016`（409 异源绑定冲突）。
- 权限点：`ENTP_SSO:READ|CREATE|UPDATE|DELETE`（SYSTEM_ADMIN；rbac §6 预登记 UPDATE 兑现+补齐）。
- 前端：`/system/sso/page.tsx`（类型分形态表单）；login/page.tsx「更多登录方式」区块+LDAP Tab；LeftNav 系统设置「认证配置」（license 可见性）；api-client s9。
- mock：§2 所列六组 IdP 端点+控面。

## 5. 测试用例

- ENTP-002-T1（jmx 四类）：认证源 CRUD 主链（建 OIDC 指向 mock → 列表掩码 → 编辑 → 测试连接 ✓ → 删）；401/403（无点/无 License 90001）；422（端点非 URL/掩码回传不改密/映射缺 username 90014 前置/SAML 启用 90015）；public/sso-methods 信封（enabled 过滤+社区版空）。
- ENTP-002-T2（spec OIDC 全链）：加 License → 建源（mock 控面预设 userinfo）→ 登录页出现「更多登录方式」按钮 → 点击（302 mock）→ mock 自动授权回跳 → 会话建立（source=OIDC 用户 personal/projects 可访）→ Console 无错（UI+Console+接口：authorize/callback/会话三类断言）。
- ENTP-002-T3（spec 二态）：社区版入口隐藏+authorize 403 90001；禁用源即从登录页消失+callback 422 90011；坏 state 回调 422 90012。
- ENTP-002-T4（jmx CAS/OAuth2 变体）：CAS serviceValidate XML 成功路径登录+失败 ticket 502 90013；OAuth2（GitHub 形态）同 T1 建源走 mock 全链。SAML 拒绝用例登记勘误：authSourceUpsertSchema 判别联合无 SAML 分支 → zod 层 20422 先于服务层 90015，jmx 不可达——SAML 拦截由 schema 单测（无 SAML 分支）+UI 类型灰置覆盖。
- 单测（`apps/web/src/server/domains/entp/__tests__/sso.test.ts`）：state 生成/过期/校验；三协议 token/userinfo 解析（含 CAS XML）；映射缺失 90014；find-or-create 三分支（新建/同源更新/异源 90016）；LDAP adapter fake 矩阵（bind 成败/search 空/二次 bind 密码错）；secrets 加密掩码往返。

## 6. 竞品深度对标

基线 12.4 核对：LDAP 五要素+测试双入口✓ CAS serviceValidate✓ OIDC/OAuth2 授权码流+映射✓ 更多登录方式✓ 认证配置在系统参数域✓。差异：①SAML 占位（验收环境缺失——显式登记，非静默缺失）；②统一 AuthSource 表（基线各协议独立配置页——收敛设计）；③SSO 用户不自动入组织（基线未明示，空态引导）；④mock IdP 为测试基建超出基线。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：sso 端点组+public/sso-methods+callback 路径契约。联调点：mock IdP 全链（T2）+middleware 白名单。验收=§5 全绿+概览主线「SSO」段。

## 8. 勘误登记

无。
