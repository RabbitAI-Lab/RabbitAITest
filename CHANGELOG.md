# Changelog

本项目的所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [Unreleased]

### Sprint 0 — POC 技术验证（2026-09-26）

#### 新增

- **基础设施**：pnpm + Turborepo 纯 TS Monorepo（apps：web/engine/mock/plugin-runner；packages：db/shared/api-client/ui）；Docker Compose 一键启动全栈（db/redis/minio/migrator/web/engine/mock）；本地零依赖开发（embedded-postgres + Docker Redis，`pnpm dev`）；husky pre-push + commitlint + oxlint/oxfmt。
- **数据模型**：Prisma 一次建齐八域 45 实体（含未启用列）；项目内 advisory lock 取号；软删/变更历史通用横切；幂等种子。
- **认证与组织**：邮箱注册/登录/登出（Argon2id + iron-session）；注册即建默认组织+演示项目+双场景模块树；middleware 路由守卫与 withAuth/withProjectScope 数据隔离（404 防枚举）。
- **测试用例**：功能用例 CRUD（名称/前置/步骤/等级/标签）、乐观锁 409、回收站（恢复/彻底删除二次确认）、变更历史落库。
- **接口测试**：HTTP 调试（8 方法/头/体 raw-json/断言：状态码+JSONPath）→ BullMQ 入队；执行引擎 v0（undici 采样、断言求值纯函数、失败三分类、Redis Stream 事件流、终态回调幂等、节点心跳注册、--local 本地模式）；最小报告页（请求/响应/断言明细/日志，SSE 实时 + Last-Event-ID 续传 + RUNNING 轮询兜底）；调试历史。
- **质量体系**：Playwright E2E 11 条全绿（每条含 UI/Console/接口三类断言，录屏 on-with-retry + trace + 截图，HTML 报告）；JMeter 接口自动化 3 计划（四类场景×四项断言）全绿；Vitest 单测（shared 契约/engine 断言求值）；GitHub Actions CI（lint/typecheck/unit/build/迁移重放/e2e/jmeter/audit）。
- **文档**：Sprint 0 十份功能规格 + 五组高保真原型（待人工确认）。

#### 修复

- **样式完全丢失事故（走查①发现）**：实现使用 Tailwind 工具类但从未安装 Tailwind——所有布局类失效，录屏中页面无样式。已安装 Tailwind v4（postcss + `@import 'tailwindcss'`）并修正 rem 基准（移除 `html{font-size:13px}`，对齐原型 16px 基准）；新增 VISUAL computed-style 断言防回归（rules/react-nextjs §5.5）。

#### 已知限制（登记去向）

- Prisma 列名暂为默认 camelCase（rules/database §2 的 snake_case 目标在 Sprint 1 以 @map 补齐，登记为 INFRA-003 勘误 1）
- api-client 为手工类型化（OpenAPI 自动生成在 Sprint 1 接入，登记为 INFRA-001 范围调整）
- undici 重定向跟随暂未启用（maxRedirections 在 v7 移除，Sprint 2 以 interceptor 接入）
