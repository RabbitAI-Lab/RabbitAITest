# INFRA-009 指标面收尾（租户慢查询 + 引擎/节点进程指标 + Backlog 清零）

## 0. 元信息

| 项       | 值                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | Draft → Implemented（分支 `INFRA-009-metrics-completeness`，基线 main fbc8f7f（含 INFRA-006/007/008/PLUG-004），worktree RabbitAITest-s10b，2026-09-30）          |
| 模块     | INFRA（可观测性收尾；engine 侧仅心跳字段 additive，无产品面 UI 变更）                                                                                            |
| 评审方式 | 纯后端规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——契约面 = §2.1 心跳 proc 字段契约 + §2.2 指标目录增量；经用户目标式授权「未做的再检查下是否可以做了」实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/observability.md §6（Backlog 三项处理）· rules/engine.md（engine 无 web/db 依赖红线——本规格不引入）                                                         |
| 前置     | S10 INFRA-006（RLS 租户通道，#15）+ INFRA-007（指标面 v2）+ INFRA-008（v2.1 采样器错误码/进程指标）                                                               |

## 1. 问题

INFRA-007/008 交付时登记三项 Backlog，前置现已全部成熟（#15/#17 均已合并 main），逐项处理：

1. **租户通道慢查询零计数**：`$on('query')` 只挂 admin 客户端；RLS 合入后，组织/项目作用域请求全量走 `rabbit_tenant` 客户端——占流量主体的查询不进 `rabbit_db_slow_queries_total`；
2. **engine/mock/plugin-runner 进程指标不可见**：web 进程已有 `rabbit_process_*`（INFRA-008），其余进程只能靠外置 exporter 或完全没有观测（engine 状态仅经池心跳间接可见——槽位 busy 有，资源占用无）；
3. **多副本时延 histogram 化**：分位 summary 不可跨实例聚合——本次评估是否实施（§2.4 结论：结构性变更，登记不实施）。

## 2. 方案

### 2.1 租户通道慢查询（Backlog ① 实装）

- `packages/db/src/tenant.ts` `ensureTenantRuntime()` 创建 tenant `PrismaClient` 时启用 `log: [{ level: "query", emit: "event" }]`（与 prismaAdmin 同款 warn/error stdout）；
- **计数出口不动**：现有 `rabbit_db_slow_queries_total` 即聚合 admin+tenant 两通道（`prisma` 门面上下文外 `$on` 绑定=prismaAdmin；门面构造不感知 tenant 客户端，metrics-db 无需订阅第二个实例——spec/HELP 措辞改「双通道」，README/文档同步）。租户/降级模式（tenant=prismaAdmin）下同一客户端只被订阅一次（globalThis 单例防重）。
- 与 RLS 合并缝隙兼容性验证：门面 Proxy 无租户上下文时 `$on` 经 `bindAdminProp` 直达 prismaAdmin（已核实 main 代码）——admin 通道计量在 RLS 合入后未断。

### 2.2 engine/mock/plugin-runner 进程指标（Backlog ② 实装——心跳上报法，零新端口零依赖）

**契约 §2.1：engine 心跳 body 新增可选字段 `proc`**（`heartbeatSchema.proc` additive 可选）：

```json
proc: { uptimeSeconds: number, cpuSeconds: number, rssBytes: number, heapUsedBytes: number }
```

