# 测试域统一数据模型

| 元信息项 | 内容 |
| --- | --- |
| 文档层级 | 架构文档（全局约束） |
| 状态 | 已确认（Approved） |
| 对标基线 | MeterSphere 功能清单 §十三（六域后端模块）；MeterSphere `framework/provider` 关联用例机制 |
| 下游消费 | INFRA-003（建表基线）、全部业务规格 §4 |
| 实现规范 | 本文件定义实体与关系；**落地写法（命名/类型/索引/查询/迁移）见 `rules/database.md`** |

---

## 1. 域划分（对齐 MeterSphere 六域，另拆 exec/report）

`system / project / case / plan / bug / api_test / exec / report`

## 2. 核心实体总览（仅列关键列；完整 DDL 在各规格产出）

### 2.1 system 域
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| User | email 唯一、status | 密码 Argon2 |
| Organization / Project | org FK、owner、status(enabled/ended) | 项目删除=软删 30 天可撤销（对齐基线） |
| Group / GroupMember | scope(system/org/project)、permissions JSONB | 权限点集合，见 rbac 文档 |
| ResourcePool | type(node/k8s)、nodes、max_concurrency、is_default | 标准版限 1 默认池（License 门控新增） |
| Plugin / AuditLog / Notification / Robot / ApiKey / SystemParam | — | 见各规格 |

### 2.2 project 域
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| ModuleNode | scene(case/api/scenario/bug/file)、parent、name、order | **一张通用模块树表**，scene 区分 |
| Template / FieldDef / WorkflowState / WorkflowTransition | scene、fields JSONB、org/project 两级 | 见 dynamic-template-fields.md |
| Environment / EnvGroup / GlobalParam | config JSONB（变量/域名/数据库/host/前后置/断言/证书） | 环境整体一个 JSONB 文档 + 版本 |
| FileItem / FileRepo | module FK、storage_key、repo_ref(平台/分支/路径)、jar_enabled | |
| PublicScript / FalseAlarmRule / AppSetting | — | AppSetting 为项目应用配置 KV |

### 2.3 case 域
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| FunctionalCase | module FK、template FK、fields JSONB、steps JSONB、tags[]、level、status、num | 步骤（前置/步骤/预期）结构化 JSONB |
| CaseReview / ReviewCase | review_mode(single/multi)、reviewers、result、re_submit | 重新提审由变更触发 |
| CaseDependency | pre_case / post_case 自关联 | |
| CaseDemandRef | (entity_type, entity_id) 多态 | 关联 Jira/TAPD/禅道需求 |
| 评论/变更历史 | 通用组件 | 见 §4 |

### 2.4 plan 域
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| TestPlan | group FK（计划组）、module、plan_dates、tags、settings JSONB(阈值/重复关联/自动更新状态)、archived_at | 计划组=parent plan（type=group） |
| TestPoint | plan FK、parent、inherit_config | 测试点树 |
| PlanCaseRef | plan FK、point FK、**ref_type(case/api_case/scenario)、ref_id**、config(环境/资源池/串并行/失败停止) | ★多态引用，见 §3 |
| PlanReport | summary、threshold_result、share_token | 聚合视图 |

### 2.5 bug 域
| 官体 | 关键列 | 备注 |
| --- | --- | --- |
| Bug | template FK、fields JSONB、platform(local/jira/zentao/tapd)、platform_key、sync_state | |
| BugCaseRef | bug FK、ref_type、ref_id | 多态 |
| PlatformSyncConfig | platform、project_key、mode(incr/full)、cron | 项目应用设置 |

### 2.6 api_test 域
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| ApiDefinition | module FK、method、path、protocol、request JSONB、response JSONB、status、version | API-CASE diff 基础 |
| ApiCase | api FK、request JSONB(覆盖差量)、level、status、tags | |
| ApiMock | api FK、matchers JSONB、response JSONB、follow_api | |
| Scenario / ScenarioStep | steps 树（自关联 parent + order + step_type + config JSONB） | 7 类步骤：ref_api/ref_case/ref_scenario/custom/loop/condition/once/script/wait |
| 变更历史 | 通用组件 | API/场景均启用 |

### 2.7 exec / report 域（本项目新拆，MeterSphere 分布在各域）
| 实体 | 关键列 | 备注 |
| --- | --- | --- |
| ExecTask | task_type(api_case/scenario/plan)、target 多态、pool FK、env FK、status、client_task_id | 状态机见引擎文档 |
| ExecItem | task FK、ref_type/ref_id、status、result JSONB | 一个用例/场景=一个 item |
| ExecStepResult | item FK、step_path、request_snapshot、response_summary、asserts JSONB、logs_ref | **事件流存储，报告是视图** |
| Report | report_type(api_case/scenario/plan)、source(FK task)、share_token、expire_at、snapshot JSONB | 分享=只读快照，避免源数据清理影响分享 |
| FalseAlarmHit | report FK、rule FK | 误报标记 |

## 3. 多态引用与 Provider 接口（跨域解耦核心）

计划关联三类用例、缺陷关联用例、执行目标引用——统一 `(ref_type, ref_id)`，读取经域 Provider：

```python
class CaseRefProvider(Protocol):
    def list_ref_summary(self, ids: list[UUID]) -> list[RefSummary]      # 名称/编号/状态/所属模块
    def batch_validate(self, ids) -> dict[UUID, bool]                    # 计划执行前校验存在性
```

**规则**：`plan / bug / exec / report` 域禁止直接 FK 或 import `case/api_test` models；新增可被执行的用例类型（未来 UIT/LOAD）只需注册 Provider 实现，不改计划与引擎核心表——对齐 MeterSphere `BaseAssociateCaseProvider` 思路。

## 4. 横切机制

| 机制 | 实现 |
| --- | --- |
| 变更历史 | `ChangeLoggedModel` 抽象基类：保存时 diff 白名单字段 → `ChangeLog(entity_type, entity_id, seq, diff JSONB)`，前端「变更历史」Tab 统一读取 |
| 评论 | `Comment(entity_type, entity_id, content, mentions[], parent)` 通用表，@提及触发消息通知 |
| 回收站 | 软删除 + `?recycled=true` + restore/purge 端点（CASE/BUG/API/SCENARIO 共用机制） |
| 关注 | `Follow(user, entity_type, entity_id)` 通用表，变更触发通知 |
| 编号 | 各实体 `num`（项目内 advisory lock 自增），对外 `P-{projNum}-C-0001` 式展示 |

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
