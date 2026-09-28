# 用例关联接口（跨域 Provider 通道）

| 元信息项     | 内容                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | CASE-006                                                                                                                            |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                             |
| 优先级       | P2（依赖 Sprint 1 评审与关联体系+Sprint 2 接口域就绪）                                                                              |
| 所属模块     | 测试用例（case 域）↔ 接口测试（api_test 域）                                                                                        |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                          |
| 上游依赖     | CASE-003（详情 Tab 体系，用例 Tab 承接）、API-002/003（定义与用例目标）、PLAN-001（计划关联弹窗扩展位）                             |
| 下游消费     | S4 PLAN-003（计划内执行接口用例+自动更新状态激活）、DASH-002（接口域卡片）                                                          |
| 上游依据     | 需求文档 M3（用例详情关联）/M4（计划关联接口）；功能清单 §四（用例关联测试用例类型）§五（计划关联接口/场景用例）                    |
| 对标基线     | 功能清单 §四.2 关联（功能用例关联接口/场景用例）；§五 关联用例（接口/场景 Tab）；MeterSphere BaseAssociateCaseProvider 同构         |
| 关联架构文档 | test-domain-model.md §3（Provider 解耦：case 与 api_test 互不依赖、多态引用）、§4（横切关联）                                       |
| 高保真确认   | 待确认（原型 docs/design/CASE-006-case-associate-api/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                 |
| 工作量估算   | 后端 2.5 人日 / 前端 3 人日 / 联调 1 人日                                                                                           |

## 1. 概述

### 1.1 功能定位

打通测试管理与接口测试：功能用例可挂接口用例（追溯）；测试计划可关联接口用例（S4 执行）。**case 域与 api_test 域代码互不 import**，读对方经 Provider（list_ref_summary/batch_validate，test-domain-model §3）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                         | P1 ✅ | 后续                                      |
| ------------------------------------------------------------------------------------------------------------ | ----- | ----------------------------------------- |
| 功能用例详情新增「关联」Tab：已关联接口用例列表（名称/所属接口/method/等级/状态/操作：移除）                 | ✅    | 场景关联（S3，refType 预留 scenario）     |
| 关联选择器：接口模块树+定义→CASE 级勾选（批量）、搜索；已关联去重（422 code 10009 既有）                     | ✅    | 跨项目关联（基线无，不做）                |
| 接口侧引用关系反查（API-002 消费 Provider）                                                                  | ✅    | —                                         |
| 计划关联扩展：关联弹窗增「接口用例」Tab（PLAN-001 预留位）；计划详情接口用例行（状态 NOT_RUN 展示，执行 S4） | ✅    | 计划内执行（PLAN-003）/自动更新状态（S4） |
| Bug 关联接口用例（BugCaseRef refType 扩展）                                                                  | ❌    | S3（缺陷侧消费面随误报/同步迭代评估）     |
| 关联数徽标：用例列表「关联」列（接口用例数）                                                                 | ✅    | —                                         |

### 1.3 前置依赖

API-003 用例列表查询（Provider 数据源）；CASE-003 详情 Tab 容器；PLAN-001 关联弹窗组件。

### 1.4 对标基线核对

完全复刻：用例关联接口用例/计划关联接口用例两入口（Provider 同构基线 BaseAssociateCaseProvider）。简化实现：场景 refType 仅建模不落 UI（S3）；计划内执行=S4（PLAN-001 既定去向）；Bug 侧延后（登记）。

## 2. 业务逻辑

- 关联存储：新表 `case_api_refs`（多态预留 refType ∈ api_case|scenario）；唯一约束 (caseId, refType, refId)。
- 校验：refId 必须为同项目未删 ApiCase（Provider batch_validate：不存在/已删→422 明细返回）。
- 计划关联：PlanCaseRef refType=api_case（表已建）；去重受计划「允许重复关联」开关既有语义约束（10009）。
- 删除联动：接口用例软删→关联行保留但标「已删除」（灰显）；硬口径=展示层过滤由 Provider summary 提供 deleted 标志。

