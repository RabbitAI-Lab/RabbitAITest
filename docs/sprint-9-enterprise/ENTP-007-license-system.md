# License 体系（授权管理 · 企业版总门控）

| 字段         | 内容                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-007                                                                                                                                                                                                |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                                   |
| 优先级       | P3（迭代内 P0——门控 ENTP-001/006/008 及全部企业特性，依赖链 `ENTP-007 ──→ ENTP-001/006/008`）                                                                                                           |
| 所属模块     | system 域（web 内服务；engine/mock 不感知 License——门控全部收敛在 web API 层）                                                                                                                          |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                            |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                              |
| 上游依赖     | SYS-001（会话/withSystemPerm）、SYS-005（SystemParam 模式先例）、SYS-008（审计）、rbac-permission-model §6（门控蓝图）、api-conventions §3（90xxx 段预留）、test-domain-model §2（licenses 表 S0 已建） |
| 下游消费     | ENTP-001/002/003/004/005/006/008（六特性门控 `assertEntpEnabled`）、前端按钮解锁（公开 license-status）                                                                                                 |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 系统设置-授权管理、§十二「License 体系本身在社区版可见」、12.11                                                                                                          |
| 对标基线     | 功能清单 §十：社区版可见授权管理页（authorizedManagement）、LicenseController 校验与添加接口、ms-expire-alert/ms-trial-alert 到期试用提醒、validateLicense 指令；§十二：企业版功能总开关【企业版】      |
| 关联架构文档 | rbac-permission-model.md §6（本规格将其伪代码落为 TS 实现）；api-conventions.md §3（90xxx）；test-domain-model.md §2/§6（licenses 表零 DDL）                                                            |
| 高保真确认   | 待确认（原型 docs/design/ENTP-007-license-system/，人工确认待 Sprint 验收走查——不可由 AI 代签，见 ai-collaboration §5）                                                                                 |
| 工作量估算   | 后端 1.5 人日 / 前端 1 人日 / 联调 0.5 人日                                                                                                                                                             |

## 1. 概述

### 1.1 功能定位

企业版总开关：授权管理页可见于社区版（状态=社区版/未授权），添加 License 后六大企业特性逐一解锁。License 采用**离线签名文件**模型（超出基线，自主设计：MeterSphere 为官方线上签发不可复刻，本项目以 HMAC-SHA256 签名的三段式字符串实现同构语义——同一套「校验/添加/到期提醒/总门控」能力，签发密钥 env 注入，社区部署无密钥即无法伪造）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                 | P1 ✅ | 后续                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------- |
| License 三段式格式：`RABBIT-ENT1.<b64url(payloadJson)>.<b64url(hmac)>`；payload={lic,edition,issuedAt,expiresAt,features?,maxUsers?} | ✅    | 在线激活/吊销/宽限期续期 Backlog（离线模型外） |
| 校验：结构解析→HMAC 验签→期限判定；状态机 NONE（无）/VALID/EXPIRED（读时惰性流转，过期自动降级）                                     | ✅    | 多 License 并存与择优 Backlog（单条覆盖模型）  |
| 六特性目录：MULTI_ORG/SSO/MULTI_POOL/THEME/MSG_TEMPLATE/USER_SCALE（features 缺省=全部；扫描登录归 SSO 特性位）                      | ✅    | 特性粒度再细分（如 SSO 按协议授权）Backlog     |
| 添加/移除：POST /system/license（结构/验签/期限三重校验，失败 422 90002-90004）；DELETE 回社区版                                     | ✅    | License 历史记录列表 Backlog                   |
| 状态查询：GET /system/license（管理面，含 payload 明细）；GET /public/license-status（无鉴权，{edition,expiresAt,features}）         | ✅    | —                                              |
| 统一门控 `assertEntpEnabled(feature)`：无/过期 License→403 90001；特性未授权→403 90005；web 全部企业端点必经                         | ✅    | engine/mock 侧门控（不感知，架构决策见 §6）    |
| 到期提醒：30 天内黄条/过期红条（授权页+顶栏横幅，基线 ms-expire-alert 语义）；功能矩阵六项点亮/置灰                                  | ✅    | 试用提醒（ms-trial-alert 对应）Backlog         |
| 签发工具：scripts/gen-license.mjs（--expires/--features/--max-users；测试/开发用，生产换 LICENSE_SIGNING_SECRET）                    | ✅    | 许可证服务器 Backlog                           |
| 社区版限制提示汇总：1 组织/30 用户/1 默认池/固定模板（授权页展示与各功能点 403 文案一致）                                            | ✅    | —                                              |

