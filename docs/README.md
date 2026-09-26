# RabbitAITest 设计文档体系

> 一站式开源测试工作台 · 测试管理 + 接口测试 + AI · 全量设计文档导航索引

---

## 一、项目简介

RabbitAITest 是一套**复刻 [MeterSphere](https://metersphere.io) v3.x 社区版功能面**的开源一站式测试工作台，覆盖系统设置、项目管理、测试用例、测试计划、缺陷管理、接口测试（调试/定义/Mock/场景自动化）、工作台、消息协作、AI 能力九大模块，并预留企业版扩展层（SSO/多组织/多资源池/主题/消息模板/License）。产品节奏以「**2 周跑通 POC、8 周测试域核心可用、23 周标准版生产可用、27 周企业版核心交付**」为主线，严格按 P0→P4 优先级推进。

**对标基线**：[MeterSphere功能清单.md](./MeterSphere功能清单.md)（官方文档 + 代码库逆向调研产物）。每份功能规格必须注明对应的清单章节，v1.0 验收目标为社区版功能覆盖率 100%。

## 二、技术栈概要

| 层次      | 选型                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------- |
| 工程      | pnpm workspace + Turborepo **纯 TypeScript Monorepo**                                                             |
| 全栈框架  | **Next.js（App Router + React 19）**：UI 与 API（Route Handlers，REST /api/v1）同应用承载                         |
| 前端      | React 19 + Ant Design + Tailwind CSS + TanStack Query + Zustand + TanStack Table + @antv/x6（脑图）+ Monaco       |
| 数据库    | **embedded-postgres**（默认内嵌免外部 DB，`DATABASE_URL` 可外接 PostgreSQL 16）+ Prisma（`packages/db` 唯一出口） |
| 异步/实时 | BullMQ + Redis（定时任务 repeatable job）；SSE 事件流（执行日志，Redis Stream 续传）                              |
| 执行引擎  | 自研 Node.js 采样内核 worker（`apps/engine`，undici + p-limit，不用 JMeter；兼容 jmx 导入格式）                   |
| 部署      | 默认 4 进程：web（含内嵌 PG）+ engine + mock + redis（+minio）；Docker Compose 一键                               |
| 部署      | Docker Compose（标准版）/ Helm（企业版资源池）                                                                    |

详见 [architecture/tech-stack.md](architecture/tech-stack.md)。

## 三、文档体系（三层结构）

```
第一层：架构文档（architecture/，9 份）—— 全局约束，一次确定长期遵循
第二层：迭代概览（sprint-*/sprint-overview.md，11 份）—— 每个迭代交付什么、验收什么
第三层：功能规格（sprint-*/MODULE-NNN-*.md，82 份）—— 单功能完整规格（模板见 plan §三）
```

阅读路径：`glossary.md` → `architecture/tech-stack.md` → `architecture/test-domain-model.md` → 当前迭代概览 → 功能规格。
开发某功能前，必须先读其元信息表「上游依赖」列出的文档。

> **工作流硬性门禁**（文档先行、**高保真原型 + 人工确认后才能开发**、一次建齐数据模型、API 契约纪律等）统一定义在仓库根 [AGENTS.md](../AGENTS.md)（CLAUDE.md 与其同步），此处不重复。

## 四、迭代里程碑总览

| 里程碑 | 周     | Sprint                                                                | 主题                                         | 文档数 | 状态                                                                                     |
| ------ | ------ | --------------------------------------------------------------------- | -------------------------------------------- | ------ | ---------------------------------------------------------------------------------------- |
| M1     | W1-2   | [sprint-0-poc](./sprint-0-poc/sprint-overview.md)                     | POC 技术验证（P0）                           | 10     | **已验收 ✅**（2026-09-26 用户验收通过；E2E 17/17、JMeter 3/3、CI 六阶段绿；tag v0.1.0） |
| M2     | W3-5   | [sprint-1-mvp-test-mgmt](./sprint-1-mvp-test-mgmt/sprint-overview.md) | 测试管理 MVP（P1）                           | 11     | 概览 + 11 份规格已产出（Draft 待评审）                                                   |
| M3     | W6-8   | sprint-2-api-core                                                     | 接口测试核心（P1/P2）                        | 10     | 待产出                                                                                   |
| M4     | W9-11  | sprint-3-scenario-automation                                          | 场景自动化（P2）                             | 7      | 待产出                                                                                   |
| M5     | W12-14 | sprint-4-plan-mindmap                                                 | 计划完整与脑图（P2）                         | 7      | 待产出                                                                                   |
| M6     | W15-16 | sprint-5-collaboration                                                | 协作通知（P2）                               | 6      | 待产出                                                                                   |
| M7     | W17-19 | sprint-6-integration-plugin                                           | 集成与插件（P2/P3）                          | 7      | 待产出                                                                                   |
| M8     | W20-21 | sprint-7-ai                                                           | AI 能力（P2）                                | 5      | 待产出                                                                                   |
| M9     | W22-23 | sprint-8-stabilize                                                    | 稳定化 → **标准版 v1.0 GA**                  | 3      | 待产出                                                                                   |
| M10    | W24-27 | sprint-9-enterprise                                                   | 企业版核心（P3）→ v2.0                       | 8      | 待产出                                                                                   |
| —      | W28+   | sprint-future-p4                                                      | 远期：性能/UI 测试、协议插件、外部工具（P4） | 8      | 待产出                                                                                   |

各 Sprint 的完整文档清单见 [plan/迭代架构设计与功能规格拆解.md](./plan/迭代架构设计与功能规格拆解.md) §二目录树。

## 五、架构文档索引（9 份 · 全局约束）

| #   | 文档                                                                              | 标题                       | 备注                                    |
| --- | --------------------------------------------------------------------------------- | -------------------------- | --------------------------------------- |
| 1   | [tech-stack.md](architecture/tech-stack.md)                                       | 技术栈确认与版本锁定       | 含相对 MeterSphere 的五项替换决策       |
| 2   | [monorepo-structure.md](architecture/monorepo-structure.md)                       | Monorepo 仓库结构规范      | apps 六服务 + packages 三包             |
| 3   | [api-conventions.md](architecture/api-conventions.md)                             | REST API 统一规范          | 路径/信封/错误码分段/WS 通道            |
| 4   | [test-domain-model.md](architecture/test-domain-model.md)                         | 测试域统一数据模型         | 八域实体 + Provider 解耦 + 一次建齐原则 |
| 5   | [rbac-permission-model.md](architecture/rbac-permission-model.md)                 | 三级权限模型               | 权限点规范 + License 门控               |
| 6   | [dynamic-template-fields.md](architecture/dynamic-template-fields.md)             | 模板与动态自定义字段       | 10 类字段 + 缺陷工作流                  |
| 7   | [engine-execution-architecture.md](architecture/engine-execution-architecture.md) | 执行引擎与资源池架构       | ★本项目核心（自研引擎）                 |
| 8   | [plugin-architecture.md](architecture/plugin-architecture.md)                     | 插件体系（协议/平台/驱动） | ★TS 插件包 + worker_threads 隔离        |
| 9   | [dependency-graph.md](architecture/dependency-graph.md)                           | 模块依赖关系图             | DAG + 关键路径 + 禁止方向               |

## 六、功能规格索引（82 份 · 按迭代）

> 逐份索引随各迭代文档产出时在本节补全（当前仅 Sprint 0 列出）；清单章节 → 文档编号的**覆盖率映射表**在 Sprint 0 规格产出后建立，作为 v1.0 Release Gate 核对依据。

### Sprint 0 — POC（P0 · 10 份 · **已交付**）

[INFRA-001](./sprint-0-poc/INFRA-001-monorepo-scaffold.md) monorepo 脚手架｜[INFRA-002](./sprint-0-poc/INFRA-002-docker-compose.md) docker-compose｜[INFRA-003](./sprint-0-poc/INFRA-003-domain-models-init.md) 数据模型基线｜[SYS-001](./sprint-0-poc/SYS-001-registration-login.md) 注册登录｜[SYS-002](./sprint-0-poc/SYS-002-route-guard-isolation.md) 路由守卫与隔离｜[SYS-003](./sprint-0-poc/SYS-003-org-project-init.md) 组织项目初始化｜[CASE-001](./sprint-0-poc/CASE-001-case-crud.md) 用例 CRUD｜[API-001](./sprint-0-poc/API-001-http-debug.md) HTTP 调试｜[EXEC-001](./sprint-0-poc/EXEC-001-engine-kernel-v0.md) 引擎内核 v0｜[RPT-001](./sprint-0-poc/RPT-001-execution-report-mvp.md) 最小执行报告

### Sprint 1 — 测试管理 MVP（P1 · 11 份 · Draft 待评审）

[SYS-004](./sprint-1-mvp-test-mgmt/SYS-004-user-group-management.md) 用户与三级用户组｜[SYS-005](./sprint-1-mvp-test-mgmt/SYS-005-system-params.md) 系统参数｜[PROJ-001](./sprint-1-mvp-test-mgmt/PROJ-001-project-permission.md) 项目成员与权限｜[PROJ-002](./sprint-1-mvp-test-mgmt/PROJ-002-template-custom-fields.md) 模板与自定义字段（含缺陷工作流）｜[CASE-002](./sprint-1-mvp-test-mgmt/CASE-002-module-tree-list.md) 模块树与列表完整版｜[CASE-003](./sprint-1-mvp-test-mgmt/CASE-003-case-detail-association.md) 用例详情与关联｜[CASE-004](./sprint-1-mvp-test-mgmt/CASE-004-excel-xmind-io.md) Excel/Xmind 导入导出｜[CASE-005](./sprint-1-mvp-test-mgmt/CASE-005-case-review.md) 用例评审｜[BUG-001](./sprint-1-mvp-test-mgmt/BUG-001-local-bug-management.md) 本地缺陷管理｜[PLAN-001](./sprint-1-mvp-test-mgmt/PLAN-001-test-plan-basic.md) 测试计划基础｜[DASH-001](./sprint-1-mvp-test-mgmt/DASH-001-workbench-home.md) 工作台首页

### Sprint 2-10 与远期

见 [plan §二完整目录树](./plan/迭代架构设计与功能规格拆解.md)（Sprint 1：SYS-004~~005 / PROJ-001~~002 / CASE-002~~005 / BUG-001 / PLAN-001 / DASH-001；Sprint 2：API-002~~005 / PROJ-003~~004 / EXEC-002 / SYS-006 / RPT-002 / CASE-006；Sprint 3：API-006~~010 / EXEC-003 / RPT-003；Sprint 4：PLAN-002~~005 / CASE-007~~008 / DASH-002；Sprint 5：MSG-001 / BUG-002 / PROJ-005~~006 / FILE-001 / SYS-007；Sprint 6：PLUG-001~~002 / INTG-001~~003 / API-011 / SYS-008；Sprint 7：AI-001~~005；Sprint 8：QA-001~~002 / INFRA-004；Sprint 9：ENTP-001~~008；P4：LOAD-001~~002 / UIT-001 / PLUG-003 / TOOL-001~~002 / RPT-004 / EXEC-004）

## 七、支撑文档

| 文档                                                                       | 说明                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [需求文档.md](./需求文档.md)                                               | 产品需求总纲：模块需求、非功能需求、P0-P4 分级、范围红线、验收维度                                                                                                                                                                                                                                                                        |
| [glossary.md](./glossary.md)                                               | 术语表（含模型映射）                                                                                                                                                                                                                                                                                                                      |
| [plan/迭代架构设计与功能规格拆解.md](./plan/迭代架构设计与功能规格拆解.md) | 文档拆解计划：方法论、目录树、统一模板、执行阶段、依赖链、质量控制                                                                                                                                                                                                                                                                        |
| [MeterSphere功能清单.md](./MeterSphere功能清单.md)                         | 对标基线（调研产物，只读）                                                                                                                                                                                                                                                                                                                |
| [../rules/](../rules/)                                                     | 研发规范细则（8 份，AGENTS.md 引用）：`typescript`（通用编码）、`react-nextjs`、`database`（PG/Prisma/SQL/迁移）、`engine`（执行引擎）、`testing`（JMeter + Playwright 三类断言/录屏/截屏 + GLM-5.3-Flash 视觉还原度比对）、`security`、`git-workflow`（分支/PR/CI/发布）、`observability`（日志/链路）、`ai-collaboration`（人+AI 协作） |
| design/                                                                    | 高保真原型（随迭代产出，暂空）                                                                                                                                                                                                                                                                                                            |
