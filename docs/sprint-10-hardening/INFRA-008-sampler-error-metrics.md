# INFRA-008 采样器错误码与运行时指标（指标面 v2.1）

## 0. 元信息

| 项       | 值                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | Draft → Implemented（分支 `INFRA-008-sampler-error-metrics`，基线 main c806fdc（含 INFRA-007），worktree RabbitAITest-s2，2026-09-30）                            |
| 模块     | INFRA（可观测性；含 engine 侧最小结构化改动，无产品面 UI 变更）                                                                                                  |
| 评审方式 | 纯后端规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——契约面 = §2.1 错误码枚举表 + §2.2 指标目录增量 + §2.3 log 帧新增字段；经用户目标式授权「继续补」实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/observability.md §6（Backlog 兑现——INFRA-007 §2.4 登记的「采样器级细粒度错误码」）· rules/engine.md · api-conventions（帧 schema additive）                |
| 前置     | S10 INFRA-007（指标面 v2，24h 窗口 gauge 族与组装框架复用）                                                                                                      |
| 并行分支 | INFRA-006（RLS，PR #15）/PLUG-004（PR #17）——本规格 engine 触点为 samplers/http 调用侧（runner/step.ts）与 kernel 新文件，与两者（processors/drivers/worker 心跳）无重叠；CHANGELOG 无冲突语义 |

## 1. 问题

INFRA-007 交付的失败分类只到任务级 `failureKind`（NETWORK_ERROR/ASSERT_FAILED/CONFIG_ERROR/SCRIPT_ERROR），且**多条目任务（api_case/scenario/plan）的任务级 failureKind 恒为 ASSERT_FAILED**（worker 聚合口径），步骤级网络失败原因（DNS？拒连？证书？超时？）完全不可见；引擎事件帧里只有自由文本 message，无法聚合。另两处指标面缺口：进程运行时零观测（CPU/堆/事件循环延迟——多副本/性能排障基础）、监控部署文档未覆盖平台组件 exporter（postgres/redis/node）。

## 2. 方案

### 2.1 采样器错误码枚举（契约冻结点）

engine 新增纯函数 `classifySamplerError(err)`（kernel/errors.ts，walk cause 链收集 code/name）：

| code       | 判定（错误 code/name 正则，大小写不敏感）                                          | 语义                     |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------ |
| `dns`      | `ENOTFOUND` / `EAI_AGAIN` / `EAI_NONAME`                                           | 域名解析失败             |
| `connect`  | `ECONNREFUSED` / `ENETUNREACH` / `EHOSTUNREACH`                                    | 连接被拒/网络不可达      |
| `reset`    | `ECONNRESET` / `EPIPE`                                                             | 连接中途被重置           |
| `tls`      | 含 `tls`/`ssl`/`cert`/`leaf_signature`/`self_signed`                              | 证书/握手失败            |
| `timeout`  | 含 `timeout` / `ETIMEDOUT`（含 undici Headers/BodyTimeoutError）                   | 超时                     |
| `url`      | 含 `invalid url` / `URIError` / `InvalidArgument`；或 err 为 `TypeError`           | URL/参数非法             |
| `aborted`  | 含 `abort`                                                                          | 请求中止（非用户停止）   |
| `other_net`| 其余网络/传输错误                                                                   | 兜底（不虚造细类）       |
| `config`   | `ProcessorError(CONFIG_ERROR)`                                                     | 前置配置错误（映射）     |
| `script`   | `ProcessorError(SCRIPT_ERROR)`                                                     | 脚本错误（映射）         |

任务级 `failureKind` **语义不变**（兼容 INFRA-007 指标与既有测试）；code 是步骤级细化，二者并存。

### 2.2 指标目录增量（INFRA-007 §2.1 目录只增不改）

| 指标                            | 类型  | 标签  | 数据源与口径                                                                                                       |
| ------------------------------- | ----- | ----- | ------------------------------------------------------------------------------------------------------------------ |
| `rabbit_sampler_errors_24h`     | gauge | `code` | 近 24h `exec_items(status='FAILED')` 按 `result->>'errorCode'` 分组（join exec_tasks created_at 窗口）；分母 0 → 无行（HELP/TYPE 恒在） |
| `rabbit_process_uptime_seconds` | gauge | —     | `process.uptime()`                                                                                                  |
| `rabbit_process_cpu_seconds_total` | counter | —  | `process.cpuUsage()` user+system 累计（重启归零）                                                                   |
| `rabbit_process_resident_memory_bytes` | gauge | — | `process.memoryUsage().rss`                                                                                         |
| `rabbit_process_heap_used_bytes` | gauge | —    | `process.memoryUsage().heapUsed`                                                                                    |
| `rabbit_process_eventloop_lag_ms` | gauge | —   | `monitorEventLoopDelay().mean()`（读后 reset——窗口=抓取间隔；globalThis 单例，20ms resolution）                      |

### 2.3 帧与持久化通道（additive，零 DDL）

1. **log 帧新增可选字段 `code`**（`logFrame.code: string ≤32 optional`）——engine 在步骤 catch 出口把分类码随错误日志发出；UI/既有消费方对未知字段免疫（zod 默认宽松、SSE 透传），帧原样落库 `exec_step_results.frame`；
2. **web 回调终局冗余**：`exec.service` 条目终局（多条目分支与 api_debug 分支）从该条目帧提取首个 `code`，并入 `exec_items.result.errorCode`（result 为 Json 摘要列，additive 键）——指标 SQL 走 item 级行（远小于帧行），与误报命中率同成本级；
3. api_debug 分支 item 此前不写 `result`，本次补齐 `{status, message, errorCode?}`（报告消费只读既有键，additive 安全）。

