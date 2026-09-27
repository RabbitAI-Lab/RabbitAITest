# 场景报告与概览（步骤树·迭代分组·变量终值·误报统计）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | RPT-003                                                                                                                               |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                                                 |
| 优先级       | P1（迭代内）                                                                                                                          |
| 所属模块     | 报告（report 域）+ 前端报告视图                                                                                                       |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                                                                                |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | RPT-002（报告链路/分享/钻取组件复用）、API-006（stepPath 帧/执行历史）、API-010（FAKE_ERROR 与误报统计）                              |
| 下游消费     | S4 PLAN-003（计划内场景报告归并）、PLAN-005（报告导出）                                                                               |
| 上游依据     | 需求文档 §五「报告：场景/用例两类报告、步骤级请求-响应钻取、分享（有效期）、误报规则」；功能清单 §6.8                                  |
| 对标基线     | 功能清单 §6.8：场景报告/用例报告两类；点击步骤查看实际请求与响应；分享（有效期）；误报规则标记                                          |
| 关联架构文档 | engine-execution-architecture.md §2（报告=事件视图）；test-domain-model.md §2.7（ExecStepResult 帧持久化）                            |
| 高保真确认   | 待确认（原型 docs/design/RPT-003-scenario-report-share/）                                                                             |
| 工作量估算   | 后端 2 人日 / 前端 5 人日                                                                                                             |

## 1. 概述

### 1.1 功能定位

reportType=scenario 的报告渲染层：场景列表入口（任务 N item→每 item 一份场景报告视图）、步骤树视图（stepPath 分组+循环迭代分组+控制器折叠）、变量终值视图、误报统计概览；分享与免登复用 RPT-002 链路。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                         | P1 ✅ | 后续                                             |
| ---------------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 场景报告视图：item 列表（场景名/状态含 FAKE_ERROR 徽标/耗时/误报数）→单场景步骤树 | ✅     | —                                                |
| 步骤树渲染：按 stepPath 层级缩进树；控制器节点折叠（loop 显示迭代分组 xN）  | ✅     | 树节点搜索（登记 Backlog）                      |
| 循环迭代分组：iteration 帧分组头「迭代 #n」+迭代级小计（通过/失败/耗时）    | ✅     | 迭代失败快速定位排序（登记）                    |
| 步骤钻取：复用 ItemDrillPanel（请求快照/响应/断言/提取/日志）               | ✅     | —                                                |
| 变量终值视图：场景变量（temp 终值/参数/CSV 末行）合并表                     | ✅     | 变量变更轨迹逐帧 diff（登记）                   |
| 误报统计：概览卡片「误报 N」（与通过/失败并列）+命中规则名 tooltip          | ✅     | 误报趋势（S7）                                  |
| 执行历史：场景详情历史抽屉→报告链接（API-006 承载数据，本规格消费）         | ✅     | —                                                |
| 分享：RPT-002 分享免登同口径（drillEnabled 只读复用，含误报徽标）           | ✅     | 报告批量导出/PDF（S4 PLAN-005）                 |
| 报告保留清理：随 RPT-002 定时清理口径（无新增）                             | ✅     | —                                                |

### 1.3 前置依赖

帧 stepPath/iteration 扩展（API-006 契约 v3）；ReportItemsTable/ItemDrillPanel 组件（S2）；误报 hit 聚合（API-010）。

### 1.4 对标基线核对

完全复刻：场景/用例两类报告分流渲染、步骤级请求响应钻取、分享有效期、误报标记。简化实现：迭代级小计聚合（基线循环明细更强，登记）；变量视图=终值快照（基线含变更历史）。

## 2. 业务逻辑

