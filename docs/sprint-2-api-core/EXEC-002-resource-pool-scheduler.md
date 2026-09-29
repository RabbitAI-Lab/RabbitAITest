# 资源池与调度（并发槽·停止·重跑）

| 元信息项     | 内容                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | EXEC-002                                                                                                                                                                               |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                                                                                |
| 优先级       | P1                                                                                                                                                                                     |
| 所属模块     | 执行引擎（exec 域）                                                                                                                                                                    |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例）；引擎类规格以接口契约评审替代高保真——AGENTS 门禁 2 |
| 最后更新日期 | 2026-09-27                                                                                                                                                                             |
| 上游依赖     | EXEC-001（内核 v0/心跳/回调）、API-004（执行契约 v2）、SYS-004（SYSTEM_POOL 权限）                                                                                                     |
| 下游消费     | API-008（场景批量执行）、PLAN-003（计划执行）、ENTP-006（多池 License 门控）、EXEC-004（K8S）                                                                                          |
| 上游依据     | 需求文档 M1（资源池）/M6（执行引擎）/§四（100 并发/任务不丢/失败重跑）；功能清单 §9.1                                                                                                  |
| 对标基线     | 功能清单 §9.1：Node/K8S 型、编辑最大并发、社区版限 1 默认池不可删、任务中心联动                                                                                                        |
| 关联架构文档 | engine-execution-architecture.md §2（状态机/重派）§5（池与调度）§7（差异化决策）；rules/engine.md §7（双层槽位）                                                                       |
| 高保真确认   | 不适用（引擎类）——接口契约评审：执行契约 v2（API-004 §4）+ 心跳 v2 + 停止信号协议，2026-09-27 评审通过                                                                                 |
| 工作量估算   | 引擎 4 人日 / 后端 2 人日 / 前端 1.5 人日                                                                                                                                              |

## 1. 概述

### 1.1 功能定位

执行任务的调度面：默认池并发配置下发、节点在线状态（心跳槽位）、任务停止（控制信号）、失败重跑（副本重建）。标准版=单默认池单机多进程语义。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                        | P1 ✅ | 后续                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------- |
| 池列表/详情（系统设置）：类型/最大并发/节点表（nodeId/版本/槽位 busy/total/最近心跳/在线态）                                | ✅    | —                                               |
| 编辑默认池最大并发（2-64）：经心跳响应下发，engine 动态调整 Worker concurrency                                              | ✅    | —                                               |
| 心跳 v2：slots 语义=总并发，新增 busy（在执任务数）；离线 3 拍标记不可调度展示                                              | ✅    | 多节点路由细化（BullMQ 单队列自然负载均衡近似） |
| 新建/删除池                                                                                                                 | ❌    | ENTP-006（License 门控：UI 禁用+提示）          |
| K8S 型池                                                                                                                    | ❌    | EXEC-004（P4）                                  |
| 任务停止：`POST .../exec-tasks/{id}/stop`→Redis 控制键→engine 取消（item 间隙检查）→STOPPED                                 | ✅    | 步骤中途强杀（S2=步骤边界协作式）               |
| 失败重跑：复制原任务载荷重建新任务（不续写旧任务），clientTaskId 置空                                                       | ✅    | —                                               |
| 引擎重启任务不丢：BullMQ attempts 2+指数退避；RUNNING 心跳超时回收口径登记 ✅（回收=任务中心展示 STUCK 标记，人工重跑兜底） | ✅    | 自动重派 ≤2 次（S3 API-008 批量执行前置）       |
| 引擎版本协商：心跳携带版本，web 侧低于契约 v2 的节点标记「版本不匹配-不调度展示」                                           | ✅    | —                                               |

### 1.3 前置依赖

执行契约 v2（API-004）；Redis（控制键通道）。

### 1.4 对标基线核对

完全复刻：池并发编辑/节点心跳/社区版单默认池不可删。简化实现：调度=单队列自然负载均衡（基线 Controller 精细路由=企业版 §12.6 口径）；停止=协作式（步骤/item 边界）；重派自动化延后（登记）。超出基线：busy 槽位展示、版本协商（架构 §5/§7 要求）。

## 2. 业务逻辑

