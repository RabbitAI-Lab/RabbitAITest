# 待办跟进创建（我关注的七维度 · 我创建的修正 · Follow 补齐）

| 元信息项     | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | DASH-002                                                                                                                                                               |
| 所属迭代     | Sprint 4 — 计划完整与脑图                                                                                                                                              |
| 优先级       | P2                                                                                                                                                                     |
| 所属模块     | 工作台（dash 域）+ 各域 Follow 入口                                                                                                                                     |
| 文档状态     | Approved（2026-09-27 自评审冻结；交付后翻 Implemented）                                                                                                                 |
| 最后更新日期 | 2026-09-27                                                                                                                                                             |
| 上游依赖     | DASH-001（工作台三 Tabs 骨架）、各域对象（case/plan/review/bug/api_case/scenario）                                                                                      |
| 下游消费     | S5 MSG-001（关注变更通知——Follow 表为通知源）                                                                                                                           |
| 上游依据     | 需求文档 §四 M7「我的待办/我关注的/我创建的（七维度筛选）」；功能清单 §一「工作台」                                                                                     |
| 对标基线     | 功能清单 §一：我的待办（按项目、测试计划、用例评审、缺陷等维度筛选）；我关注的（关注用例/计划等后集中展示，可按项目、测试计划、用例评审、测试用例、接口用例、接口场景、缺陷筛选）|
| 关联架构文档 | test-domain-model.md §3（跨域经 dash.service 聚合口径）                                                                                                                |
| 高保真确认   | 待确认（原型 docs/design/DASH-002-todo-follow-create/；人工确认待 Sprint 验收走查——不可 AI 代签）                                                                      |
| 工作量估算   | 后端 2.5 人日 / 前端 2.5 人日 / 联调 0.5 人日                                                                                                                          |

## 1. 概述

### 1.1 功能定位

工作台三区补齐到完整口径：**我关注的**七维度筛选+项目维度（当前 Follow 仅聚合无筛选、无接口域）；**我创建的**修正为创建人口径（当前实现为全量列表——缺陷修正）并扩展接口域两维度；**我的待办**执行维度纳入接口用例/场景 refs；各对象 Follow 写入口补齐（计划/场景/接口用例/评审）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | S4 ✅ | 后续                                             |
| ---------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 我关注的七维度：case/plan/review/api_case/scenario/bug kind 筛选       | ✅     | 自定义保存筛选（Backlog）                        |
| 我关注的-项目维度：仅当前项目（followed 增加 projectId 过滤）          | ✅     | 跨项目聚合视图（Backlog）                        |
| 我创建的修正：kind∈case/review/plan/bug 按 createdBy=me（缺陷修正）   | ✅     | —                                                |
| 我创建的扩展：api_case/scenario 两维度（createdBy=me）                 | ✅     | —                                                |
| 待办-我的执行：纳入 refType=api_case/scenario（execUserId=me+NOT_RUN）| ✅     | —                                                |
| Follow 写入口补齐：计划（列表行+详情）、场景（详情）、接口用例（详情）、评审（详情） | ✅ | 全对象关注（Mock/环境等登记后续） |
| 关注状态回显：各详情返回 followed 布尔（计划/场景/接口用例/评审补齐） | ✅     | —                                                |
| 关注→通知                                                              | ❌     | S5 MSG-001（Follow 表为通知源，本迭代只落数据） |

### 1.3 前置依赖

Follow 表预建；case/bug 关注端点成熟（S1）；dash.service 聚合骨架成熟（DASH-001）。

### 1.4 对标基线核对

完全复刻：七维度筛选/项目维度/待办维度/全对象关注入口。差异：跨项目聚合登记 Backlog（当前单项目工作台口径）。

## 2. 业务逻辑

