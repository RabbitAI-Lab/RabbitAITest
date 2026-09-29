# OAuth Token 通道（Device Flow · 第三认证通道 · scope 收窄）

| 元信息项     | 内容                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | SYS-009                                                                                                                                                  |
| 所属迭代     | Sprint 11 — AI CLI 与 Token 通道                                                                                                                          |
| 优先级       | P1（迭代内）                                                                                                                                              |
| 所属模块     | 认证（auth）+ 个人中心（personal）+ 守卫（guard）                                                                                                         |
| 文档状态     | Approved（2026-09-30 会话设计逐项确认；按 S0 §8.1 目标授权先例，人工确认与走查后置至验收）                                                                 |
| 最后更新日期 | 2026-09-30                                                                                                                                                |
| 上游依赖     | SYS-002 认证守卫、SYS-004 RBAC 权限集、INTG-003（APIKEY 通道先例：session 优先协商/Bearer 解析/哈希库存/审计口径）、S10 INFRA-006（RLS 租户上下文）           |
| 下游消费     | CLI-001（rabbit CLI——auth login/refresh/revoke 的服务端对端）                                                                                             |
| 上游依据     | 需求文档 §八安全行「认证（Session+Token+APIKEY）」三通道预留；RFC 8628（OAuth 2.0 Device Authorization Grant）                                             |
| 对标基线     | 功能清单 §9.3 仅含 APIKEY（第三方 API 调用）；Token 通道+Device Flow 为平台自有增强（超基线，sprint-overview §1 登记）——对标 GitHub PAT/OAuth Device Flow 形态 |
| 关联架构文档 | api-conventions.md §2/§3/§4（信封与错误码；本规格 §4.6 登记两处 RFC 例外）；rbac-permission-model.md；security.md §认证                                  |
| 高保真确认   | 待确认（原型已产出：docs/design/SYS-009-oauth-token-channel/——`/oauth/device` 授权确认页 + `/personal/authorizations` 授权会话页）                          |
| 工作量估算   | 后端 5 人日 / 前端 2 人日                                                                                                                                 |

## 1. 概述

### 1.1 功能定位

落地需求文档 §八预留的第三认证通道 **Token**：OAuth 2.0 Device Flow（RFC 8628）面向无浏览器终端（AI Agent CLI、SSH、CI 人机交互场景）——CLI 发起登录 → 终端打印验证码 → 人在任意浏览器完成批准 → CLI 轮询取得短 TTL access token + 可旋转 refresh token。Token 与 Session/APIKEY 并列，经统一认证协商注入既有守卫体系：**RBAC 权限点、项目/组织成员校验、404 防枚举、RLS 租户隔离全部原样生效，权限模型零分叉**；Token 在此之上叠加 scope 粗粒度收窄（read/write/exec，deny-by-default）。

