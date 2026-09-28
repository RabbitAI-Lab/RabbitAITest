# 个人中心（个人信息 · 密码 · 本地执行 · 个人模型 · APIKEY 收编）

| 字段         | 内容                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | SYS-007                                                                                                                                                                       |
| 所属迭代     | Sprint 5 — 协作通知                                                                                                                                                           |
| 优先级       | P2（迭代内 P1）                                                                                                                                                               |
| 所属模块     | system 域（personal 段：会话本人资源，无权限点）+ ai 域（个人默认模型消费）                                                                                                   |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测（环回矩阵并入 s5-project）+ JMeter 1 + Playwright 3 全绿；走查随验收）                                                                |     |
| 最后更新日期 | 2026-09-28                                                                                                                                                                    |
| 上游依赖     | SYS-001（会话/argon2 密码/me 端点）、INTG-003（APIKEY 端点与页面，收编复用）、AI-001（系统模型表，S7 §1.4 挂点「个人级延后宿主=本规格」）、engine --local（本地执行拉取模式） |
| 下游消费     | S7 AI（个人默认模型生效即挂点兑现）、S8 QA-001（覆盖率核对「个人中心」行）                                                                                                    |
| 上游依据     | 需求文档 §三 M1（个人中心全量口径）；功能清单 §9.3、§一一级菜单「个人中心」行                                                                                                 |
| 对标基线     | 功能清单 §9.3：个人信息（头像/姓名/邮箱/手机）、修改密码、APIKEY（≤5，S6 已交付）、本地执行（地址+连通检测+优先本地执行）、三方平台账号、模型设置                             |
| 关联架构文档 | api-conventions §1（/personal 段无权限点）；test-domain-model §2（users/user_preferences 表零 DDL）；rules/security.md（密码/密钥）                                           |
| 高保真确认   | 待确认（原型 docs/design/SYS-007-personal-center/，人工确认待 Sprint 验收走查）                                                                                               |
| 工作量估算   | 后端 1.5 人日 / 前端 2 人日 / 联调 0.5 人日                                                                                                                                   |

## 1. 概述

### 1.1 功能定位

把散落的个人资源收进一个容器：个人信息查看/编辑、修改密码、APIKEY（复用 S6 页面收编入口）、本地执行配置（环回地址+连通检测+优先开关）、个人默认模型（S7 登记挂点兑现——AI 助手/生成优先用个人所选系统模型）。兑现 AI-001 §1.4「个人级模型设置宿主=SYS-007」。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                           | P1 ✅ | 后续                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| 个人信息：查看（email/姓名/手机/角色概要）；编辑 name(1-128)/phone(≤32 可空)                                                                                   | ✅    | —                                                     |
| 邮箱=登录名不可编辑（展示+禁用态输入框）                                                                                                                       | ✅    | 换绑邮箱 Backlog（需验证码链路）                      |
| 头像：姓名首字母色块（无上传）                                                                                                                                 | ✅    | 头像上传 Backlog（users 无头像列，登记简化）          |
| 修改密码：旧密码校验（错→422 PERSONAL_PASSWORD_MISMATCH）+新密码 ≥8 位（同 SYS-001 口径）+成功后其余会话失效                                                   | ✅    | 密码策略强化（复杂度/历史）Backlog                    |
| APIKEY：收编 INTG-003 页面为个人中心子页（端点/上限 5/掩码一次性展示全复用，不重建）                                                                           | ✅    | —                                                     |
| 本地执行配置：address（仅环回 127.0.0.1/localhost/::1，非环回 422）+连通检测（GET {address} 3s 超时）+preferLocal 开关；UserPreference key `local_runner` 承载 | ✅    | 非 Web 环回地址白名单 Backlog                         |
| 优先本地执行语义：偏好记录与展示；实际本地执行由 `engine --local` 拉取模式自决（登记技术口径，web 不做调度改向）                                               | ✅    | web 调度按偏好改向 Backlog（需引擎消费协议）          |
| 个人默认模型：从启用系统模型中选一（UserPreference key `ai_model`）；AI 助手与功能/接口用例生成解析模型时 个人默认 > 系统默认；清除=回系统默认                 | ✅    | 个人级 API Key 覆盖 Backlog（AI-001 登记延续）        |
| 三方平台账号绑定（缺陷以个人账号创建）                                                                                                                         | ❌    | Backlog（与 INTG-001 组织级凭据架构冲突，需评审）     |
| 界面语言切换（基线 §二通用）                                                                                                                                   | ❌    | Backlog（全局 i18n 超范围）                           |
| 主题/时区                                                                                                                                                      | ❌    | 主题=ENTP-004 红线；时区基线未提不做                  |
| 邮箱邀请注册/Excel 批量导入（SYS-004 §1.2 登记 Sprint 5+）                                                                                                     | ❌    | Backlog（再次顺延，依赖 SMTP 已具备、批量基建未排期） |

