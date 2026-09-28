# 测试域统一数据模型

| 元信息项 | 内容                                                                                      |
| -------- | ----------------------------------------------------------------------------------------- |
| 文档层级 | 架构文档（全局约束）                                                                      |
| 状态     | 已确认（Approved）                                                                        |
| 对标基线 | MeterSphere 功能清单 §十三（六域后端模块）；MeterSphere `framework/provider` 关联用例机制 |
| 下游消费 | INFRA-003（建表基线）、全部业务规格 §4                                                    |
| 实现规范 | 本文件定义实体与关系；**落地写法（命名/类型/索引/查询/迁移）见 `rules/database.md`**      |

---

## 1. 域划分（对齐 MeterSphere 六域，另拆 exec/report）

`system / project / case / plan / bug / api_test / exec / report / ai`

> ai 域为 S7 新增（2026-09-27 随 Sprint 7 规格评审入库，见 §2.8 与 §6 例外登记）。

## 2. 核心实体总览（仅列关键列；完整 DDL 在各规格产出）

### 2.1 system 域

| 实体                                                            | 关键列                                             | 备注                                  |
| --------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------- |
| User                                                            | email 唯一、status                                 | 密码 Argon2                           |
| Organization / Project                                          | org FK、owner、status(enabled/ended)               | 项目删除=软删 30 天可撤销（对齐基线） |
| Group / GroupMember                                             | scope(system/org/project)、permissions JSONB       | 权限点集合，见 rbac 文档              |
| ResourcePool                                                    | type(node/k8s)、nodes、max_concurrency、is_default | 标准版限 1 默认池（License 门控新增） |
| Plugin / AuditLog / Notification / Robot / ApiKey / SystemParam | —                                                  | 见各规格                              |

### 2.2 project 域

| 实体                                                     | 关键列                                                        | 备注                             |
| -------------------------------------------------------- | ------------------------------------------------------------- | -------------------------------- |
| ModuleNode                                               | scene(case/api/scenario/bug/file)、parent、name、order        | **一张通用模块树表**，scene 区分 |
| Template / FieldDef / WorkflowState / WorkflowTransition | scene、fields JSONB、org/project 两级                         | 见 dynamic-template-fields.md    |
| Environment / EnvGroup / GlobalParam                     | config JSONB（变量/域名/数据库/host/前后置/断言/证书）        | 环境整体一个 JSONB 文档 + 版本   |
| FileItem / FileRepo                                      | module FK、storage_key、repo_ref(平台/分支/路径)、jar_enabled |                                  |
| PublicScript / FalseAlarmRule / AppSetting               | —                                                             | AppSetting 为项目应用配置 KV     |

### 2.3 case 域

| 实体                    | 关键列                                                                        | 备注                               |
| ----------------------- | ----------------------------------------------------------------------------- | ---------------------------------- |
| FunctionalCase          | module FK、template FK、fields JSONB、steps JSONB、tags[]、level、status、num | 步骤（前置/步骤/预期）结构化 JSONB |
| CaseReview / ReviewCase | review_mode(single/multi)、reviewers、result、re_submit                       | 重新提审由变更触发                 |
| CaseDependency          | pre_case / post_case 自关联                                                   |                                    |
| CaseDemandRef           | (entity_type, entity_id) 多态                                                 | 关联 Jira/TAPD/禅道需求            |
| 评论/变更历史           | 通用组件                                                                      | 见 §4                              |

### 2.4 plan 域

| 实体        | 关键列                                                                                                | 备注                             |
| ----------- | ----------------------------------------------------------------------------------------------------- | -------------------------------- |
| TestPlan    | group FK（计划组）、module、plan_dates、tags、settings JSONB(阈值/重复关联/自动更新状态)、archived_at | 计划组=parent plan（type=group） |
| TestPoint   | plan FK、parent、inherit_config                                                                       | 测试点树                         |
| PlanCaseRef | plan FK、point FK、**ref_type(case/api_case/scenario)、ref_id**、config(环境/资源池/串并行/失败停止)  | ★多态引用，见 §3                 |
| PlanReport  | summary、threshold_result、share_token                                                                | 聚合视图                         |

### 2.5 bug 域

