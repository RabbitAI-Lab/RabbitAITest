# INFRA-007 指标面 v2（Prometheus 企业级监控对接）

## 0. 元信息

| 项       | 值                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | Draft → Implemented（分支 `INFRA-007-metrics-v2`，基线 main 837eebd，worktree RabbitAITest-s2，2026-09-30）                                                      |
| 模块     | INFRA（可观测性，无产品面 UI 变更）                                                                                                                             |
| 评审方式 | 纯后端规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——契约面 = §2.1 指标目录（名称/类型/标签/口径）+ §2.3 鉴权矩阵；经用户目标式授权「好的，请完善这套指标体系」后实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/observability.md §6（最小指标集——本规格兑现并改写）· api-conventions（文本端点信封例外，INFRA-004 已登记）· rules/security.md §4（密钥与凭据）          |
| 前置     | S8 INFRA-004（/system/metrics v1 最小集）；S9 ENTP-006（exec-pool-{poolId} 按池队列）；INTG-003（个人 APIKEY 通道）                                             |
| 并行分支 | INFRA-006（RLS 租户隔离，另一会话独立分支交付）——本规格不依赖其代码；两者共同触及 guard/index.ts 与 packages/db 构造点，合并次序任意（见 §4.7）                 |

## 1. 问题（为什么必须做）

INFRA-004 交付的 `/api/v1/system/metrics` 是「最小指标集」（4 组指标），对照 rules/observability.md §6 的规划与 MeterSphere v3 企业级监控对接形态，存在四类缺口：

1. **Web 时延面缺失**：只有请求计数（`rabbit_http_requests_total`），没有按路由组的时延分位——运维无法回答「哪个域的 API 变慢了」（§6 规划：API P95 按路由组）；
2. **DB 层零观测**：慢查询（>200ms）无计数（§6 规划：DB 慢查询计数）；
3. **业务与失败分类面缺失**：任务失败原因分类（`ExecTask.failureKind`：NETWORK_ERROR/ASSERT_FAILED/CONFIG_ERROR/SCRIPT_ERROR——引擎 `classifyFailure` 已落库但从未聚合暴露）、24h 任务量/失败率、误报命中（`FalseAlarmHit` 表已建模但零暴露）全部不可见（§6 规划：采样错误分类码计数、每日执行任务数、失败率、误报命中率）；
4. **企业级对接资产缺失**：端点仅会话鉴权，Prometheus 无法带凭据直连抓取（抓取建议停留在注释）；仓库无 prometheus.yml 示例、无 Grafana 看板、无监控部署文档——「一般企业级的应用都支持配置监控」的最后一公里断线。

另有一处口径缺口：v1 队列/槽位指标只覆盖默认池（label 硬编码 `pool="exec"`），S9 ENTP-006 已支持多资源池按池隔离队列（`exec-pool-{poolId}`），多池部署下非默认池队列深度与槽位完全不可见。

### 1.2 能力行（P1）

| # | 能力                         | 说明                                                                 | 层级 | 测试映射                          |
| - | ---------------------------- | -------------------------------------------------------------------- | ---- | --------------------------------- |
| 1 | 指标目录 v2 暴露             | 新增 6 组指标（时延分位/慢查询/失败分类/任务 24h/失败率/误报），既有 4 组不破坏 | API  | INFRA-007-T2（jmx 正常路径）      |
| 2 | 全池队列与槽位               | 队列深度/执行中/dead 与引擎槽位按池展开（label=BullMQ 队列名）        | API  | INFRA-007-T2（jmx 断言按池 label） |
| 3 | APIKEY 直连抓取              | `Authorization: Bearer ak.sk` 免会话抓取，权限仍收敛于 SYSTEM_METRICS:READ | API  | INFRA-007-T2（jmx APIKEY 三分支） |
| 4 | 监控部署资产                 | prometheus.yml 示例 + Grafana 看板 JSON + 部署文档（含告警建议）      | 文档 | 评审走查（本规格 §2.5）           |
| 5 | 指标语义自描述               | 全部指标 HELP 注明窗口口径与重启语义（gauge 窗口/进程内计数归零）     | API  | INFRA-007-T1/T2（HELP 断言）      |

（无 UI 能力行——纯后端指标端点，Playwright 豁免登记见 §5。）

## 2. 方案

### 2.1 指标目录 v2（契约冻结点）

既有 4 组（v1，**只增不改**）：

