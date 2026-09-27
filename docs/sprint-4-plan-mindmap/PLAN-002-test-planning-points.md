# 测试规划与测试点（分层组织 · 配置继承）

| 元信息项     | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLAN-002                                                                                                                                                               |
| 所属迭代     | Sprint 4 — 计划完整与脑图                                                                                                                                              |
| 优先级       | P2（迭代内 P1）                                                                                                                                                        |
| 所属模块     | 测试计划（plan 域）                                                                                                                                                     |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                              |
| 最后更新日期 | 2026-09-27                                                                                                                                                             |
| 上游依赖     | PLAN-001（计划基础与用例关联）、CASE-006（接口用例关联 refType=api_case）、API-006（场景 refType=scenario）                                                            |
| 下游消费     | PLAN-003（执行配置继承与按点执行）、PLAN-005（报告按点维度明细）                                                                                                        |
| 上游依据     | 需求文档 §四 M4「测试规划：功能/接口/场景三类 + 测试点分层（继承配置）」；功能清单 §五「测试规划」                                                                      |
| 对标基线     | 功能清单 §五：按「功能用例/接口用例/场景用例」三类组织，支持测试点（Test Point）分层：添加测试点、关联用例、配置是否继承上级配置；§五「报告按测试点维度查看用例明细」    |
| 关联架构文档 | test-domain-model.md §2.4（TestPoint/PlanCaseRef.pointId 预建）                                                                                                        |
| 高保真确认   | 待确认（原型 docs/design/PLAN-002-test-planning-points/；人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                  |
| 工作量估算   | 后端 3 人日 / 前端 4 人日 / 联调 1 人日                                                                                                                                |

## 1. 概述

### 1.1 功能定位

把 PLAN-001 的「平铺用例清单」升级为「测试点分层规划」：测试点（TestPoint）是计划内的执行分组节点（自引用树），三类用例（functional_case / api_case / scenario）挂在测试点下；执行配置（envId/poolId/serial/stopOnFail）沿祖先链继承，最终回退计划执行配置。测试点是「测试轮次/关联性测试」的承接形态（清单 §五口径记录）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | S4 ✅ | 后续                                            |
| ---------------------------------------------------------------------- | ----- | ----------------------------------------------- |
| 测试点树：添加父/子点、重命名、删除（校验非空）、同级排序（上移/拖拽）  | ✅     | 跨计划复用点模板（Backlog）                    |
| 配置继承：inheritConfig=true 沿祖先链取最近显式配置，根回退计划执行配置 | ✅     | —                                               |
| 用例挂点：关联三类用例时指定测试点；点间移动                           | ✅     | 跨点复制（Backlog）                             |
| 无点平铺兼容：pointId=null 视作「未分组」虚拟点，PLAN-001 老数据不迁移  | ✅     | —                                               |
| 报告按点分组明细（PLAN-005 消费）                                       | ✅     | —                                               |
| 按点执行（执行单点内用例）                                              | ✅     | 点级独立执行历史聚合视图（Backlog）             |

### 1.3 前置依赖

TestPoint 模型 S0 门禁 3 预建（parentId 自引用 + inheritConfig + config + order），**零新列零迁移**；PLAN-001 addPlanCases 已支持 apiCaseIds（refType=api_case）。

### 1.4 对标基线核对

完全复刻：三类组织/点分层/继承配置/报告按点明细。简化实现：点级「复制」登记 Backlog；MeterSphere 点配置含执行人维度，我们以 PlanCaseRef.execUserId 行级承载（同口径不同层级，登记）。

## 2. 业务逻辑

- **点树**：TestPoint(planId, parentId?, name, order, inheritConfig, config)；同级 order 排序；删除前校验无子点且无挂载用例（422 50012 POINT_NOT_EMPTY），否则提示先清空。
- **配置继承链**：`resolvePointConfig(point) = inheritConfig ? 沿 parent 链取最近 inheritConfig=false 的显式 config : 自身 config`；链尾未遇显式配置 → 回退计划执行配置（PLAN-003 的 planExecConfig）；环检测（祖先链去重，深度≤20）。
- **挂载**：PlanCaseRef.pointId 可空；「未分组」虚拟点（pointId=null）始终展示在点树末位；点间移动=批量改 pointId（保留执行状态与历史）。
- **关联入口**：PLAN-001 LinkCasesModal 扩展「挂载到点」选择器（默认当前选中点；未分组可选）；scenario 页签新增（S3 交付场景域后补挂入口，本规格一并落地 refType=scenario 关联）。
- **重复关联开关**：沿用 PLAN-001 settings.allowDuplicate 口径（关闭时同 (planId, refType, refId) 二次关联 422 10009，**跨点也算重复**）。

