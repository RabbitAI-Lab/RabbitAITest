# CLAUDE.md

> 本仓库的完整工作规范见 [AGENTS.md](./AGENTS.md)（规范冲突时以 AGENTS.md 为准）。

核心约束速览（详见 AGENTS.md）：

1. **高保真门禁**：每个功能点必须先产出高保真原型（`docs/design/{MODULE}-NNN-*/`），人工确认后才能开始功能迭代开发；规格元信息「高保真确认」字段未确认不得编码。
2. **文档先行**：无 Approved 规格文档（`docs/sprint-*/MODULE-NNN-*.md`）不得开发对应功能。
3. **技术栈**：Monorepo（pnpm + Turborepo，纯 TS）｜全栈 Next.js（App Router，API 走 Route Handlers /api/v1）｜React 19 + AntD + Tailwind｜**embedded-postgres**（可外接 PostgreSQL）+ Prisma｜BullMQ + Redis｜执行引擎为自研 Node worker（不用 JMeter 做执行引擎）。
4. **自动化测试 = 完成的定义**：功能点完成必须交付 ① Vitest 单测；② **JMeter 接口用例**（`tests/api/`，四类场景 + 状态码/业务码/JSONPath/响应时间四项断言）；③ **Playwright UI 用例**（`tests/e2e/`，每条必须同时含 **UI 断言 + Console 断言（无 error/pageerror）+ 接口断言（网络请求状态码/响应体/请求负载）** 三类断言）。缺一项 PR 不合并；主链路 E2E 全绿是 Release Gate。
5. **数据模型一次建齐**：核心表在 `packages/db/prisma/schema.prisma` 建齐全部列，禁止反复 DDL；命名/索引/查询/迁移细则见 rules/database.md（禁拼 SQL、禁 N+1、migration 只增不改、破坏性变更走 expand-contract）。
6. **API 纪律**：遵循 `docs/architecture/api-conventions.md`；schema 用 zod 定义于 `packages/shared`；前端只用 `packages/api-client` 生成客户端。
7. **范围红线**：P0-P2 不做 ENTP（企业版）功能；标准版不做 UI/性能测试。
8. **阅读顺序**：AGENTS.md → docs/README.md → docs/architecture/tech-stack.md → docs/architecture/test-domain-model.md → 当前 sprint-overview → 功能规格 → 按工作内容读 rules/（完整规范地图见 AGENTS.md §2：react-nextjs / testing / database / engine / security / typescript / git-workflow / observability / ai-collaboration）。
9. **Playwright UI 用例必须录屏**（video: on-with-retry）+ trace（retain-on-failure）+ 失败截图 + **每用例自动整页截屏**；另须产出视觉快照（`pnpm test:visual`）并用 **GLM-5.3-Flash 多模态比对高保真还原度**（`pnpm visual:diff`，≥80 通过，报告入 PR）。
10. **远程 CI 与 Sprint 交付**：以 GitHub Actions 远端结果为准（本地过 ≠ 完成）；main 必须保持绿（变红 stop the line）；**每个 Sprint 收尾必须 commit + push 到远程且远端 CI 全绿**（流程：rules/git-workflow.md §8），禁止代码只留本地。

@rules/typescript.md

@rules/react-nextjs.md

@rules/testing.md

@rules/database.md

@rules/engine.md

@rules/security.md

@rules/git-workflow.md

@rules/observability.md

@rules/ai-collaboration.md
