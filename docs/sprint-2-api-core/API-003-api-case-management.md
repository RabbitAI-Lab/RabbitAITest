# 接口用例管理（差量请求·执行·差异同步）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-003                                                                                                                               |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                               |
| 优先级       | P1                                                                                                                                    |
| 所属模块     | 接口测试（api_test 域）+ 执行（exec 域）                                                                                              |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | API-002（定义与 CASE 页签）、API-004（请求契约 v2 与编辑器）、PROJ-003（环境）、EXEC-002（池与调度）                                  |
| 下游消费     | CASE-006（关联目标）、S3 API-006（场景步骤）、RPT-002（api_case 报告）、SYS-006（任务中心）                                           |
| 上游依据     | 需求文档 M6（接口用例/执行引擎）；功能清单 §6.3                                                                                       |
| 对标基线     | 功能清单 §6.3：手动创建（参数/等级/状态/标签/前后置/断言/选环境执行）、执行历史（报告/响应内容）、引用关系、API-CASE 差异同步（diff+一键更新） |
| 关联架构文档 | test-domain-model.md §2.6/§2.7（差量 request/ExecTask-Item-StepResult）；engine-execution-architecture.md §2（失败重跑=副本重建）     |
| 高保真确认   | 待确认（原型 docs/design/API-003-api-case-management/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                   |
| 工作量估算   | 后端 4 人日 / 前端 4 人日 / 联调 2 人日                                                                                               |

## 1. 概述

### 1.1 功能定位

接口定义的参数化实例与执行单元：一条用例=基础定义请求的全量副本+自有参数/断言，可独立执行与批量执行，产生 api_case 类型任务与报告。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                       | P1 ✅ | 后续                                       |
| -------------------------------------------------------------------------- | ----- | ------------------------------------------ |
| 用例 CRUD（定义 CASE 页签内）：名称/等级 P0-P3/状态/标签/请求（API-004 编辑器全量） | ✅     | —                                          |
| 新建用例：默认复制定义当前 request 为基线（syncedVersion=定义 version）    | ✅     | AI 生成（S7 AI-003）                       |
| API-CASE 差异同步：定义 version>syncedVersion → 列表标「待同步」；diff 视图（分区级：参数/认证/请求体/前后置/断言）；一键同步（覆盖为定义最新，二次确认） | ✅     | 部分同步（基线可勾选区同步，简化整替登记） |
| 单条执行：选环境+池（默认池）→ api_case 任务（1 item）→ 跳报告             | ✅     | 本地执行（S5 个人中心）                    |
| 批量执行：CASE 页签勾选→环境/失败停止开关→1 任务 N item 串行               | ✅     | 并行度选择（S3 API-008 池级并发）          |
| 执行历史：用例行「历史」抽屉（任务/状态/耗时/时间→报告链接）               | ✅     | 响应内容直接内嵌（跳报告即可，简化）       |
| 引用关系：被功能用例/计划关联数（Provider）                                | ✅     | 场景引用（S3）                             |
| 批量删除/标签与等级筛选                                                    | ✅     | 批量移动（随定义模块）                     |

### 1.3 前置依赖

API-004 契约 v2（item 结构）；EXEC-002 任务创建/停止/重跑端点；PROJ-003 环境选择器。

### 1.4 对标基线核对

完全复刻：手动创建全参/执行历史/差异同步提示与一键更新。简化实现：diff 为分区级摘要+字段列表（基线逐字段树 diff，登记简化）；同步=整体替换（基线部分同步）；「执行历史看响应内容」经报告链接承载。

## 2. 业务逻辑

- 差量模型：用例存全量 request 副本+`syncedVersion`；定义保存 bump version；同步=以定义 request 覆盖+syncedVersion 对齐（用例名/等级/标签保留）。
- 批量执行任务：web 预建 ExecItem（PENDING，id 即 command itemId）→入队；串行执行；`stopOnFail` 开→首个失败 item 后余项 SKIPPED（item 状态）。
- 用例级状态机（ExecItem）：PENDING→RUNNING→SUCCESS|FAILED|SKIPPED|STOPPED；任务终态聚合（全部 SUCCESS→SUCCESS；任一 FAILED→FAILED；停止→STOPPED）。
- 执行入口幂等：clientTaskId（单条执行带，防连点重复）。

