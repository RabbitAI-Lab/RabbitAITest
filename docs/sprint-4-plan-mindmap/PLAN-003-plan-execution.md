# 计划执行（引擎调度 · 脑图执行 · 依赖联动）

| 元信息项     | 内容                                                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLAN-003                                                                                                                                                                |
| 所属迭代     | Sprint 4 — 计划完整与脑图                                                                                                                                               |
| 优先级       | P2（迭代内 P1，最重）                                                                                                                                                   |
| 所属模块     | 测试计划（plan 域）+ 执行（exec 域）+ 引擎（engine）                                                                                                                    |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                            |
| 最后更新日期 | 2026-09-27                                                                                                                                                              |
| 上游依赖     | PLAN-001（执行配置与状态机）、PLAN-002（点配置继承）、API-003/EXEC-002（api_case 执行命令）、API-006（scenario 命令与内核）、CASE-008（依赖联动）、CASE-007（脑图组件） |
| 下游消费     | PLAN-005（报告导出消费 plan 报告）、DASH-002（待办-我的执行含接口域）                                                                                                   |
| 上游依据     | 需求文档 §四 M4「执行配置/执行（列表模式、脑图模式 S/E/B）/实时通过率」；功能清单 §五「执行」                                                                           |
| 对标基线     | 功能清单 §五：执行配置（资源池、环境、串行/并行、失败停止）、执行脑图模式（S 成功/E 失败/B 阻塞、关联/新建缺陷）、实时通过率；§一 计划自动执行接口用例                  |
| 关联架构文档 | engine-execution-architecture.md §2/§4（契约 additive、kernel 纯函数）；test-domain-model.md §2.4                                                                       |
| 高保真确认   | 待确认（原型 docs/design/PLAN-003-plan-execution/；人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                         |
| 工作量估算   | 后端 5 人日 / 前端 5 人日 / 引擎 3 人日 / 联调 3 人日                                                                                                                   |

## 1. 概述

### 1.1 功能定位

计划从「人工记录结果」升级为「三类用例统一执行」：接口用例与场景经引擎真实调度（契约 v4 `plan` 命令），功能用例保持人工口径但升级脑图执行模式（S/E/B 快捷键）；执行配置四项（环境/资源池/串并行/失败停止）从 PLAN-001 占位全部激活；依赖用例失败联动 BLOCKED；通过率实时刷新。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                             | S4 ✅ | 后续                                              |
| -------------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| 引擎执行：计划内 api_case/scenario 打包 ExecTask(type=plan)，item=子命令真实执行 | ✅    | 定时执行计划（Backlog，复用 SYS-006 模式）        |
| 执行配置激活：环境选择器/资源池选择器/串行并行/失败停止（点配置继承链参与）      | ✅    | —                                                 |
| 功能用例脑图执行：模块→用例树，S/E/B 快捷键标记，右侧详情面板回写                | ✅    | 脑图内关联/新建缺陷（沿用列表行操作，登记）       |
| 依赖联动：功能用例前置 FAIL → 关联执行时后置项 BLOCKED（推导不落人工标记）       | ✅    | 跨计划依赖（登记 Backlog）                        |
| 自动更新状态激活：api_case/scenario 结果 PASS → CASE-006 关联功能用例自动标 PASS | ✅    | FAIL 方向策略（登记：仅 PASS 方向，失败不自动标） |
| 实时通过率：执行中 SSE 刷新进度/通过率/阈值徽标                                  | ✅    | —                                                 |
| 执行历史：PlanCaseRef.execHistory 累积（人工+引擎统一时间线）                    | ✅    | —                                                 |
| 停止执行：运行中 plan 任务可停止（复用 exec:stop 协作式停止）                    | ✅    | —                                                 |

### 1.3 前置依赖

ExecTask.type 注释已预留 `plan`（schema.prisma:884）；Report.reportType 预留 `plan`（:946）；引擎 api_case/scenario 分支成熟（S2/S3）。

### 1.4 对标基线核对

完全复刻：执行配置四项/脑图三键/实时通过率/自动执行接口用例。简化实现：脑图内缺陷操作沿用行操作（登记）；自动更新仅 PASS 方向（MeterSphere 双向，失败自动标 FAIL 登记后续）；依赖 BLOCKED 仅引擎执行边界（人工标记不推导，登记）。

## 2. 业务逻辑

