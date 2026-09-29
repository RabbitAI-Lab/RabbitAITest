# 用户规模扩容与部门管理（上限放开 · 组织部门树）

| 字段         | 内容                                                                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | ENTP-008                                                                                                                                                                                                                       |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                                                          |
| 优先级       | P3（迭代内 P1）                                                                                                                                                                                                                |
| 所属模块     | system 域（用户上限）+ project 域（组织级部门）；engine/mock 不感知                                                                                                                                                            |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                                                   |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                                                     |
| 上游依赖     | ENTP-007（USER_SCALE 门控+payload.maxUsers）、SYS-004（用户管理/30 上限 10151 先例）、ENTP-001（组织上下文）                                                                                                                   |
| 下游消费     | 后续部门级权限/统计（Backlog）                                                                                                                                                                                                 |
| 上游依据     | 需求文档 §三 M10「用户扩容与部门管理」；功能清单 §十 用户管理、§十二 12.2 用户规模扩容                                                                                                                                         |
| 对标基线     | 功能清单 12.2：社区版上限 30 个用户（USER_TOO_MANY/user_open_source_max，SimpleUserService 硬编码 30）；企业版不限用户数（UserXpackService 扩容钩子 GWHowToAddUser/ChangeUser/DeleteUser）；pricing 口径 5/30 差异以部署版为准 |
| 关联架构文档 | test-domain-model.md §6（Department/DepartmentMember 例外登记）；rbac-permission-model.md §6（USER_SCALE）                                                                                                                     |
| 高保真确认   | 待确认（原型 docs/design/ENTP-008-user-scale-department/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                                                                         |
| 工作量估算   | 后端 1.5 人日 / 前端 1.5 人日 / 联调 0.5 人日                                                                                                                                                                                  |

## 1. 概述

### 1.1 功能定位

两件事：①用户规模扩容——社区版 30 用户上限在有效 License（USER_SCALE 特性）下放开（payload.maxUsers 可选封顶），删除 License 即回落 30；兑现清单 12.2 的 UserXpackService 扩容语义（本项目以「上限函数读 License」替代钩子注入）。②部门管理——组织级部门树（两级+）与成员挂载，为后续部门维度统计/权限提供模型底座。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                        | P1 ✅ | 后续                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------- |
| 上限判定函数 `effectiveUserLimit()`：无 License/无 USER_SCALE→config.userLimit（30，env 可覆写）；有→payload.maxUsers ?? Infinity           | ✅    | 按组织分别限额 Backlog（全局口径）                      |
| 创建用户（含注册入口共用判定）超限 → 10151（文案区分「社区版上限 30 / 授权上限 N」）                                                        | ✅    | 邮箱邀请注册流 Backlog（管理员创建+自助注册两既有入口） |
| 用户管理页社区版提示：进度条「当前 N / 30」+ 达限时引导「扩容需企业版授权」链接授权页                                                       | ✅    | 批量 Excel 导入（基线企业版语义）Backlog                |
| Department 树 CRUD：组织级 `id/orgId/parentId?/name`（同层唯一 409）；建/改名/移动（parentId 变更）/删（有子部门 409；有成员→级联解除挂载） | ✅    | 拖拽排序 Backlog                                        |
| DepartmentMember 挂载：批量添加成员（组织成员范围内）/移除；一人可属多部门                                                                  | ✅    | 部门负责人角色 Backlog                                  |
| 部门页 `/org/departments`：左树右表（部门树+选中部门成员表+添加成员弹窗）                                                                   | ✅    | 部门筛选项目成员列表 Backlog                            |
| 门控：部门 CRUD 经 USER_SCALE 特性（90001/90005）；用户创建路径只读判定不额外 403                                                           | ✅    | —                                                       |

### 1.3 前置依赖

- User 表零改动（上限为服务层判定）；Department/DepartmentMember 为 ENTP 域新表（门禁 3 例外登记：部门树形态依赖本规格定型，S0 无 ENTP-008 输入——与 S7 ai 域同类）
- SYS-004 既有：USER_TOO_MANY 10151、user.service createUser 判定点、用户管理页

### 1.4 对标基线核对

完全复刻：社区版 30 上限与 USER_TOO_MANY 语义✓ 企业版放开上限✓ 用户管理面扩容引导✓。简化实现：maxUsers 为 License 内声明（基线扩容=购买人数变更授权——同构）；部门树两级+（基线 v2 部门为多级树，本项目不限层级但 UI 展示两级+折叠）。超出基线，自主设计：DepartmentMember 多对多（基线部门-用户挂载语义未明示，多对多覆盖树形汇报场景）。

## 2. 业务逻辑

