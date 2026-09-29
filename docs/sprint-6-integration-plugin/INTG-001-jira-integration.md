# Jira 对接（组织服务集成 · 缺陷双向同步）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | INTG-001                                                                                                                              |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                                 |
| 优先级       | P2（迭代内）                                                                                                                          |
| 所属模块     | 组织设置（org 域）+ 缺陷管理（bug 域）+ 插件运行时                                                                                    |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿、CI 六作业全绿；高保真走查随验收）                                     |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | PLUG-001（平台插件加载）、BUG-001（本地缺陷模型/模板）、PROJ-002（模板字段）、S3 定时基建（BullMQ repeatable）                        |
| 下游消费     | INTG-002（禅道/TAPD 复用编排）、S7（同步数据供 AI 分析）、MS §六兼容承诺                                                              |
| 上游依据     | 需求文档 §二「三方同步：Jira/禅道/TAPD 双向同步（手动+定时）、增量/全量策略、平台字段映射模板」                                       |
| 对标基线     | 功能清单 §8.4/§9.2 服务集成（JIRA Basic Auth/Bearer Token·测试连接）、§七「第三方平台对接：手动+自动、双向同步」、§11 JIRA 口径       |
| 关联架构文档 | plugin-architecture.md（PlatformPlugin SPI/凭据 Secret 存储）；test-domain-model.md §2（Bug.platform/sync_state、PlatformSyncConfig） |
| 高保真确认   | 待确认（原型 docs/design/INTG-001-jira-integration/）                                                                                 |
| 工作量估算   | 后端 5 人日 / 前端 3 人日 / 插件 3 人日                                                                                               |

## 1. 概述

### 1.1 功能定位

组织级配置 Jira 服务集成（地址+凭据，加密存储）→ 项目关联 Jira 项目（projectKey+缺陷类型映射+同步模式）→ 本地缺陷**推送创建/更新**到 Jira（platformKey 回写）+ Jira 状态变更**拉取回写**（手动按钮 + 定时增量）。所有平台交互经 plugin-runner 的 jira 平台插件执行（三方网络故障不拖垮 web 主进程——架构既定）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                     | P1 ✅               | 后续                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------- |
| 组织服务集成配置：platform=jira、address、认证方式（Basic Auth 用户名/密码 or Bearer Token）、凭据加密存储                               | ✅                  | —                                              |
| 测试连接：经 runner jira 插件 `testConnection`（GET /rest/api/2/myself），返回账号展示名                                                 | ✅                  | —                                              |
| 凭据安全：AES-256-GCM 加密落库（密钥 env 派生）；GET 永不回显明文（`hasCredential` 布尔+掩码）                                           | ✅                  | 密钥服务（KMS 类）                             |
| 项目关联：PlatformSyncConfig（platform/projectKey/bugTypes 映射/mode INCREMENT                                                           | FULL/cron/enabled） | ✅                                             | —   |
| 字段映射：模板自动生成（`fieldMapping()` 本地模板字段→Jira 字段：title→summary、description→description、自定义字段按标识直传）          | ✅                  | 映射可编辑 UI（当前固定映射+映射表展示，登记） |
| 推送（出站）：本地 Bug（platform=LOCAL）「同步到 Jira」→ 创建 issue → platform=jira/platformKey/syncState=SYNCED；已同步 Bug 再推送=更新 | ✅                  | 删除同步（本地删→Jira 关闭，登记）             |
| 拉取（入站）：Jira issue 状态变更 → 本地 Bug.status 映射回写（平台状态→本地 WorkflowState 映射表）+ tags 记平台标签                      | ✅                  | Jira 评论双向（登记）                          |
| 同步模式：手动（缺陷列表/详情「同步」按钮）；定时（cron repeatable，INCREMENT=syncState=SYNCED 且平台侧 updatedAt 变更者）               | ✅                  | 全量对账（FULL=重拉全量比对，S7 前评审）       |
| 同步留痕：AuditLog action=integration.sync；失败重试 1 次后任务中心报错                                                                  | ✅                  | —                                              |
| 断链保护：runner 不可达/平台 401/超时 → 明确错误码，不阻塞本地缺陷操作                                                                   | ✅                  | —                                              |

