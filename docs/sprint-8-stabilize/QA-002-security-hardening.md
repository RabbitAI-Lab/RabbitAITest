# 安全加固（QA-002 · SSRF 收口 / CSRF / 安全头 / 登录限流 / 供应链）

| 元信息项     | 内容                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | QA-002                                                                                                                                     |
| 所属迭代     | Sprint 8 — 稳定化                                                                                                                          |
| 优先级       | P2（rules/security.md 全部已登记残余项的收口迭代）                                                                                         |
| 所属模块     | 横切：web 出站守卫 / middleware / 登录认证 / CI 供应链                                                                                     |
| 文档状态     | Implemented（2026-09-28 交付：safe-fetch/CSRF/安全头/限流/密码策略/audit CI 全量；三层测试全绿）                                           |
| 最后更新日期 | 2026-09-28                                                                                                                                 |
| 上游依赖     | S7 AI-001 baseurl-guard（残余：DNS rebinding）、S6 API-011 outbound-guard、S5 MSG-001 webhook 守卫、INTG-003 rate-limit 原语、SYS-008 审计 |
| 下游消费     | S9 企业版（SSO 前的安全底座）；Release Gate 质量维度                                                                                       |
| 上游依据     | 需求文档 §四 安全；rules/security.md 全文（本规格=其验收落地）                                                                             |
| 对标基线     | MeterSphere v3 社区版安全面（认证/权限/审计已在前序迭代复刻）；本规格为平台自身加固，非功能复刻                                            |
| 关联架构文档 | rules/security.md §1/§3.4/§4/§5；observability.md §3（脱敏）                                                                               |
| 高保真确认   | 不适用（纯后端类）                                                                                                                         |
| 工作量估算   | 后端 5 人日                                                                                                                                |

## 1. 概述

### 1.1 功能定位

收口 rules/security.md 已登记但未落地/有残余的六项：SSRF 连接期校验统一、CSRF Origin 校验、安全响应头、登录暴力破解限流、密码策略、依赖审计 CI 门禁。全部为加固既有链路，无新业务功能。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                    | P1 ✅ | 后续                                                   |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| safe-fetch：undici Agent `connect.lookup` 连接期 IP 校验（消 DNS rebinding TOCTOU）                                     | ✅    | 出站白名单管理界面（登记）                             |
| 三处出站统一收口：AI 网关 chat / Swagger 同步拉取 / 通知 webhook 投递                                                   | ✅    | 其余新增出站点默认走 safe-fetch（规范约束）            |
| CSRF：非幂等方法（POST/PUT/PATCH/DELETE）cookie 会话请求校验 Origin/Referer 同源                                        | ✅    | SameSite=Strict 实验（登记，兼容性观察）               |
| CSRF 豁免：APIKEY（Authorization 头，非 cookie 认证）与登录/注册（未认证面）                                            | ✅    | —                                                      |
| 安全响应头：X-Content-Type-Options=nosniff、X-Frame-Options=DENY、Referrer-Policy、Permissions-Policy、HSTS（https 时） | ✅    | CSP 全量（登记——antd 内联样式需 nonce 方案，独立评估） |
| 登录限流：同 IP 连续失败 ≥ 5 次锁 10 分钟（429）；成功登录清零；审计留痕                                                | ✅    | 按 email 维度二级锁（登记）                            |
| 密码策略：注册/新建用户/改密/重置统一 ≥ 8 位且含字母+数字                                                               | ✅    | 弱口令字典（登记）                                     |
| 依赖审计：CI quality job 增 `pnpm audit --prod --audit-level high`（high+ 阻塞）                                        | ✅    | SBOM 产出（登记）                                      |

### 1.3 前置依赖

三处既有 SSRF 守卫（解析期校验）保留为前置快速失败；rate-limit 原语（INTG-003）；next.config headers 能力；SYS-008 recordAudit。

### 1.4 对标基线核对

基线功能面（认证/权限/审计）已在前序迭代复刻。本规格六项均为基线未明示的平台自身加固——登记为超出基线的质量资产（与基线「安全」章节不冲突）。

## 2. 业务逻辑