## 3. UI/UX 设计（高保真 docs/design/CASE-006-case-associate-api/）

- 用例详情：Tab 栏新增「关联」（位于 依赖 与 评审 之间）；空态引导「关联接口用例」；选择器弹窗（左：接口模块树；右：定义列表→展开 CASE 勾选，顶部搜索+已选计数）。
- 用例列表：「关联」列徽标（N 处悬停浮层列前 5 条名称）。
- 计划关联弹窗：Tabs「功能用例｜接口用例」（后者=左模块树+右用例表勾选，等级/状态列）；计划详情清单中接口用例行类型徽标「接口」、状态 NOT_RUN、操作列「执行(S4)」禁用 Tooltip。

## 4. 技术架构

- 数据模型：**新表 `case_api_refs`**（门禁 3 评审理由：INFRA-003 建模了 plan/bug 两侧多态引用，case→api_test 关联通道为规划缺口（当时接口域未启动），属补齐跨域通道而非核心表 DDL；结构复刻 PlanCaseRef/BugCaseRef 同构）。迁移：`s2_case_api_refs`。
- Provider：`src/server/domains/api/api-ref.provider.ts` 实现 list_ref_summary(refIds)/batch_validate(refIds)（case/plan 域经接口调用，禁 import prisma api 模型直查——code review 门禁）。
- 端点：`GET/POST /api/v1/projects/{pid}/cases/{caseId}/api-refs`、`DELETE .../api-refs/{refId}`；选择器数据源复用 API-002/003 列表端点；计划侧扩展现有 `POST .../plans/{id}/cases`（body refType，zod 扩展）与 `GET .../plans/{id}` 详情聚合。
- zod：caseApiRefCreateSchema（refIds[]≤100、refType enum）；planRefCreateSchema 扩 refType。
- 权限点：PROJECT_CASE:UPDATE（用例侧）；PROJECT_PLAN:UPDATE（计划侧）；选择器读=PROJECT_API:READ。
- 错误码：复用 CASE_NOT_FOUND/DUP_ASSOC；新增 `REF_TARGET_INVALID 40464`（batch_validate 失败明细）。
- 前端：`components/case/ApiRefPanel.tsx`、`ApiRefPicker.tsx`；计划弹窗扩展 `PlanCasePicker.tsx` 增 Tab。

## 5. 测试用例

- CASE-006-T1（jmx 四类）：关联 CRUD/重复关联 409? （422 code 10009 既有口径）/无效 refId 422 明细；401/403/404；关联列表信封。
- CASE-006-T2（spec 用例侧主链路）：建定义+2 用例→功能用例「关联」Tab 空态→选择器勾选 2 条→列表呈现（含等级/状态）→用例列表「关联」徽标=2→移除 1 条徽标=1（UI+Console+接口）。
- CASE-006-T3（spec 计划侧）：计划关联弹窗切「接口用例」Tab→勾选 2 条→计划清单出现「接口」徽标行 NOT_RUN→「执行(S4)」禁用；功能用例与接口用例混合清单共存。
- CASE-006-T4（spec 二态）：关联已删除接口用例→行灰显「已删除」；重复关联提交被拒 Toast。
- 单测：Provider batch_validate 矩阵（不存在/他项目/已删）、refType 校验、计划混合清单聚合。

## 6. 竞品深度对标

基线 §四.2/§五 两关联入口全覆盖，Provider 同构基线 BaseAssociateCaseProvider（多态 refType+config）。差异：场景关联 S3；计划内执行与自动更新状态 S4（PLAN-001/003 既定拆分链）；Bug 侧延后登记。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。依赖方向单测（case 域不 import api 模型）随 CI lint 门禁（dependency-cruiser 不引入，review checklist 人工项+单测断言 provider 边界）。

## 8. 勘误登记

（暂无）
