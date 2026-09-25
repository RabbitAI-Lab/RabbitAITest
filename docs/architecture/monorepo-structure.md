# Monorepo 仓库结构规范

| 元信息项 | 内容 |
| --- | --- |
| 文档层级 | 架构文档（全局约束） |
| 状态 | 已确认（Approved） |
| 上游依据 | tech-stack.md（全栈 Next.js + 纯 TS Monorepo） |
| 下游消费 | INFRA-001（monorepo 脚手架）、全部功能规格 §4 |

---

## 1. 顶层目录树

```
rabbitaitest/
├── apps/
│   ├── web/                      # ★ 全栈 Next.js（App Router）
│   │   ├── src/app/(console)/    #   页面路由：工作台/项目/用例/计划/接口/缺陷/系统设置
│   │   ├── src/app/api/v1/       #   REST Route Handlers（system / orgs / projects / personal / share）
│   │   ├── src/server/           #   服务端实现（只在 Node runtime 执行）
│   │   │   ├── guard/            #     withAuth / withPermission / withProjectScope / withAudit
│   │   │   └── domains/          #     按域分包：system/project/case/plan/bug/api_test/exec/report/dashboard/ai
│   │   ├── src/components/       #   业务组件（views 级）
│   │   └── src/stores/           #   Zustand 客户端状态
│   ├── engine/                   # 执行引擎（Node worker，无 Next 依赖）
│   │   ├── kernel/               #   步骤树解释器 / 变量上下文 / 断言提取管线
│   │   ├── samplers/             #   采样器（HttpSampler/undici，协议插件位）
│   │   ├── runner/               #   BullMQ 消费 / 并发槽(p-limit) / 心跳 / 状态机
│   │   └── cli/                  #   本地执行入口（engine --local 单机模式）
│   ├── mock/                     # Mock 服务（Hono）：规则匹配，规则快照来自 Redis
│   ├── plugin-runner/            # 插件宿主（worker_threads 池：协议/平台/驱动加载与 RPC）
│   └── proxy/                    # 可选 Nginx（mock 域名路由 / MinIO 预签名直链 / 生产 TLS）
├── packages/
│   ├── db/                       # ★ Prisma schema + migrations + client（全仓唯一数据访问出口）
│   ├── shared/                   # zod schema / 枚举 / 错误码 / 权限点 / 执行事件契约（web·engine·mock 三方共享）
│   ├── ui/                       # AntD 二次封装：模块树 / 高级表格 / 脑图 / 请求构造器 / 断言编辑器
│   └── api-client/               # OpenAPI 生成的 TS 客户端（CI 再生成，前端唯一接口层）
├── docs/                         # 文档体系（含 design/ 高保真原型，见 AGENTS.md 门禁 2）
├── deploy/                       # docker-compose / helm / 备份恢复脚本
├── scripts/                      # 初始化 / 种子数据 / 代码生成
└── tests/                        # Playwright E2E（主链路）+ 契约测试
```

## 2. 分包规则

1. **域包只准经 Provider 接口跨域引用**（对齐 MeterSphere `framework/provider` 思路）：`plan / bug / exec / report` 域读「用例类实体」必须走 `caseRefProvider.listRefSummary()` 形态，禁止直接 import 他域服务/查表——见 test-domain-model.md §3。
2. **engine 独立性**：`apps/engine` 不得依赖 `apps/web` 与 `packages/db`（无数据库访问）；仅通过 BullMQ 队列 + HTTP 回调与 web 交互。保证可独立部署为资源池节点（EXEC-002）与本地 CLI（EXEC-001）。
3. **packages/db 是唯一 Prisma 出口**：只有 `apps/web/src/server` 使用；engine/mock/plugin-runner 一律不得直连数据库。
4. **packages/shared 是三端契约源**：执行事件流、任务状态、错误码、权限点的 zod schema 在此定义，web / engine / mock 共享（编译期防契约漂移）。
5. `packages/ui` 不依赖业务状态与 api-client；业务组件放 `apps/web/src/components`。

## 3. Turbo 任务管道

```
build:    packages/shared → packages/db(client) → packages/api-client → packages/ui → apps/web
lint:     并行全部（oxlint）
test:     packages(vitest) ∥ apps(engine vitest) → tests(playwright, 依赖 build)
dev:      turbo run dev --filter=web --filter=engine --filter=mock
```

单语言仓，无跨语言编排；`apps/web` dev server 负责自动拉起 embedded-postgres 并执行 migrate（INFRA-002）。

## 4. 代码所有权与命名

- 分支：main 保护 + 短生命周期分支，命名 `{MODULE}-NNN-{slug}`（与文档编号一致，见 AGENTS.md §5）
- `apps/web/src/server/domains/` 域目录与文档模块缩写一一对应（`case/` ↔ `CASE-NNN` 规格），评审按文档编号定位代码
- commitlint（Conventional Commits，scope=模块缩写）
