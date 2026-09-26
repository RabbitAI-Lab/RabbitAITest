# AGENTS.md — RabbitAITest 工作规范（AI 与人类协作者必读）

> 本文件是仓库的**最高工作规范**。任何 AI 会话（Claude Code / ZCode 等）或人类协作者在本仓库工作前必须先读本文。
> CLAUDE.md 与本文件保持同步，规范冲突时以本文件为准。

---

## 0. 项目一句话

RabbitAITest：复刻 MeterSphere v3.x 社区版功能面的开源一站式测试工作台（测试管理 + 接口测试 + AI）。唯一对标基线：`docs/MeterSphere功能清单.md`。

## 1. 硬性工作流门禁（违反即停止开发）

### 门禁 1：文档先行

任何功能开始编码前，必须有对应规格文档 `docs/sprint-{N}-*/{MODULE}-NNN-*.md` 且状态为 **Approved**。没有文档的代码 PR 直接拒绝。

### 门禁 2：高保真原型 + 人工确认 + 实现后走查（最重要）

**每个功能点必须先产出高保真原型，经人工确认通过后，才能开始功能迭代开发；实现完成后必须走查对照原型。**

- 高保真原型产出在 `docs/design/{MODULE}-NNN-{slug}/`（静态 HTML+Tailwind 或 Storybook story，可浏览器打开走查）
- 规格文档元信息表必须含「高保真确认」字段：`确认人 / 确认日期 / 原型链接`；未确认前该字段为 `待确认`，编码不得开始
- 确认后如交互变更，须更新原型并**重新确认**，状态回到 `待确认`
- 纯后端/引擎类规格（INFRA/EXEC/QA 等）以「接口契约评审」替代高保真：OpenAPI/事件流 schema 人工确认后视为通过
- **实现完成 ≠ 与高保真一致**：UI 功能交付前必须与原型**逐项走查**（布局/交互/各状态/边界/裁剪），走查批次编号登记（走查①②③…）；发现差异要么回改实现、要么更新原型并登记「勘误 N」（勘误记在原型目录 README，可追溯）——RabbitProjects 实践中约 1/3 的 UI 缺陷（布局裁剪、漏挂组件、下拉被裁切）由走查环节暴露
- 走查结论、录屏（§3.3）与**视觉还原度报告**（§3.7：GLM-5.3-Flash 多模态比对高保真↔实现截图，`pnpm visual:diff`）一并归档进 PR 描述

### 门禁 3：一次建齐数据模型

核心域表在 `packages/db/prisma/schema.prisma` 一次性建齐全部列（含未启用列），后续迭代只做「开关 + 种子 + 索引」。新增列必须说明为何无法初期建齐并经架构评审（见 `docs/architecture/test-domain-model.md` §6）。

### 门禁 4：API 契约纪律

- 端点必须符合 `docs/architecture/api-conventions.md`（路径 / 响应信封 / 错误码分段 / 分页 / 软删除）
- 请求响应 schema 一律用 zod 定义于 `packages/shared`，OpenAPI 由 schema 生成
- 前端**禁止手写接口路径**，只能使用 `packages/api-client` 生成的客户端；CI 校验 OpenAPI 快照 diff

### 门禁 5：权限与解耦

- 每个端点声明所需权限点（`packages/shared/permissions.ts`），经 `withPermission()` 包装（见 rbac-permission-model.md）
- 跨域读用例只准经 Provider 接口，禁止跨域直接查表（见 test-domain-model.md §3）
- `apps/engine` 不得 import `apps/web` 与 `packages/db`（引擎无数据库依赖）

### 门禁 6：范围红线

- P0-P2 迭代不实现任何 ENTP 前缀功能（企业版功能统一 License 门控）
- 标准版不做 UI 测试、性能测试（P4）
- 执行引擎不做性能压测内核

### 门禁 7：自动化测试门槛（功能「完成」的定义）

