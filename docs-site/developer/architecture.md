# 架构概览

RabbitAITest 是一个纯 TypeScript Monorepo（pnpm workspace + Turborepo），由四个应用与三个共享包组成。本文给出模块划分、执行链路与关键设计约束，帮助二次开发者快速建立全局认知。

## 模块划分

```
RabbitAITest/
├── apps/
│   ├── web/            # 全栈 Next.js：UI + REST API（/api/v1，Route Handlers）
│   ├── engine/         # 执行引擎：Node.js worker（自研，不用 JMeter）
│   ├── mock/           # Mock 服务（Hono）
│   └── plugin-runner/  # 插件运行时（worker_threads 隔离宿主）
├── packages/
│   ├── shared/         # zod schema、权限点、错误码、执行契约（单一事实源）
│   ├── db/             # Prisma schema + migration + seed（数据库唯一出口）
│   └── api-client/     # 由 OpenAPI 生成的 API 客户端（前端禁手写接口路径）
├── plugins/            # 仓库自带插件：tcp-conn / websocket / mqtt / jira / zentao / tapad…
├── rules/              # 工程细则（测试、数据库、引擎、安全、协作等）
└── docs/               # 内部研发文档（规格、架构、迭代记录）
```

## 一次接口执行的生命周期

```
浏览器（Web 控制台）
   │  创建执行任务（api_debug / api_case / scenario / plan）
   ▼
apps/web  ──►  BullMQ 队列 exec-pool-{poolId}（默认池恒为 exec）
   ▲                    │
   │                    ▼
   │            apps/engine  worker
   │            （kernel 纯函数：渲染 → 采样 → 断言 → 提取）
   │                    │
   │                    ├─► Redis Stream 事件流（seq 单调，TTL 24h）
   │                    │        ▼
   └──── SSE 实时转发 ◄── apps/web Route Handler（断线续传）
   │
   └──── 终态回调 ◄──── engine → web（指数退避 ≤ 5 次，INTERNAL_TOKEN 鉴权）
```

要点：

- **引擎无数据库依赖**：执行所需的环境变量、公共脚本等由 web 构建快照随任务注入；`apps/engine` 不得 import `apps/web` 与 `packages/db`（CI 边界检查）。
- **并发**：并行执行按 item 级 p-limit 取资源池并发上限（由心跳动态下发，初始 4）。
- **协议扩展**：HTTP 走内置 undici 管线；其它协议（tcp / websocket / mqtt）由协议插件提供，引擎进程内加载启用清单，采样热路径不跨进程。

## 执行契约与事件流

- 执行契约版本 **v4**：命令 4 类（`api_debug` / `api_case` / `scenario` / `plan`）、步骤类型 6 种（request / loop / condition / once / script / wait）、断言 6 种 × 操作符 7 个。
- 事件帧：`task-start` / `item-start` / `step-start` / `step-result` / `step-op` / `log` / `step-skip` / `item-final` / `task-final`，帧内 `seq` 任务内单调递增，前端据此实现断线续传。
- 脚本沙箱：quickjs，同步执行 5 秒中断强杀，API 白名单（`log` / `getVar` / `setVar` / `envGet` / `randomInt` / `now`），**无任何 IO**。

## Mock 服务

`apps/mock`（Hono）**无数据库、无状态**：规则来源是 web 写入 Redis 的项目全量快照，Mock 服务直读快照——保存规则即热更新，实例可横向扩容。多规则按「匹配条件最多者」优先，未命中返回 404（业务码 `40401`）。

## 插件体系

- **SPI 版本 1.0**，单一来源 `packages/shared/src/plugins/spi.ts`；插件清单声明于包 `package.json` 的 `rabbitPlugin` 字段（name / kind / version / spiVersion / entry），SPI 不兼容拒绝加载（错误码 70003）。
- **类型**：`protocol`（协议采样）/ `platform`（三方平台适配）/ `driver`（驱动）。
- **隔离**：每插件一个 worker_threads 线程；崩溃按 1s / 4s / 16s 退避重启，连续 3 次标记 ERROR；调用超时 30s。

## API 与权限

- 所有端点符合 `docs/architecture/api-conventions.md`：REST `/api/v1`、统一响应信封、错误码分段、分页、软删除。
- 请求 / 响应 schema 一律用 zod 定义于 `packages/shared`，OpenAPI 由 schema 生成，前端只能使用 `packages/api-client` 生成的客户端（CI 校验快照 diff）。
- 每个端点声明所需权限点（`withPermission()`），权限点共 109 个；导航 = 权限点 ∧ 项目模块开关双门控。

## 可观测性

- 结构化日志 + reqId 链路；三级审计日志（系统 / 组织 / 项目）。
- 引擎心跳注册（slots / busy / poolId），web 侧可观测资源池负载。

## 相关链接

- [二次开发指南](developer/contributing.md) —— 环境搭建、命令、工程规范
- [通用功能](manual/common/overview.md) —— 权限与模块开关的产品侧说明
- [资源池](manual/system/pools.md) · [插件管理](manual/system/plugins.md)
