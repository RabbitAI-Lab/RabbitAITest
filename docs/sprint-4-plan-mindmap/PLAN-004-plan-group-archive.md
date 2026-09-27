# 计划分组与归档增强

| 元信息项     | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLAN-004                                                                                                                                                               |
| 所属迭代     | Sprint 4 — 计划完整与脑图                                                                                                                                              |
| 优先级       | P2                                                                                                                                                                     |
| 所属模块     | 测试计划（plan 域）                                                                                                                                                     |
| 文档状态     | Approved（2026-09-27 自评审冻结；交付后翻 Implemented）                                                                                                                 |
| 最后更新日期 | 2026-09-27                                                                                                                                                             |
| 上游依赖     | PLAN-001（归档与列表基线）                                                                                                                                             |
| 下游消费     | PLAN-005（组报告聚合）、DASH-002（组维度筛选登记）                                                                                                                     |
| 上游依据     | 需求文档 §四 M4「计划与计划组」；功能清单 §五/§12.7                                                                                                                    |
| 对标基线     | 功能清单 §五「计划与计划组：多个计划可归入计划组」、§12.7（口径说明：代码层 xpack 门控，功能手册按通用功能介绍）、§五「归档：计划可归档，列表支持只看已归档」             |
| 关联架构文档 | test-domain-model.md §2.4（TestPlan.type=GROUP/groupId 预建，xpack 语义列 P0 建齐不启用）                                                                              |
| 高保真确认   | 待确认（原型 docs/design/PLAN-004-plan-group-archive/；人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                    |
| 工作量估算   | 后端 2 人日 / 前端 3 人日 / 联调 0.5 人日                                                                                                                              |

## 1. 概述

### 1.1 功能定位

计划组=计划的容器聚合（多计划归组、组视图、组聚合报告与总结、组级归档）。**口径决策**：MeterSphere 代码层将计划组置于 X-Pack License 门控后，但其官方功能手册与 pricing 页均按通用功能介绍（清单 §12.7 已记录该口径差异）——本项目按**功能手册口径**在社区版实现（无 License 门控），作为对标差异显式登记；schema 的 type/groupId 列 S0 已建齐（当时标注 xpack 语义列，本迭代启用，无需迁移）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | S4 ✅ | 后续                                       |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------ |
| 计划组 CRUD：创建组（名称/描述）、编辑、删除（需组空）                  | ✅     | —                                          |
| 成员管理：计划移入/移出组（单计划至多一组；groupId 可空）               | ✅     | 组间拖拽批量移动                           |
| 列表组视图：组折叠行（成员数/聚合进度/通过率均值）+ 展开成员            | ✅     | —                                          |
| 组聚合报告：成员计划通过率/进度汇总卡+成员明细表+组总结（可编辑保存）   | ✅     | 组内步骤明细聚合（钻取走成员报告）         |
| 组归档：组归档→成员计划级联 archived；组恢复→成员恢复                  | ✅     | 成员单独恢复（登记：组恢复整组口径）       |
| 归档增强：列表批量勾选归档/恢复                                         | ✅     | —                                          |
| 组执行：逐成员计划顺序执行（前端循环调用）                              | ✅ 简化 | 组级并行编排调度（登记 Backlog）           |

### 1.3 前置依赖

TestPlan.type/groupId 列预建（`type @default("PLAN")`、`groupId?` 指向同表 GROUP 记录），零迁移。

### 1.4 对标基线核对

按功能手册口径完全复刻（组 CRUD/成员/组报告/组归档）；§12.7 口径差异（企业版代码门控 vs 手册通用）显式登记为本项目决策。简化：组执行=逐成员顺序（Backlog 并行编排）；成员单独恢复登记。

## 2. 业务逻辑

- **组**：TestPlan(type=GROUP)；组不可挂 groupId（组不嵌套，422 50013 GROUP_NESTED）、组不可被执行/关联用例（写端点拒绝，422 50014 GROUP_NOT_EXECUTABLE）。
- **成员约束**：成员必须 type=PLAN；移入=置 groupId；移出=置 null；删除组要求无成员（422 50015 GROUP_NOT_EMPTY）；删除计划不影响组。
- **组视图聚合**：progress=Σ(成员已执行 refs)/Σ(成员 refs)；passRate=ΣPASS/Σ已执行（planPassRate 口径复用，分母 pass+fail+blocked）；阈值判定=全部成员达阈值（AND）。
- **组归档级联**：组 archived_at 置位→成员批量同置（事务）；恢复同理。级联后成员写端点全部 422 10008（PLAN-001 语义不变）。
- **组报告**：懒创建 reportType=`plan_group` 报告；内容=成员统计表+阈值判定+组总结（summary 可编辑保存）；成员行链接成员计划报告。
- **组执行**：前端「执行组」=对未归档成员顺序逐个调 plan execute（串行等待前一任务终态）；中断=停止当前任务，余成员不再发起。

