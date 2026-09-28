# 可观测与备份（INFRA-004 · 统一日志 / reqId 链路 / 指标 / 排障包 / 备份恢复）

| 元信息项     | 内容                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | INFRA-004                                                                                                          |
| 所属迭代     | Sprint 8 — 稳定化                                                                                                  |
| 优先级       | P2（rules/observability.md 的落地迭代）                                                                            |
| 所属模块     | 基础设施横切：shared logger / web middleware+guard / system 端点 / engine / 备份脚本                               |
| 文档状态     | Implemented（2026-09-28 交付：logger/reqId/metrics/ready/排障包/备份恢复全量；三层测试全绿；排障包原型走查随验收） |
| 最后更新日期 | 2026-09-28                                                                                                         |
| 上游依赖     | S0 health/ready、S2 BullMQ 基建、S3 ExecStepResult 事件帧、S4 报告页、BUG-001 附件存储（storageKey 抽象）          |
| 下游消费     | QA-001（metrics=场景 C 数据源）、运维部署（备份策略）、S9 企业版                                                   |
| 上游依据     | rules/observability.md 全文；需求文档 §四 可靠性/可部署（数据备份/恢复脚本）                                       |
| 对标基线     | MeterSphere 社区版无内置备份/指标 UI（部署侧能力）——本项目以脚本+端点最小落地，非 UI 复刻                          |
| 关联架构文档 | rules/observability.md（§1-§7 即本规格验收清单）；monorepo-structure.md（包边界：logger 落 packages/shared）       |
| 高保真确认   | 待确认（原型 docs/design/INFRA-004-observability-backup/——仅排障包下载按钮；其余无 UI）                            |
| 工作量估算   | 后端 5 人日 / 前端 0.5 人日                                                                                        |

## 1. 概述

### 1.1 功能定位

落地 rules/observability.md：统一 pino logger（脱敏）+ reqId 链路（X-Request-Id）+ 访问日志；`/system/metrics` Prometheus 文本最小指标集；ready 增强（存储+池心跳）；失败任务排障包（报告页一键下载）；备份/恢复脚本 roundtrip。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                  | P1 ✅ | 后续                                     |
| ----------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------- |
| `packages/shared/logger`：pino JSON、redact 脱敏（§3 清单）、子 logger（module 绑定）                 | ✅    | 日志外送 ELK/Loki（登记）                |
| 全栈接入：web/engine/mock/plugin-runner 四应用 + 存量 console.* 清零                                  | ✅    | —                                        |
| reqId：middleware 生成 → AsyncLocalStorage 透传 → `X-Request-Id` 响应头                               | ✅    | 跨服务 W3C traceparent（登记）           |
| 访问日志：guard 层输出 method/path/status/耗时/reqId/userId（info）                                   | ✅    | 慢请求 (>1s) 独立 warn 聚合（登记）      |
| `/api/v1/system/metrics`：Prometheus 文本（队列深度/执行中/dead、引擎槽占用、任务 P50/P95、API 计数） | ✅    | 外部 Prometheus 抓取部署文档（不进代码） |
| ready 增强：附件存储可写 + 默认资源池心跳（engine 3 拍内）                                            | ✅    | MinIO 驱动（附件本地盘勘误延续）         |
| 排障包：failed/dead 任务聚合 manifest+末 50 事件帧+日志片段 → tar.gz 附件存储                         | ✅    | 自动预生成（当前按需生成，登记）         |
| 报告页「下载排障包」按钮（失败任务可见；成功任务隐藏）                                                | ✅    | —                                        |
| 备份脚本：`scripts/backup.mjs`（pg_dump+附件目录+manifest → tar.gz）                                  | ✅    | 增量/加密/异地（登记）                   |
| 恢复脚本：`scripts/restore.mjs`（manifest 校验→pg_restore→附件回放）roundtrip                         | ✅    | —                                        |

### 1.3 前置依赖

