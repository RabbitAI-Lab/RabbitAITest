# 监控对接（Prometheus + Grafana）

> 对应规格：`docs/sprint-10-hardening/INFRA-007-metrics-v2.md`（指标目录与鉴权矩阵的契约冻结点）。
> 适用版本：main（S10 起）。指标端点：`GET /api/v1/system/metrics`（Prometheus 文本格式 `text/plain; version=0.0.4`）。

## 1. 快速开始（抓取配置）

Prometheus 侧两种凭据形态任选其一（凭据来自个人 APIKEY：Web「个人设置 → APIKEY」创建，`sk` 仅创建时返回一次）：

```yaml
# 形态 A：Bearer（推荐，见 docs/deployment/assets/prometheus.yml 完整示例）
scrape_configs:
  - job_name: rabbitaitest
    scrape_interval: 15s
    metrics_path: /api/v1/system/metrics
    authorization:
      type: Bearer
      credentials: "<accessKey>.<secretKey>" # ak.sk
    static_configs:
      - targets: ["rabbit-web:3000"] # 换成实际地址端口


# 形态 B：Basic（ak 作用户名、sk 作密码）
#   basic_auth: { username: "<accessKey>", password: "<secretKey>" }
```

要求：该 APIKEY 属主具备 `SYSTEM_METRICS:READ` 权限点（系统管理员组）。**普通用户的 key 抓取会得到 403（10003）**；无效/吊销 key 得 401（10010）；单 key 限 30 次/分钟（429，默认抓取间隔 15s 远低于此）。

Grafana：导入 `assets/rabbit-overview.grafana.json`（v2·10 面板总览：队列/槽位/HTTP/任务/失败与误报/慢查询/**采样器错误分类**/**进程资源 web·engine·mock**），数据源选上述 Prometheus。

## 2. 指标目录

### 队列与引擎（实时 gauge）

| 指标                                                               | 标签                                                                  | 说明                                                    |
| ------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `rabbit_queue_depth` / `rabbit_queue_active` / `rabbit_queue_dead` | `pool`（BullMQ 队列名：默认池=`exec`，非默认池=`exec-pool-{poolId}`） | 待执行/执行中/dead 任务数；Redis 故障时输出 0（段降级） |
| `rabbit_engine_slots`                                              | `pool`, `state=used\|cap`                                             | 引擎并发槽占用/容量（resource_pools 心跳快照，逐池）    |

### HTTP 面（进程内）

