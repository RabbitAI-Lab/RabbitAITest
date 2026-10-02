# 二次开发指南

本章面向想给 RabbitAITest 贡献代码或做二次开发的工程师。仓库的完整工作规范见根目录 `AGENTS.md` 与 `rules/` 目录（本文为导读性质，冲突时以仓库规范为准）。

## 开发环境

搭建步骤与[安装部署](quickstart/installation.md)一致：`pnpm install && pnpm dev`。开发相关补充：

- 格式化 / 静态检查使用 oxlint / oxfmt（非 ESLint / Prettier）。
- 多 worktree 并行开发时，端口按槽位自动隔离（`scripts/rabbit-env.mjs`，槽位取自 `RABBIT_SLOT` 或目录名 `RabbitAITest-s{N}`），禁止任何脚本硬编码端口。
- 可选：设置 `GLM_API_KEY` 后可运行 `pnpm visual:diff`，用多模态模型比对高保真原型与实现截图的还原度（这是研发流程工具，与产品内 AI 功能无关）。

## 常用命令

| 命令                                          | 作用                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                                    | 启动 web（含内嵌 PG 自动初始化）+ engine + mock + plugin-runner |
| `pnpm build`                                  | 构建全部应用                                                    |
| `pnpm test`                                   | Vitest 单元测试                                                 |
| `pnpm test:api`                               | JMeter 接口自动化（对本地服务执行）                             |
| `pnpm test:e2e`                               | Playwright UI 自动化（自动起全套服务）                          |
| `pnpm test:visual`                            | 视觉快照采集                                                    |
| `pnpm lint` / `pnpm format`                   | oxlint 检查 / oxfmt 格式化                                      |
| `pnpm typecheck`                              | TypeScript 类型检查                                             |
| `pnpm db:generate` / `db:migrate` / `db:seed` | Prisma 生成 / 迁移 / 种子                                       |
| `pnpm build:plugins`                          | 构建仓库自带插件                                                |
| `pnpm lint:boundaries`                        | 模块边界检查（如 engine 不得依赖 web/db）                       |
| `pnpm backup` / `pnpm restore`                | 数据备份 / 恢复                                                 |

## 工程门禁（摘要）

`AGENTS.md` 定义了 9 条硬性门禁，PR 违反即不予合并，其中与日常开发最相关的：

1. **文档先行**：任何功能编码前，必须有对应规格文档 `docs/sprint-{N}-*/{MODULE}-NNN-*.md` 且状态为 Approved。
2. **高保真原型**：UI 功能先产出高保真原型（`docs/design/`）并经人工确认，才能编码；实现完成后与原型逐项走查。纯后端 / 引擎类规格以「接口契约评审」替代。
3. **数据模型一次建齐**：核心域表在 `packages/db/prisma/schema.prisma` 一次性建齐全部列（含未启用列），后续迭代只做开关 + 种子 + 索引。
4. **API 契约纪律**：schema 用 zod 定义于 `packages/shared`；前端只用 `packages/api-client`；CI 校验 OpenAPI 快照 diff。
5. **权限与解耦**：每个端点声明权限点经 `withPermission()` 包装；引擎不得 import web 与 db。
6. **自动化测试门槛**：功能「完成」= 功能代码 + Vitest 单测 + JMeter 接口用例（四类场景 × 四项断言）+ Playwright UI 用例（UI / Console / 接口三类断言），且 CI 全绿。
7. **测试与文档同步**：规格 §5 用例表与 `tests/` 文件编号一一对应；Bug 修复先写失败用例复现。

## 分支与提交

- 分支：`main` 受保护；功能分支命名 `{MODULE}-NNN-{slug}`（与规格编号一致，如 `case-001-mindmap`）。
- 提交信息：Conventional Commits（`feat(case): ...` / `fix(api): ...` / `docs: ...`）。
- PR：描述必须链接对应规格文档与高保真确认记录；远端 GitHub Actions 全绿是合并硬性条件。
- 文档与代码同 PR 变更：改了行为必须同步改文档（含状态流转：Draft → Approved → Prototyped → Implemented → Verified）。

## 本文档站的维护

本站（`docs-site/`）基于 Docsify，全部依赖已本地化在 `docs-site/vendor/`（离线可访问），页面为纯 Markdown：

- 新增页面：在 `docs-site/` 对应目录建 `.md` 文件，并在 `_sidebar.md` 登记入口；站内链接使用根相对路径（如 `manual/api/debug.md`，不带 `./`、`../` 或开头 `/`）。
- 截图统一放 `docs-site/_media/shots/`。
- 本地预览：

```bash
cd docs-site
python3 -m http.server 5275
# 打开 http://localhost:5275
# 或：npx docsify-cli serve docs-site（在仓库根目录执行）
```

- 发布到 GitHub Pages：将 Pages 源指向 `docs-site/` 目录即可（目录内已含 `.nojekyll`）。

## 相关链接

- [架构概览](developer/architecture.md)
- [安装部署](quickstart/installation.md)
- [关于与版本](about.md)