### 1.3 前置依赖

- `licenses` 表 S0 已建齐（code VarChar(4096)/status/payload Json）——**零 DDL**
- 加密器：S6/S5 先例（AES-GCM）——本规格仅用 HMAC 验签，不涉及可逆加密
- 审计：SYS-008 recordAudit（添加/移除留痕）

### 1.4 对标基线核对

完全复刻：社区版可见授权管理页（添加/校验接口、状态展示、到期提醒组件语义、企业版功能总开关定位）；六特性目录与基线 X-Pack 功能面一一对应（多组织 12.1/用户扩容 12.2/主题 12.3/SSO+扫码 12.4/消息模板 12.5/多资源池 12.6）。简化实现：单条 License 覆盖（基线未明示多许可并存语义）；过期即降级无宽限期。超出基线，自主设计：三段式 HMAC 签名格式与本地签发脚本（基线为官方授权服务器签发）；公开 license-status 端点（基线 validateLicense 前端指令的等价无鉴权形态）。

## 2. 业务逻辑

- **格式**：`RABBIT-ENT1.<b64url(JSON)>.<b64url(HMAC-SHA256(b64url(payload), secret))>`；payload 必含 `lic`（序列号 8-64 字符）、`edition:"ENTERPRISE"`、`issuedAt`/`expiresAt`（ISO），可选 `features`（六特性子集数组，缺省=全部六项）与 `maxUsers`（正整数，缺省=不限）。
- **校验管线**（添加时全跑，读取时复跑期限）：①正则分段→90002；②JSON 可解析且 zod licensePayloadSchema 通过→90002；③HMAC 验签→90003；④expiresAt > now→90004（已过期可添加后立即降级？——**否**：过期即拒绝添加，避免「添加成功却无效」的歧义态）。
- **状态机**：库内至多一条 ACTIVE 记录；添加=覆盖（先删后插）；读取时 expiresAt 已过→落库 EXPIRED 并按 NONE 门控（惰性降级，无需定时任务）。
- **门控语义**：`assertEntpEnabled(feature)` 在**服务层入口**调用（Route Handler 内、服务函数首行），六特性枚举 `EntpFeature` 收敛于 shared；90xxx 语义=「企业版能力未授权」，与 10003（RBAC 权限不足）正交：先权限后门控（无权限仍 403 10003）。
- **前端解锁**：公开端点 `GET /api/v1/public/license-status` 返回 `{edition:"COMMUNITY"|"ENTERPRISE", expiresAt, features[]}`；前端 hook `useEntp()` 驱动企业功能按钮 disabled+锁提示（社区版可见但锁定，与基线「按钮禁用」一致）。
- **审计**：添加（code 掩码 `RABIT-ENT1.****.****`）/移除，action=`license.add`/`license.remove`。

## 3. UI/UX 设计（高保真 docs/design/ENTP-007-license-system/）

- 入口：系统设置组新增「授权管理」`/system/license`（LeftNav `nav-system-license`，perm `SYSTEM_LICENSE:READ`）。
- 画板一（授权管理页）：顶部状态卡（社区版：灰徽标+限制清单「1 个组织 / 30 名用户 / 1 个默认资源池 / 默认主题 / 固定消息模板」+「添加 License」主按钮；企业版：紫徽标+序列号+有效期+剩余天数）；功能矩阵表（六特性 × 状态点亮/置灰+对应功能入口链接）；添加弹窗（License 内容 textarea+「校验并添加」）。
- 画板二（到期提醒形态）：有效期 ≤30 天=黄条横幅「企业版授权将于 N 天后到期」；过期=红条「企业版授权已过期，企业功能已锁定」+ 授权页顶部同形态。
- 空态/二态：无 License（社区版状态卡）；有 License（企业版状态卡+矩阵全亮）；features 子集（矩阵部分亮，未授权行置灰+「未包含在当前授权中」）；添加失败（结构/验签/过期三种 422 文案红字回显）。

## 4. 技术架构