- **plan 任务构造**：`createPlanTask(planId, {pointId?, trigger})` → 取点范围（pointId 缺省=全计划）内 refType∈{api_case, scenario} 的 refs → 每条经 resolvePointChain 取生效配置（envId/poolId/serial/stopOnFail，点显式>继承链>计划默认）→ 组装 `execCommand {kind:"plan", planId, mode(全局 serial|parallel), stopOnFail, items:[{itemId=PlanCaseRef.id, pointId, command: api_case|scenario 子命令}]}` → 事务建 ExecTask(type=plan, PENDING)+逐 item 预建 ExecItem(refType=`plan_case`, refId=PlanCaseRef.id) → 入队。
- **子命令复用**：api_case 子命令=createApiCaseTask 同构内嵌（request/asserts/pre/post/extracts 快照）；scenario 子命令=createScenarioTask 的 resolveScenarioSteps 展开树（引用解析/CSV 预展开复用）。envSnapshot 按点生效 envId 构建（同一任务内不同点可不同 env）。
- **执行语义**：mode=serial 逐 item 顺序；parallel=p-limit(池并发) 并行；stopOnFail 开→首个终态 FAILED 余 item SKIPPED（item-final 帧 status=SKIPPED，plan 不算失败）。功能用例（functional_case refs）不进 plan 任务（人工口径）。
- **依赖联动（引擎侧推导）**：功能用例 refs 按 CaseDependency（pre→post）参与 BLOCKED 推导——引擎执行完 api/scenario 后不推导功能用例；**BLOCKED 推导发生在人工标记边界**：标记功能用例执行时，若其前置用例在本计划内且最近结果=FAIL → 提示「前置未通过」并默认 BLOCKED（可强制改标）；**接口/场景间依赖不推导**（登记：依赖联动仅功能用例域，CASE-008 §2 口径一致）。
  - 修订（实现冻结口径）：依赖推导在「列表/脑图标记」时做（服务端校验返回 blocked 候选），引擎执行不涉及功能用例。
- **回调回写**：handleCallback 扩展 plan 分支——item-final 时回写 PlanCaseRef.status（SUCCESS→PASS / FAILED|FAKE_ERROR→FAILED / SKIPPED→SKIPPED）+result.actualResult（报告链接入 result.reportTaskId）；task-final 后：①刷新计划状态与通过率 ②autoUpdateStatus 开→逐 PASS 的 api_case/scenario ref 经 CASE-006 CaseApiRef 反查关联功能用例，若该功能用例在本计划且 NOT_RUN→自动标 PASS（execHistory 记 `auto` 来源）③plan 报告聚合（PLAN-005）。
- **停止**：复用 exec:stop:{taskId} 协作式停止；停止后已完成 item 状态保留、余项 SKIPPED。
- **实时通过率**：执行页复用 SSE（/stream/exec/{taskId}）；计划详情通过率卡在报告事件后刷新（轮询 2s 降级）。
- **脑图执行**：功能用例在计划内按模块分组渲染脑图（CASE-007 组件）；节点=用例，选中后右侧详情面板（步骤列表+快捷键标记 S/E/B/Skipped+实际结果+评论+缺陷操作沿用）；标记走既有 execPlanCase 端点（+依赖 BLOCKED 推导）。

## 3. UI/UX 设计（高保真 docs/design/PLAN-003-plan-execution/）

- 计划详情头部新增「执行」主按钮（下拉：执行全部/执行当前点）+ 执行配置抽屉（环境/资源池/串并行/失败停止四项，显示每项生效来源徽标「点：扫码支付」或「计划默认」）。
- 执行进行态：头部进度条（已完成/总数）+ 实时通过率刷新 +「停止」按钮；完成 Toast 跳报告。
- 用例清单 Tab：接口/场景行新增「执行结果」徽标（PASS/FAILED/FAKE_ERROR）+ 最近报告链接；行内「执行」单条触发（构造单项 plan 任务）。
- 新增「脑图执行」Tab（功能用例）：左脑图（模块→用例，节点状态色：未执行灰/PASS 绿/FAIL 红/BLOCKED 橙/SKIPPED 蓝灰）+ 右详情面板（步骤对位结果勾选 + S/E/B 快捷键提示 + 实际结果/评论 + 关联缺陷）。
- 原型画板：①执行配置抽屉+生效来源徽标 ②执行中态（进度/停止/实时通过率）③脑图执行 Tab（三键+详情面板+BLOCKED 提示）。

## 4. 技术架构

- 数据模型：**零迁移**。ExecItem.refType 新增取值 `plan_case`（自由字符串列，zod 枚举扩展）；PlanCaseRef.result 存 `{ reportTaskId?, lastRunAt? }`。
- 契约（packages/shared `execution/schemas.ts`，`EXEC_CONTRACT_VERSION` bump **4**，全 additive）：
  - `execCommandSchema` 新分支 `planCommandSchema`：`{ kind:"plan", planId, name, mode:"serial"|"parallel", stopOnFail, items:[{ itemId, pointId?, command: apiCaseCommandSchema | scenarioCommandSchema（判别联合） }] }`。
  - 帧扩展：`step-start/step-result` 增加 optional `stepName`（S3 遗留：loop 控制器名不经帧传递→报告树 fallback 名修复）。
  - `execItemRefTypes` 增加 `plan_case`；`reportType` 查询枚举增加 `plan`。
