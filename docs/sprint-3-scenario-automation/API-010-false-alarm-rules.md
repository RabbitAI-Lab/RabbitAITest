# 误报规则（项目级匹配·FAKE_ERROR 标记）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-010                                                                                                                               |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                                                 |
| 优先级       | P2（迭代内）                                                                                                                          |
| 所属模块     | 接口测试（api_test 域）+ 执行（exec 域）+ 报告（report 域）                                                                           |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                                                                                |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | API-006/008（执行终态回调）、RPT-002（报告视图与分享）、RPT-003（误报统计概览）                                                       |
| 下游消费     | S5 MSG-001（执行成功/失败/误报通知）、S7（误报趋势分析）                                                                              |
| 上游依据     | 需求文档 §五「误报规则」；功能清单 §6.8 误报规则                                                                                      |
| 对标基线     | 功能清单 §6.8：项目级配置匹配规则，命中标记为误报（仅对新执行报告生效）；§5 通知「执行成功/失败/误报」                                 |
| 关联架构文档 | test-domain-model.md §2.7（FalseAlarmRule/FalseAlarmHit 已建模）；api-conventions.md（错误码分段）                                    |
| 高保真确认   | 待确认（原型 docs/design/API-010-false-alarm-rules/）                                                                                 |
| 工作量估算   | 后端 3 人日 / 前端 2 人日                                                                                                             |

## 1. 概述

### 1.1 功能定位

项目级误报治理：配置匹配规则（状态码/响应体/响应头/耗时），执行回调时对 FAILED 的 item 匹配——命中则终态改判 FAKE_ERROR（误报）并留痕 FalseAlarmHit，报告单列误报统计；不算任务失败。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                           | P1 ✅ | 后续                                             |
| ------------------------------------------------------------------------------ | ----- | ------------------------------------------------ |
| 规则 CRUD：名称/匹配器/启用开关/描述；项目级列表（≤50 条）                    | ✅     | 规则分组/优先级（先命中先得分，无顺序语义）      |
| 匹配器四类（多条件 AND）：`status`(精确)/`bodyContains`/`headerContains`(k=v 子串)/`responseTimeGt`(ms) | ✅     | 正则体匹配、JSONPath 条件（登记 Backlog）        |
| 匹配时机：web 回调终态时对 item 的 FAILED 步骤集求值；任一规则命中→FAKE_ERROR | ✅     | 步骤级细粒度标记（item 级先做，登记简化）        |
| 状态改判：ExecItem.status=FAILED→FAKE_ERROR；task 聚合不含 FAKE_ERROR 判失败；Report.summary 增 `fakeErrorCount` | ✅     | —                                                |
| 留痕：FalseAlarmHit（report/task/rule）创建；报告详情命中规则名展示           | ✅     | —                                                |
| 仅对新执行生效：规则变更不回溯历史报告（回调时读当前规则快照）                | ✅     | —                                                |
| 分享/免登视图同口径展示误报徽标                                                | ✅     | —                                                |

### 1.3 前置依赖

FalseAlarmRule/FalseAlarmHit 模型已建（S0）；itemStatus enum 扩展 FAKE_ERROR（契约 v3 additive）；回调链路 handleCallback（S2）扩展改判点。

### 1.4 对标基线核对

完全复刻：项目级规则/命中标记误报/仅新报告生效/四类基础匹配器。简化实现：匹配粒度=item 级（基线步骤级，误报归因整用例，登记）；无规则优先级（全部 AND 条件集，任一命中即标）。

## 2. 业务逻辑