- **followed(projectId, kind)**：Follow 全量→按 entityType 映射七 kind（functional_case/test_plan/case_review/api_case/scenario/bug）→kind 过滤→实体反查 **带 projectId 过滤**（api_case 经 ApiCase→ApiDefinition.projectId；scenario 直查）；已删除实体行静默丢弃。
- **created(projectId, kind, userId)**：六 kind 全部加 `createdBy: userId`（修正原全量缺陷）；api_case kind=ApiCase（经定义 join projectId）；scenario kind=Scenario。
- **todo exec 维度**：PlanCaseRef where execUserId=me & status=NOT_RUN & plan 未删未归档——refType 分流反查名称（functional_case/api_case/scenario 三向）；展示类型徽标。
- **Follow 端点补齐**（POST/DELETE /{entity}/{id}/follow，权限=对应域 READ）：
  - `plans/[planId]/follow`（test_plan）
  - `scenarios/[id]/follow`（scenario，S3 登记去向兑现）
  - `apis/[apiId]/cases/[caseId]/follow`（api_case）
  - `reviews/[reviewId]/follow`（case_review）
  - 详情响应补 `followed` 布尔（getPlan/getScenario/apiCase detail/getReview 聚合 Follow 查询）。
- **幂等**：唯一键冲突=已关注（POST 幂等返回当前态）；DELETE 不存在=204。

## 3. UI/UX 设计（高保真 docs/design/DASH-002-todo-follow-create/）

- 工作台「我关注的」子筛选升级为七枚（用例/计划/评审/接口用例/场景/缺陷，含计数徽标）；「我创建的」六枚；「我的待办」执行子项类型徽标（功能/接口/场景三色）。
- 关注入口：计划列表行「☆/★」与详情头部；场景详情头部；接口用例详情头部；评审详情头部（样式与用例/缺陷现有一致：星形 toggle）。
- 原型画板：①工作台三区七维度全景 ②各对象关注入口拼板（计划列表行+四详情头部）③待办接口域行样式。

## 4. 技术架构

- 数据模型：零迁移（Follow 唯一键既有）。
- 契约：`dashFollowedQuerySchema { kind?, page?, pageSize? }`（七枚举）；`dashCreatedQuerySchema` 六枚举；todo 响应 item 扩展 `refType`。
- 端点：`GET /dashboard/followed?kind=`（升级）、`GET /dashboard/created?kind=`（升级）、`GET /dashboard/todo`（升级）；四个新 follow 端点（见 §2）；详情 followed 布尔经既有 GET 响应扩展。
- 服务：`dash.service.ts` 升级三函数；follow 通用化：抽 `crosscut/follow.service.ts`（setFollow/listFollowed 带 entityType 白名单）供各域复用（case/bug 现有实现迁移收敛）。
- 前端：工作台子筛选组件参数化；关注星组件 `FollowStar` 通用化（props: entityType/entityId/followed/api）；四页面接入。
- 错误码：`FOLLOW_TARGET_NOT_FOUND 40432`。

## 5. 测试用例

- DASH-002-T1（jmx 四类）：followed?kind= 七维度二态（关注计划后 kind=plan 可见、kind=case 空）；created 修正断言（他人创建不可见——两账号数据）；todo exec 含 api_case 行；401；新 follow 端点 404；follow 幂等。
- DASH-002-T2（spec 关注主链路）：计划详情关注→工作台我关注的（筛选「计划」）出现→取消→消失；场景详情关注同径（UI+Console+接口）。
- DASH-002-T3（spec 我创建的修正）：A 建接口用例+B 建场景→我创建的（A 视角 api_case 维度见、B 场景维度见；交叉不可见）。
- DASH-002-T4（spec 待办接口域）：计划关联 api_case 指派执行人→该用户待办-我的执行出现接口用例行（类型徽标断言）。
- 单测：kind↔entityType 映射矩阵、createdBy 过滤口径、todo refType 分流。

## 6. 竞品深度对标

基线 §一主体复刻。差异：单项目工作台（基线多项目切换聚合，登记 Backlog）；关注通知 S5 承接（基线关注即通知，我们分两步走）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（S0 §8.1 先例）。联调重点：七维度反查 N+1（批量 in 查询）与 created 修正的回归（DASH-001 旧断言更新）。

## 8. 勘误登记

（交付后回填）