### 1.3 前置依赖

Plugin 框架（PLUG-001）+ platform 插件加载；Bug.platform/platformKey/syncState 列已建（S0）；PlatformSyncConfig 表已建（S0）；模板字段体系（S1）。

### 1.4 对标基线核对

复刻：组织级服务集成入口+测试连接；项目关联+双向同步+手动/自动+增量模式；凭据不回显。口径说明：基线插件文档页将 JIRA 对接标为企业版（pricing 页标两版均有，基线自认口径不一致）——本项目按 plan 既定（S6 标准版交付 INTG-001）纳入，无 License 门控，登记于此供对标审计。简化：字段映射固定规则（基线可视化映射编辑器，登记）；删除同步/评论同步延后（登记）。

## 2. 业务逻辑

- **凭据加密**：`RABBIT_INTEGRATION_SECRET`（env，32B；缺失时启动警告并禁用集成保存）→ HKDF 派生 per-platform 密钥 → AES-256-GCM（iv+tag+密文 base64 存 `credential` 列）。测试与种子只从 env 读（源码零字面量凭据）。
- **配置层级**：PlatformIntegration（组织级，orgId+platform 唯一）→ 项目引用（PlatformSyncConfig.projectId 唯一，platform 必须与组织已配置一致，否则 422 70012）。
- **推送语义**：`POST projects/{pid}/bugs/{id}/sync` → 读组织集成+项目关联 → runner `call jira.createIssue|updateIssue`（字段映射：本地 title/description/模板自定义字段→Jira；bugTypes 映射 Jira issuetype）→ 回写 platformKey（issue key）→ 留痕。幂等：syncState=SYNCED 且 platformKey 存在 → 走更新分支。
- **拉取语义**：手动 `POST projects/{pid}/bugs/sync` 或定时 → `syncBugs({projectKey, since})` → 平台 issue 列表（INCREMENT 按 JQL updated>=since）→ 对每条：platformKey 匹配本地 → 状态映射回写（映射表：平台状态→本地 WorkflowState.serial，内置默认：done→已解决/closed→已关闭/其余→进行中；项目可在关联配置覆盖）→ 本地 version+1 变更留痕（ChangeLog 记 `platform-sync` 来源）。
- **状态机**：syncState ∈ NONE→SYNCED→SYNC_FAILED（可重试）；断链不改 syncState 之外任何字段。
- **定时**：BullMQ repeatable（复用 S3 schedule 模式：AppSetting 权威源+队列执行），最短间隔 5 分钟；enabled=false 移除 job。
- **失败与重试**：平台 401/403 → 70014（凭据失效，页面提示重新配置）；网络超时 → 70013 任务中心失败+重试 1 次。

## 3. UI/UX 设计（高保真 docs/design/INTG-001-jira-integration/）

- 组织设置「服务集成」页 `/org/{orgId}/integrations`：三平台卡片（Jira/禅道/TAPD；本规格 Jira 先行，卡片布局共用）——每卡：平台图标/状态（已配置·测试连接通过时间 or 未配置）/「配置」按钮。
- 配置抽屉（Jira）：地址 URL、认证方式单选（Basic Auth：用户名+密码 / Bearer Token：token 输入）、「测试连接」按钮（成功显示 Jira 账号展示名，失败显示平台错误）+ 保存。
- 项目设置「三方同步」页 `/projects/{pid}/settings/integration`：组织集成状态提示（未配置→引导链接）+ 关联配置表单（Jira 项目 Key、缺陷类型映射列表（本地模板状态→Jira issuetype）、同步模式（增量/全量）+ 定时开关与 cron、状态映射表编辑）。
- 缺陷列表行：platform 徽标（LOCAL/JIRA/禅道/TAPD）+ 操作「同步」（SYNCED 显示平台 key 链接）+ 顶部「批量拉取同步」。
- 同步历史条目（项目设置页底部）：时间/方向（推送·拉取）/结果（N 成功 M 失败）/失败明细展开。

## 4. 技术架构