### 1.3 前置依赖

- `users` 表列已齐（email/name/phone/passwordHash）；`user_preferences`（userId+projectId="" 全局键）零 DDL 承载 local_runner/ai_model 两键。
- 会话机制：SYS-001 既有 session（修改密码后失效策略视实现：session 版本号或逐条删除——实现期定，登记）。
- AI 模型解析：S7 `ai.service` 的模型选择函数（isDefault 系统默认）——插入个人偏好优先分支。

### 1.4 对标基线核对

完全复刻：个人信息+修改密码、APIKEY（复用）、本地执行（地址+检测+优先开关）、模型设置（个人级，S7 挂点）。简化实现：头像=首字母色块（基线有头像上传，简化登记）；三方平台账号绑定延后（基线社区版有，但与本项目组织级集成凭据架构冲突，登记差异与去向）；「优先本地执行」为偏好记录（基线未明示调度语义，本项目 web 不改向，登记）。超出基线：无（克制）。

## 2. 业务逻辑

- **个人信息**：`PATCH /personal/me`（name/phone；email 忽略不收）；姓名空串 422；手机格式宽松（≤32）。
- **修改密码**：旧密码 argon2 verify（失败 422 PERSONAL_PASSWORD_MISMATCH）；新 ≥8 位；成功→更新 passwordHash+**失效本人除当前外的所有会话**（实现：session 存储带 userId 索引逐条删除或版本号校验——以既有 session 实现取低侵入方案，登记）；审计 recordAudit（不含密码值）。
- **本地执行**：PUT `{address?, preferLocal}`；address 非空时必须环回主机（127.0.0.1/localhost/::1，端口任意，路径须 `/` 或空）否则 422 PERSONAL_LOCAL_RUNNER_INVALID；check=服务端 GET `{address}`（3s 超时，URL 整体仍过环回校验）返回 `{reachable, detail}`；不配置也可保存 preferLocal。
- **个人默认模型**：PUT `{modelId|null}`——校验为系统内**启用**模型（不存在/停用 422 PERSONAL_AI_MODEL_INVALID）；ai 服务模型解析顺序：`ai_model` 偏好（存在且启用）> 系统 isDefault；助手 SSE 与两处生成同链路生效。
- **审计**：me/密码/模型偏好变更 recordAudit；本地执行配置仅日志（低敏）。

## 3. UI/UX 设计（高保真 docs/design/SYS-007-personal-center/）

- 入口：顶栏个人下拉「个人中心」（替换现「APIKEY」直达项为个人中心容器）；路由 `/personal`（左侧子菜单：个人信息/修改密码/APIKEY/本地执行/模型设置），既有 `/personal/api-keys` 迁为子页（路由保留重定向兼容 e2e）。
- 个人信息页：头像色块+表单（email 禁用灰/姓名/手机）+保存；成功 toast。
- 修改密码页：旧/新/确认三框+强度提示；错误红条（旧密码错/两次不一致）。
- APIKEY 页：INTG-003 既有页面原样嵌入。
- 本地执行页：地址输入（placeholder `http://127.0.0.1:7001`，非环回前端预校验红字）+「检测连通」按钮（结果绿√/红×+耗时）+「优先本地执行」开关；说明文案（本地执行由 engine --local 拉取模式决定）。
- 模型设置页：系统启用模型单选列表（名称/供应商/模型名 tag）+「清除（用系统默认）」链接；保存 toast。
- 空态/二态：无启用模型→引导文案+跳转系统管理；未配置地址时检测按钮禁用。

