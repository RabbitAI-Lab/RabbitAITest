# 场景批量执行与定时任务

| 元信息项     | 内容                                                                                           |
| ------------ | ---------------------------------------------------------------------------------------------- |
| 文档编号     | API-008                                                                                        |
| 所属迭代     | Sprint 3 — 场景自动化                                                                          |
| 优先级       | P1（迭代内）                                                                                   |
| 所属模块     | 接口测试（api_test 域）+ 执行（exec 域）+ 引擎并发                                             |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）             |
| 最后更新日期 | 2026-09-27                                                                                     |
| 上游依赖     | API-006（createScenarioTask）、EXEC-002（池并发/心跳下发）、SYS-006（任务中心定时 Tab）        |
| 下游消费     | S4 PLAN-003（计划批量执行复用并发模式）、RPT-003（批量报告）                                   |
| 上游依据     | 需求文档 §五「定时任务、批量操作」；功能清单 §6.5 列表/执行                                    |
| 对标基线     | 功能清单 §6.5：列表批量执行/移动/复制/删除、定时任务；§5 任务中心实时任务「定时任务开启/关闭」 |
| 关联架构文档 | engine-execution-architecture.md §2（p-limit 并发槽）；observability.md（调度日志）            |
| 高保真确认   | 待确认（原型 docs/design/API-008-scenario-execution-batch/）                                   |
| 工作量估算   | 后端 3 人日 / 前端 2 人日 / 引擎 1 人日                                                        |

## 1. 概述

### 1.1 功能定位