**任何功能点开发完成 = 功能代码 + 单测 + JMeter 接口用例 + Playwright UI 用例全部交付且 CI 全绿**，缺一项 PR 不予合并：

1. **单元测试（Vitest）**：核心分支覆盖，与代码同 PR；核心域行覆盖率 ≥ 70%。
2. **接口自动化（JMeter）**：每个功能点至少一个 `tests/api/{MODULE}-NNN-*.jmx`，必测四类场景（正常路径 / 401·403·404 权限 / 422 校验失败 / 分页信封）；每个采样器四项断言必备（HTTP 状态码、业务码 `code`、关键字段 JSONPath、响应时间上限）。
3. **UI 自动化（Playwright）**：每个界面功能点至少一条 `tests/e2e/{MODULE}-NNN-*.spec.ts`，且每条用例**必须同时包含三类断言**：
   - **UI 断言**：元素可见/文本/表格行数/表单回显/Toast 等界面结果
   - **Console 断言**：全程无 `console.error`、无未捕获 `pageerror`（白名单须显式登记）
   - **接口断言**：关键链路网络请求的状态码、响应体关键字段、请求负载（payload）
4. 主链路 E2E（docs/需求文档.md §二）+ 全量 tests/ 绿是 **Release Gate**。

详细规范（目录命名、fixtures、选择器、数据隔离、CI 执行）见 [rules/testing.md](./rules/testing.md)。

### 门禁 8：测试与文档同步

- 规格 §5 用例表与 tests/ 文件编号一一对应；「先合功能后补测试」不允许；Bug 修复必须先写失败用例复现再修复转绿。

### 门禁 9：远程 CI 与 Sprint 交付纪律

1. **GitHub CI 必须通过**：远端 CI（GitHub Actions）全绿是 PR 合并与任何交付的硬性条件——本地自测通过不等于完成，**以远端 CI 结果为准**。
2. **main 必须保持绿**：main 分支 CI 变红即最高优先级（stop the line），先修复再继续任何新开发；禁止在红 main 上继续合并。
3. **每个 Sprint 收尾必须 commit + push 到远程**：Sprint 交付的定义包含「代码已 push 到 GitHub（合入 main 或功能分支）且远端 CI 全绿」；**禁止代码只留在本地**（防丢失、保证可追溯、远端 CI 真实执行）。
4. Sprint 收尾同时完成：文档状态流转（sprint-overview 交付表更新）、changelog 追加（涉及用户可见变更时）。细化流程见 rules/git-workflow.md §8。

## 2. 技术栈约束（不得擅自变更）

| 项          | 选型                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------- |
| 工程结构    | **Monorepo**：pnpm workspace + Turborepo，纯 TypeScript                                                                |
| 应用框架    | **全栈 Next.js**（App Router + React 19）：UI 与 API 同仓同应用，API 走 Route Handlers（REST，/api/v1）                |
| 前端        | **React** + Ant Design（React 19 兼容版）+ Tailwind CSS + TanStack Query + Zustand                                     |
| 数据库      | **embedded-postgres**（@embedded-postgres/node）：开发与单机部署内嵌免外部 DB；`DATABASE_URL` 可切外部 PostgreSQL 16   |
| ORM         | Prisma（`packages/db` 唯一出口，schema + migration）                                                                   |
| 异步任务    | BullMQ + Redis（定时任务用 repeatable job）                                                                            |
| 实时通道    | SSE（Route Handler 流式；Redis Stream 断线续传）                                                                       |
| 执行引擎    | `apps/engine`：Node.js worker（undici 采样、p-limit 并发槽、quickjs 脚本沙箱），**不用 JMeter**（仅兼容 jmx 导入格式） |
| Mock / 插件 | `apps/mock`（Hono）；`apps/plugin-runner`（worker_threads 隔离，TS 插件包）                                            |
| 中间件      | 仅 PostgreSQL + Redis + MinIO 三个                                                                                     |

**技术栈编码细则分层管理**：本文件只定门禁与红线，细则全部在 `rules/` 目录（8 份，按需扩展）：