- **safe-fetch 语义**：`safeFetch(url, init)` = 全局 fetch 的替身，以共享 `undici.Agent({ connect: { lookup } })` 为 dispatcher；lookup 回调内对解析出的每个地址跑 `ipIsForbidden`（复用现有黑名单段），命中即 `callback(new Error('blocked'))`——**校验与连接使用同一次解析结果**，rebinding 二次解析返回内网地址也无法建立连接。字面 IP 直连路径同样被 lookup 覆盖（undici 对 IP 字面量也走 connect.lookup，单测确认；若版本行为差异则以 resolve+固定 IP host 重写兜底，登记实现注记）。
- **既有守卫保留**：assertAiBaseUrl/assertSafeOutboundUrl（解析期）继续做 422 快速失败（错误码不变）；safe-fetch 为第二道连接期防线（失败映射既有 70422/70011/供应商错误口径）。
- **CSRF 判定**：请求携带会话 cookie 且方法非幂等 → 取 `Origin`（缺则 `Referer`）与请求 host 比；不匹配 → 403 `10013 CSRF_REJECTED`；**两者都缺失 → 放行**（决策登记：第一层防护=cookie `SameSite=Lax` 基线——跨站 POST 本就不会携带会话 cookie；Origin 校验为纵深防御第二层，缺失放行兼容非浏览器客户端（JMeter/CI 脚本/OpenAPI SDK），与 Django `CSRF_TRUSTED` 之外的主流实践一致；老浏览器跨站伪造请求仍会带 Origin 且被拒）。豁免：`Authorization` 头存在的请求（APIKEY/Bearer——非 cookie 认证）。豁免清单显式登记于实现文件头。
- **安全头**：next.config `headers()` 全局（API 与页面共用）；HSTS 仅在 `X-Forwarded-Proto=https` 或生产 https 部署时输出（本地 http 不发，避免开发环境副作用）。
- **登录限流**：`rateLimit('login-fail', ip, 5, 600)`；命中返回 429 `10014 LOGIN_RATE_LIMITED`；成功登录后 `DEL rl:login-fail:{ip}:*`（当前窗口 key 直删）；失败记审计 `login.rate_limited`。
- **密码策略**：shared zod schema `passwordPolicy`（≥8、含字母与数字）统一挂到注册/创建用户/改密/重置四处现有 schema（422 口径不变）。
- **供应链**：CI 步骤 `pnpm audit --prod --audit-level high`；已知无法立即修复的 critical/high 须在 `docs/security/audit-waivers.md` 登记理由与期限（缺登记即红）。

## 3. UI/UX 设计

无新 UI。登录限流 429 在登录页以既有错误 toast 呈现（文案走 ErrMsg）。

## 4. 技术架构

- **位置**：`apps/web/src/server/safe-fetch.ts`（web 出站统一入口）；CSRF 挂 `apps/web/src/middleware.ts`（matcher 扩至 `/api/v1/:path*`，只拦非幂等+有 cookie 请求）；安全头挂 `apps/web/next.config.ts` headers()；密码策略挂 `packages/shared/src/system/schemas.ts`。
- **engine 不涉及**：引擎采样目标是业务测试对象（rules/security §3.4 明确不限制）。
- **权限点**：无新增（无新资源面）。
- **错误码**：`CSRF_REJECTED 10013`（认证段）、`LOGIN_RATE_LIMITED 10014`（认证段）——两枚新增，ErrMsg 同步。
- **测试栈兼容**：`OUTBOUND_ALLOW_PRIVATE=1`/`AI_ALLOW_PRIVATE_BASEURL=1` 语义保留（lookup 校验读取同一开关；环回豁免口径与现守卫一致）。
- **日志**：拦截事件记 warn（含 reqId/module=security，不记完整 URL query 防泄露 token）。

## 5. 测试用例

- QA-002-T1（单测）：safe-fetch lookup 矩阵（公网放行/私网段拒绝/环回豁免开关两态/rebinding——mock lookup 返回先公网后内网仍拒）；CSRF 判定矩阵（同源过/跨源拒/无 Origin 拒/Authorization 豁免/login 豁免/GET 放行）；密码策略矩阵；限流窗口边界（5 过 6 拒、成功清零）。
- QA-002-T2（jmx）：四类——正常路径（登录成功+变更请求同源头过）；401/403（跨源 POST 403 10013、未登录 401）；422（弱密码注册 20422）；限流 429（6 连失败）+安全头断言（响应头四枚 JSONPath）。
- QA-002-T3（e2e）：登录限流三态（正常登录→失败 5 次→429 且正确密码也拒→窗口后恢复，UI toast+网络断言+Console 无错）；越权矩阵抽查（system/users 与 ai-models 管理员/普通成员/未登录三视角）；排障包等 INFRA-004 用例见其规格。
- CI：quality job audit 步骤红绿即门禁。

## 6. 竞品深度对标

见 §1.4——加固项超出基线明示范围，登记为质量资产；不引入基线没有的行为变化。

## 7. 里程碑与验收

DoD：§1.2 全能力行 ✅ + 单测/jmx/e2e 三件套绿 + CI（quality 含 audit）绿。走查=攻击面手工复验清单（rebinding/CSRF/限流各一条）。

## 8. 勘误登记

1. 登录失败既有 HTTP 口径=400（BAD_CREDENTIALS 落 toResponse 兜底段，SYS-001 T1-3 同口径断言）——限流 429 前的失败计数请求即 400/10102，规格 §5 e2e 断言按 400 落地。
2. 依赖升级：nodemailer ^6→^9.1（3 条 high 收口；类型用 @types/nodemailer@8——v9 未带类型，API 面兼容）+ pnpm overrides（postcss≥8.5.18 修 Next 15.5 传递依赖 2 条 high、deepmerge-ts≥8 修 @prisma/config 传递依赖 1 条 high），6→0。
3. audit 豁免台账 docs/security/audit-waivers.md 暂无需登记项（当前 0 high，余 2 moderate 不阻塞）。
