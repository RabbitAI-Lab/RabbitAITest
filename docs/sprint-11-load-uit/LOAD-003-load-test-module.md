# 性能测试模块实施（LOAD-003 · 企业版 License 门控）

| 元信息项     | 内容                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | LOAD-003                                                                                                                                             |
| 所属迭代     | Sprint 11 — 性能测试 / UI 测试模块兑现                                                                                                               |
| 优先级       | P4→企业版兑现级                                                                                                                                      |
| 所属模块     | LOAD 性能测试 / EXEC 执行（引擎 load 内核）/ SYS 系统设置（License 特性）                                                                            |
| 文档状态     | **Verified**（2026-09-30 人工验收走查通过：验收演示视频 demo/s11-acceptance-demo.webm 九段主线复核；功能+三层测试全绿）                              |
| 最后更新日期 | 2026-09-30                                                                                                                                           |
| 上游依赖     | LOAD-001（占位资产：开关/权限/占位页/池 DTO）、LOAD-002（架构稿：拓扑/状态机/契约冻结）、ENTP-007（License 门控）、EXEC-002（池注册/心跳）           |
| 下游消费     | ENTP 深化（多节点分布式调度=LOAD-002 Phase 2；压测报告对比）                                                                                         |
| 上游依据     | 需求文档 §范围红线 3「执行引擎不自研性能压测内核（**P4 再议**）」再议结论 + §优先级 P4 行；本 PR 同步修订该两处及 AGENTS 门禁 6 第 3 条              |
| 对标基线     | MeterSphere功能清单 §12.10（v1/v2 性能测试=JMeter 分布式；本项目差异化=Node 施压进程，LOAD-002 §6 已冻结决策）                                       |
| 关联架构文档 | engine-execution-architecture.md（BullMQ 拓扑复用）、tech-stack.md（引擎新增 load 内核模块登记）                                                     |
| 高保真确认   | **已确认**（确认人：xujialiang；确认日期：2026-09-30；原型链接：docs/design/LOAD-003-load-test/index.html；验收演示：demo/s11-acceptance-demo.webm） |
| 工作量估算   | 后端+引擎 2 人日 + 前端 1.5 人日 + 测试 1 人日                                                                                                       |

## 1. 概述

### 1.1 功能定位

兑现 LOAD-002 冻结架构：把 LOAD-001 占位替换为**真实性能测试模块**（企业版 License 门控，标准版口径不变）。交付施压计划（目标+压力模型）编排、执行（controller 阶梯调度 + 单节点施压内核）、秒级度量时间线与报告曲线。**不是通用压测引擎**：内核=引擎内 undici+p-limit 施压进程，仅服务本模块结构化施压计划（LOAD-002 §6 决策：不做压测 jmx 兼容、不引 JVM）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | P1 ✅ | 后续                                              |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| 施压计划 CRUD（名称/目标 HTTP 请求/压力模型/断言阈值，软删）           | ✅    | —                                                 |
| 压力模型：持续时长 + 阶梯加压（并发阶梯/目标 TPS 两种模式）            | ✅    | —                                                 |
| 执行与即时停止（STOP ≤2s 停发压并上报已发总量）                        | ✅    | —                                                 |
| 秒级度量（发压数/成功数/失败数/RT min/avg/P50/P95/P99）聚合与持久化    | ✅    | —                                                 |
| 报告：秒级时间线曲线（TPS/失败率/RT 分位，SVG 自绘）+ 结论（阈值判定） | ✅    | 报告对比 diff（ENTP 深化）                        |
| 多节点分布式分片调度（controller→N 压力节点）                          | ❌    | ENTP 深化（拓扑/契约已冻结，队列/流键位一次建齐） |
| 压测 jmx 兼容 / JMeter 内核                                            | ❌    | 不做（红线+LOAD-002 §6 差异化冻结）               |
| 池 type=LOAD 专用压力节点池                                            | 部分  | type 值+DTO 激活语义交付；专用调度面 ENTP 深化    |

### 1.3 前置依赖

- LOAD-001 占位资产（开关/权限点/导航/占位页）；ENTP-007 `assertEntpEnabled`+License 签发链；EXEC-002 池注册与 POOL_ID 队列绑定；BullMQ/ioredis/undici/p-limit（引擎既有依赖，零新增）。

### 1.4 对标基线核对