- **engine**（worker.ts beat 循环）：每次心跳携带 `proc`（Node 内建 `process.uptime/cpuUsage/memoryUsage`——不引 prom-client、不开 HTTP 端口，遵守 engine 仅 Redis+web HTTP 出向的边界）；`heartbeatSchema` 加 `proc` 可选字段（zod additive，旧引擎无此字段→route 透传不明字段到 nodes JSON，新引擎带码→web 解析器容忍旧负载）。
- **web**（pool register route）：现有实现将 beat body 整体摊入 `resource_pools.nodes[]` JSON——`proc` 随对象天然落库，**零改动**（已核实解构只剔 poolId）。
- **metrics 路由**：`rabbit_process_*` 五指标增加 `process` label——web=`web`（自采），engine=逐节点 `process="engine-{nodeId}"`（取自 nodes JSON 的 proc 子对象；eventloop_lag 仅 web 自采——engine 心跳不上报直方图，跨进程 reset 语义复杂，文档注明）。
- **mock/plugin-runner**：同为 Node 进程但无心跳通道（内嵌于 web 的 mock=与 web 同进程已覆盖；plugin-runner worker_threads 在 engine 进程内——engine proc 覆盖）。独立 mock 进程（api-test-stack 起法）指标登记 Backlog（要引入需要新通道——Mock 无注册协议，不为此造通道）。

### 2.3 指标目录增量（INFRA-007 §2.1 目录只增不改）

| 指标                                     | 变更   | 口径                                                                                          |
| ---------------------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| `rabbit_db_slow_queries_total`           | HELP 改 | 口径=admin+tenant 双通道（实现不变；文档/HELP 措辞对齐）                                       |
| `rabbit_process_uptime_seconds{process}` | +label | web=自采；engine-*=池心跳 proc 快照（10s 粒度）                                                |
| `rabbit_process_cpu_seconds_total{process}` | +label | 同上                                                                                           |
| `rabbit_process_resident_memory_bytes{process}` | +label | 同上                                                                                        |
| `rabbit_process_heap_used_bytes{process}` | +label | 同上                                                                                           |
| `rabbit_process_eventloop_lag_ms{process}` | +label | **仅 web**（engine 不上报直方图；HELP 注明）                                                   |

既有查询表达式兼容性：无 label 的 selector（`rabbit_process_rss_bytes`）在 Prometheus 中匹配全部 label 集——看板与告警零回归（INFRA-007 看板不引用 process 指标，INFRA-008 看板引用的是无 label 形态，selector 语义兼容）。

### 2.4 多副本 histogram 化（Backlog ③——评估结论：不实施）

- 时延指标 histogram 化=指标类型变更（`rabbit_http_request_duration_ms` 从 summary 改 histogram 会生成 `_bucket/_sum/_count` 新序列簇），属于 INFRA-007 §2.1 契约面的**变更**而非「只增不改」；
- 本项目当前部署形态=单 web 副本（embedded PG 单机），无跨副本聚合的真实消费场景；强行变更会让既有 Grafana 面板（INFRA-007 资产引用 summary quantile）失效；
- **登记为「部署形态升级触发」**：文档（monitoring.md §6）注明触发条件=web 多副本部署立项时随配额/provisioning 迭代一并设计。

### 2.5 顺带清偿

- **sprint-overview**：#15 分支已回填 INFRA-006 行但 CI 已随 PR 结束、main 上该文件仍是旧版（#15 合入即 d65828c 之后无 follow-up）——本规格重建**含 INFRA-006/007/008 三行**的概览（INFRA-006 行内容以 #15 分支版为准）；
- **stash@{0}（infra6-wip）清理**：#15 已合并，其中残留的 INFRA-006 工作产物已全部入 main；metrics 残留以 #16/#18 为权威——drop。

## 3. 技术架构

```
engine beat(10s) ── proc={uptime,cpu,rss,heap} ──> POST /internal/pools/register ──> resource_pools.nodes[].proc（JSON 摊入，web 零改动）
web guard 请求 ── tenant 上下文 ──> prismaFacade.$on(query)（=prismaAdmin）──┐
                                  tenant 客户端（RLS，query 事件启用）───────┼──> metrics-db 双通道计数
                                  admin 通道（job/回调/系统）────────────────┘
/system/metrics：进程段 process label 展开（web 自采 ∪ 各 engine 节点心跳 proc）
```

文件清单：