- 端点（前缀 `/api/v1/projects/{pid}/plans/{planId}`）：
  - `POST /execute`：`{ pointId?, mode?, stopOnFail?, envId?, poolId? }`（显式覆盖>点链>计划默认）→ createPlanTask → 返回 `{ taskId }`。
  - `POST /cases/{refId}/run`：单条引擎执行（refType 限 api_case/scenario，构造单项 plan 任务）。
  - 既有 `POST /cases/{refId}/exec`（人工标记）扩展：依赖 BLOCKED 推导（返回 `blockedBy` 提示字段，不阻断强制改标）。
  - `GET /executions`：计划执行历史（ExecTask type=plan 列表，含触发人/状态/起止/报告链接）。
  - 权限点：execute/run=PROJECT_PLAN:UPDATE（执行=写口径，PLAN-001 先例）。
- 服务：`exec.service.ts` 扩展 `createPlanTask`（复用 createApiCaseTask/createScenarioTask 的命令构造函数抽出的 `buildApiCaseCommand`/`buildScenarioCommand`）；`handleCallback` plan 分支（item 回写+autoUpdate+报告聚合+计划状态刷新）。
- 引擎（apps/engine）：`runner/worker.ts` runTask 新增 plan 分支——`kernel/plan.ts`：逐 item（serial 顺序 / parallel p-limit(4)）调既有 runScenarioItem / api_case 单步管线；stopOnFail 检查在 item 边界；item-final 帧带 plan 维度（itemId=PlanCaseRef.id）。engine 零数据库依赖不变（planId 仅透传）。
- 前端：计划详情「执行」主按钮+配置抽屉+脑图执行 Tab；api-client `s4.ts` planApi（execute/run/executions）。
- 错误码：`PLAN_NO_EXECUTABLE 42208`（计划内无 api_case/scenario refs）、`PLAN_ARCHIVED 10008`（沿用）、`TASK_NOT_STOPPABLE 40904`（沿用）。

## 5. 测试用例

- PLAN-003-T1（jmx 四类）：execute 正常路径（2 api_case+1 scenario→终态轮询断言 task SUCCESS、items 状态回写、通过率信封）；401/403/404；422（空计划 42208、归档计划 10008、pointId 不存在）；executions 列表分页信封。
- PLAN-003-T2（spec 引擎执行主链路）：建计划→挂点（点显式 env=mock B）→关联 api_case+scenario→执行→报告页 plan 视图→状态回写→通过率徽标刷新（UI+Console+接口）。
- PLAN-003-T3（spec 失败停止二态）：断言必败 api_case+stopOnFail→余 item SKIPPED；关闭→余 item 正常执行。
- PLAN-003-T4（spec 自动更新状态）：settings.autoUpdateStatus 开→api_case PASS→CASE-006 关联的功能用例自动 PASS（execHistory 含 auto 来源）；关→不更新。
- PLAN-003-T5（spec 脑图执行）：脑图 Tab→S 键标记→节点变绿+列表同步；E→红+详情面板实际结果必填提示；前置 FAIL 依赖用例→默认 BLOCKED 提示。
- PLAN-003-T6（spec 单条执行与停止）：行内执行单 api_case→单项任务报告；执行中停止→余项 SKIPPED。
- 单测：shared planCommandSchema 校验矩阵；engine plan kernel（serial 序/parallel 槽/stopOnFail 边界/子命令判别）；exec.service 回调回写（autoUpdate 二态/FAKE_ERROR→FAILED 口径/幂等重放）；依赖 BLOCKED 推导纯函数。

## 6. 竞品深度对标

基线 §五主体覆盖。差异：①自动更新状态仅 PASS 方向（基线双向，失败自动标 FAIL 登记后续策略）；②依赖 BLOCKED 限功能用例人工边界（基线执行序推导，登记）；③脑图内缺陷操作沿用行操作；④并发与调度自研（基线 Java 池调度）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（S0 §8.1 先例）。最重联调点：契约 v4 plan 命令在 web 构造↔engine 消费的一致性（子命令复用度 100% 目标），与回调回写幂等（BullMQ attempts=2 重放场景）。

## 8. 勘误登记

- 勘误 1（2026-09-27，实现形态对齐）：①S3 遗留「step-start 帧 +stepName」的控制器命名修复，落地为控制器命名帧（log kind=node-name）+树聚合消费——控制器不发 step-start（无 method/url），纯命名帧最小 additive；②错误码最终为 PLAN_NO_EXECUTABLE=50012（422）、坏点 404/30454；③依赖 BLOCKED 推导收敛于人工标记边界（§2 修订口径与实现一致）；④报告页复用 /reports/{taskId}（type=plan 分支），报告命名「计划执行 · N 条用例」。
