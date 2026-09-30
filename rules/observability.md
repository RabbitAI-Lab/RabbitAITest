# rules/observability.md — 日志、链路与可观测性规范

> 由 AGENTS.md §2 引用；对应 INFRA-004（可观测性与备份）与 QA-001（性能基线）的数据来源规范。

## 1. 结构化日志

1. 统一 logger：web/engine/mock/plugin-runner 一律 `packages/shared/logger`（pino JSON 输出）；**禁止 `console.log/warn/error` 直写**（lint 拦截；脚本与 CLI 例外）。
2. 标准字段（JSON 顶层）：

| 字段                             | 说明                                                     |
| -------------------------------- | -------------------------------------------------------- |
| `ts` / `level` / `msg`           | pino 内建；级别见 §2                                     |
| `reqId`                          | 请求/操作唯一 ID（入站生成，响应头 `X-Request-Id` 返回） |
| `userId` / `orgId` / `projectId` | 上下文归属（已登录必带）                                 |
| `execTaskId`                     | 执行任务 ID（engine 侧与 web 编排侧贯穿）                |
| `module`                         | 域名（case/plan/api/exec/…）                             |

3. 消息用稳定英文短语 + 结构化字段带参（`logger.info({caseId}, 'case created')`），禁止把变量拼进 msg（无法检索）。

## 2. 级别语义

| 级别  | 用途                                                | 动作                       |
| ----- | --------------------------------------------------- | -------------------------- |
| error | 需要人关注：未捕获异常、回调重试耗尽、任务 dead     | 告警渠道（P2 起）          |
| warn  | 可自愈但需观察：重试、降级、越权尝试(403)、配额接近 | 周报                       |
| info  | 业务关键动作：任务创建/完成、同步执行、插件加载     | 保留                       |
| debug | 排障细节（变量渲染、事件帧样例）                    | 生产默认关闭，按模块动态开 |

## 3. 脱敏

1. 序列化前统一过滤键：`password/passwd/secret/token/apikey/authorization/cookie/credential`（含嵌套对象与数组内对象）；logger 配置 redact 路径，新增敏感字段在 security.md §4.3 清单登记后同步维护。
2. 请求体日志只记摘要（方法/路径/字节数），不落完整 payload；响应同理。

## 4. 链路追踪

1. `reqId` 生成于 Next middleware / Route Handler 入口；经 HTTP 头透传到 engine 回调、plugin-runner RPC、三方同步任务——同一执行任务的所有日志可按 `execTaskId` 聚合检索。
2. 异步任务（BullMQ）以 jobId 建立与 `execTaskId` 的映射日志（任务入队/出队各一条 info）。
3. **外部调用禁止静默吞错**：webhook 注册、三方平台对接、消息推送等外部调用失败必须记 warn/error 并在界面可见（或进重试队列）——历史教训：绑仓 webhook 注册失败被静默吞掉，排查时无任何线索。
4. **队列消费者注册自检**：新增任务类型必须同时登记消费者（processor），服务启动时自检「已注册任务类型 ↔ 已注册消费者」双向对齐并输出清单——历史教训：异步模块漏注册导致 worker 侧 unregistered、任务静默堆积。

## 5. 健康检查与就绪

1. `GET /api/v1/system/health`：liveness（进程存活）；`GET /api/v1/system/ready`：readiness 逐项检查 DB（含 embedded 模式）、Redis、MinIO、默认资源池心跳（engine 最近 3 拍内有心跳）——部署与 CI 启动等待均以 ready 为准。
2. engine 节点心跳含：版本、并发槽容量/占用、已加载协议插件列表（调度与排障依据）。

## 6. 指标（QA-001 基线数据源）

`GET /api/v1/system/metrics` 输出 Prometheus 文本格式（S8 INFRA-004 最小集 → S10 INFRA-007 v2 兑现并扩展；完整指标目录、鉴权矩阵、抓取配置与看板见 [docs/deployment/monitoring.md](../docs/deployment/monitoring.md)）：

- 队列（按池，label=BullMQ 队列名）：待执行深度、执行中、dead 数
- 引擎（按池）：并发槽占用/容量（池心跳快照）、任务 P50/P95 时长（近 1h 终态）
- Web：API 计数（路由组×状态类）、P50/P95 时延双口径——ms summary（512 样本滑窗）+ **seconds histogram 桶族**（加法式并存，跨副本 histogram_quantile 可聚合，INFRA-010）、DB 慢查询计数（admin+tenant 双 Prisma 通道 ≥200ms，`RABBIT_SLOW_QUERY_MS` 可调/0 关闭）
- 业务：24h 任务分布与失败率、失败分类计数（FailureKind 四类+UNCLASSIFIED）、采样器/步骤错误分类码计数（dns/connect/tls/timeout 等结构化枚举，INFRA-008）、误报命中数与命中率
- 进程运行时：`rabbit_process_*{process}`——web 自采（uptime/cpu/rss/heap/eventloop_lag，INFRA-008）+ engine 节点心跳 proc 快照（engine-{nodeId}，INFRA-009）+ mock 自暴露 `/metrics`（mock，INFRA-010）
- 鉴权：会话或个人 APIKEY（`Authorization: Bearer ak.sk`），权限统一 `SYSTEM_METRICS:READ`；APIKEY 通道限流 30 次/分（mock `/metrics` 为内网支撑服务无鉴权，与 /healthz 同口径）

指标 Backlog 已清零（INFRA-007~010）；未来事项非缺口：多副本成为默认形态时废止 ms summary（另行勘误）。

## 7. 排障包（失败任务自助定位）

任务终态为 failed 时按需聚合：任务定义快照 + 事件流末尾 N 帧（N=50）+ 日志检索说明（进程日志走 stdout pino JSON，按 `execTaskId` 字段检索——S8 勘误：不做 LOG_FILE 文件读取，避免 env 路径穿越面）→ 报告页「排障包」按钮 POST 直下单 JSON（INFRA-004 已交付；预生成/对象存储归档登记 Backlog）；这是「失败重跑」之外的第二支持路径。
