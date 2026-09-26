# Monorepo 骨架（pnpm + Turborepo 纯 TS）

| 元信息项     | 内容                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 文档编号     | INFRA-001                                                                   |
| 所属迭代     | Sprint 0 — POC 技术验证（第 1-2 周）                                        |
| 优先级       | P0（POC 阻塞级 · 迭代起点）                                                 |
| 所属模块     | M0-INFRA                                                                    |
| 文档状态     | Verified（用户验收通过 2026-09-26）                                         |
| 最后更新日期 | 2026-09-26                                                                  |
| 上游依赖     | 架构文档 tech-stack / monorepo-structure                                    |
| 下游消费     | 全部 Sprint 0 文档（INFRA-002/003 首当其冲）                                |
| 上游依据     | 需求文档 §五 P0、monorepo-structure.md 全文                                 |
| 对标基线     | MeterSphere 功能清单 §十三（多模块仓库结构思想）；实现为差异化决策（纯 TS） |
| 高保真确认   | 不适用（工程基建，契约=本文件 §4）                                          |

## 1. 概述

### 1.1 功能定位

建立 pnpm workspace + Turborepo 的纯 TypeScript Monorepo：4 个 apps（web/engine/mock/plugin-runner）+ 4 个 packages（db/shared/api-client/ui），配齐 lint/typecheck/test/build 任务管道。是所有 P0 功能的物理载体。

### 1.2 范围边界

| 能力                                                             | P0 ✅                                              | 后续                     |
| ---------------------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| workspace 结构 + turbo 管道（dev/lint/typecheck/test/build）     | ✅                                                 | —                        |
| oxlint + oxfmt + tsc --noEmit 基线（第一天真跑清零存量）         | ✅                                                 | —                        |
| packages/shared（zod 契约、错误码、枚举）                        | ✅                                                 | Sprint 1 扩权限点全集    |
| packages/db（Prisma schema + client 出口）                       | ✅（实体见 INFRA-003）                             | —                        |
| packages/api-client（信封+类型化客户端，SSE 封装）               | ✅（手工类型化；OpenAPI 自动生成在 Sprint 1 接入） | Sprint 1 生成管线        |
| packages/ui（Button/PageShell 等 3 个基础封装）                  | ✅                                                 | Sprint 1 起补表格/模块树 |
| apps/web（Next.js App Router 骨架 + API Route 结构）             | ✅                                                 | —                        |
| apps/engine / mock / plugin-runner（可启动的最小进程）           | ✅                                                 | Sprint 2/6 充实          |
| .github/workflows/ci.yml + PR 模板 + commitlint + husky pre-push | ✅                                                 | —                        |

### 1.3 前置依赖

无（本迭代起点）。

### 1.4 对标基线核对

清单 §十三为 Java 多 Maven 模块；本项目按 tech-stack 决策替换为纯 TS Monorepo（对标其「模块化」思想，不照抄结构）。超出基线：turbo 管道、共享 zod 契约。

## 2. 业务逻辑

不适用（工程基建）。关键决策：pnpm workspace `apps/*` `packages/*`；turbo 任务依赖 shared→db→api-client→ui→web；`.nvmrc` = 20；Node 24 本机兼容运行。

## 3. UI/UX 设计

不适用。契约=目录树（monorepo-structure §1）逐目录落地。

## 4. 技术架构

- 根配置：`pnpm-workspace.yaml`、`turbo.json`（dev/lint/typecheck/test/build/outputMode=errors-only）、`tsconfig.base.json`（strict + noUncheckedIndexedAccess）、`.gitignore`（node_modules/dist/.turbo/test-results/playwright-report/.pgdata/.env）、`commitlint.config.js`、`.husky/pre-push`（lint+typecheck）
- packages/shared：`envelope.ts`（ok/fail）、`errors.ts`（错误码段）、`execution/`（任务指令/事件帧 zod，见 EXEC-001 §4）
- packages/api-client：`client.ts`（fetch 信封解包 + ApiError 透出 code/message）、`stream.ts`（SSE 封装，Last-Event-ID 续传）
- apps/web：`src/app/(console)/layout.tsx`（控制台壳）、`src/app/api/v1/`、`src/server/guard/`（withAuth 等，SYS-002 落地）

## 5. 测试用例

- INFRA-001-T1：`pnpm install && pnpm lint && pnpm typecheck && pnpm build` 全绿（CI 同构）
- INFRA-001-T2：`pnpm test`（shared 的 envelope/错误码单测）
- INFRA-001-T3：pre-push hook 触发 lint+typecheck

## 6. 竞品深度对标

MeterSphere：Java Maven 多模块 + 独立前端仓 → 本项目：单仓纯 TS + turbo 管道。理由见 tech-stack §2。

## 7. 里程碑与验收

- 交付：全部目录/配置就位、管道四任务全绿、CI workflow 跑通
- DoD：本文件 §5 三条通过；monorepo-structure §1 目录树逐项存在

## 8. 勘误登记

- **勘误 1（2026-09-26）**：packages/api-client 为手工类型化客户端（信封+SSE 封装），OpenAPI 自动生成推迟至 Sprint 1（zod-to-openapi 管线）——P0 控制体量；类型来源仍单一（packages/shared 契约）。
- **勘误 2（2026-09-26）**：`output: 'standalone'` 在本机构建禁用（磁盘成本）、Docker 构建阶段启用（Dockerfile sed 开关）。