### 2.4 部署资产增补（文档，不进代码）

- `docs/deployment/prometheus.yml` 增加注释化的 postgres_exporter / redis_exporter / node_exporter 抓取段（占位 target）；
- `monitoring.md` 新增「平台组件指标」章节与上述三项新指标的目录行、Backlog 清单更新（删除「采样器细粒度错误码」项，保留「租户通道慢查询」与「多副本 histogram 化」）。

## 3. 技术架构

```
engine runStep catch ──┬─ ProcessorError → log("error", msg, "config"|"script")
                      └─ 其他异常 → classifySamplerError → log("error", `网络错误（${code}）：…`, code)
帧流（Redis Stream）→ web 回调终局 → exec_items.result.errorCode（多条目/api_debug 两分支）
/system/metrics DB 段 → rabbit_sampler_errors_24h{code}（GROUP BY result->>'errorCode'，24h 窗口）
/system/metrics 进程段 → metrics-runtime.ts（Node 内建：uptime/cpuUsage/memoryUsage/monitorEventLoopDelay）
```

文件清单：

| 文件                                                          | 变更 | 内容                                                |
| ------------------------------------------------------------- | ---- | --------------------------------------------------- |
| `packages/shared/src/execution/schemas.ts`                    | +1 行| logFrame.code 可选字段                              |
| `apps/engine/src/kernel/errors.ts`                            | 新增 | classifySamplerError（含 cause 链遍历）             |
| `apps/engine/src/runner/step.ts`                              | 小改 | log() 支持 code；两处 catch 出口带码                |
| `apps/web/src/server/domains/exec/exec.service.ts`            | 小改 | 条目终局提取 code → result.errorCode（两分支）      |
| `apps/web/src/server/metrics-format.ts`                       | 小改 | samplerErrorRows                                    |
| `apps/web/src/server/metrics-runtime.ts`                      | 新增 | 运行时快照与行构造（纯函数可测）                    |
| `apps/web/src/app/api/v1/system/metrics/route.ts`             | 小改 | 采样器错误段 + 进程运行时段                         |
| `docs/deployment/*`、`rules/observability.md`、CHANGELOG      | 增补 | 目录/Backlog/exporter 示例                          |

## 4. 契约与兼容性

1. **failureKind 不变**：任务级分类、exec_tasks.failure_kind、INFRA-007 既有指标全部不动；
2. **帧 schema additive**：code 为可选字段，旧帧无 code、旧消费方忽略；OpenAPI 无 diff（帧非 HTTP 契约面）；
3. **exec_items.result additive**：新增 errorCode 键，报告/统计读既有键零感知；
4. **分类码枚举冻结**（§2.1 十一枚举）：新增码须走勘误；`other_net` 为显式兜底，避免长尾噪声码；
5. e2e/jmx 既有断言（NETWORK_ERROR 任务级文案、误报改判链路）零回归——FAKE_ERROR 改判只匹配 step-result 帧，网络失败步骤无 step-result 帧，errorCode 不与误报语义交叠。

## 5. 测试用例

| 编号         | 类型                                                     | 内容                                                                                                                                  |
| ------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-008-T1 | Vitest `apps/engine/src/__tests__/sampler-errors.test.ts`| classifySamplerError 矩阵：ENOTFOUND→dns / ECONNREFUSED→connect / ECONNRESET→reset / 证书码→tls / HeadersTimeoutError→timeout / TypeError→url / undici cause 链嵌套 / 兜底→other_net |
| INFRA-008-T2 | Vitest（web，s10-metrics-v2/runtime 增补）               | samplerErrorRows（码透传+label 转义+NULL 过滤）；runtimeRows 六行格式（数值有限性）；errorCode 提取 helper（有/无 code 帧）            |
| INFRA-008-T3 | JMeter `tests/api/INFRA-008-sampler-errors.jmx`          | 四类×四断言：正常路径（注册→`.invalid` 域名 api_debug 确定性 DNS 失败（RFC 2606 保证 NXDOMAIN）→ 等待终态 → 管理员 GET metrics 断言 `rabbit_sampler_errors_24h{code="dns"}` 与 `rabbit_process_uptime_seconds` + 时长）；401（未登录 10001）；403（普通用户 10003）；422/分页不适用（同 INFRA-007 登记口径） |
| e2e          | 豁免登记                                                 | 无 UI 能力行（帧 code 字段对 UI 透明）；全量 e2e 回归为帧链路零回归证据                                                                |

## 6. 竞品/业界对标

- MeterSphere v3：HTTP 采样错误在报告中即有粗分类（连接/超时/断言）；本规格以结构化码 + Prometheus 聚合补齐同等可观测能力，且不引入新依赖（自研分类器 ~40 行）；
- Prometheus 社区：process_* 指标命名对齐 client_golang/client_python 惯例（uptime_seconds/cpu_seconds_total/resident_memory_bytes），事件循环延迟是 Node 生态特有口径（monitorEventLoopDelay 官方 API）。

## 7. 里程碑与验收

- DoD：§5 三项测试交付 + 全量回归绿 + 远端 CI 全绿；
- 契约冻结点：§2.1 错误码枚举、§2.2 指标增量、log 帧 code 字段——只增不改。

## 8. 勘误登记

无。