## 3. UI/UX 设计（高保真 docs/design/PLAN-004-plan-group-archive/）

- 计划列表页：工具条新增「新建计划组」；列表组视图=组行（组名/成员数/聚合进度条/通过率均值/阈值达标徽标/操作：展开·报告·执行·归档·编辑·移出成员·删除）+ 缩进成员行；未分组计划平铺其后。
- 成员移入：计划行「移入分组」弹窗（单选组树/新建组快捷）；组行成员「移出」。
- 组报告页：汇总卡（成员数/总 refs/进度/通过率/阈值达标数）+ 成员明细表（计划名/refs/进度/通过率/阈值/报告链接）+ 总结编辑区。
- 批量归档：列表勾选（计划与组混选）→ 批量归档/恢复。
- 原型画板：①列表组视图（折叠+展开态）②移入弹窗+组报告页 ③批量归档与级联提示。

## 4. 技术架构

- 数据模型：零迁移（type/groupId 已建）；组报告复用 Report 表 reportType 新值 `plan_group`。
- 契约（shared `plan/schemas.ts`）：`planGroupUpsertSchema { name, description? }`；`planMoveGroupSchema { groupId | null }`；`planGroupReportSchema`（成员行结构）；列表响应扩展 `groups[]`（组+成员嵌套）与 `type` 字段。
- 端点（前缀 `/api/v1/projects/{pid}`）：
  - `GET/POST /plan-groups`、`PUT/DELETE /plan-groups/{groupId}`
  - `POST /plans/{planId}/move-group`（body groupId|null）
  - `POST /plan-groups/{groupId}/archive|unarchive`（级联）
  - `GET /plan-groups/{groupId}/report`、`PUT /plan-groups/{groupId}/report/summary`
  - `POST /plans/batch-archive`（ids 混选级联）
  - 权限点：全 PROJECT_PLAN:UPDATE（读 PLAN:READ）。
- 服务：`plan.service.ts` 扩展组方法（组聚合/级联归档事务）；`plan-group.service.ts` 拆分（组视图查询与组报告）。
- 错误码：`GROUP_NOT_FOUND 40431`、`GROUP_NESTED 50013`、`GROUP_NOT_EXECUTABLE 50014`、`GROUP_NOT_EMPTY 50015`。
- 前端：plans/page.tsx 组视图渲染；组报告路由 `/plans/groups/[groupId]/report`；api-client s4.ts planGroupApi。
- 前端路由注意：组报告放 `/plans/[id]` 详情页分支（id 前缀 `grp:` 区分）或独立段——采用独立段 `/plans/groups/{groupId}`（Next 动态段不冲突）。

## 5. 测试用例

- PLAN-004-T1（jmx 四类）：组 CRUD/move/archive 级联正常路径（聚合值断言）；401/403/404；422（嵌套组/组执行/删除非空组）；groups 列表态信封（组含成员嵌套）。
- PLAN-004-T2（spec 组视图主链路）：建组→移入 2 计划（各带执行进度）→列表组视图聚合断言→组报告页成员表→总结编辑保存（UI+Console+接口）。
- PLAN-004-T3（spec 级联归档二态）：组归档→成员全部只读（编辑 422 10008）→组恢复→可编辑；批量归档勾选混选。
- 单测（shared）：组聚合纯函数（空组/零 refs/阈值 AND 口径）、planGroupUpsert 校验。

## 6. 竞品深度对标

§12.7 口径差异显式登记（手册通用 vs 代码 xpack）——本项目选手册口径，社区版直接可用，不设 License 门控。组并行编排登记 Backlog。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（S0 §8.1 先例）。联调重点：级联归档事务原子性与组聚合口径与 planPassRate 一致。

## 8. 勘误登记

（交付后回填）