| 指标                                 | 类型    | 标签                                | 口径（HELP 冻结）                                                              |
| ------------------------------------ | ------- | ----------------------------------- | ------------------------------------------------------------------------------ |
| `rabbit_queue_depth` / `_active` / `_dead` | gauge | `pool`（BullMQ 队列名）             | v2 起 `pool` 取值为队列名：默认池=`exec`（与 v1 字面一致），非默认池=`exec-pool-{poolId}`；池清单来自 resource_pools 表 ∪ 默认队列 |
| `rabbit_engine_slots`                | gauge   | `pool`, `state=used\|cap`           | v2 起按池逐池输出（v1 仅默认池一条）；数据源 resource_pools.nodes 心跳快照     |
| `rabbit_task_duration_ms`            | summary | `quantile=0.5\|0.95` + `_sum/_count` | 近 1h 终态任务，DB 聚合（不变）                                                |
| `rabbit_http_requests_total`         | counter | `route_group`, `status_class`       | 进程内累计、重启归零（不变）                                                    |

新增 6 组：

| 指标                              | 类型    | 标签                                    | 数据源与口径                                                                                                          |
| --------------------------------- | ------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `rabbit_http_request_duration_ms` | summary | `route_group`, `quantile=0.5\|0.95` + `_sum/_count` | 进程内每路由组环形缓冲（最近 512 样本/组），guard accessLog 埋点；滑动窗口口径注明于 HELP，重启归零                   |
| `rabbit_db_slow_queries_total`    | counter | —                                       | Prisma `$on('query')` 事件，duration ≥ 200ms（`RABBIT_SLOW_QUERY_MS` 可调，0=关闭订阅）计数；重启归零                 |
| `rabbit_task_failures_24h`        | gauge   | `kind`（四种 FailureKind + `UNCLASSIFIED`） | 近 24h `exec_tasks.status='FAILED'` 按 `failure_kind` 分组（NULL→UNCLASSIFIED），DB 聚合                              |
| `rabbit_tasks_24h`                | gauge   | `status`                                | 近 24h `exec_tasks` 按 `created_at` 窗口、`status` 分组计数，DB 聚合                                                   |
| `rabbit_task_failure_rate_24h`    | gauge   | —                                       | 近 24h FAILED/total（`created_at` 口径）；分母 0 时输出 0                                                              |
| `rabbit_false_alarm_hit_rate_24h` | gauge   | —                                       | 近 24h `false_alarm_hits` 计数 / `exec_items(status='FAILED')` join 任务窗口计数（分母 0 → 0）；分子≥0 可 >1（一条失败项可命中多规则），语义注明 |

所有 label 值经 Prometheus 文本格式转义（`\\`、`\"`、`\n`）；指标段（队列/槽位/DB 聚合/进程内）各自独立降级——任一数据源故障只跳过该段，端点仍 200 输出其余指标（v1 queueOk 模式推广）。

### 2.2 时延埋点与慢查询计量

- **埋点位置**：`guard/index.ts` `accessLog()`（全 API 出口统一收口，reqId/计数/日志已在此）——响应返回后 `httpObserve(path, ms)`，与 `httpIncr` 同点；环形缓冲存 `globalThis`（Next dev 多 chunk 与 HMR 复用，同 metrics-counter 既有模式）。
- **慢查询**：`packages/db` PrismaClient 构造时启用 `log: [{ level: "query", emit: "event" }]`（warn/error 保持 stdout），`apps/web` 侧（guard 模块加载时）订阅一次（globalThis 防重），阈值过滤后仅累计计数——不落日志、不记 SQL 文本与参数（安全 §3 脱敏口径：参数不外泄）。开销：Prisma 查询事件序列化常驻；提供 `RABBIT_SLOW_QUERY_MS=0` 关闭订阅的逃生门。

### 2.3 抓取鉴权矩阵（APIKEY 直连）

`GET /api/v1/system/metrics` 权限语义：**SYSTEM_METRICS:READ 不变**，新增第三通道：

| 通道                  | 凭据                                   | 判定                                                                                                |
| --------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 会话（浏览器/既有 jmx） | Cookie session                        | `getActiveUserId` → `permissionSetFor` 含 SYSTEM_METRICS:READ → 200；无会话 → 走 APIKEY 通道         |
| APIKEY（Prometheus）  | `Authorization: Basic ak:sk` / `Bearer ak.sk` | `verifyApiKey`（常量时间比对，INTG-003 复用）→ userId → 权限点校验 → 200；key 无效/吊销 → 401（10010） |
| 无凭据                | —                                      | 401（10001，与 v1 未登录一致——INFRA-004 jmx T4.1 兼容）                                             |