| 官体                | 关键列                                                                                | 备注                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Bug                 | template FK、fields JSONB、platform(local/jira/zentao/tapd)、platform_key、sync_state |                                                                                                |
| BugCaseRef          | bug FK、ref_type、ref_id                                                              | 多态                                                                                           |
| PlatformSyncConfig  | platform、project_key、mode(incr/full)、cron                                          | 项目应用设置                                                                                   |
| PlatformIntegration | org FK、platform、address、auth_type、credential(AES-GCM 密文)、test_status/tested_at | S6 建表（INTG-001：组织级服务集成；凭据 env RABBIT_INTEGRATION_SECRET 派生密钥加密，永不回显） |

### 2.6 api_test 域

| 实体                    | 关键列                                                                            | 备注                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ApiDefinition           | module FK、method、path、protocol、request JSONB、response JSONB、status、version | API-CASE diff 基础                                                             |
| ApiCase                 | api FK、request JSONB(覆盖差量)、level、status、tags                              |                                                                                |
| ApiMock                 | api FK、matchers JSONB、response JSONB、follow_api                                |                                                                                |
| Scenario / ScenarioStep | steps 树（自关联 parent + order + step_type + config JSONB）                      | 7 类步骤：ref_api/ref_case/ref_scenario/custom/loop/condition/once/script/wait |
| 变更历史                | 通用组件                                                                          | API/场景均启用                                                                 |

### 2.7 exec / report 域（本项目新拆，MeterSphere 分布在各域）

| 实体           | 关键列                                                                                       | 备注                                  |
| -------------- | -------------------------------------------------------------------------------------------- | ------------------------------------- |
| ExecTask       | task_type(api_case/scenario/plan)、target 多态、pool FK、env FK、status、client_task_id      | 状态机见引擎文档                      |
| ExecItem       | task FK、ref_type/ref_id、status、result JSONB                                               | 一个用例/场景=一个 item               |
| ExecStepResult | item FK、step_path、request_snapshot、response_summary、asserts JSONB、logs_ref              | **事件流存储，报告是视图**            |
| Report         | report_type(api_case/scenario/plan)、source(FK task)、share_token、expire_at、snapshot JSONB | 分享=只读快照，避免源数据清理影响分享 |
| FalseAlarmHit  | report FK、rule FK                                                                           | 误报标记                              |

### 2.8 ai 域（S7 新增；对齐 MeterSphere framework/ai-engine + services/system-setting 的 AI 会话）

| 实体             | 关键列                                                                                   | 备注                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| AiModel          | name、provider(deepseek/openai/zhipu)、base_url、model、api_key_enc、enabled、is_default | 系统级；**apiKey AES-256-GCM 密文**（密钥自 SESSION_SECRET 派生，不落库） |
| AiConversation   | user_id、title、deleted_at                                                               | 个人级会话（软删）；消息子表随会话删除清理                                |
| AiMessage        | conversation FK、role(user/assistant)、content Json                                      | 对话消息；content 结构化（text + 预留 refs）                              |
| AiPromptTemplate | project FK、scene(case_gen/api_gen)、template、design_method、is_default                 | 项目级提示词模板；`{{requirement}}` 等占位符                              |
| AiGenRecord      | project/user/model FK、scene、generated_count、imported_count、prompt_snapshot Json      | 生成留痕（审计/回溯）；prompt 快照为组装后全文                            |

**Provider 边界**：ai 域消费 case 域（生成功能用例草稿→经既有 CASE-001 创建端点导入）与 api_test 域（读 ApiDefinition、生成接口用例草稿→经既有 API-003 创建导入）；**不反向依赖**（case/api_test 不感知 ai）。模型网关为 web 内服务（非 engine：LLM 调用读 DB 配置，engine 无 DB 红线不破）。

**FK 形态**：与 FalseAlarmRule 同款——裸列（无 Prisma relation），避免动 User/Project 存量模型；一致性由 service 层保证。

## 3. 多态引用与 Provider 接口（跨域解耦核心）

计划关联三类用例、缺陷关联用例、执行目标引用——统一 `(ref_type, ref_id)`，读取经域 Provider：