- 视图数据源：ExecStepResult 帧（itemId 过滤）→ 服务端 `scenarioReportView(itemId)`：按 stepPath 前缀聚树 → 同 stepPath 的 iteration 分组 → 组节点状态聚合（全 SUCCESS→SUCCESS；任一 FAILED→FAILED；FAKE_ERROR 沿 item 不改步骤色，步骤仍红+item 级徽标）。
- 小计：组节点耗时=Σ子请求 responseTimeMs；迭代分组头=该迭代请求计数与失败计数。
- 变量终值：帧 log 中 var 快照（引擎 runScenario 结束时发一帧 `vars-final` log，payload=合并表）——**新增 log 子类**（log 帧 payload additive 字段 kind="vars-final"，不新帧类型）。
- 概览：summary={total,success,failed,fakeError,durationMs}（api_case 兼容展示，scenario 增 fakeErrorCount 字段 additive）。
- 分享：snapshot 不落库（P0 决策维持），免登页实时读帧（RPT-002 同口径）。

## 3. UI/UX 设计（高保真 docs/design/RPT-003-scenario-report-share/）

- 报告页 scenario 分支：顶部概览卡（通过/失败/误报/总耗时）+ item 表（场景列）→ 展开**步骤树面板**：层级缩进行（图标按 stepType：请求/循环/条件/脚本/等待）、状态色条、耗时；loop 节点下「迭代 #1..#n」分组头（可折叠）；行点击→右侧钻取抽屉（复用 ItemDrillPanel）。
- 变量终值：树面板上方 Tab「变量」→ 合并表（变量名/来源徽标/终值）。
- 免登分享页：同树视图只读（drillEnabled）。
- 概览卡片误报为橙色、失败红、通过绿。

## 4. 技术架构

- 数据模型：零新表新列（帧 Json 与 summary 字段承载）。
- 契约：`stepResultFrame` 已含 stepPath/iteration（API-006）；`ReportSummaryV2` +fakeErrorCount、log 帧 payload kind 枚举 +vars-final（additive）；`ScenarioTreeView={item 头, groups:[{stepPath,name,stepType,status,iterationChildren?…}], varsFinal}`（zod，OpenAPI 快照更新）。
- 端点：`GET /reports/{taskId}/items/{itemId}/scenario-tree`（树视图聚合）；其余复用 RPT-002（detail/itemFrames/shares）。
- 服务：exec.service `scenarioTree(itemId)`（帧→树聚合纯函数 `buildScenarioTree(frames)` 于 shared 单测）；reportDetail 分支 scenario 增 tree 摘要与 fakeErrorCount。
- 权限点：PROJECT_REPORT:READ/SHARE（既有）。
- 前端：`ScenarioTreePanel.tsx`（树+迭代分组）、`VarsFinalTable.tsx`、概览卡扩展（`ReportSummaryCards` + 误报卡）；报告页 scenario 分支接入。
- 错误码：复用 RPT-002（40425 报告不存在等）。

## 5. 测试用例

- RPT-003-T1（jmx）：scenario-tree 端点四类（正常树结构 JSONPath/401/403/404/信封随报告列表）。
- RPT-003-T2（spec 树视图主链路）：执行含循环 3+条件跳过的场景→报告步骤树层级与迭代分组 #1..#3（UI 断言行数与缩进）、失败步骤红色、钻取抽屉请求快照（UI+接口+Console）。
- RPT-003-T3（spec 变量终值+误报概览）：提取变量后「变量」Tab 终值行；误报命中场景概览误报卡=1、item 徽标（与 API-010-T2 同链路数据断言）。
- RPT-003-T4（spec 分享只读）：分享链接免登打开树视图只读+误报徽标同口径（接口断言免登 payload）。
- 单测：buildScenarioTree（stepPath 聚树/迭代分组/状态聚合/FAKE_ERROR 不改步骤色）、vars-final 合并、summary fakeErrorCount。

## 6. 竞品深度对标

基线场景报告主体覆盖；差异：①迭代小计粒度（登记）；②变量终值快照（基线轨迹）；③导出 S4。树+钻取+分享与基线能力等价。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：stepPath 帧与树聚合一致性（engine 发帧序即树序）；免登页树视图权限剔除。

## 8. 勘误登记

（暂无）