- 数据模型：`licenses` 既有表零 DDL（code 存三段式原文，payload 存解析后 Json）。
- 契约（packages/shared/src/entp/schemas.ts 新域目录）：`licensePayloadSchema`、`licenseAddSchema`（code 1-8192）、`licenseStatusSchema`、`EntpFeature` 枚举与 `ENTP_FEATURES` 常量（含中文名映射）。
- 端点：
  - `GET /api/v1/system/license`（withSystemPerm `SYSTEM_LICENSE:READ`）→ 当前状态+payload 明细
  - `POST /api/v1/system/license`（`SYSTEM_LICENSE:UPDATE`）→ 校验三重+落库+审计
  - `DELETE /api/v1/system/license`（`SYSTEM_LICENSE:UPDATE`）→ 回社区版+审计
  - `GET /api/v1/public/license-status`（无鉴权）→ {edition, expiresAt, features}
- 服务：`apps/web/src/server/domains/entp/license.service.ts`——`verifyLicenseCode(code)`（四步管线，返回 payload 或抛 DomainError）、`getLicenseState()`（读时惰性降级+缓存 60s 失效即重查）、`addLicense(code)`/`removeLicense()`、`assertEntpEnabled(feature)`（全仓唯一门控入口，供其余 ENTP 服务 import）；`packages/shared/src/entp/features.ts`（枚举/目录，前端复用）。
- 签发：`scripts/gen-license.mjs`（node:crypto HMAC；env `LICENSE_SIGNING_SECRET` 缺省 dev 密钥 `rabbit-dev-license-secret`——生产必换，部署文档登记）。
- 错误码（90xxx 企业版段，api-conventions §3 预留兑现）：`LICENSE_REQUIRED 90001`（403，通用门控）、`LICENSE_FORMAT_INVALID 90002`（422）、`LICENSE_SIGNATURE_INVALID 90003`（422）、`LICENSE_EXPIRED 90004`（422）。
- 权限点（入库+预置组同步）：`SYSTEM_LICENSE:READ|UPDATE`（SYSTEM_ADMIN）；90xxx 与 10003 的 HTTP 映射进 guard `toResponse`。
- 前端：`apps/web/src/app/(console)/system/license/page.tsx`；`hooks/useEntp.ts`（public status 查询+缓存）；到期横幅组件 `EntpExpireBanner`（授权页+console 布局顶部条件渲染）；api-client `s9.ts`。

## 5. 测试用例

- ENTP-007-T1（jmx 四类）：license 状态查询（GET 信封/edition 字段）→ 添加有效（POST 200→public status 转企业版）→ 删除回落；401（无 cookie）/403（无 SYSTEM_LICENSE 点）；422（坏格式 90002/篡改签名 90003/过期 90004）；public 端点无鉴权可访。
- ENTP-007-T2（jmx 门控链路）：无 License 建 enterprise 池 → 403 90001 → 添加 License → 同请求 201（同计划内串联，四断言含 90001 code）。
- ENTP-007-T3（spec 主链路）：授权页添加（gen-license 签发值预置 textarea）→ 状态卡转企业版+矩阵六亮+顶栏横幅消失 → 删除 → 回社区版（UI+Console+接口三类断言）。
- ENTP-007-T4（spec 二态）：到期 License（expiresAt=now+5d）→ 黄条横幅可见+剩余天数；过期 License 添加被拒 422 文案回显。
- 单测（`packages/shared/src/__tests__/s9-license.test.ts` + `apps/web/src/server/domains/entp/__tests__/license.test.ts`）：验签管线（合法/分段缺失/JSON 坏/签名篡改/缺字段）；状态机（NONE→VALID→过期惰性降级）；features 子集门控矩阵（六特性 × 无/有/过期/未授权四态 → 90001/90005/放行）；maxUsers 缺省与封顶解析。

## 6. 竞品深度对标

基线 §十/§十二核对：社区版可见授权页✓ 添加/校验接口✓ 到期提醒✓ 总开关语义✓ 特性目录=12.1-12.6 六域✓。差异：①签发侧为本地 HMAC 离线模型（基线官方授权服务器——不可复刻，自主设计登记）；②单条覆盖非多许可；③过期即降级无宽限期；④门控收敛 web 层（engine/mock 不感知——基线 X-Pack 为 Spring 容器注入，本项目以「web 是唯一写路径」架构决策替代，见 test-domain-model §3 跨域纪律）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：license 四端点 + `EntpFeature` 枚举 + 90xxx 首五码。联调点：ENTP-001/006/008 门控接入（依赖本规格先行交付）。验收=规格 §5 用例全绿 + 概览演示主线「授权」段。

## 8. 勘误登记

无。