- 无权限（普通用户或其 APIKEY）→ 403（10003，与 v1 一致——INFRA-004 jmx T4.2 兼容）。
- APIKEY 通道限流：`rateLimit("system-metrics", ak 前缀, 30, 60)`（30 次/分钟；15s 抓取间隔=4 次/分钟，余量 7 倍）→ 429（10012，OPEN_RATE_LIMITED 复用）；jmx 不做 429 直发（固定窗口分钟边界翻滚不稳定，INTG-003 同口径先例——限流由 rateLimit 单测覆盖）。
- 会话通道不限流（管理员浏览器调试口径不变）。
- 实现形态：路由文件内 `withMetricsAuth` 逻辑（accessLog 从 guard 导出复用——访问日志/reqId/httpIncr 口径与其余端点完全一致），不新增通用 guard（避免影响 280+ 既有路由）。

### 2.4 采样器错误分类的现实口径

§6 规划的「采样错误分类码计数」以**任务级失败分类**（`failure_kind`，引擎 `classifyFailure` 产出并经回调落库）兑现：`rabbit_task_failures_24h{kind}`。HTTP 采样器内部的细粒度网络错误（DNS/CONNECT/TLS/TIMEOUT 细分，engine 事件帧内有 message 但无结构化码）登记 Backlog——需先在 engine 侧结构化错误码（EXEC 域变更），不在本规格虚造口径。

### 2.5 监控部署资产（不进代码，进 docs）

- `docs/deployment/monitoring.md`：抓取配置（bearer/basic 两形态）、指标目录说明、Grafana 导入、告警建议（dead>0、失败率突增、槽位饱和、慢查询增长）、安全注意（metrics 不公网暴露、key 轮换走个人 APIKEY 页、SYSTEM_METRICS:READ 权限收敛）；
- `docs/deployment/assets/prometheus.yml`：单实例 scrape 段示例（15s、metrics_path、authorization）；
- `docs/deployment/assets/rabbit-overview.grafana.json`：8 面板总览看板（队列深度与 dead、槽位、HTTP QPS/P95、任务时延 P95、24h 任务分布、失败率+失败分类、误报率+慢查询）。

## 3. 技术架构

```
Prometheus ──(Bearer ak.sk, 15s)── /api/v1/system/metrics ── 鉴权矩阵（会话优先协商 → APIKEY → 401/403/429）
                                        │  指标组装（分段独立降级，任一源故障仍 200）
                                        ├─ 队列段：resource_pools 清单 × execQueueNameFor(poolId) → BullMQ getJobCounts（每池）
                                        ├─ 槽位段：resource_pools 逐池 nodes 心跳求和
                                        ├─ DB 段：近 1h 时长分位 / 24h 任务分布 / 失败分类 / 误报（$queryRaw）
                                        └─ 进程段：httpIncr/httpObserve（guard accessLog 埋点）+ $on('query') 慢查询计数
guard accessLog ──┬─ httpIncr(path, status)   （v1 既有）
                  ├─ httpObserve(path, ms)    （v2 新增，环形缓冲 512/组）
                  └─ initSlowQueryMeter()     （guard 模块加载时订阅一次）
packages/db PrismaClient（log: query event）── $on('query') → metrics-db 计数（阈值 200ms）
```

文件清单：

| 文件                                                              | 变更   | 内容                                                        |
| ----------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| `apps/web/src/server/metrics-counter.ts`                          | 修改   | +`httpObserve`/`httpDurationSnapshot`/`DURATION_WINDOW`     |
| `apps/web/src/server/metrics-format.ts`                           | 新增   | 文本组装纯函数（escape/percentile/ratio/行构造）            |
| `apps/web/src/server/metrics-db.ts`                               | 新增   | 慢查询计量（订阅一次 + 计数出口）                           |
| `apps/web/src/app/api/v1/system/metrics/route.ts`                 | 重写   | v2 组装 + 鉴权矩阵（§2.3）                                  |
| `apps/web/src/server/guard/index.ts`                              | +4 行  | accessLog 导出 + httpObserve 埋点 + 慢查询订阅初始化        |
| `packages/db/src/index.ts`                                        | +1 处  | PrismaClient 启用 query 事件                                |
| `docs/deployment/*`                                               | 新增   | 监控文档 + prometheus.yml + Grafana JSON                    |
| `rules/observability.md` §6                                       | 改写   | 已交付指标目录对齐 + Backlog 登记                           |