## 3. UI/UX 设计（高保真 docs/design/API-003-api-case-management/）

- 定义详情 CASE 页签：工具条（新建用例/批量执行/批量删除 + 筛选：等级/状态/标签）；表格（名称(num)/等级徽标/状态/标签/同步态（待同步 黄点+「同步」链接）/创建人/操作：执行·历史·编辑·删除）。
- 用例编辑抽屉（全宽抽屉）：头部（名称/等级/状态/标签）+ RequestEditor（基线=定义，可改任意区）+ 保存。
- diff 视图：双栏（左定义最新/右用例当前）分区折叠，差异分区高亮；顶部「以定义覆盖本用例」按钮+确认。
- 批量执行弹窗：环境选择/失败停止开关/执行说明（串行）；提交后跳任务中心并高亮新任务。
- 执行历史抽屉：任务列表行（状态徽标/耗时/时间）→点击开报告页。

## 4. 技术架构

- 数据模型：ApiCase/ExecTask/ExecItem/ExecStepResult 已建齐；**新增列 `api_cases.synced_version Int @default(0)`**（门禁 3 评审理由：INFRA-003 建模时 API-CASE 差量同步语义未定义（依赖定义 version 语义，EXEC-001 冻结事件契约后才明确差量口径），属设计缺口补齐而非核心表反复 DDL；`version` 列保持乐观锁语义不变）。迁移：`s2_api_case_synced_version`。
- 端点：`GET/POST /api/v1/projects/{pid}/apis/{apiId}/cases`、`GET/PUT/DELETE .../cases/{id}`、`POST .../cases/{id}/sync`、`GET .../cases/{id}/history`（ExecItem 聚合）、`POST .../apis/{apiId}/cases/batch-delete`、`POST .../apis/{apiId}/cases/execute`（{caseIds[], envId?, stopOnFail?}，1..200 条）；任务操作端点见 EXEC-002。
- zod：apiCaseUpsertSchema（requestSpecSchema v2+syncedVersion int）、apiCaseExecuteSchema。
- 服务：`src/server/domains/api/api-case.service.ts` + `exec.service.ts` 扩展 `createApiCaseTask`（envSnapshot 构建：vars=全局参数∪环境 vars、http/hosts/database/pre/post/asserts 原样；未选环境且任一请求相对 URL→422）。
- 权限点：PROJECT_API:CREATE|UPDATE|DELETE（执行=CREATE 口径）；**新增入库 `PROJECT_EXEC_TASK:READ|UPDATE`**（任务读取与停止/重跑，SYS-006 共同消费）。
- 错误码：`API_CASE_NOT_FOUND 40424`。
- 前端：CASE 页签组件 `ApiCasePanel.tsx`、diff 组件 `RequestDiff.tsx`。

## 5. 测试用例

- API-003-T1（jmx 四类）：用例 CRUD/sync/execute（对 mock 执行至终态断言 item 状态）；401/403/404；caseIds 空/超 200 422；列表分页信封。
- API-003-T2（spec 主链路）：建定义+2 用例（其一断言故意失败）→批量执行（stopOnFail=true）→任务 FAILED、item1 SUCCESS/item2 FAILED/余项 SKIPPED→报告用例级列表两态呈现→重跑生成新副本（UI+Console+接口）。
- API-003-T3（spec 差异同步二态）：改定义请求体→用例「待同步」黄点→diff 高亮请求体区→一键同步→黄点消失且 syncedVersion 对齐；未变更用例无标记。
- API-003-T4（spec 执行历史）：执行后用例「历史」抽屉出现记录→点击跳报告；单条执行连点仅生成一任务（clientTaskId 幂等，接口断言）。
- 单测：差量同步判定与覆盖、批量执行载荷构建（envSnapshot 合并次序）、item 聚合状态矩阵。

## 6. 竞品深度对标

基线 §6.3 主体覆盖；差异：①AI 生成=S7（plan 既定拆分）；②diff 粒度分区级（登记简化）；③执行历史响应内容经报告钻取（报告=事件视图架构决策）。技术差异必引：并发与调度为自研 p-limit/BullMQ（基线 JMeter 线程组）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。批量执行链路（web 预建 item→engine 分组帧→回调聚合）是本迭代最重联调点（验收 2/4）。

## 8. 勘误登记

（暂无）