pino 依赖新增（packages/shared）；iron-session middleware 既有；ExecStepResult/ExecTask 模型既有；attachments 本地存储驱动既有。

### 1.4 对标基线核对

基线无对应 UI/脚本（部署侧）。本项目最小落地；排障包为超出基线的支持路径（observability.md §7 预定）。

## 2. 业务逻辑

- **logger**：`createLogger(module)` 返回 pino instance（level=env `LOG_LEVEL` 默认 info；生产 JSON、TTY 开发单行文本）；redact 路径=`password/passwd/secret/token/apikey/api_key/authorization/cookie/credential` 含嵌套通配；标准字段约定见 rules §1.2。
- **reqId 链路**：middleware 为每个请求生成 `reqId`（crypto.randomUUID 短形态 12 位）挂 `AsyncLocalStorage`；guard `toResponse`/`withAuth` 出口统一补 `X-Request-Id` 头；engine 侧 job 日志带 execTaskId（既有约定延续）。
- **访问日志**：middleware 完成时 `logger.info({reqId,method,path,status,ms,userId}, 'http request')`；API 面只在 guard 出口记（避免双记），页面由 middleware 记。
- **metrics 语义**（Prometheus 文本，`# HELP/# TYPE` 齐全）：
  - `rabbit_queue_depth{pool}` / `rabbit_queue_active{pool}` / `rabbit_queue_dead{pool}`：BullMQ `getJobCounts`（wait/active/delayed→failed 永久口径）
  - `rabbit_engine_slots{state="used|cap"}`：心跳最新值（ResourcePool 心跳记录）
  - `rabbit_task_duration_ms{quantile="0.5|0.95"}`：近 1h 终态任务 durationMs 分位（DB 聚合）
  - `rabbit_http_requests_total{route_group,status_class}`：进程内计数器（middleware 内存累计，重启归零——登记口径）
- **ready 增强**：checks 增 `storage`（附件根目录写探针）与 `pool`（默认资源池最近心跳 ≤ 3×心跳间隔；无 engine 部署 `NO_ENGINE=1` 时显示 skipped 不阻塞）。
- **排障包**：`POST /api/v1/projects/{pid}/reports/{id}/troubleshoot-pack`（按需生成）→ 组装 `{manifest.json（任务/items/汇总/环境）, events.jsonl（末 50 帧原样）, logs.txt（LOG_FILE 存在则 grep execTaskId 片段，不存在则说明行）}` → tar.gz 存附件存储，返回下载 token；`GET` 同路径下载（HMAC 令牌复用附件读通道）。任务非 failed/dead → 422 `70060 PACK_NOT_ALLOWED`。
- **备份**：`backup.mjs`：`pg_dump -Fc` + 附件目录 tar + `manifest.json`（版本/时间/pg 版本/schema checksum）→ `backups/rabbit-YYYYMMDD-HHmmss.tar.gz`；`--out` 可指定目录；提示保留策略（cron 示例进文档）。
- **恢复**：`restore.mjs`：校验 manifest 版本与 pg 大版本兼容 → 停栈提示 → `pg_restore --clean --if-exists` → 附件回放 → 打印 seed 口径提醒（不自动 seed，防覆盖）。

## 3. UI/UX 设计（高保真 docs/design/INFRA-004-observability-backup/）

- 报告详情页工具栏区（既有「导出/分享」旁）增「排障包」按钮：仅任务终态 failed/dead 可见（成功任务隐藏，不留灰态）；
- 点击 → loading（生成中）→ toast 成功后浏览器下载 tar.gz；失败 toast 错误文案；
- 原型静态 HTML 三状态走查：可见可点 / 生成中 / 不可见（成功任务对照）。

## 4. 技术架构