零业务表 DDL（门禁 3 不涉及）；OpenAPI 无变更（同 path 同响应 schema，鉴权经 header 不进契约）。

## 4. 契约与兼容性（接口契约评审面）

1. **v1 指标向后兼容**：4 组既有指标名/类型/标签语义不变（默认池 label 仍为 `exec`）——INFRA-004 jmx 断言（`rabbit_queue_depth`、`rabbit_task_duration_ms` 名称包含断言）保持绿；
2. **鉴权兼容**：会话通道 401/403 行为与 v1 完全一致（code 10001/10003）——INFRA-004 jmx T4.1/T4.2 保持绿；
3. **文本格式**：`text/plain; version=0.0.4`，`# HELP/# TYPE` 齐全，数值无 NaN（分母 0 → 0）；label 值转义符合 exposition format；
4. **降级语义**：Redis 断 → 队列段 0 值保留（v1 语义）；DB 断 → DB 段跳过、进程段照常（端点可用性优先——监控系统自身不给被监控系统的故障雪上加霜）；
5. **权限收敛**：SYSTEM_METRICS:READ 不放宽——APIKEY 通道同样过权限点校验（普通用户 key 403）；抓取不落审计（高频，审计面以 key 建立与吊销为准）；
6. **OpenAPI 快照**：无 diff（CI --check 不受影响）；
7. **与 INFRA-006（RLS）并行**：无代码依赖；共同触点 guard/index.ts（本规格 +4 行 accessLog 区域，RLS 改动在守卫包裹区域）与 packages/db 构造点（本规格在 index.ts 构造参数；RLS 将构造迁至 tenant.ts prismaAdmin）——后合并方需把 query 事件 log 选项随构造点平移（两分支 PR 描述互见登记）。

## 5. 测试用例

| 编号            | 类型                                                    | 内容                                                                                                                                                                                              |
| --------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-007-T1    | Vitest `apps/web/src/server/__tests__/s10-metrics-v2.test.ts` | httpObserve 环形缓冲（超容量淘汰、分位口径、非法值丢弃）；httpDurationRows（空组跳过/sum/count）；escapeLabelValue 转义矩阵；percentile 边界；ratio 分母 0→0；failureKindRows（NULL→UNCLASSIFIED、四 kind）；metrics-db（阈值默认/非法 env 回退、订阅一次、≥阈值计数、0 跳过订阅） |
| INFRA-007-T2    | JMeter `tests/api/INFRA-007-metrics-v2.jmx`             | 四类×四断言：正常路径（管理员会话 200 + v1/v2 指标名与 `pool="exec"` label 断言 + JSR223 Content-Type=text/plain + 时长上限；管理员 APIKEY Bearer 直连 200）；401（未登录 10001 / 无效 key 10010）；403（普通用户会话 10003 / 普通用户 APIKEY 10003）；422/分页不适用（无请求体、文本端点非信封——INFRA-004 同口径登记；429 限流不做直发，见 §2.3） |
| e2e             | 豁免登记                                                | 纯后端指标端点无 UI 能力行（§1.2 无 UI 行）；全量 e2e 回归作为 guard 埋点零回归证据                                               |

## 6. 竞品/业界对标

- **MeterSphere v3**：自研 Java 服务以 Spring Boot Actuator + Micrometer 暴露 `/actuator/prometheus` 供企业 Prometheus 抓取——本规格同构（单端点文本格式 + Bearer 抓取 + 看板导入），差异仅在指标集合按本项目域模型定义；
- **Prometheus 社区惯例**：进程内计数器重启归零由 `rate()` 吸收、DB 窗口聚合用 gauge + HELP 注明窗口、label 用稳定队列名而非可改名资源名——均按 exposition format 与社区最佳实践落地；
- Grafana 看板随仓库版本化（JSON 资产），对标企业发行版「开箱即用看板」。

## 7. 里程碑与验收

- DoD：§5 两项测试交付 + 全量回归（Vitest/JMeter 71+ 计划/e2e 双分片）绿 + 远端 CI 全绿；
- 契约冻结点：§2.1 指标目录（名称/类型/标签/口径）与 §2.3 鉴权矩阵——新增指标只增不改（同 v1 纪律）；后续指标变更须走勘误登记。

## 8. 勘误登记

无。