场景的规模化执行入口：列表勾选批量执行（串行/并行两种模式）+ 项目级定时任务（cron 周期触发指定场景集），兑现 S2 API-003「并行度选择」遗留与 SYS-006 定时 Tab 空态。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                             | P1 ✅ | 后续                                       |
| -------------------------------------------------------------------------------- | ----- | ------------------------------------------ |
| 批量执行弹窗：勾选 1..50 场景→环境/池/失败停止开关/**模式：串行 or 并行**        | ✅    | 并行度数值调节（池级并发即上限，登记简化） |
| 并行模式：任务内 item 并行（p-limit 池 maxConcurrency 槽位）                     | ✅    | —                                          |
| 失败停止：串行同 S2 语义（余项 SKIPPED）；并行=已发item完成余项 SKIPPED          | ✅    | —                                          |
| 批量移动（目标模块）/批量复制/批量删除（软删）                                   | ✅    | —                                          |
| 定时任务：名称/cron（5 段）/场景集（多选）/环境/通知开关占位；启用/停用/立即执行 | ✅    | 通知（S5 MSG-001 承接开关）                |
| 任务中心「定时任务」Tab：项目级定时任务列表（cron/场景数/状态/最近触发）         | ✅    | 触发历史（以生成的执行任务承载，登记简化） |
| 触发链路：到点→按场景集建任务（复用 createScenarioTask）→任务中心可见            | ✅    | 错过触发补偿（单机部署下次点触发，登记）   |

### 1.3 前置依赖

BullMQ repeatable job（技术栈既定）；web 侧常驻 consumer（instrumentation 起 scheduler worker，queue `schedule`）；engine worker 并发动态调整（心跳下发，S2 已交付）。

### 1.4 对标基线核对

完全复刻：批量执行/移动/复制/删除、定时任务启停与 cron。简化实现：并行度=池并发上限不可调（基线可调线程数）；通知开关为占位（S5）；单机部署口径（多实例需分布式锁，社区版单机先登记）。

## 2. 业务逻辑

- 批量执行：`POST /scenarios/execute {scenarioIds 1..50, envId?, poolId?, stopOnFail?, mode: serial|parallel}` → 1 ExecTask(type=scenario) N item（每场景一个，预建）；serial=engine 顺序执行（S2 同构）；parallel=engine 对 items p-limit(池 maxConcurrency) 并行，stopOnFail 触发后未开始 item SKIPPED。
- 定时任务：`ScenarioSchedule` 语义存 AppSetting（key=`scenario_schedules`，value=[{id,name,cron,scenarioIds,envId,enabled}]）+ BullMQ repeatable job（jobId=schedule id，cron pattern 校验 5 段）双轨——AppSetting 为权威源，repeatable 为触发器（启停同步增删）。
- 触发：scheduler worker 收 job → 逐 schedule 调 exec.service.createScenarioTask（复用入队链路，ExecTask.createdBy=`system:schedule`）→ 任务中心出现该任务。
- cron 校验：字段 5 段（分/时/日/月/周），词法白名单（数字/`*`/`,`/`-`/`/`），最短间隔≥5 分钟防风暴（更细 422 50034）。
- 边界：场景被删（软删）后定时触发跳过该场景并记 log（不失败整任务）；全部被删→任务创建为空 422 防呆（schedule 自动停用并标记）。

## 3. UI/UX 设计（高保真 docs/design/API-008-scenario-execution-batch/）

- 批量执行弹窗：环境选择/池（默认池）/失败停止开关/模式 Radio（串行：说明顺序执行；并行：说明池并发上限 N）→提交跳任务中心高亮。
- 批量移动弹窗：目标模块树选择；批量复制=名称后缀「-copy」提示。
- 定时任务页签（任务中心 Tab 2 复用 + 场景列表工具条「定时任务」入口）：列表（名称/cron 描述/场景数/环境/状态开关/最近触发/操作：编辑·立即执行·删除）+ 新建/编辑抽屉（cron 输入+下次触发时间预览）。
- 任务中心定时 Tab：同列表数据源（项目级）。

## 4. 技术架构

- 数据模型：零新表（AppSetting 承载 schedule；**评审理由**：调度元数据非核心域关系数据、生命周期随项目且无跨域查询，建表收益低；若 S4 计划定时需要独立审计再升级独立表）。
- 端点：`GET/POST /projects/{pid}/scenario-schedules`、`PUT/DELETE .../scenario-schedules/{id}`、`POST .../scenario-schedules/{id}/toggle`、`POST .../scenario-schedules/{id}/run`（立即执行）；批量：`POST /scenarios/execute`、`POST /scenarios/batch-move`、`POST /scenarios/batch-copy`。
- 服务：`schedule.service.ts`（CRUD+BullMQ repeatable 同步：`queue.add("fire",{scheduleId},{repeat:{pattern},jobId})`/`removeRepeatable`）；web `instrumentation.ts` 起 `schedule` 队列 Worker（Node runtime，单实例前提）。
- 引擎：worker runTask scenario 分支支持 parallel 模式（p-limit(heartbeat 下发并发)，SerialExecutor/ParallelExecutor 策略对象）；帧 seq 全任务单调（并行 item 帧交错按 seq 排序回放，ExecStepResult 按 itemId 分组——回调分组逻辑 S2 已有）。
- 权限点：批量执行=PROJECT_SCENARIO:CREATE；定时任务=PROJECT_SCENARIO:UPDATE（增删改/启停）；任务中心查看=PROJECT_EXEC_TASK:READ（既有）。
- 错误码：`SCHEDULE_NOT_FOUND 40428`、`CRON_INVALID 50034`、`SCHEDULE_SCENARIOS_EMPTY 50035`。
- 前端：`BatchExecuteModal.tsx`（场景版）、`SchedulePanel.tsx`（任务中心 Tab 接入，替换 S2 空态）。

## 5. 测试用例

- API-008-T1（jmx 四类）：schedules CRUD/toggle/run；401/403/404；cron 非法 422 50034、scenarioIds 空 422；列表信封。批量 execute>50 422。
- API-008-T2（spec 批量并行）：2 场景并行执行→1 任务 2 item 均达终态（报告两份入口）；stopOnFail 并行语义（其一失败→未开始 item SKIPPED）；任务中心状态（UI+接口）。
- API-008-T3（spec 定时任务）：建 schedule（cron `*/5 * * * *` 立即验证缩短路径用 run 触发+BullMQ 每 15s 轮询替代等待，E2E 用 `run` 端点断言同链路）→触发后任务中心出现 system:schedule 任务；停用后不再触发（mock 时间窗口断言）；场景全删→schedule 自动停用。
- 单测：cron 词法矩阵、schedule CRUD 与 repeatable 同步（mock BullMQ）、parallel p-limit 分组与 stopOnFail 矩阵、seq 交错回放排序。

## 6. 竞品深度对标

基线批量/定时主体覆盖；差异：①并行度固定池上限；②通知延后 S5；③单实例 scheduler（社区版单机口径，基线分布式 node）；④触发历史以执行任务承载。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：并行 item 帧交错与回调分组（S2 按 itemId 分组逻辑复用验证）；scheduler 在 web 进程的启停稳定性（e2e global-setup 起栈验证）。

## 8. 勘误登记

（暂无）