- **数据模型**：**新表 `PlatformIntegration`**（orgId+platform 唯一/address VarChar(512)/authType VarChar(16) BASIC|BEARER/credential Text 密文/testStatus/testMessage/testedAt/updatedAt）——门禁 3 说明：S0 建模时集成域以「见各规格」留白（test-domain-model §2.27 行），组织级凭据属 S6 首次启用的域表，整表新增非补列，随本规格评审通过建模；test-domain-model.md 同步补 §2 行。PlatformSyncConfig 已建（bugTypes 复用为「缺陷类型+状态映射」JSON，字段重载定义见本规格 §2）。
- **插件**：`plugins/jira-platform/`（tarball）：testConnection/createIssue/updateIssue/syncBugs/fieldMapping 五方法（undici，REST v2，Basic/Bearer）；SPI=PlatformPlugin（shared）。
- **web 服务**：`integration.service.ts`（组织集成 CRUD+加密+测试连接）、`platform-sync.service.ts`（项目关联+推送/拉取编排+定时注册+同步历史）、`credential-crypto.ts`（AES-GCM 封装，单测主力）。
- **端点**：`orgs/{orgId}/integrations`（GET/PUT/DELETE + POST test-connection）；`projects/{pid}/integration`（GET/PUT）；`projects/{pid}/bugs/{bugId}/sync`（POST）；`projects/{pid}/bugs/sync`（POST 拉取）；`projects/{pid}/integration/sync-history`（GET 分页）。
- **权限点**：`ORG_INTEGRATION:READ/UPDATE`（新增，组织管理员组）；项目侧复用 `PROJECT_BUG:UPDATE`（同步动作属缺陷编辑语义）+ 关联配置 `PROJECT_SETTING:UPDATE`（S1 既有，若无此点则登记复用 PROJECT_BUG:UPDATE）。
- **错误码**：`INTEGRATION_NOT_FOUND 70010`、`INTEGRATION_CONNECT_FAILED 70011`、`PLATFORM_SYNC_CONFIG_INVALID 70012`、`SYNC_TASK_FAILED 70013`、`PLATFORM_UNAUTHORIZED 70014`、`INTEGRATION_SECRET_MISSING 70015`（env 未配时保存集成）。
- **审计**：集成保存/删除/测试连接/每次同步动作（SYS-008 withAudit）。

## 5. 测试用例

- INTG-001-T1（jmx 四类）：组织集成 PUT（合法+测试连接 mock）/GET 信封（凭据掩码断言）；401/403（非组织管理员）/404；地址非法 422、authType 非法 422；env 缺失 70015。
- INTG-001-T2（spec 端到端推送）：配置集成（mock Jira 端点）→ 项目关联 → 建本地 Bug →「同步」→ mock 平台返回 key → 断言 platformKey/syncState=SYNCED/platform 徽标（UI+接口）→ 再同步走更新分支（mock 收到 issue 更新）。
- INTG-001-T3（spec 拉取回写）：预置 SYNCED Bug → mock syncBugs 返回状态 done → 拉取 → 本地 status 映射「已解决」+ ChangeLog 留痕 platform-sync → 定时路径（缩短 cron 触发一次）同结果。
- INTG-001-T4（spec 断链两态）：runner 停止 → 同步报 70004 任务失败本地数据无损；mock 平台 401 → 70014 提示重新配置。
- 单测：credential-crypto 加解密矩阵（往返/篡改密文/密钥不符/env 缺失）、字段映射表、状态映射表（默认+覆盖）、增量 since 计算、syncState 状态机。

## 6. 竞品深度对标

基线 §8.4/§9.2/§七 主体复刻（组织配置+项目关联+双向+手动/自动+增量）。差异：①Jira 企业版口径→本项目标准版（plan 既定，登记）；②字段映射固定规则非可视化编辑器（登记）；③删除/评论同步延后（登记）；④FULL 模式=拉取全量比对回写（不含删除对账，S7 前评审）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：加密密钥 env 部署口径（README+CI secret）；runner jira 插件与 mock Jira（e2e 栈 apps/mock 扩 /mock-jira 路由）契约一致。

## 8. 勘误登记

（暂无）