- 任务状态机（扩展）：PENDING→RUNNING→SUCCESS|FAILED|**STOPPED**（终态幂等；STOPPED 由 engine 终态回调带回）。
- 停止协议：web `SET exec:stop:{taskId}=1`（TTL 1h）+ PUBLISH；engine 在 item 边界与每步采样前检查→余下 item 标 SKIPPED、当前 item 中断→task-final(stopped)；web 收 stopped 回调→任务/余 item STOPPED。
- 并发槽：engine Worker concurrency=心跳响应下发的 maxConcurrency（BullMQ 支持运行时调整）；心跳 busy=当前在执 job 数。
- 重跑：`POST .../exec-tasks/{id}/rerun` 仅 FAILED/STOPPED 可用（其他 422 code 50003 语义变体——`TASK_NOT_RERUNNABLE 50004`）；新任务 payload/环境快照深拷贝，名称关联原任务（任务中心「重跑自」列）。

## 3. UI/UX 设计（高保真 docs/design/EXEC-002-resource-pool-scheduler/）

- 系统设置新增「资源池」页：池卡片（默认池：类型 NODE/最大并发/在线节点数）+ 节点表格（nodeId/版本/槽位 busy÷total 进度条/最近心跳相对时间/状态徽标 在线|离线|版本不匹配）+「新建资源池」禁用按钮（Tooltip：企业版功能，License 未启用）。
- 编辑并发：卡片「编辑」→Modal 数字输入 2-64→保存→约一个心跳周期后 engine 槽位变化（节点表刷新验证）。
- 任务操作入口：任务中心行「停止」（RUNNING 态）/「重跑」（FAILED/STOPPED 态）；报告页头部「重跑」。

## 4. 技术架构

- 数据模型（已建齐）：ResourcePool(nodes JSONB/maxConcurrency/isDefault)、ExecTask(failureKind/message)。
- 契约 v2（shared/execution）：heartbeatSchema 增 `busy?:number`；注册/心跳响应体 `{maxConcurrency, acceptVersion}`（engine 据此调并发；版本不匹配→节点标 UNMATCHED 仍心跳不领任务由 web 判定展示）；taskStatusSchema 增 `STOPPED`；execCommandSchema.type 扩 `api_case`；callback outcome 增 `stopped`。
- 端点：`GET /api/v1/system/pools`、`GET .../system/pools/{id}`、`PUT .../system/pools/{id}`（maxConcurrency 2-64；默认池不可删、type/name 不可改→422）；`POST /api/v1/projects/{pid}/exec-tasks/{taskId}/stop`、`POST .../exec-tasks/{taskId}/rerun`；internal 注册/心跳响应升级。
- 权限点：SYSTEM_POOL:READ|UPDATE（SYSTEM_ADMIN 预置已有）；任务操作=PROJECT_EXEC_TASK:UPDATE（API-003 入库）。
- 错误码：`POOL_NOT_FOUND 50404`、`TASK_NOT_RUNNING 50003`、`TASK_NOT_RERUNNABLE 50004`。
- 引擎：worker 心跳解析响应调 `worker.concurrency`；停止键检查点（每 item 前+每步采样前）；任务取消时 close in-flight undici AbortController。
- 前端：`/system/pools/page.tsx`（Server）+ `PoolCard.tsx`。

## 5. 测试用例

- EXEC-002-T1（jmx 四类）：池列表/详情/PUT 并发；401/403（无 SYSTEM_POOL）/404；并发越界 422（1/65）、type 改动 422；节点表信封。
- EXEC-002-T2（spec 主链路）：提交长任务（mock 延迟接口）→任务中心 RUNNING→「停止」→状态 STOPPED（UI+接口断言 outcome=stopped）→报告标停止。
- EXEC-002-T3（spec 重跑二态）：失败任务「重跑」→新任务出现（「重跑自」关联）且原任务不动；SUCCESS 任务重跑按钮隐藏+直发 422（50004）。
- EXEC-002-T4（spec 并发生效）：编辑并发 4→2→节点表槽位 total 变 2（心跳后刷新断言）；心跳 busy 在 RUNNING 任务时 ≥1。
- 单测：停止键检查点矩阵、重跑副本深拷贝（环境快照不共享引用）、心跳响应并发应用边界。

## 6. 竞品深度对标

基线 §9.1 社区版口径全覆盖（单默认池/并发编辑/不可删）。技术差异必引（§7）：JMeter 分布式→BullMQ 单队列多 worker（节点=进程实例，扩容=起进程）；K8S 型=EXEC-004；多池=ENTP-006 License 门控（UI 禁用对齐基线无 License 交互）。

## 7. 里程碑与验收

契约评审已过（见元信息）。停止/重跑与 SYS-006/RPT-002 三方联动（验收 2/4）；undici 重定向遗留（S0 §8）随 API-004 采样器重写清偿。

## 8. 勘误登记

（暂无）