| 指标                                   | 标签                                  | 说明                                                                                                                                                                                                                                     |
| -------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rabbit_http_requests_total`           | `route_group`, `status_class`         | 计数器（重启归零，用 `rate()`）；route_group 为 `/api/v1/{第一段}`                                                                                                                                                                       |
| `rabbit_http_request_duration_ms`      | `route_group`, `quantile=0.5\|0.95`   | 每路由组最近 512 样本滑动窗口分位 + `_sum/_count`（重启归零；单进程口径）                                                                                                                                                                |
| `rabbit_http_request_duration_seconds` | `route_group`, `le`（histogram 桶族） | **加法式 histogram（INFRA-010，秒制）**——与 ms summary 同点双写并存；跨副本聚合：`histogram_quantile(0.95, sum by (route_group, le) (rate(rabbit_http_request_duration_seconds_bucket[5m])))`；桶界 0.005~5s +Inf（契约冻结于规格 §2.1） |

### DB 面（进程内）

| 指标                           | 说明                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `rabbit_db_slow_queries_total` | admin Prisma 通道 ≥`RABBIT_SLOW_QUERY_MS`（默认 200ms）的查询计数；`RABBIT_SLOW_QUERY_MS=0` 关闭订阅 |

### 任务与业务面（24h 窗口 gauge，每次抓取重算）

| 指标                              | 标签                                                                         | 说明                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `rabbit_task_duration_ms`         | `quantile=0.5\|0.95` + `_sum/_count`                                         | 近 1h 终态任务时长分位                                                                                                      |
| `rabbit_tasks_24h`                | `status`                                                                     | 近 24h 创建任务按状态分布                                                                                                   |
| `rabbit_task_failure_rate_24h`    | —                                                                            | 近 24h 失败率（FAILED/total；无任务时 0）                                                                                   |
| `rabbit_task_failures_24h`        | `kind`（NETWORK_ERROR/ASSERT_FAILED/CONFIG_ERROR/SCRIPT_ERROR/UNCLASSIFIED） | 失败任务按引擎失败分类                                                                                                      |
| `rabbit_false_alarm_hits_24h`     | —                                                                            | 误报命中数（false_alarm_hits）                                                                                              |
| `rabbit_false_alarm_hit_rate_24h` | —                                                                            | 误报命中率 = 命中数/失败执行项（可 >1：一项可命中多规则）                                                                   |
| `rabbit_sampler_errors_24h`       | `code`（dns/connect/reset/tls/timeout/url/aborted/other_net/config/script）  | 步骤/采样器执行错误按结构化分类码（INFRA-008；多条目任务的任务级 failureKind 恒 ASSERT_FAILED，步骤级网络失败原因由此可见） |

### 进程运行时面（INFRA-008 web 自采 + INFRA-009 引擎心跳上报 + INFRA-010 mock 自暴露；Node 内建零依赖）

| 指标                                                                      | `process` label                                                                                                      | 说明                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `rabbit_process_uptime_seconds` / `rabbit_process_cpu_seconds_total`      | `web`（自采）/ `engine-{nodeId}`（池心跳 proc 快照，10s 粒度）/ `mock`（`GET /metrics` 自暴露，Prometheus 内网直抓） | 进程存活时长 / 累计 CPU（user+system，重启归零）                             |
| `rabbit_process_resident_memory_bytes` / `rabbit_process_heap_used_bytes` | 同上                                                                                                                 | 常驻内存 / V8 堆使用                                                         |
| `rabbit_process_eventloop_lag_ms`                                         | **仅 `web`**                                                                                                         | 事件循环平均延迟（直方图读后 reset——窗口=抓取间隔；engine 心跳不上报直方图） |

> 慢查询计数（`rabbit_db_slow_queries_total`）自 INFRA-009 起覆盖 **admin+tenant 双 Prisma 通道**（RLS 租户流量主体已纳入；HELP/语义不变）。

## 3. 告警建议（起步值）

| 告警           | 表达式（示例）                                                     | 建议阈值                     |
| -------------- | ------------------------------------------------------------------ | ---------------------------- |
| 死信堆积       | `rabbit_queue_dead > 0` 持续 5m                                    | 立即通知（引擎消化失败终态） |
| 队列积压       | `rabbit_queue_depth > 100` 持续 10m                                | 按容量调整                   |
| 槽位饱和       | `used/cap ≥ 0.95` 持续 15m                                         | 扩池或调 maxConcurrency      |
| API 可用性     | `rate(rabbit_http_requests_total{status_class="5xx"}[5m]) > 0`     | 立即通知                     |
| API P95 劣化   | `rabbit_http_request_duration_ms{quantile="0.95"} > 2000` 持续 10m | 按基线调整                   |
| 失败率异常     | `rabbit_task_failure_rate_24h > 0.3` 持续 30m                      | 结合业务基线                 |
| 慢查询增长     | `rate(rabbit_db_slow_queries_total[10m]) > 0.1`                    | DB 侧排查索引                |
| DNS/网络故障面 | `rabbit_sampler_errors_24h{code="dns"} > 10` 持续 10m              | 检查解析器/网络出口          |
| 事件循环阻塞   | `rabbit_process_eventloop_lag_ms > 100` 持续 5m                    | 定位同步阻塞/事件堆积        |

## 4. 安全注意

- **不要把 `/api/v1/system/metrics` 暴露到公网**：指标含路由组/状态分布等运行时信息，且端点有真实 DB/Redis 查询成本（抓取限 30 次/分钟/key 只兜滥用，不是安全边界）；
- 凭据轮换：APIKEY 在个人设置页随时吊销重建（≤5 条/人），Prometheus 配置同步更新；
- 抓取不落审计日志（15s 间隔高频；审计面以 key 的建立/吊销事件为准）；
- 指标输出不含任何业务数据明细与凭据（慢查询只计数不记 SQL 文本——rules/observability §3 脱敏口径）。

## 5. 平台组件指标（外部 exporter）

应用指标之外，PostgreSQL / Redis / 宿主机指标由各自官方 exporter 提供（`docs/deployment/assets/prometheus.yml` 内附注释化抓取段，按需启用并替换 target）：

| 组件       | exporter                                | 关注面                                                         |
| ---------- | --------------------------------------- | -------------------------------------------------------------- |
| PostgreSQL | `prometheuscommunity/postgres_exporter` | 连接数饱和、慢查询（pg_stat_statements）、死元组、复制延迟     |
| Redis      | `oliver006/redis_exporter`              | 内存碎片率、驱逐键、阻塞客户端、主从延迟                       |
| 宿主机     | `prometheus/node_exporter`              | CPU/内存/磁盘/网络；与 `rabbit_process_*` 互补（进程 vs 机器） |

engine 进程指标经心跳 proc 上报为 `process="engine-{nodeId}"` 序列（INFRA-009）；mock 进程经自身 `GET /metrics` 暴露 `process="mock"` 序列（INFRA-010，Prometheus 内网直抓无凭据——与 mock 既有 /healthz 同口径，生产不公网暴露）；plugin-runner 为 engine 内 worker_threads 已计入所属 engine 进程。

## 6. 已知边界（INFRA-010 后指标 Backlog 清零）

- **无剩余登记项**。未来事项（非缺口）：web 多副本成为默认部署形态时可废止 ms summary（届时以 INFRA-010 histogram 为唯一口径，另行勘误）；engine eventloop_lag 若有需要可随心跳携带直方图均值（当前无消费场景）。