| 基线行为（v1/v2 性能测试）         | 本项目实现                                            | 口径     |
| ---------------------------------- | ----------------------------------------------------- | -------- |
| 压测任务：JMX 脚本+压力配置+资源池 | 结构化施压计划（zod schema）+压力模型 Json            | 简化实现 |
| JMeter master-slave 分布式施压     | controller+压力节点（BullMQ shard 队列，LOAD-002 §6） | 简化实现 |
| 实时监控（TPS/RT/错误率曲线）      | 秒级时间线 SSE 推流+SVG 曲线                          | 完全复刻 |
| 聚合报告+分位数                    | summary.metrics 秒级时间线（P50/P95/P99）+阈值结论    | 完全复刻 |
| 社区版无模块                       | License 未激活=占位页+90001                           | 完全复刻 |

## 2. 业务逻辑

- **生命周期**：`PENDING → RUNNING(RAMPING_UP|STEADY) → SUCCESS | ABORTED | FAILED`（ExecTask.type=`load` 复用任务面；FAILED=施压配置/目标不可达）。
- **调度**（controller，BullMQ 单消费者）：按压力模型生成本地调度表（每秒目标并发/TPS），驱动施压内核阶梯爬升；每 1s 窗口聚合内核上报计数，XADD 秒级帧到 `load-metrics-{taskId}` Stream；任务终态聚合全时间线写 Report(summary.metrics) 并回调 web。
- **施压内核**（单节点）：undici Agent 连接池+p-limit 并发槽，按每秒配额发压；STOP 键（`load-stop-{taskId}`）轮询 ≤2s 停发，上报已发总量。
- **停止语义**：web 停止=SET 停止键+任务状态 ABORTED（controller 终态回写）；报告仍生成（已发压部分时间线保留）。
- **门控链**：路由层 `assertEntpEnabled("LOAD_TEST")`（90001）→ `withPermission(PROJECT_LOAD:*)` → 页面层 modules.load ∧ canGlobal(perm) ∧ useEntp().can("LOAD_TEST")。三重不满足任一→占位页（社区版态）。
- **边界**：目标 URL 走既有 SSRF 守卫口径；时长上限 10 分钟、并发上限 200、TPS 上限 1000（zod 上界+管理面可配，防误操作打挂目标）；同项目同时仅一个 RUNNING 施压任务（409）。

## 3. UI/UX 设计

- 高保真原型：`docs/design/LOAD-003-load-test/index.html`（四画板：计划列表/计划编辑器/任务监控实时曲线/报告曲线与结论）。
- 页面：`/load`（列表：名称/目标/最近任务状态/操作 执行·编辑·删除）/ ` /load/{id}`（编辑器：目标请求+压力模型+阈值）/ `/load/tasks/{taskId}`（监控：运行态实时曲线+停止按钮；终态跳报告）/ `/load/reports/{reportId}`（曲线三联+结论卡）。
- 占位页降级：License 缺失时 /load 全路由组渲染企业版方向空态（复用 LOAD-001 卡片，文案增「License 未激活」），导航与开关逻辑不变。

## 4. 技术架构

- **数据模型**（门禁 3 一次建齐；无独立任务/度量表——任务复用 ExecTask、时间线载于 Report.summary Json，对齐 LOAD-002 §2「报告」行）：
  - `LoadTest`：id/projectId/name/status(ACTIVE)/target(Json: method/url/headers/body)/pressure(Json: mode=concurrency|tps, durationSec, ramp: 阶梯数组, maxConcurrency|targetTps)/thresholds(Json: okRateMin, p95MsMax, avgMsMax)/envId?/createdBy/timestamps/deletedAt
  - `ExecTask.type` 增 `load`；`Report.reportType` 增 `load`（summary Json 扩展 `metrics` 键：秒级点数组+聚合结论）
