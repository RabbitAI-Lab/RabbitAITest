# Sprint 0 — POC 技术验证 · 迭代概览

| 元信息项 | 内容 |
| --- | --- |
| 迭代编号 | Sprint 0 |
| 迭代名称 | POC 技术验证（Proof of Concept） |
| 周期 | 第 1-2 周（10 个工作日） |
| 覆盖优先级 | **P0 全量**（P1 及以上一律不进入本迭代） |
| 文档数 | 10 份（3 INFRA + 3 SYS + 1 CASE + 1 API + 1 EXEC + 1 RPT） |
| 文档状态 | Implemented（交付自查见 §7；高保真确认仍待人工，见 §8 遗留） |
| 上游依据 | [需求文档](../需求文档.md) §五（P0 范围）、§七（M1 里程碑） |
| 前置迭代 | 无（仅依赖 9 份架构文档） |
| 阻塞下游 | Sprint 1 全量 → 进而阻塞 Sprint 2-9 |

---

## 1. 迭代目标

**用 2 周跑通最小核心闭环，验证全栈架构可行性，清零技术风险。**

端到端可演示路径（浏览器操作主线）：

```
注册登录 → 默认组织/项目初始化 → 创建功能用例 → 新建 HTTP 调试请求
→ 服务端执行（engine）→ 查看执行报告（响应/断言结果）
```

三条成功判定：

| 维度 | 目标 | 判定方式 |
| --- | --- | --- |
| 技术可行性 | web（含内嵌 PG）+ engine + mock + redis + minio 全链路跑通 | `docker compose up` 后全部容器 healthy，主线可完成 |
| 架构正确性 | 测试域模型一次建齐全部列；Provider 解耦、三级权限、API 信封在代码真实落地 | Prisma schema 快照对照 test-domain-model §2；跨域引用静态检查通过 |
| 引擎可行性 | 自研 Node.js 内核（undici 采样）完成 HTTP 采样 + 断言 + 事件流回传（本项目最大技术风险） | 一次调试请求产生完整 step 事件流并渲染报告 |

**本迭代不追求**：UI 精细度、模块树、导入导出、环境体系（URL 直填）、性能与覆盖率。

## 2. 交付范围（10 项）

| # | 交付项 | 内容 | 文档 |
| --- | --- | --- | --- |
| 1 | Monorepo 骨架 | pnpm+Turborepo 纯 TS 仓；apps/web（全栈 Next.js）·engine·mock·plugin-runner + packages/ui·api-client·shared·db | `INFRA-001` |
| 2 | Docker Compose 一键启动 | web/engine/mock/redis/minio + embedded-postgres 自动初始化 + Prisma migrate + 种子数据（默认组织/管理员） | `INFRA-002` |
| 3 | 数据模型基线 | `packages/db` Prisma schema：test-domain-model §2 全实体建模（含未启用列）；编号 advisory lock（$queryRaw）；通用横切（软删/变更历史/评论/关注） | `INFRA-003` |
| 4 | 注册登录 | 邮箱注册/登录/退出；Session；Argon2 | `SYS-001` |
| 5 | 路由守卫与隔离 | 前端菜单守卫 + 后端 401/403/404；ProjectScopedViewSet 强制 project 过滤 | `SYS-002` |
| 6 | 组织/项目初始化 | 注册即建默认组织+默认项目；项目切换器（左上角，对齐基线交互） | `SYS-003` |
| 7 | 功能用例 CRUD | 名称/前置/步骤/预期/等级/标签；列表+详情页；回收站软删 | `CASE-001` |
| 8 | HTTP 接口调试 | 新建请求（方法/URL/头/体）+ 断言（状态码/响应体 JSONPath）；服务端执行；响应四视图（体/头/实际请求/控制台） | `API-001` |
| 9 | 引擎内核 v0 | BullMQ 消费 → HttpSampler（undici）→ 断言 → Redis Stream 事件流 → 回调状态机；`--local` CLI 模式 | `EXEC-001` |
| 10 | 最小执行报告 | 事件流渲染单请求报告页（请求/响应/断言结果/耗时）；SSE 实时日志 | `RPT-001` |

## 3. 范围排除（防蔓延红线）

- 不做：模块树、批量操作、自定义视图、导入导出、脑图、评审、计划、缺陷、Mock、环境、场景、AI、消息、插件运行时（仅留 plugin-runner 空进程位）
- 不做任何 ENTP 功能；不做 K8S 部署
- 前端仅 Ant Design 默认样式 + 基础布局（顶部导航 + 左侧项目切换）

## 4. 验收标准（现场跑通）

