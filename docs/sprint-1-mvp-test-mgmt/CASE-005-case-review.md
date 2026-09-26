# 用例评审

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | CASE-005 |
| 所属迭代 | Sprint 1 — 测试管理 MVP |
| 优先级 | P1 |
| 所属模块 | 测试用例（case 域） |
| 文档状态 | Draft（待评审） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | CASE-002（关联选择器）、CASE-003（用例详情评审 Tab）、PROJ-001（应用设置：重新提审开关） |
| 下游消费 | DASH-001（我的待办=待我评审）、CASE-003（评审 Tab 数据） |
| 上游依据 | 需求文档 M3（用例评审）；功能清单 §四.2（用例评审全量） |
| 对标基线 | 功能清单 §四.2：评审模式（单人=最后结果生效/多人=全员通过才通过）、评审人、逐条评审（通过/失败/建议+意见）、自动下一条、批量评审、批量改评审人、重新提审（应用设置）、评审历史、通过率、视图（我评审的/我创建的）、复制（状态重置） |
| 关联架构文档 | test-domain-model.md §2.3（CaseReview/ReviewCase） |
| 高保真确认 | 待确认（docs/design/CASE-005-case-review/，原型待产出） |
| 工作量估算 | 后端 3.5 人日 / 前端 4 人日 / 联调 1 人日 |

## 1. 概述

### 1.1 功能定位
用例质量门禁流程：创建评审→关联用例→评审人逐条标记→通过率驱动「评审通过」状态。是工作台「我的待办」的第一数据源。

### 1.2 范围边界

| 能力 | P1 ✅ | 后续 |
| --- | --- | --- |
| 评审 CRUD：名称、模式（single/multi）、评审人（多选项目成员）、起止时间、描述、关联用例（按模块树/筛选/勾选导入） | ✅ | — |
| 评审操作：逐条标记（Pass/Fail/Suggest + 意见必填于 Fail/Suggest）、自动下一条开关、按状态/评审人筛选、快捷创建用例 | ✅ | — |
| 批量：批量评审（同一标记）、批量修改评审人 | ✅ | — |
| 结果计算：single=最后评审结果；multi=全员 Pass 才 Pass，任一 Fail 即 Fail；Suggest 不否决 | ✅ | — |
| 重新提审：用例变更（CASE-003 编辑保存触发）自动置「重新提审」；受项目应用设置开关控制 | ✅ | 按字段粒度配置触发（后续增强） |
| 评审历史：每条 ReviewCase 的标记时间线 | ✅ | — |
| 通过率统计：评审维度（已评/通过/失败/建议/未评审） | ✅ | 趋势图（DASH-002） |
| 评审管理：复制（状态重置）、关注、取消关联、结束评审（只读） | ✅ | — |
| 脑图模式评审 | ❌ | CASE-007（Sprint 4） |
| 视图：我评审的 / 我创建的 | ✅ | — |

### 1.3 前置依赖
CASE-002 关联选择器；应用设置 KV（本项目AppSetting 首个键：case_review.re_submit）。

### 1.4 对标基线核对
基线 §四.2 除脑图评审（→CASE-007）外全复刻。简化实现：基线「评审计划管理」中的定时提醒依赖通知（MSG-001），本迭代不做提醒。

## 2. 业务逻辑

- 状态机（评审）：`进行中 → 已结束`（手动结束；到达止时间不自动结束，仅标记「已逾期」徽标——对齐基线手动口径）。
- 结果矩阵：ReviewCase(result=pass|fail|suggest|pending, reviewers[], results JSONB[{user,result,comment,ts}])；multi 模式聚合见 §1.2；评审判定只统计「评审人集合」内的标记，非评审人标记 403。
- 重新提审：触达条件=用例 update 事件（白名单字段变更：steps/name/level/动态字段）；动作=该用例所在**未结束**评审中 result 重置 pending、清 results、标记 re_submit=true、ChangeLog 记录；开关关闭则不触发。
- 复制评审：名称+copy、关联与评审人复制、result 全部重置；关注关系不复制。
- 结束评审：标记后所有写端点 422（code 10007 REVIEW_ENDED）。

## 3. UI/UX 设计（高保真 docs/design/CASE-005-case-review/）

- 左导航新增「用例评审」入口：列表页（视图 Tabs：全部/我评审的/我创建的；表格=名称/模式/评审人头像组/用例数/通过率进度条/状态/起止/操作：进入·复制·关注·结束）。
- 评审详情页：头部（名称/模式说明 tooltip/通过率环形图/结束按钮）+ 左用例清单（状态色点、评审人、筛选、自动下一条 Switch）+ 右当前用例速览（名称/等级/步骤折叠）+ 底部操作条（通过✓/失败✗/建议💬 + 意见输入（Fail/Suggest 必填））。
- 评审历史弹窗：该用例标记时间线（人/结果/意见/时间）。
- 重新提审徽标：用例行「重新提审」橙色标签 + tooltip 说明。
- 空态/权限态：无可评审用例引导关联；非评审人进入详情=只读无操作条。

## 4. 技术架构

- 数据模型（已建齐）：CaseReview(review_mode/reviewers/period/status)、ReviewCase(review/case/result/reviewers/results JSONB/re_submit)、AppSetting(key/value)。
- 端点：`GET/POST /api/v1/projects/{pid}/reviews`、`GET/PUT/DELETE .../reviews/{id}`、`POST .../reviews/{id}/close`、`POST .../reviews/{id}/copy`、`POST .../reviews/{id}/cases`（批量关联）、`DELETE .../reviews/{id}/cases/{caseId}`、`POST .../reviews/{id}/cases/{caseId}/judge`（标记）、`POST .../reviews/{id}/cases/batch-(judge|reviewer)`；`GET/PUT /api/v1/projects/{pid}/settings/case-review`（开关）。
- zod：reviewUpsertSchema、judgeSchema(result 枚举+comment 条件必填)、aggregateResult 纯函数（single/multi 矩阵，单测重点）。
- 权限点：PROJECT_CASE_REVIEW:READ|UPDATE（随本规格入库）；关联用例需 PROJECT_CASE:READ。
- 事件：用例 update 后同步调用 reSubmitService（进程内事件总线，避免跨域直查——走 case Provider 接口）。
- 前端：评审域路由 `/reviews/*`；环形图 AntD Progress circle。

## 5. 测试用例
- CASE-005-T1（jmx 四类）：评审 CRUD/关联/标记；401/403（非评审人标记）；Fail 无意见 422；评审分页信封。
- CASE-005-T2（spec 主链路）：建 multi 评审关联 2 用例 2 评审人 → 评审人 A 全 Pass → 用例仍 pending → 评审人 B 一条 Fail → 该用例 result=fail（接口断言聚合）→ 通过率环图变化（UI）。
- CASE-005-T3（spec）：开启重新提审 → 编辑已评用例步骤 → 该评审中用例回 pending+徽标（UI+接口）；关闭开关后编辑不重置。
- CASE-005-T4：结束评审 → 标记端点 422 code 10007；复制评审状态重置断言。
- 单测：single/multi 聚合矩阵（含 Suggest 混合）、重新提审白名单字段。

## 6. 竞品深度对标
基线 §4.2 逐条对齐（除脑图登记 CASE-007）。差异：基线「按状态筛选+批量评审」齐备；「评审周期到期自动行为」基线仅展示逾期，本项目一致不自动结束。多人评审语义完全复刻（全员通过才通过）。

## 7. 里程碑与验收
DoD 前置：高保真人工确认。验收对应 sprint-overview 验收 5；演示 single 与 multi 双模式。