- **上限判定**：`effectiveUserLimit()` = license(USER_SCALE 有效).maxUsers ?? Infinity，否则 config.userLimit；createUser（管理员建）与 registerUser（自助注册）共用；超限 10151 message 按口径生成。既有用户不因 License 删除而禁用（只拦新增）。
- **部门树**：parentId 必须同组织且非自身后代（环检测 422 90042）；删除：有子部门 409 90043；有成员→先级联解除 DepartmentMember 再删（简化：删除弹窗提示将解除 N 名成员挂载）。
- **挂载**：添加成员限本组织 OrgMember（越界 422）；重复挂载幂等（unique(departmentId,userId)）；移除单条。
- **门控**：departments 全部写端点 + 读端点经 USER_SCALE（读也门控——社区版不暴露部门能力，页入口隐藏）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-008-user-scale-department/）

- 画板一（部门管理页 `/org/departments`）：左侧部门树（根=组织名，节点操作：新增子部门/重命名/删除）；右侧选中部门成员表（姓名/邮箱/移除）+「添加成员」（弹窗多选本组织未挂成员）；面包屑显示层级路径。
- 画板二（用户管理页上限提示态）：社区版顶部进度条「用户 27 / 30」+文案「达到上限后需企业版授权扩容」+「授权管理」链接；企业版显示「用户 N（授权上限 M / 不限）」。
- 空态/二态：无部门（树仅根+引导建部门）；社区版（LeftNav 部门入口隐藏；API 403 90001）；同层重名红框 409。

## 4. 技术架构

- 数据模型：新表 `departments`（id/orgId/parentId?/name/createdAt/updatedAt，@@unique([orgId,parentId,name] 可空联合唯一改应用层校验——Postgres NULL 语义，用服务层同层重名校验+普通索引）+ `department_members`（id/departmentId/userId/createdAt，@@unique([departmentId,userId])）；例外登记 test-domain-model §6。
- 契约（packages/shared/src/entp/schemas.ts）：`departmentUpsertSchema`（name 1-64/parentId?）、`departmentTreeItemSchema`（含 children 递归/memberCount）、`departmentMemberAddSchema`（userIds 1-100）。
- 端点：
  - `GET/POST /api/v1/orgs/{orgId}/departments`（ORG_DEPARTMENT:READ/CREATE，门控）
  - `PATCH/DELETE /api/v1/orgs/{orgId}/departments/{departmentId}`（UPDATE/DELETE，门控）
  - `POST /api/v1/orgs/{orgId}/departments/{departmentId}/members`（UPDATE）、`DELETE .../members/{userId}`（UPDATE）
- 服务：`apps/web/src/server/domains/entp/department.service.ts`（树组装/环检测/级联解除）；`user.service` 判定点换 `effectiveUserLimit()`。
- 错误码：`DEPARTMENT_NOT_FOUND 90040`（404）、`DEPARTMENT_CYCLE 90042`（422 parentId 环/跨组织）、`DEPARTMENT_HAS_CHILDREN 90043`（409）、`DEPARTMENT_MEMBER_NOT_IN_ORG 90044`（422）。
- 权限点：`ORG_DEPARTMENT:READ|CREATE|UPDATE|DELETE`（SYSTEM_ADMIN+ORG_ADMIN）。
- 前端：`/org/departments/page.tsx`（orgId 取 useOrgContext）；users/page.tsx 上限提示条；LeftNav 组织组「部门管理」（perm ORG_DEPARTMENT:READ+企业版可见性由 license-status 驱动——单组织社区版隐藏入口）；api-client s9。

## 5. 测试用例

- ENTP-008-T1（jmx 四类）：部门 CRUD 主链（建根/建子/改名/移动/删）；401/403（无点/无 License）；422（重名 90041 建在服务层映射——清单见 §4/环 90042/成员越组织 90044）；树返回信封。
- ENTP-008-T2（spec 部门主链路）：加 License → 部门页建「质量部>测试一组」两级 → 添加成员（本组织用户）→ 成员表可见 → 删除「质量部」被拒（有子）→ 删「测试一组」成功（UI+Console+接口）。
- ENTP-008-T3（spec 上限二态）：USER_LIMIT=31 测试栈——社区版建第 31 个用户 10151 文案含「30」；加 License（maxUsers=100）→ 第 31 个用户创建成功；用户管理页进度条/企业版口径切换。
- 单测（`apps/web/src/server/domains/entp/__tests__/department.test.ts` + 上限矩阵）：effectiveUserLimit 四态（无/有无限/有 maxUsers/License 过期回落）；树组装与环检测；重名/级联解除；挂载越界。

## 6. 竞品深度对标

基线 12.2/§十核对：30 上限与 10151 语义✓ 企业版放开✓ 扩容引导✓。差异：①扩容=maxUsers 声明式（基线钩子注入——同构更简）；②部门为组织级模型（基线 v2 部门挂用户组语义未在 v3 清单实证，自主设计登记）；③无批量导入（登记 Backlog）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：departments 六端点+effectiveUserLimit。联调点：ENTP-001 组织上下文（部门页 orgId）。验收=§5 全绿+概览主线「部门」段。

## 8. 勘误登记

无。
