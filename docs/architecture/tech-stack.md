# 技术栈确认与版本锁定

| 元信息项 | 内容 |
| --- | --- |
| 文档层级 | 架构文档（全局约束） |
| 状态 | 已确认（Approved） |
| 最后更新日期 | 2026-09-26 |
| 下游消费 | 全部 sprint 与功能规格文档、AGENTS.md §2 |
| 决策原则 | **全栈 TypeScript 单语言 Monorepo**（用户决策）；中间件最少化（仅 PG + Redis + MinIO） |

---

## 1. 选型总表

| 层次 | 选型 | 版本锁定 | 说明 |
| --- | --- | --- | --- |
| 工程结构 | pnpm workspace + Turborepo（**纯 TypeScript**） | pnpm 9 / Turbo 2 | 单语言仓，无跨语言工具链 |
| 应用框架 | **Next.js（App Router）+ React 19 + TypeScript** | Next 15 / React 19 / TS 5.x | **全栈单应用** `apps/web`：UI + API（Route Handlers，REST `/api/v1`）+ Server Actions 同仓承载 |
| UI 体系 | Ant Design（React 19 兼容版本）+ Tailwind CSS 4 + lucide-react | — | AntD 提供企业级表格/表单/树组件（复刻 MeterSphere 交互密度所需）；MeterSphere 前端为 Vue3+Arco，本项目按用户决策用 React |
| 状态与数据 | TanStack Query（服务端状态）+ Zustand（客户端状态） | — | 与 RSC/App Router 适配的请求缓存与轻量全局态 |
| 重交互组件 | TanStack Table、@antv/x6、Monaco Editor | — | 表格（列表通用能力）、**脑图画布**（用例/评审/执行三态脑图）、脚本编辑器 |
| 校验与契约 | zod（schema 单一来源）+ zod-to-openapi → openapi-typescript | — | schema 定义于 `packages/shared`；OpenAPI 与 TS 客户端全部生成 |
| ORM | Prisma | 6.x | `packages/db` 唯一数据访问出口（schema + migration + client） |
| **数据库** | **embedded-postgres**（@embedded-postgres/node）+ Prisma | PG 16 | **开发与单机部署内嵌运行、免外部数据库**；`DATABASE_URL` 可切换外部 PostgreSQL（生产集群/企业版资源池场景） |
| 异步任务 | BullMQ（worker + repeatable 定时任务）+ Redis | BullMQ 5 / Redis 7 | 定时执行（计划/场景/Swagger 同步/缺陷同步）、报告异步生成、事件流 |
| 实时通道 | **SSE**（Next Route Handler 流式响应） | — | 执行日志/任务状态推送；Redis Stream 存档支持断线按 seq 续传（无需独立 WS 服务） |
| **执行引擎** | **Node.js TypeScript worker（`apps/engine`）** | Node 20+ / undici | 自研采样内核（p-limit 并发槽），**不用 JMeter**（详见 engine-execution-architecture.md） |
| Mock 服务 | Hono（Node，`apps/mock`） | — | 高频无状态匹配，独立进程横向扩容 |
| 插件运行时 | `apps/plugin-runner`（worker_threads 隔离） | — | 协议/平台/驱动插件进程隔离加载（详见 plugin-architecture.md） |
| 对象存储 | MinIO（S3 兼容） | — | 附件、文件管理、JAR/CSV、插件包、报告导出 |
| PDF 导出 | Playwright（服务端渲染报告页 → PDF） | — | 计划报告/接口报告导出 |
| AI 接入 | OpenAI 兼容协议客户端 | — | DeepSeek / 智谱 / OpenAI 三 provider 起步，模型网关统一抽象 |
| 部署 | 默认 4 进程：web（含内嵌 PG）+ engine + mock + redis（+minio）；Docker Compose 一键 | — | 企业版 K8S 资源池 = P4（Helm） |
| 质量工具 | Vitest + coverage（单测）；Playwright（E2E）；oxlint + oxfmt（Lint/格式） | — | 主链路 E2E 作为 Release Gate |

## 2. 关键替换决策（相对 MeterSphere）

| MeterSphere 实现 | 本项目实现 | 理由 |
| --- | --- | --- |
| Java Spring Boot 模块化单体 + Vue3 前端 | **全栈 Next.js 单应用（TS）** | 用户决策：团队栈统一 TypeScript；前后端同仓共享 zod schema/类型，契约漂移在编译期暴露 |
| 外部 MySQL/Redis/Kafka/MinIO 多中间件部署 | **embedded-postgres 内嵌 + Redis + MinIO**（中间件仅 3 个） | 开发与单机部署零外部 DB 依赖；Kafka 用 Redis（BullMQ + Stream）替代，减少运维面 |
| 内嵌 JMeter 5.6.3 引擎 | 自研 Node.js worker 内核（undici） | 摆脱 JVM 与 jmx 运行时；执行日志/变量/断言模型原生可控；保留 jmx **格式导入**兼容（转换器） |
| pf4j Java 插件 | TS 插件包 + plugin-runner（worker_threads）隔离 | 见 plugin-architecture.md；**明确不兼容** pf4j jar 生态 |
| WebSocket 推送 | SSE（Route Handler 流式） | 单向日志/状态推送足够；免独立 WS 服务，Next 原生支持 |

## 3. 版本锁定纪律

- 依赖版本在 `pnpm-lock.yaml` 锁定，升级走独立 PR + 全量回归
- PostgreSQL / Redis 大版本升级视为 INFRA 级变更，需架构评审（embedded-postgres 与外部 PG 版本对齐验证）
- Node 运行时版本在 `.nvmrc` 固定

## 4. 环境要求

Node.js 20+、Redis 7+（可选外部 PostgreSQL 16）。
开发态 `pnpm dev` 自动初始化 embedded-postgres 数据目录并执行 `prisma migrate deploy` + 种子数据。