与 APIKEY 的分工：APIKEY=非交互 CI（长期、全量、Basic/Bearer ak.sk）；Token=交互式终端（短期、可 scope 收窄、可旋转、授权会话可吊销、审计归因到会话）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                     | P1 ✅ | 后续                                                               |
| -------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| Device Flow 发码：`POST /oauth/device/code`（client_id+scope，form 编码）→ RFC 原生 JSON                  | ✅    | 第三方客户端注册表（OAuthClient 表，登记不交付）                   |
| 浏览器批准：`/oauth/device` 确认页（输码→回显 scope/来源→批准/拒绝）+ `POST /oauth/device/approve`       | ✅    | 批准页二维码（verification_uri_complete 已可贴）                   |
| 轮换取 token：`POST /oauth/token`（device_code grant；authorization_pending/slow_down/access_denied/expired_token RFC 错误形状） | ✅    | —                                                                  |
| refresh 旋转：refresh_token 一次性换新；旧值重放=检测即吊销整个授权会话（token family）                  | ✅    | —                                                                  |
| Token 生命周期：access 2h / refresh 30d / device_code 10min / user_code 8 位去混淆字符集 XXXX-XXXX     | ✅    | TTL 进 SystemParam 组配置                                          |
| 统一认证协商：session → Bearer `rat_*`（全守卫自动生效）；open 面 session→token→APIKEY 三序              | ✅    | —                                                                  |
| scope 收窄：read/write/exec 三类；deny-by-default；登录时声明；RBAC 点照常校验（权限=RBAC∩scope）      | ✅    | 细粒度到权限点的 scope（登记）；scope 审批页动态展示（已展示）      |
| scope 分类：HTTP 方法缺省（GET→read，非 GET→write）+ exec 路由注册表（13 条显式登记）                    | ✅    | —                                                                  |
| 授权会话管理：个人中心列表（设备/scope/IP/最近使用/过期）+ 单条吊销 + `POST /oauth/revoke`（CLI 登出）   | ✅    | 改密吊销全部会话（登记 CLI-001 联动）                              |
| 审计：oauth.code.request/approve/deny、oauth.token.issue/refresh/revoke、oauth.grant.revoke             | ✅    | Token 通道写操作审计带 grantId 归因（access log 已含 reqId/userId） |
| 限流：发码 10/min/IP；token 轮询按 device 键控（超发 429 slow_down）；批准 10/min/用户                   | ✅    | 逐 Token QPS 限流（决策：不做，登记理由 §4.7）                      |
| 安全存储：token 仅存 sha256；user_code 批准页错 5 次锁；禁用/软删用户 token 立即失效                      | ✅    | —                                                                  |

### 1.3 前置依赖

守卫体系（guard/index.ts 五守卫 + open-api-guard）；Prisma User 表（relation 追加）；rate-limit.ts（固定窗口）；audit.service（recordAudit）；next/headers（Route Handler 内读 Authorization）。

### 1.4 对标基线核对

基线（功能清单）无 Token 通道/Device Flow——本规格为超基线自有增强（依据：需求文档 §八三通道预留 + AI CLI 迭代目标）。形态对标 GitHub（api.github.com 单 API 多认证：浏览器 session / PAT / OAuth token 同面）与 gh CLI（device flow 登录）。差异登记：①first-party 客户端写死 `rabbit-cli`（无 OAuthClient 注册表）；②无 PKCE（device flow 语义不需要）；③批准页非独立设备页面（复用平台登录态）。

## 2. 业务逻辑

### 2.1 Device Flow 时序（RFC 8628）

```
CLI                                    平台(/api/v1)                         浏览器(已登录)
 │ POST /oauth/device/code ──────────────▶│                                    │
 │   (client_id=rabbit-cli, scope)        │ 生成 device_code(256bit)+user_code │
 │ ◀── {device_code,user_code,uri,600,5} ─│  OAuthDeviceCode(PENDING,10min)    │
 │ 打印 verification_uri_complete         │                                    │
 │ POST /oauth/token ──(每5s)──────────▶ │                                    │
 │ ◀── 400 {error:authorization_pending} ─│                                    │
 │                                        │ ◀── GET /oauth/device?code=XXXX ──│
 │                                        │ POST /oauth/device/approve ──────│
 │                                        │  (session; user_code→APPROVED)    │
 │ POST /oauth/token ───────────────────▶ │                                    │
 │ ◀── 200 {access_token,refresh_token,  ─│ 创建 OAuthGrant(旋转元数据)        │
 │          expires_in:7200,scope}        │                                    │
 │ Bearer rat_* 调用任意 /api/v1 …        │                                    │
```

- **user_code**：8 位字符集 `BCDFGHJKMPQRTVWXY2346789`（去元音/去混淆），展示与输入均为 `XXXX-XXXX`，库内规范化大写去连字符；批准页错 5 次锁定（该码 expiresAt 提前， brute-force 不可行：10 分钟窗口内 32^8 空间）。
- **轮询限速**：按 device_code 哈希键控，>13 次/分钟 → `429 {error:"slow_down"}`（CLI 自动 +5s 退避）；IP 兜底 60/min。
- **一次性**：device_code 换 token 成功即 CONSUMED（条件更新防双花）；APPROVED 也可仅被消费一次。

