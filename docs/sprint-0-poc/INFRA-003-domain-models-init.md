# 数据模型基线（Prisma 一次建齐）

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | INFRA-003 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0（本迭代最重的基建） |
| 文档状态 | Approved（P0 起步授权） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | INFRA-001；架构 test-domain-model 全文、rules/database |
| 下游消费 | SYS/CASE/API/EXEC/RPT 全部（一切实体来源） |
| 上游依据 | test-domain-model §2 实体总览、§6 一次建齐原则 |
| 对标基线 | 功能清单 §十三六域；表结构为自主设计 |
| 高保真确认 | 不适用（契约=schema 快照） |

## 1. 概述

在 `packages/db/prisma/schema.prisma` **一次性建模 test-domain-model §2 全部实体（八域约 45 模型，含未启用列）**，P0 仅暴露：User/Organization/Project/ProjectMember/FunctionalCase/ExecTask/ExecStepResult/Report 相关。附通用横切：软删、ChangeLog、Comment、Follow、advisory lock 编号。

### 范围边界
✅：全部实体建列+索引；`nextNum()`（advisory lock）；软删 mixin 语义；seed（SystemParam 默认行）。
❌：未启用实体的 API/UI；业务校验（后续规格逐个接管）。

## 2. 业务逻辑

- 编号：事务内 `SELECT pg_advisory_xact_lock(hashtext('{table}'), {projectId})` → `max(num)+1`；对外展示 `P{projNum}-C{0001}` 式（P0 只落 num）。
- 软删：`deletedAt` 可空；默认查询排除；回收站 `recycled=true`；restore 置空；purge 物理删除。
- 变更历史：ChangeLog(entityType, entityId, seq, diff Json) 白名单字段 diff（P0 仅 FunctionalCase 接线）。

## 3. UI/UX 设计
不适用。

## 4. 技术架构

域→模型清单（完整列见 schema，此处列关键约束）：

| 域 | 模型（P0 启用★） |
| --- | --- |
| system | User★, Organization★, Project★, ProjectMember★, Group, GroupMember, ResourcePool★, Plugin, AuditLog, Notification, Robot, ApiKey, SystemParam★, License |
| project | ModuleNode★(scene), FieldDef, Template, WorkflowState, WorkflowTransition, Environment, EnvGroup, GlobalParam, FileItem, FileRepo, PublicScript, FalseAlarmRule, AppSetting |
| case | FunctionalCase★, CaseReview, ReviewCase, CaseDependency, CaseDemandRef, Comment★, ChangeLog★, Follow★ |
| plan | TestPlan, TestPoint, PlanCaseRef, PlanReport |
| bug | Bug, BugCaseRef, PlatformSyncConfig |
| api_test | ApiDefinition, ApiCase, ApiMock, Scenario, ScenarioStep |
| exec | ExecTask★, ExecItem★, ExecStepResult★ |
| report | Report★, ReportShare, FalseAlarmHit |

约定：UUID `@default(uuid())`（应用侧生成传入亦允许）；`steps/request/config/payload` Json；状态列 String + zod（不用 PG enum）；外键 `onDelete` 显式（业务主体 Restrict、横切 Cascade）；复合索引 `(projectId, deletedAt)` 族；`version Int @default(1)` 乐观锁（编辑型实体）。

## 5. 测试用例
- INFRA-003-T1：空库 `prisma migrate deploy` 成功；`prisma migrate diff` 快照一致（CI 步骤）
- INFRA-003-T2：`nextNum()` 并发 50 取号不重不漏（Vitest 集成）
- INFRA-003-T3：软删/恢复/物理删除三态行为单测

## 6. 竞品深度对标
MeterSphere 六域 MyBatis 实体 → 本项目八域 Prisma 模型（exec/report 独立成域是本项目决策：报告=事件视图）。多态引用 (refType,refId) 与其 BaseAssociateProvider 同构。

## 7. 里程碑与验收
schema 与 test-domain-model §2 逐实体核对一致（验收标准 7 前半）；跨域引用 CI 静态检查（executor 域无 case 域 import）规则由 lint 承担。