- 匹配输入：item 的失败步骤帧（step-result.responseSummary：status/bodyText 截断 4KB/responseTimeMs/headers）。
- 求值：`matchFalseAlarm(rules, failedSteps)` 纯函数——逐规则 AND 条件对任一失败步骤成立即命中（返回首个命中规则 id 集合）；多规则可多命中（全留痕，状态一次改判）。
- 改判次序：回调读 item 终态 FAILED → 匹配 → 命中：status=FAKE_ERROR、FalseAlarmHit.createMany、summary.fakeErrorCount 累计；task 终态计算排除 FAKE_ERROR（全 FAKE_ERROR+SUCCESS→SUCCESS）。
- 展示：报告 item 行徽标「误报」（橙色）替代红色失败；概览卡片「误报 N」单列；命中规则名 tooltip（FalseAlarmHit join rule 名）。
- 边界：规则停用即时生效（下次回调不读）；规则删除后历史 hit 保留（ruleId 冗余名快照，rule 删后仍可展示名）——**需要 ruleName 冗余列**（见 §4 数据模型）。

## 3. UI/UX 设计（高保真 docs/design/API-010-false-alarm-rules/）

- 规则页 `/scenarios/false-alarm`（场景列表工具条「误报规则」入口）：表格（名称/匹配器摘要 chips/启用开关/描述/更新时间/操作：编辑·删除）+ 新建按钮（≤50 上限提示）。
- 规则编辑抽屉：名称/四类条件构造器（状态码输入、体包含、头包含 k=v、耗时上限 ms，至少一项）/启用开关/描述。
- 报告侧（RPT-003 联动）：item 行误报徽标 + 概览「误报」卡片 + tooltip 规则名。

## 4. 技术架构

- 数据模型：FalseAlarmRule/FalseAlarmHit 已建；**FalseAlarmHit 增列 `rule_name VarChar(128)`**（门禁 3 评审理由：规则删除后留痕名称需可展示，属展示冗余补齐；建表时「规则不可删」假设被对标核对推翻，非核心表反复 DDL）。迁移：`s3_false_alarm_hit_rule_name`。
- 契约：`falseAlarmMatcherSchema`（四条件 optional AND，至少一项）、itemStatus +FAKE_ERROR、ReportSummaryV2 +fakeErrorCount（additive）。
- 端点：`GET/POST /projects/{pid}/false-alarm-rules`、`PUT/DELETE .../false-alarm-rules/{id}`（删除=物理删+留痕名冗余生效）。
- 服务：`false-alarm.service.ts`（CRUD+上限 50）；`exec.service.handleCallback` 插入改判点（matchFalseAlarm 纯函数于 shared，单测主力）；reportDetail 聚合 hits。
- 权限点：复用 PROJECT_SCENARIO:READ/UPDATE（规则服务于场景执行口径，避免新权限点膨胀；如后续 API 用例也用误报再评估独立点——登记）。
- 错误码：`FALSE_ALARM_RULE_NOT_FOUND 40429`、`MATCHER_EMPTY 50039`、`RULES_LIMIT_EXCEEDED 50040`。
- 前端：`FalseAlarmRulesPage.tsx` + `MatcherBuilder.tsx`；报告侧徽标在 RPT-003 组件。

## 5. 测试用例

- API-010-T1（jmx 四类）：规则 CRUD/启用禁用；401/403/404；matcher 空 422 50039、超 50 条 50040；列表信封。
- API-010-T2（spec 命中改判）：预置规则 bodyContains「known-issue」→执行含该响应的失败场景→item FAKE_ERROR 徽标+task SUCCESS+概览误报 1（UI+接口）；关闭规则→新执行 item FAILED（不标记）。
- API-010-T3（spec 多条件与多规则）：status+bodyContains AND 语义（单条件不命中）；两规则同时命中→两 hit 留痕（接口断言）。
- 单测：matchFalseAlarm 矩阵（四条件×AND×多步骤任一成立）、改判后 task 聚合、ruleName 冗余（删规则后报告名展示）、仅新报告（改规则后旧 hit 不变）。

## 6. 竞品深度对标

基线主体覆盖；差异：①item 级粒度（基线步骤级，登记）；②匹配器四类基础集（正则/JSONPath Backlog）；③无优先级/分组；④通知延后 S5（通知场景清单已含误报，届时接入）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：改判点位于回调事务内（FAKE_ERROR 与 hit 同事务，报告 summary 一致性）。

## 8. 勘误登记

（暂无）