### 2.2 Token 生命周期与旋转

- access：`rat_`+43 位 base64url（256-bit），TTL 7200s；refresh：`rrt_`+43 位，TTL 30d。
- **旋转**：每次 refresh 换新 access+refresh，旧行 `prevRefreshHash` 保留旧 refresh 哈希；**重放检测**：到达的 refresh 匹配 `prevRefreshHash`（已旋转旧值）→ 判定泄露，整授权会话置 REVOKED，返回 `invalid_grant`。
- 库内仅存 sha256（hex）；查找按 accessTokenHash/refreshTokenHash 索引等值查询。
- 失效：用户 status≠ACTIVE 或 deletedAt≠null（协商时校验，与 session 同语义）；吊销（本人）；refresh 过期后不可再换（grant 置 EXPIRED 惰性）。

### 2.3 scope 模型（deny-by-default）

- 三类：`read` / `write` / `exec`；登录时 `scope` 参数声明（逗号分隔，非法值 400 `invalid_scope`）；空缺省=`read`（最小权限缺省）。
- **所需 scope 判定**（shared 单一来源 `requiredScopeFor(method, path)`）：
  1. 命中 **exec 路由注册表**（13 条：projects 域 11 条执行触发/停止/重跑 + open/exec 2 条 POST）→ `exec`；
  2. 否则 GET/HEAD → `read`；
  3. 否则 → `write`。
- **执法点**：守卫层（withAuth/withProjectScope/withOrgScope/withSystemPerm/withApiKey）在身份解析后、业务 handler 前统一断言 `tokenScope ⊇ requiredScope`；仅 Token 通道受约束（session/APIKEY `tokenScope=null` 不受限，行为不变）；**豁免：`/api/v1/oauth/*` 生命周期端点**（revoke 等 token 自管理——RFC 7009 语义，read/exec token 也必须能登出）。
- 权限语义：**scope 是 Token 的收窄，不是 RBAC 的替代**——RBAC 权限点（requirePerm）照常校验，最终允许 = RBAC 权限点 ∧ scope；scope 不足 → 403 `code 10003`（message 注明 `token scope 缺少 write`）。
- 典型用法：AI Agent 发 `read,exec`——可看可跑不可改。

### 2.4 认证协商（升级点，全部既有守卫自动受益）

`current-user.ts`：`getActiveUserId()`（session-only）升级为 `getAuthIdentity()`（React cache 单请求一次）：

```
1) session cookie 有 userId → 查 User(ACTIVE) → {userId, email, tokenScope:null, kind:"session"}
2) Authorization: Bearer rat_* → sha256 查 OAuthGrant(ACTIVE, 未过期) → User(ACTIVE)
   → {userId, tokenScope:[...], kind:"token"}；lastUsedAt 异步回写
3) 否则 null → 401（现状语义）
```

`getActiveUserId()` 保留为薄封装（全部既有调用点零改动）；新增 `getTokenScope()` 供守卫断言。open-api-guard 协商序升级：session → token（经 getActiveUserId 自动生效）→ APIKEY（`ak.sk` 带点 / `rat_` 前缀无歧义）。CSRF（QA-002）：Authorization 头请求既有豁免，Bearer 通道天然通过。

### 2.5 授权会话管理

- `GET /api/v1/personal/authorizations`：本人 OAuthGrant 列表（clientId/deviceName/scope/ip 脱敏（保留 /24 尾段）/lastUsedAt/accessExpiresAt/status/createdAt）。
- `DELETE /api/v1/personal/authorizations/{id}`：置 REVOKED（本人校验，404 防枚举）。
- `POST /api/v1/oauth/revoke`：CLI 登出口——Bearer 自身份吊销所属会话（RFC 7009 形态简化：无 client_secret，token 即凭证）。