| 文件                                                        | 变更 | 内容                                         |
| ----------------------------------------------------------- | ---- | -------------------------------------------- |
| `packages/db/src/tenant.ts`                                 | +选项 | tenant 客户端启用 query 事件                  |
| `packages/shared/src/execution/schemas.ts`                  | +字段 | heartbeatSchema.proc 可选                     |
| `apps/engine/src/runner/worker.ts`                          | +几行 | beat 携带 proc 快照                           |
| `apps/web/src/server/metrics-runtime.ts`                    | 扩展 | process label 展开逻辑（engine 节点行构造）    |
| `apps/web/src/app/api/v1/system/metrics/route.ts`           | 小改 | engine 节点 proc 行（pools 数据源已在手）      |
| `docs/sprint-10-hardening/sprint-overview.md`               | 重建 | INFRA-006/007/008 交付行（含 #15 分支版内容）  |
| `docs/deployment/monitoring.md` §2/§6                       | 增补 | label 说明 + histogram 触发条件 + Backlog 对齐 |
| `rules/observability.md` §6、CHANGELOG、docs/README         | 增补 | 交付面同步                                    |

零 DDL；OpenAPI 无 diff（心跳 schema additive；/metrics 同 path）。

## 4. 契约与兼容性

1. **心跳 additive**：旧引擎（无 proc）→ 心跳照常（route 透传不明字段进 nodes JSON——metrics 侧无 proc 跳过该节点行）；新引擎对旧 web→zod 校验 web 侧 heartbeatSchema（新增字段后两者兼容——字段 optional）；
2. **指标 selector 兼容**：无 label selector 语义=全 label 集匹配（Grafana/告警零回归）；
3. **failureKind 等既有指标不动**（INFRA-007/008 目录只增不改纪律）；
4. **engine 依赖红线**：未引新依赖、未开端口、未 import web/db——engine 进程依然只有 Redis+web HTTP 出向；
5. **性能**：engine proc 采集=四个 process.* 调用（<1μs 级）；metrics 路由对 nodes JSON 只读不增查询。

## 5. 测试用例

| 编号          | 类型                                                    | 内容                                                                                                                              |
| ------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-009-T1  | Vitest（web，s10-metrics-runtime 增补）                 | runtimeBlock 带 process label（web 行 + engine 节点行构造）；engine proc 行缺失字段跳过；labels 转义                               |
| INFRA-009-T2  | Vitest（engine）                                        | procSnapshot()（worker.ts 导出纯函数）：字段齐全/数值有限（NaN 归 0）/cpuUsage user+system 折算秒                                   |
| INFRA-009-T3  | JMeter `tests/api/INFRA-009-process-metrics.jmx`        | 四类×四断言：正常路径（管理员 200 断言 `rabbit_process_uptime_seconds{process="web"}` 与 `process="engine-` 前缀行 + 慢查询 HELP 含双通道措辞）；401（未登录）；403（普通用户）；422/分页不适用（同口径登记） |
| e2e           | 豁免登记                                                | 无 UI 能力行；全量 e2e 回归为心跳链路零回归证据                                                                                    |

## 6. 里程碑与验收

- DoD：§5 三项测试 + 全量回归绿 + 远端 CI 全绿；
- 契约冻结点：§2.1 proc 字段契约、§2.3 label 增量——只增不改。

## 7. 勘误登记

1. **jmx 断言转义（2026-09-30，本地复跑首跑 T1.1 失败触发）**：HELP 断言串 `across admin+tenant channels` 中 `+` 未转义——JMeter `ResponseAssertion` 的 `Assertion.test_type=2` 语义为**正则匹配**（非字面子串），`admin+` 被解释为正则量词致断言恒失败；而 direct curl 命中、另两条 `process="web"/"engine-"`（无正则元字符）通过——造成「服务正确而断言错误」的迷惑表象。修复为 `admin\+tenant`。历史 INFRA-004/007/008 jmx 的 type 2 断言串均无正则元字符故未暴露。教训登记：凡含 `+`、`.`、`*`、`(` 等正则元字符的断言串必须转义，或断言值改用无元字符前缀（如 `across admin`）。
