# INFRA-010 指标面终结（mock 自暴露 metrics + HTTP 时延 histogram 化·加法式）

## 0. 元信息

| 项       | 值                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | Draft → Implemented（分支 `INFRA-010-mock-metrics-histogram`，基线 main 0102e5d（含 INFRA-009），worktree RabbitAITest-s10b，2026-09-30）                          |
| 模块     | INFRA（可观测性收尾；mock 侧新增只读端点，无 UI 变更）                                                                                                            |
| 评审方式 | 纯后端规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——契约面 = §2.1/§2.2 指标目录增量；经用户目标式授权「继续补」延续与「剩余两个做起来困难吗」确认后实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/observability.md §6 · rules/engine.md（mock 同为无 DB 支撑服务）· docs/deployment/monitoring.md                                                              |
| 前置     | S10 INFRA-007（summary 时延）/ INFRA-009（§2.4 histogram 决策与 §2.5 mock 无通道结论——本规格以**加法式/自暴露**两条零破坏路径兑现，非推翻）                          |

## 1. 问题

INFRA-009 收尾后指标 Backlog 仅剩两项，均为决策挂起而非技术障碍：

1. **多副本时延 histogram 化**（INFRA-009 §2.4 判「触发式不实施」）：顾虑是**替换式**改类型——histogram 与 summary 同基名会冲突（`_sum/_count` 序列撞名），且既有看板/告警引用 `quantile` 形态会失效。**加法式**可零破坏兑现：新增秒制 histogram 族 `rabbit_http_request_duration_seconds`（Prometheus 命名惯例，天然避开 ms summary 基名），原 summary 保留——单副本继续用 summary，多副本用 `histogram_quantile(sum(rate(..._bucket[5m])) by (le))` 跨实例聚合。
2. **独立 mock 进程指标**（INFRA-009 §2.5 判「无注册通道不造通道」）：**自暴露路径**无需任何通道——mock 是 Hono 服务，新增 `GET /metrics` 供 Prometheus 直抓，与其既有无鉴权内网端点（/healthz、/hello）同口径。

## 2. 方案（契约冻结点）

### 2.1 HTTP 时延 histogram（web，加法式）

| 指标 | 类型 | 标签 | 口径 |
| --- | --- | --- | --- |
| `rabbit_http_request_duration_seconds` | **histogram** | `route_group`, `le`（桶界，秒） | 桶界 `0.005/0.01/0.025/0.05/0.1/0.25/0.5/1/2.5/5/+Inf`；`_bucket`（累积计数，重启归零，rate() 可用）+ `_sum`（秒累计）+ `_count`；与 ms summary 同点埋点（guard httpObserve 一份数据两视图）；空组跳过 |

- 跨副本聚合（多副本就绪后）：`histogram_quantile(0.95, sum by (route_group, le) (rate(rabbit_http_request_duration_seconds_bucket[5m])))`。
- 原 `rabbit_http_request_duration_ms`（summary）**不动**——既有看板/告警零回归；未来多副本成为默认部署形态时可废止 summary（另行勘误）。

### 2.2 mock 进程指标（自暴露，零依赖零通道）

| 端点 | 响应 | 指标 |
| --- | --- | --- |
| `GET /metrics`（apps/mock） | `text/plain; version=0.0.4` | `rabbit_process_uptime_seconds{process="mock"}` / `cpu_seconds_total` / `resident_memory_bytes` / `heap_used_bytes`（Node 内建四字段；与 web/engine 同族同 label 语义） |

- 鉴权口径：与 mock 既有 `/healthz` `/hello` 一致——**内网无鉴权**（mock 是测试支撑服务，生产部署不公网暴露；monitoring.md 安全注意同步）；eventloop_lag 不暴露（mock 无抓取直方图状态需求，避免半成品口径）。
- 部署资产：prometheus.yml 增 mock 抓取 job（无凭据，注释化说明内网口径）。

### 2.3 指标 Backlog 终态

INFRA-007~010 指标缺口**清零**——无剩余登记项（多副本场景的 summary 废止属未来勘误，非缺口）。

## 3. 技术架构

```
guard httpObserve(path, ms) ──┬─ 环形缓冲 → ms summary（INFRA-007，不动）
                              └─ 桶计数器（ms→秒界）→ seconds histogram（INFRA-010）
Prometheus ──(内网直抓, 无鉴权)── mock :port/metrics → rabbit_process_*{process="mock"}
```

文件清单：

| 文件 | 变更 | 内容 |
| --- | --- | --- |
| `apps/web/src/server/metrics-counter.ts` | 扩展 | 桶计数器（DURATION_BUCKETS 秒界 + httpObserve 双写 + httpHistogramSnapshot） |
| `apps/web/src/server/metrics-format.ts` | 扩展 | httpHistogramRows（le 行 + _sum/_count，label 转义） |
| `apps/web/src/app/api/v1/system/metrics/route.ts` | 小改 | 进程段挂 histogram 块 |
| `apps/mock/src/index.ts` | +1 路由 | GET /metrics（process="mock" 四指标文本） |
| `docs/deployment/*`、`rules/observability.md`、CHANGELOG、sprint-overview、docs/README | 增补 | 交付面同步 |

零 DDL；OpenAPI 无 diff（mock 不在 web 契约面；/system/metrics 同 path 同 schema）。

## 4. 契约与兼容性

1. **加法零破坏**：ms summary 及其 `_sum/_count` 原样保留；histogram 基名不同（`_seconds`）无序列冲突；
2. mock `/metrics` 不引入鉴权/不引依赖（Node 内建）——与既有内网端点同口径，Prometheus job 无凭据；
3. 桶计数为进程内计数器（重启归零，`rate()` 吸收）；桶界冻结于 §2.1，调整须勘误。

## 5. 测试用例

| 编号 | 类型 | 内容 |
| --- | --- | --- |
| INFRA-010-T1 | Vitest（web，s10 histogram 增补） | 桶累积语义（观测 3ms/8ms/600ms → le=0.005=1、le=0.01=2、le=1=3、+Inf=count）；sum 秒折算；空组跳过；与 summary 同数据源一致（count 相等） |
| INFRA-010-T2 | Vitest（mock） | GET /metrics → 200 + text/plain + `process="mock"` 四指标行；/healthz 回归不受影响 |
| INFRA-010-T3 | JMeter `tests/api/INFRA-010-mock-histogram.jmx` | 正常路径（web histogram `le="+Inf"` 行断言 + mock 直抓 `process="mock"` + Content-Type JSR223）；404（mock 未知路径）；401（web metrics 未登录）；403（web 普通用户）——mock 401/403 豁免（无鉴权内网服务，规格登记） |
| e2e | 豁免登记 | 无 UI 能力行；全量回归为 guard 埋点零回归证据 |

## 6. 里程碑与验收

DoD：§5 三项测试 + 全量回归绿 + 远端 CI 全绿；契约冻结点=§2.1 桶界与 §2.2 端点。

## 7. 勘误登记

无。