- **shared**：`packages/shared/src/load/schemas.ts`（zod：loadTestCreate/update/pressure 阶梯/thresholds/metrics 帧）+ 权限点 `PROJECT_LOAD:READ|CREATE|UPDATE|DELETE|EXECUTE`（LOAD-001 保留位扩展动作集，预置组映射同 PROJECT_API 口径）+ `ENTP_FEATURES` 增 `{key:"LOAD_TEST", spec:"LOAD-003"}`（License 载荷 features 枚举自动扩展）
- **web API**（apps/web/src/app/api/v1/projects/[projectId]/load*）：`GET/POST /load-tests`、`GET/PUT/DELETE /load-tests/{id}`、`POST /load-tests/{id}/run`、`POST /load-tasks/{taskId}/stop`、`GET /load-tasks/{taskId}/metrics`（时间线回放，终态从 Report 读）、`GET /load-tasks/{taskId}/stream`（SSE 实时，XRANGE 起点续传）；internal 回调复用既有 exec 回调端点（type=load 分支）
- **引擎**（apps/engine/src/load/，零新增依赖）：`controller.ts`（BullMQ `load` 队列消费者：调度表生成（纯函数）+阶梯驱动+聚合+终态回调）、`generator.ts`（施压内核：undici 池+p-limit+1s 计数窗口）、`metrics.ts`（Stream 读写：XADD 秒级帧，键 `load-metrics-{taskId}` TTL 24h，帧 schema 入 shared）；停止键 `load-stop-{taskId}`（复用 exec 停止键模式）；队列 `loadQueueNameFor(poolId)`=`load`|`load-pool-{id}`（shard 队列名位 `load-shard-{taskId}` 保留不启用，LOAD-002 拓扑挂点）
- **报告曲线**：前端 SVG 自绘（RPT-004 StatsTrendChart 先例扩展双序列+分位三线）。

## 5. 测试用例

| 编号        | 类型   | 前置                     | 步骤                                        | 预期                                                                        |
| ----------- | ------ | ------------------------ | ------------------------------------------- | --------------------------------------------------------------------------- |
| LOAD-003-T1 | Vitest | 调度表纯函数             | 阶梯模型→逐秒目标并发表                     | 爬升/稳态/收尾秒序列符合模型；边界（0 阶梯/超上限）抛错                     |
| LOAD-003-T2 | Vitest | 聚合器纯函数             | 多秒计数帧→时间线+分位+阈值结论             | P50/P95/P99 插值正确；阈值越限→结论 FAIL                                    |
| LOAD-003-T3 | Vitest | zod schema               | 非法压力模型（超上限/负时长/坏 URL）        | 422 逐字段                                                                  |
| LOAD-003-T4 | Vitest | 内嵌 echo server         | 施压内核 3s 小压力（本地 http）             | 发压数≥目标×0.8、停止键 ≤2s 生效、metrics 帧齐                              |
| LOAD-003-T5 | jmx    | admin+License(LOAD_TEST) | 计划 CRUD 四类（正常/401·403/422/分页信封） | 四项断言全过（含 list 分页 data 结构）                                      |
| LOAD-003-T6 | jmx    | 无 License 会话          | 同 POST /load-tests                         | 403·90001（assume_success）                                                 |
| LOAD-003-T7 | jmx    | admin+License            | run→轮询 metrics→stop                       | run 202 信封 code=0；stop 后任务 ABORTED；时间线点数>0                      |
| LOAD-003-T8 | e2e    | admin+License+开关       | 建计划（mock /ping，8s）→执行→监控曲线→报告 | UI：曲线可见+结论文案；Console：无 error；接口：run 200 且 metrics 帧含 tps |
| LOAD-003-T9 | e2e    | 移除 License             | 访问 /load                                  | 占位页（License 未激活态）+90001 网络断言                                   |

四类场景映射：正常路径=T5/T7·T8；权限=T6（门控）+T5 的 403 组（普通成员）；校验（422）=T5 的 422 组（坏压力模型）；分页=T5 的 list 组。

## 6. 竞品深度对标

基线 v1/v2 性能测试=JMeter 分布式（master-slave RMI、JMX 脚本、聚合报告）。差异化决策（LOAD-002 §6 冻结，本规格兑现）：施压内核=引擎内 Node 进程（undici+p-limit，纯 TS 技术栈约束）；施压计划=结构化 schema 而非 JMX 全集语义；节点协调=BullMQ 队列+Redis Stream（复用既有中间件，零新增运维面）。功能面对齐：阶梯加压、即时停止、秒级实时监控、分位数聚合报告。社区版口径完全一致（无模块）。

## 7. 里程碑与验收

- DoD 前置：高保真四画板人工确认（目标式授权下原型先产出，确认随验收走查）。
- 契约冻结：shared zod schema+队列/流/停止键命名（实现前评审=本规格 §4）。
- 验收：T1-T9 全绿 + 概览 §4-2/§4-4 演示 + 回归（LOAD-001 占位 e2e 在无 License 态仍绿——占位语义不破坏）。

## 8. 勘误登记

无。