## 3. UI/UX 设计（高保真 docs/design/SYS-009-oauth-token-channel/）

- **`/oauth/device` 授权确认页**（独立页，非 console 布局；未登录经 middleware 302 /login?next= 回跳）：①输码态——大号输入框（自动大写/插连字符，`?code=` 预填）+「校验」；②确认态——卡片回显：请求方（rabbit-cli）、scope 三枚徽标（read 绿/exec 蓝/write 橙 + 中文释义）、请求时间、来源 IP；按钮「批准授权」（主）/「拒绝」（默认）；③结果态——成功（回到终端提示）/已拒绝/码无效或过期（可重输）。错 5 次锁定提示。
- **`/personal/authorizations` 授权会话页**（复用个人中心布局与 APIKEY 页表格形态）：列=设备（clientId+deviceName）/Scope/IP/最近使用/Access 过期/状态/操作（吊销，Popconfirm）；空态文案引导 CLI 登录；吊销后行内状态翻转。

## 4. 技术架构

### 4.1 端点

| 端点                                    | 方法 | 认证        | 形状                                |
| --------------------------------------- | ---- | ----------- | ----------------------------------- |
| `/api/v1/oauth/device/code`             | POST | 公开+IP 限流 | **RFC 原生 JSON**（信封例外）        |
| `/api/v1/oauth/token`                   | POST | 公开+键控限流 | **RFC 原生 JSON/错误**（信封例外）   |
| `/api/v1/oauth/device/approve`          | POST | session     | 平台信封（zod：userCode+approve）    |
| `/api/v1/oauth/revoke`                  | POST | Bearer      | 平台信封（自会话吊销）               |
| `/api/v1/personal/authorizations`       | GET  | session     | 平台信封（列表）                     |
| `/api/v1/personal/authorizations/[id]`  | DELETE | session   | 平台信封                             |

### 4.2 模型（门禁 3：一次建齐；用户级全局表，不进 RLS 策略）

```prisma
model OAuthDeviceCode { // RFC 8628 待授权码；10min 一次性
  id / clientId(默认 rabbit-cli) / deviceCodeHash(唯一索引) / userCode(8位,索引)
  scope / status(PENDING|APPROVED|DENIED|CONSUMED) / userId?(批准时绑定)
  ip? / userAgent? / approveFails(int) / expiresAt / approvedAt? / createdAt
}
model OAuthGrant { // 一次登录=一授权会话（family）；refresh 旋转原行更新
  id / userId→User / clientId / deviceName? / scope
  status(ACTIVE|REVOKED) / accessTokenHash(索引) / accessExpiresAt
  prevRefreshHash?(重放取证) / refreshTokenHash? / refreshExpiresAt?
  lastUsedAt? / rotatedAt? / ip? / createdAt / revokedAt?
}
```

User 追加 relation `oauthGrants`；迁移 `20260930120000_s11_oauth_token_channel`。

### 4.3 认证协商与守卫改造