```python
class CaseRefProvider(Protocol):
    def list_ref_summary(self, ids: list[UUID]) -> list[RefSummary]      # 名称/编号/状态/所属模块
    def batch_validate(self, ids) -> dict[UUID, bool]                    # 计划执行前校验存在性
```

**规则**：`plan / bug / exec / report` 域禁止直接 FK 或 import `case/api_test` models；新增可被执行的用例类型（未来 UIT/LOAD）只需注册 Provider 实现，不改计划与引擎核心表——对齐 MeterSphere `BaseAssociateCaseProvider` 思路。

## 4. 横切机制

| 机制     | 实现                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 变更历史 | `ChangeLoggedModel` 抽象基类：保存时 diff 白名单字段 → `ChangeLog(entity_type, entity_id, seq, diff JSONB)`，前端「变更历史」Tab 统一读取 |
| 评论     | `Comment(entity_type, entity_id, content, mentions[], parent)` 通用表，@提及触发消息通知                                                  |
| 回收站   | 软删除 + `?recycled=true` + restore/purge 端点（CASE/BUG/API/SCENARIO 共用机制）                                                          |
| 关注     | `Follow(user, entity_type, entity_id)` 通用表，变更触发通知                                                                               |
| 编号     | 各实体 `num`（项目内 advisory lock 自增），对外 `P-{projNum}-C-0001` 式展示                                                               |

## 5. 执行/报告数据流

```
ExecTask(编排) → BullMQ → engine 执行 → ExecStepResult 事件流回写(Redis Stream → 批量落库)
                                    → Report 聚合生成（异步）→ 分享快照 / PDF 导出
```

**决策**：报告不做实时物化大表，报告详情=对 ExecItem/StepResult 的按需聚合 + 缓存；列表页统计（通过率等）在 item 级冗余列上聚合。

## 6. 一次建齐原则（硬约束）

- §2 所列实体在 **INFRA-003 于 `packages/db/prisma/schema.prisma` 一次性建模**（JSONB 用 Prisma `Json` 类型；项目内自增编号经 `$queryRaw` advisory lock 实现），含暂不启用列（如 `platform` 三方字段、`group` 计划组列、误报命中表）
- 不依赖未来新表的列全部建齐；依赖未来新表的 FK 以注释预留（与 RabbitProjects 同款纪律）
- 新增列需求必须在规格文档中说明「为何 P0 无法建齐」，并经架构评审
- **例外登记（S7，2026-09-27）**：ai 域 5 表未在 INFRA-003 建齐——基线期（S0）ai 域无任何规格输入（供应商协议形状、apiKey 加密列、提示词占位符结构均依赖 AI-001~005 规格定型），属「依赖未来规格的表结构」而非「可预见的暂不启用列」，不违反本节原则；本次随 Sprint 7 一次建齐全部列（含 AiGenRecord.prompt_snapshot、AiMessage.content.refs 等启用即满列），后续迭代仅开关/种子/索引
- **例外登记（S5，2026-09-28）**：`file_items` 增 `branch`(VarChar 128)/`repo_path`(VarChar 512) 两可空列——分支/路径属**仓库文件行级溯源属性**，其形态（单文件路径 vs 目录、分支命名约束、与 storageKey 的关系）依赖 FILE-001 规格定型，基线期（S0）无该规格输入，属「依赖未来规格的表结构」而非「可预见的暂不启用列」，与 S7 ai 域例外同类不违反本节原则；除此之外 S5 全部实体（robots/notifications/env_groups/global_params/public_scripts/file_repos）均已在 INFRA-003 建齐零 DDL，事件配置复用 app_settings 键值不建表
- **例外登记（S-future，2026-09-28）**：`resource_pools` 增 `config`(JSONB NOT NULL DEFAULT '{}') 列——K8S 型池配置结构（apiServer/namespace/token/image 及后续 ENTP-006 细化字段）在 EXEC-002 建模时点未冻结（K8S 型当时仅以 `type` 枚举值预声明，配置形态依赖 EXEC-004 规格定型、多池边界属 ENTP-006 未决），属「依赖未来规格的表结构」而非「可预见的暂不启用列」，与 S7/S5 例外同口径不违反本节原则；以 Json 载体一次补齐后，后续 K8S 细化只动 Json 内部结构不动 DDL