## 4. 技术架构

- 数据模型：零 DDL（users/user_preferences 既有；`local_runner`/`ai_model` 两键 projectId=""）。
- 契约（packages/shared/src/system/schemas.ts 增量）：`personalMeUpdateSchema`、`changePasswordSchema`、`localRunnerUpsertSchema`、`personalAiModelSchema`。
- 端点（全部 withAuth，本人资源无权限点）：
  - `PATCH /api/v1/personal/me`
  - `POST /api/v1/personal/change-password`
  - `GET/PUT /api/v1/personal/local-runner`、`POST /api/v1/personal/local-runner/check`
  - `GET/PUT /api/v1/personal/ai-model`
- 服务：`apps/web/src/server/domains/system/personal.service.ts`（me/密码/会话失效）；`project/…` 无涉；ai 模型解析插分支（`ai.service` 既有 resolve 函数 + UserPreference 读取）。
- 错误码（10xxx）：`PERSONAL_PASSWORD_MISMATCH 10020`、`PERSONAL_LOCAL_RUNNER_INVALID 10021`、`PERSONAL_AI_MODEL_INVALID 10022`。
- 前端：`app/(console)/personal/page.tsx` 容器+layout 子菜单+四新子页；HeaderBell 同期交付（MSG-001）；api-client s5.ts。
- 无权限点（personal 先例：INTG-003）。

## 5. 测试用例

- SYS-007-T1（jmx 四类）：me/local-runner/ai-model 主链（改姓名→me 回读；PUT 偏好→GET 回读）；401（无 cookie）；422（环回外地址/停用模型 id/旧密码错/新密码 7 位）；personal 通知分页信封复用 MSG-001（不重复建计划）。
- SYS-007-T2（spec 主链路）：个人中心改姓名手机→刷新回显；改密码旧密码错红条→改对→旧密码登录 401→新密码登录成功（新会话）（UI+Console+接口）。
- SYS-007-T3（spec 配置链路）：本地执行填 `http://127.0.0.1:{mockPort}` 检测连通绿√（mock /healthz）；填 `http://192.168.1.1:7001` 前端红字+后端 422；模型设置选个人默认→AI 助手提问→请求体/响应链路断言走了所选模型（mock 双模型不同应答或生成记录断言）（三类断言）。
- 单测：环回地址校验矩阵（localhost/127.0.0.1/::1/0.0.0.0/内网域名拒绝）；ai_model 解析优先级（个人启用>系统默认>个人停用回退）；修改密码会话失效逻辑；phone/name 校验。

## 6. 竞品深度对标

基线 §9.3 六项：个人信息✓ 密码✓ APIKEY✓ 本地执行✓（环回约束为安全增强差异）模型设置✓（个人级）。差异：①头像上传简化为首字母色块；②三方平台账号绑定延后（架构冲突登记）；③语言切换为全局能力延后。超出基线：无。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：personal 五端点族（OpenAPI 快照 diff）。联调点：T3 连通检测打 mock 与 AI 个人模型生效断言。验收=§5 用例全绿 + 概览演示主线「个人中心」段。

## 8. 勘误登记

- 勘误 1（2026-09-28，会话失效口径）：原文「成功后其余会话失效」——实现发现会话为 iron-session **无状态加密 Cookie**（服务端无会话存储，无法主动吊销其他设备会话）；实现口径=仅当前会话保留、其余会话随 Cookie 自然过期，页面说明文案同步。若需强吊销需引入会话版本号列（Backlog）。