1. `docker compose up -d` 一条命令起全栈，5 分钟内可操作
2. 注册→登录→默认项目可见；未登录访问任意页跳登录
3. 创建用例（含步骤）→ 列表可见 → 进回收站可恢复
4. 调试请求 `GET https://httpbin.org/get` 服务端执行成功，报告展示响应体与断言结果
5. 断言故意失败时报告状态为失败且断言明细可见
6. `engine --local` 本地模式执行同一请求并上报成功（同一报告页查看）
7. Prisma schema 与 test-domain-model §2 一致（列级核对）；`plan/bug/exec` 域无直接引用 case/api_test 域模型（CI 静态检查）
8. 自动化测试齐备（rules/testing.md）：主链路 Playwright E2E（登录→用例→调试→报告）全绿且每条含 UI/Console/接口三类断言；核心 API（注册/登录/用例 CRUD/调试执行）有 JMeter 用例并通过
9. Sprint 收尾交付（AGENTS.md 门禁 9 / rules/git-workflow.md §8）：全部代码 commit 并 push 到 GitHub 远程，`git status` 干净；远端 GitHub Actions 在最新 commit 上全绿；本概览交付表状态已更新

## 5. 团队与并行节奏

| 并行线 | 内容 | 关键同步点 |
| --- | --- | --- |
| A 线（平台） | INFRA-001/002/003 → SYS-001/002/003 → CASE-001 | INFRA-003 schema 建模评审必须第 3 天前完成 |
| B 线（引擎） | EXEC-001 → API-001 → RPT-001 | 事件流 schema 第 4 天前冻结（RPT 依赖） |
| C 线（文档） | Sprint 0 十份规格补齐 + Sprint 1 概览 | 与代码并行，评审滞后不超过 2 天 |

## 6. 风险与预案

| 风险 | 预案 |
| --- | --- |
| 引擎事件流与报告渲染联调超期 | 事件流 schema 先冻结（JSON Schema + 契约测试），报告侧用录制样本先行开发 |
| embedded-postgres 平台兼容性（macOS arm64 / Linux CI） | 第 1 天双环境验证启动与迁移；异常则 CI 降级为外接 PG service container（不阻塞主线） |
| httpbin 外网依赖 | compose 内置本地 httpbin 容器作为默认调试目标 |


---

## 7. 交付自查（Sprint 收尾，2026-09-26）

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| 1. 一键起全栈，5 分钟可操作 | ✅ | `docker compose -f deploy/docker-compose.yml up -d`（构建后启动）；本地 `pnpm dev` 零 Docker 依赖亦可达 ready |
| 2. 注册→登录→默认项目；未登录跳转 | ✅ | SYS-001-01/03、SYS-002-01（E2E 绿） |
| 3. 用例创建→列表→回收站→恢复→彻底删除 | ✅ | CASE-001-01（E2E 绿，含 3 步骤表单） |
| 4. 调试执行成功展示响应与断言 | ✅ | API-001-01/04（E2E 绿；目标为本地 mock /hello 保证确定性，httpbin 可手动演示） |
| 5. 断言失败报告 FAILED+红行明细 | ✅ | API-001-02（E2E 绿） |
| 6. engine --local 本地执行上报 | ✅ | `scripts/demo-local-exec.sh`：PENDING→local 执行→报告 SUCCESS |
| 7. schema 与域模型一致；跨域静态检查 | ✅ | Prisma 45 实体一次建齐；`pnpm lint:boundaries` PASS（engine 不依赖 db/web 等） |
| 8. 自动化测试齐备 | ✅ | Playwright **11/11 全绿**（每条 UI+Console+接口三类断言；video on-with-retry/trace/截图/HTML 报告）；JMeter **3 计划全断言通过**（SYS-001/CASE-001/API-001，四类场景×四项断言）；Vitest 13 单测绿 |
| 9. push 远程 + 远端 CI 全绿 | 见提交记录 | GitHub Actions（lint/typecheck/unit/build/迁移重放/e2e/jmeter/audit） |

## 8. 遗留项与风险（去向登记）

1. **高保真人工确认未完成**（AGENTS 门禁 2 的人工部分）：五组原型状态=待确认，`docs/design/README.md` 登记表待用户走查签署；按 ai-collaboration §5 该确认不可由 AI 代签——**本 Sprint 在用户目标授权下先行实现，走查待补**。
2. 列名 camelCase → snake_case @map（INFRA-003 勘误 1，Sprint 1）。
3. api-client 手工类型化 → OpenAPI 生成（INFRA-001 勘误 1，Sprint 1）。
4. undici 重定向跟随（maxRedirections v7 移除，Sprint 2 interceptor）。
5. 运行日志规范化（pino/reqId 链路）与指标暴露为占位级（observability 规范全量落地在 INFRA-004/Sprint 8）。
6. E2E 调试目标使用本地 mock /hello（确定性优先）；对公网 httpbin 的演示路径保留在调试页示例按钮。
