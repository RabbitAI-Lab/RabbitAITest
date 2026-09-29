# 产品介绍

RabbitAITest 是一个**开源一站式测试工作台**，把测试管理（用例、评审、计划、缺陷）与接口测试（调试、定义、场景自动化、Mock、报告）整合到一个平台，并通过 AI 能力（用例生成、智能助手）提升测试效率。功能面对标 MeterSphere v3.x 社区版，以仓库内的《MeterSphere 功能清单》为唯一对标基线。

## 产品形态

RabbitAITest 由四个服务组成，一条 `pnpm dev` 即可全部启动：

| 组成 | 说明 |
| --- | --- |
| **Web 控制台**（`apps/web`） | 全栈 Next.js 应用：UI 与 REST API（`/api/v1`）同仓同应用 |
| **执行引擎**（`apps/engine`） | Node.js worker：HTTP 采样（undici）、并发槽、quickjs 脚本沙箱，事件流经 SSE 实时回传 |
| **Mock 服务**（`apps/mock`） | 独立无状态 Mock：规则快照直读、保存即热更新 |
| **插件运行时**（`apps/plugin-runner`） | worker_threads 隔离的插件宿主：协议插件、三方平台插件 |

数据库使用 **embedded-postgres** 内嵌 PostgreSQL（开发与单机部署免外部 DB），也可通过 `DATABASE_URL` 切换外部 PostgreSQL 16。异步任务基于 BullMQ + Redis。

?> 执行引擎是**自研**的：仅兼容 JMeter `jmx` 文件**导入格式**（映射常用子集），执行不依赖 JMeter。详见[接口测试概述](manual/api/overview.md)。

## 核心能力

| 能力域 | 提供什么 |
| --- | --- |
| 测试管理 | 功能用例（列表 / 脑图双模式）、用例评审（单人 / 多人）、测试计划（测试点、用例清单、脑图执行、计划组、报告导出 PDF/CSV 与分享）、缺陷管理（评论、@提及、回收站） |
| 接口测试 | 接口调试、接口定义与接口用例（八区 diff、变更历史、Mock 规则三合一详情页）、自动化场景（六类步骤、循环/条件/CSV、串行/并行、失败停止、定时任务）、误报规则、报告与多维统计 |
| Mock | 规则与接口定义同源维护、多规则按匹配条件最多者优先、延迟模拟、规则在线调试 |
| AI | 系统级模型网关（智谱 / DeepSeek / OpenAI，密钥加密落库、连接测试）、AI 生成功能用例 / 接口用例、顶栏流式智能助手、项目级提示词模板 |
| 协作 | 站内消息中心（未读徽标、90 天留存）、通知机器人五渠道（站内信/邮件/企微/钉钉/飞书）、11 类事件、全对象关注 |
| 平台管理 | 多组织多项目、RBAC（109 权限点，菜单 = 权限 ∧ 模块开关双门控）、环境与全局参数、公共脚本、文件管理、Jira/禅道/TAPD 缺陷同步、Swagger 定时同步、插件管理、资源池、三级审计日志、API Key |

## 数据兼容与迁移

从 MeterSphere 或其它工具迁入时，无需从零开始：

- **功能用例**：导入向导支持 `.xlsx` / `.xmind`，兼容 MeterSphere 官方导出模板；相同编号可选「跳过」或「覆盖」。
- **接口定义**：支持 OpenAPI 3、Postman 集合、Rabbit 自有格式导入，另支持单条 cURL 导入。
- **JMeter 场景**：`jmx` 文件按常用子集映射导入（HTTP 采样器、循环控制器、CSV 数据集、JSR223 脚本、定时器等）。

## 社区版与企业版

RabbitAITest 社区版提供完整的标准版功能。以下能力由企业版 License 门控，默认关闭：

| 特性 | 说明 |
| --- | --- |
| MULTI_ORG 多组织 | 系统级多组织管理、部门树 |
| SSO 单点认证 | 企业微信 / 钉钉 / 飞书 / CAS / OIDC / OAuth2.0 / LDAP 等 8 类认证源 |
| MULTI_POOL 多资源池 | 多执行资源池与组织分配 |
| THEME 主题品牌 | 登录横幅、界面品牌定制 |
| MSG_TEMPLATE 消息模板 | 11 类事件的自定义消息模板 |
| USER_SCALE 用户扩容 | 社区版默认 30 用户上限，企业版放开 |

?> 标准版（社区版）不包含 UI 测试与性能测试；导航中的对应入口为占位（默认关闭）。SQL 前后置处理器因安全策略暂未启用，界面上会显式报 `CONFIG_ERROR`，这不是 Bug。

## 技术栈速览

| 项 | 选型 |
| --- | --- |
| 工程结构 | pnpm workspace + Turborepo，纯 TypeScript Monorepo |
| 应用框架 | 全栈 Next.js（App Router + React 19），API 走 Route Handlers（REST `/api/v1`） |
| 前端 | React + Ant Design + Tailwind CSS + TanStack Query + Zustand |
| 数据库 | embedded-postgres（可切外部 PostgreSQL 16），ORM 为 Prisma |
| 异步 / 实时 | BullMQ + Redis；执行事件流经 Redis Stream + SSE 断线续传 |
| 执行引擎 | 自研 Node.js worker（undici 采样、p-limit 并发槽、quickjs 沙箱） |

## 相关链接

- [安装部署](quickstart/installation.md) —— 环境要求与启动步骤
- [快速体验](quickstart/quick-tour.md) —— 10 分钟主链路
- [架构概览](developer/architecture.md) —— 模块划分与执行链路
- [关于与版本](about.md) —— 版本历史与对标说明