## 3. UI/UX 设计（高保真 docs/design/PLAN-002-test-planning-points/）

- 计划详情新增顶层 Tab「测试规划」（排在「用例清单」前）：左测试点树（根=计划名；节点操作：+子点/重命名/删除/上移下移；「未分组」灰字固定末位；节点徽标=挂载用例数按三类分色）；右当前点用例清单（三类分组表：类型徽标/名称/执行人/状态/操作：移出·移到其他点）。
- 右侧头部：「关联用例」（弹窗三类页签：功能用例/接口用例/场景，各复用既有选择器）+「执行本点」（PLAN-003 入口）+ 点配置抽屉（inheritConfig 开关 + 显式配置四项：环境/资源池/串并行/失败停止）。
- 原型画板：①规划 Tab 全景（点树+右清单+配置抽屉）②关联弹窗三页签 ③未分组虚拟点与移动弹窗。

## 4. 技术架构

- 数据模型：TestPoint 已建齐，**零迁移**；种子无新增。
- 契约（packages/shared `plan/schemas.ts` 扩展）：
  - `pointUpsertSchema`：`{ name(1-256), parentId?, order?, inheritConfig?, config? }`；`pointConfigSchema`：`{ envId?, poolId?, serial?, stopOnFail? }`（全 optional，undefined=不覆盖）。
  - `planCasesAddSchema` 扩展 `pointId?`、新增 `scenarioIds(≤200)?`（三类至少一非空 refine 收紧）；`planCaseMoveSchema`：`{ refIds(1-200), pointId | null }`。
  - `resolvePointChain()` 纯函数（shared，供服务与测试共用）：输入点列表+计划配置 → 每点生效配置。
- 端点（前缀 `/api/v1/projects/{pid}/plans/{planId}`）：
  - `GET /points`（点树+每点挂载数统计）、`POST /points`、`PUT /points/{pointId}`、`DELETE /points/{pointId}`
  - `PUT /points-order`（同级批量重排 `{ orderedIds }`）
  - `POST /cases`（扩展 pointId+scenarioIds）、`POST /cases/move`（批量移动）
  - `GET /cases?pointId=&refType=`（点内清单，支持 pointId=ungrouped）
  - 权限点：全部 `PROJECT_PLAN:UPDATE`（读挂 PLAN:READ）。
- 服务：`plan.service.ts` 扩展 `listPoints/createPoint/updatePoint/deletePoint/reorderPoints/movePlanCases`；场景关联经动态 import `@/server/domains/api/scenario.service`（跨域 Provider 口径，同 addPlanCases 现状）。
- 错误码：`POINT_NOT_FOUND 40430`、`POINT_NOT_EMPTY 50012`、`POINT_CYCLE 42207`（parent 指向自己或后代）。
- 前端：计划详情页新增「测试规划」Tab（`plan-points-tab`）；`PointsTreePanel` 组件；LinkCasesModal 三页签化。

## 5. 测试用例

- PLAN-002-T1（jmx 四类）：点 CRUD/reorder/move 正常路径（挂载数断言）；401/403/404（pointId 不存在 40430）；422（POINT_CYCLE/POINT_NOT_EMPTY/名称空）；GET points 树信封+ungrouped 分组。
- PLAN-002-T2（spec 规划主链路）：建父点子点→子点关继承显式配 env→关联接口用例挂子点→执行本点（PLAN-003 联动）→报告 envSnapshot 用子点 env（UI+Console+接口三类断言）。
- PLAN-002-T3（spec 挂点与移动）：关联场景到点 A→移动到点 B→A 空 B 有→未分组清单兜底展示；删除非空点 422 提示。
- 单测（shared）：resolvePointChain 继承矩阵（显式截断/根回退/深度链/环防御）、planCasesAdd 三类至少一非空、pointUpsert 校验。

## 6. 竞品深度对标

基线 §五主体覆盖。差异：①MeterSphere 点配置含执行人，我们以行级 execUserId 承载（层级不同口径一致，登记）；②点模板复用登记 Backlog；③跨点复制登记 Backlog。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（S0 §8.1 先例：目标授权下实现先行）。最重联调点：执行配置继承链在 PLAN-003 执行时的取值一致性（resolvePointChain 服务端单点求值）。

## 8. 勘误登记

- 勘误 1（2026-09-27，错误码分段对齐）：§4 所列示意码（40430/50012/42207）按 api-conventions 分段落最终实现为 POINT_NOT_FOUND=30454（404）、POINT_NOT_EMPTY=30455（422）、POINT_CYCLE=30456（422）；§4 端点集以 OpenAPI 快照 214 paths 为准（点内清单并入 getPlan cases 透出 pointId，未单列 GET /cases?pointId）。