| 规则文件                                                 | 适用场景                                                                                                                                                          |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [rules/react-nextjs.md](./rules/react-nextjs.md)         | React 19 / Next.js App Router 编码（组件边界、数据获取、Route Handler、状态）                                                                                     |
| [rules/testing.md](./rules/testing.md)                   | 自动化测试：Vitest 单测、JMeter 接口（四类场景×四项断言）、Playwright UI（**三类断言 + 录屏/trace + 每用例截屏**）、**GLM-5.3-Flash 视觉还原度比对**（§3.6/§3.7） |
| [rules/database.md](./rules/database.md)                 | PostgreSQL/Prisma：命名、类型、索引、查询、迁移纪律、embedded-postgres                                                                                            |
| [rules/engine.md](./rules/engine.md)                     | 执行引擎：状态机、事件流、kernel 纯函数、采样器、沙箱、本地模式                                                                                                   |
| [rules/security.md](./rules/security.md)                 | 安全：认证、输入校验、注入与越权、SSRF 边界、密钥、依赖供应链                                                                                                     |
| [rules/typescript.md](./rules/typescript.md)             | TS 通用：strict 基线、命名、类型推导、错误处理、模块边界、注释                                                                                                    |
| [rules/git-workflow.md](./rules/git-workflow.md)         | 分支/Commit/PR 模板/Review checklist/CI 流水线/版本与发布                                                                                                         |
| [rules/observability.md](./rules/observability.md)       | 结构化日志、reqId 链路、健康检查、指标、排障包                                                                                                                    |
| [rules/ai-collaboration.md](./rules/ai-collaboration.md) | 人+AI 协作：会话冷启动义务、生成红线、验证义务、人保留决策                                                                                                        |

技术栈变更 = 架构级决策，须修改 `docs/architecture/tech-stack.md` 并评审，不允许只在代码里悄悄换。

## 3. 文档状态流转

```
Draft（起草）→ Approved（规格评审通过）
            → Prototyped（高保真已确认，编码可开始）
            → Implemented（代码合并）→ Verified（验收通过）
```

状态记录在规格文档元信息表；sprint-overview 的交付表同步更新。

## 4. 常用命令

```bash
pnpm install && pnpm dev        # 启动 web（含 embedded-postgres 自动初始化）+ engine + mock
pnpm test                       # Vitest 单测
pnpm test:api                   # JMeter 接口自动化（对本地服务执行，校验 jtl 失败数=0）
pnpm test:e2e                   # Playwright UI 自动化（自动起全套服务）
pnpm test:visual                # 视觉快照（tests/visual/snapshots，供还原度比对）
pnpm visual:diff                # 高保真↔实现 多模态还原度比对（需 GLM_API_KEY）
pnpm lint && pnpm format        # oxlint / oxfmt
pnpm db:migrate && pnpm db:seed # Prisma 迁移与种子
```

## 5. 协作与提交

- 分支：main 保护；feature 分支命名 `{MODULE}-NNN-{slug}`（与文档编号一致）
- Commit：Conventional Commits（feat/fix/docs/refactor/test/chore），scope 用模块缩写（如 `feat(case): ...`）
- 每个 PR 描述必须链接对应规格文档与高保真确认记录
- 文档与代码同 PR 变更：改了行为必须同步改文档（含状态流转）

## 6. 阅读顺序（新会话冷启动）

1. 本文件 → 2. `docs/README.md` → 3. `docs/architecture/tech-stack.md` → 4. `docs/architecture/test-domain-model.md` → 5. 当前迭代 `sprint-overview.md` → 6. 目标功能规格 → 7. 按工作内容读对应 rules：编码前 `react-nextjs.md` + `typescript.md`；写测试前 `testing.md`；改模型/写 SQL 前 `database.md`；引擎开发 `engine.md`；提 PR 前 `git-workflow.md`；安全相关 `security.md`；日志/排障 `observability.md`；AI 会话协作 `ai-collaboration.md`