- `current-user.ts`：`getAuthIdentity()`（§2.4）；`getActiveUserId` 薄封装。
- `guard/index.ts`：四守卫身份解析后插入 `assertTokenScope(req)`（tokenScope 存在且不含所需类 → 403 10003）；`open-api-guard.ts`：同断言（open 面方法缺省：POST open/exec/*→exec、其余 POST→write、GET→read）。
- shared `oauth-scope.ts`：`OAuthScope` 类型、`parseScopes()`、`requiredScopeFor(method,path)`、`EXEC_ROUTES`（13 条 `{x}` 段匹配器）——单一来源，单测矩阵覆盖。

### 4.4 oauth.service（domains/auth/）

issueDeviceCode / lookupPendingByUserCode / approveDeviceCode / exchangeDeviceToken / refreshGrant / verifyAccessToken / revokeByAccessToken / listGrants / revokeGrant。token 生成 `crypto.randomBytes(32)`→base64url；哈希 sha256 hex；随机与哈希经 `crypto.timingSafeEqual` 比对（对齐 apikey.service 口径）。

### 4.5 限流与审计

rate-limit 键：`oauth-code:{ip}` 10/min；`oauth-token:{deviceHash前16}` 13/min（超发 429 slow_down）；`oauth-refresh:{grantId前16}` 10/min；`oauth-approve:{userId}` 10/min。审计动作见 §1.2；detail 记 clientId/scope/ip/deviceCodeHash 前 8。

### 4.6 契约例外登记（api-conventions 增补）

`/oauth/device/code` 与 `/oauth/token` 返回 **RFC 8628 原生 JSON**（非 `{code,message,data}` 信封）：token 端点错误 `{"error":"authorization_pending|slow_down|access_denied|expired_token|invalid_grant|invalid_scope"}`（HTTP 400/429）——兼容 gh CLI/RabbitCLI 等标准实现（脚手架 cmd_auth.go 按此 switch）。openapi 快照登记两路径 response 为 RFC 形状。

### 4.7 决策登记

①Token 通道对 `/api/v1` **不做逐请求 QPS 限流**（与 session 同口径；http access log + 审计可追溯；CLI 侧有 30s 超时）——若滥用再按 grantId 键控；②scope 粗粒度三类（细粒度到权限点登记后续）；③错误码新增 `OAUTH_USER_CODE_INVALID 10030`、`OAUTH_GRANT_NOT_FOUND 10031`（10xxx 段顺延，不占用 10013/10014）。

## 5. 测试用例

- SYS-009-T1（jmx 四类）：device/code 发码→信封例外形状断言（user_code JSONPath）；未批准轮询 400 authorization_pending；登录→approve→token 200（access_token JSONPath+响应时间）；Bearer 调 /personal/me 200。
- SYS-009-T2（jmx 权限/校验类）：伪造 device_code→400 invalid_grant；Bearer 无效→401 10001；scope=read 建用例→403 10003；approve 坏码→422 10030；user_code 错 5 次→422 锁定；分页信封（Bearer 调项目用例列表 {total,items}）。
- SYS-009-T3（e2e）：浏览器批准页全链（CLI 侧 request 上下文模拟：发码→轮询→批准→token→Bearer 建/跑/查）；授权会话页列表+吊销→CLI 立即 401；scope 二态（read token 写 403/exec token 执行 200 且写 403）；Console/网络断言（批准 POST 载荷+信封）。
- 单测（Vitest）：requiredScopeFor 矩阵（13 条 exec 路由+方法缺省）；user_code 字符集/规范化；旋转重放（旧 refresh 二次使用→REVOKED+invalid_grant）；exchangeDeviceCode 状态机（PENDING/APPROVED/DENIED/CONSUMED/EXPIRED）；verifyAccessToken 过期/吊销/禁用用户；scope 解析（非法→invalid_scope，缺省 read）。
- 门禁 8 对应：§1.2 全部 P1 行由 T1-T3+单测覆盖；「改密吊销全部」「逐 Token 限流」为显式登记豁免。

## 6. 竞品深度对标

GitHub：单 API 多认证（session/PAT/OAuth token 同面）+ device flow（gh CLI 登录）——本规格同构。差异：①无 OAuth App 注册表（first-party 客户端写死）；②scope 三类粗粒度（GitHub repo:read 级细粒度登记后续）；③批准页复用平台登录态（GitHub 独立设备页）。MeterSphere：无对应能力（APIKEY 即全部），本规格为超基线增强。

## 7. 里程碑与登记

M11（v0.6.0）：Token 通道+CLI 登录闭环。登记后续：改密吊销全部会话；scope 细粒度；OAuthClient 第三方注册表；PKCE（如引入授权码流）；逐 Token QPS 限流。