- **包边界**：pino 依赖加 `packages/shared`（logger 出口）；engine/mock/plugin-runner 经 `@rabbit/shared` 引用（check-boundaries 校验通过）。
- **端点**：`system/metrics`（GET，权限 `SYSTEM_METRICS:READ` 新增一枚——系统管理员组授予；Prometheus 抓取场景建议内网+APIKEY，文档注明）；reports/{id}/troubleshoot-pack（POST 生成 + GET 下载，`PROJECT_REPORT:READ` 复用）。
- **权限点**：`SYSTEM_METRICS:READ`（新增）。
- **错误码**：`PACK_NOT_ALLOWED 70060`（任务非失败态）。
- **迁移**：无 schema 变更（门禁 3 通过——复用 ExecTask/ExecStepResult/Attachment）。
- **OpenAPI**：新增 2 paths（metrics、troubleshoot-pack POST+GET）；快照同步更新。
- **兼容**：logger 引入不改任何既有端点行为；访问日志在测试环境 LOG_LEVEL=warn 静默（避免 e2e Console 断言受 stdout 影响——Console 断言针对浏览器侧，服务端日志无冲突，但 e2e 栈默认 LOG_LEVEL=warn 降噪）。

## 5. 测试用例

- INFRA-004-T1（单测）：logger redact 矩阵（嵌套/数组对象/自定义键）；reqId ALS 透传（同步/异步）；metrics 文本格式（指标名/标签/HELP 齐全、无 NaN）；ready 探针两态；排障包组装（帧截断 50/manifest 字段/日志缺失降级行）；tar 结构。
- INFRA-004-T2（jmx）：metrics 四类（200 文本格式断言/401 未登录/403 普通用户/信封不适用——文本端点断言 Content-Type）；排障包四类（POST 生成 200+token、成功任务 422 70060、未登录 401、GET 下载 Content-Type=application/gzip）。
- INFRA-004-T3（e2e）：排障包按钮三态（失败任务可见→点击→下载请求断言 payload/Content-Type；成功任务按钮不存在；Console 无错）。
- 备份恢复：单测级 roundtrip（脚本以子进程跑 embedded 库：backup→restore→数据可查；CI 跑快速口径）。
- CI：quality（单测）+ e2e（按钮）+ jmx（两端点）既有作业覆盖，不新增作业。

## 6. 竞品深度对标

见 §1.4。基线企业版有资源池监控面板（不复制——P3 资源池多节点后才需要，登记 S9 后评估）。

## 7. 里程碑与验收

DoD：§1.2 全能力行 ✅；`pnpm test`/jmx/e2e 绿；备份恢复 roundtrip 单测绿；OpenAPI 快照 --check 过。走查=原型三状态对照+metrics 端点 curl。

## 8. 勘误登记

1. 排障包载体：tar.gz 三件 → **单 JSON 直下**（manifest+events+logs 说明内嵌）——免新增 tar 依赖与中文文件名编码风险，内容等价；预生成/对象存储归档登记 Backlog。POST 生成+token 下载两步合并为 POST 直下。
2. 排障包 LOG_FILE 日志片段**裁撤**：env 指向路径的文件读取构成路径穿越面（Mimosa 高危拦截成立）；进程日志口径改为 stdout 统一采集（pino JSON 按 execTaskId 字段检索），包内给检索说明行。
3. 排障包路径段：reports/{reportId} → **reports/{taskId}**（与报告详情端点同口径——reportDetail 按 ExecTask.id 查询，防 slug 名冲突与语义分叉）。
4. 备份载体：pg_dump -Fc → **SQL 逻辑导出**（embedded-postgres 发行包仅含 initdb/pg_ctl/postgres 三个二进制，无 pg_dump/pg_restore）；物理 dump 口径登记部署文档。jsonb 列回放做类型归一（JSON.stringify），表回放按外键拓扑序。
5. metrics 端点 Content-Type=text/plain（Prometheus 抓取格式约定，非统一信封——api-conventions 例外）。
6. 表名口径：User/Organization 两表为 PascalCase（init 迁移未 rename 表名），备份/种子 SQL 需带引号大小写敏感访问。
