# 多组织管理（组织 CRUD · 切换器 · 项目过滤）

| 字段         | 内容                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-001                                                                                                                                                        |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                           |
| 优先级       | P3（迭代内 P1）                                                                                                                                                 |
| 所属模块     | system 域（组织管理）+ console 布局（切换器）；engine/mock 不感知                                                                                               |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                    |
| 最后更新日期 | 2026-09-28                                                                                                                                                      |
| 上游依赖     | ENTP-007（MULTI_ORG 特性门控）、SYS-001（注册默认组织先例）、SYS-002（路由隔离）、SYS-003（组织-项目模型）、PROJ-001（项目权限）、S5 useProjectInfo 链路        |
| 下游消费     | ENTP-008（部门挂组织）、ENTP-006（资源池应用组织）、后续跨组织统计                                                                                              |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 组织与项目管理、§十二 12.1 多组织管理、12.11「社区版限 1 组织」                                                                  |
| 对标基线     | 功能清单 12.1：创建组织（名称/管理员/描述）、编辑、添加成员、结束（不再出现在切换列表）、删除（连同项目数据一并删除）；组织成员查看与移除；项目可挂载到指定组织 |
| 关联架构文档 | test-domain-model.md §2（Organization/OrgMember 零 DDL）；rbac-permission-model.md §6（MULTI_ORG 门控）；api-conventions.md                                     |
| 高保真确认   | 待确认（原型 docs/design/ENTP-001-multi-org/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                      |
| 工作量估算   | 后端 2 人日 / 前端 2 人日 / 联调 1 人日                                                                                                                         |

## 1. 概述

### 1.1 功能定位

社区版「默认单组织」模型上叠加多组织：系统管理员创建/编辑/结束/删除组织（删除级联项目数据）；用户多组织成员身份下顶栏出现组织切换器，切换后项目列表、/org 管理页按所选组织过滤。兑现清单 12.1「社区版限 1 组织，多组织为企业版」。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                    | P1 ✅ | 后续                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------- |
| 组织 CRUD：创建（名称/管理员既有用户邮箱/描述）→ Organization+OrgMember(owner)；编辑（名称/描述）；状态 ACTIVE↔ENDED（结束=不出现在切换列表，数据保留） | ✅    | 组织转让/管理员变更 Backlog（编辑管理员列后续） |
| 删除组织：`needConfirm:true` 二次确认 → 事务级联硬删（组织+项目+项目域数据），审计留痕                                                                  | ✅    | 软删回收站 Backlog                              |
| 组织成员：查看/移除（既有 addOrgMembers/listOrgMembers 复用，补 removeOrgMember）；owner 不可移除                                                       | ✅    | 成员跨组织批量迁移 Backlog                      |
| 顶栏组织切换器：`GET /personal/orgs`（本人组织+当前）；>1 个 ACTIVE 组织时显示；切换持久化（zustand `rabbit-org`）                                      | ✅    | 组织收藏/排序 Backlog                           |
| 项目按组织过滤：`GET /personal/projects?orgId=`；项目切换器下拉按当前组织分组                                                                           | ✅    | 跨组织全局项目视图 Backlog                      |
| /org 管理页 orgId 溯源：优先切换器选中组织，回落 useProjectInfo 派生（单组织行为不变）                                                                  | ✅    | —                                               |
| 社区版门控：无 MULTI_ORG 特性时创建/结束/删除第二个组织 403 90001；管理页只读展示单组织                                                                 | ✅    | —                                               |

### 1.3 前置依赖

- `organizations`/`org_members` 表 S0 已建齐——**零 DDL**
- 注册流先例：SYS-001 registerUser（本规格创建组织复用 `initOrgAndProjectPresets` 预设初始化，但不建演示项目——企业组织从空开始）
- ENTP-007 门控先行交付

### 1.4 对标基线核对

完全复刻：创建（名称/管理员/描述）✓ 编辑✓ 结束（不在切换列表）✓ 删除连同项目数据✓ 成员查看/移除✓ 项目挂组织✓ 社区版限 1 组织✓。简化实现：删除为硬删+确认（基线未明示回收语义）；创建管理员须为既有用户（基线未明示邀请语义，邀请注册流在 ENTP-008 范围排除）。超出基线，自主设计：切换器持久化与 personal/orgs 端点（基线前端 switch 组织交互的等价后端形态）。

## 2. 业务逻辑

- **创建**：`POST /system/orgs`（name 1-128 唯一性软校验重名 409、ownerEmail 必须为既有 ACTIVE 用户）→ 事务：Organization(status ACTIVE) + OrgMember(owner) + `initOrgAndProjectPresets`（模板/字段预设，无演示项目）。创建者默认 OWNER 组织角色组。
- **结束/恢复**：PATCH status ENDED→不出现在 personal/orgs 与切换器；项目数据保留、项目成员访问不受影响（结束≠冻结，仅从切换列表隐去——基线语义）；可恢复 ACTIVE。
- **删除**：`DELETE /system/orgs/{id}?needConfirm=true`（缺参数 422 90020）；默认组织（seed 的「管理员组织」/注册自建组织按 id 保护=seed org 不可删）不可删 409；事务按依赖拓扑级联硬删组织下全部项目域数据（复用既有项目删除级联路径逐项目执行）+ OrgMember/Group 清理。
- **成员移除**：owner 或组织内最后一名成员不可移除（422）；移除=删 OrgMember+该项目下成员资格按项目独立判断（org 与 project 成员独立模型）。
- **门控**：POST/PATCH(status·name)/DELETE 经 `assertEntpEnabled("MULTI_ORG")`；GET 列表不门控（社区版管理页只读）。
- **切换器数据流**：personal/orgs 返回 `[{id,name,status}]`（仅 ACTIVE）+ `current`；current 解析序=zustand 持久值 ∈ 列表 → 第一个 ACTIVE；personal/projects 带 orgId 过滤（ENDED 组织项目仅在显式 orgId=该组织时不返回）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-001-multi-org/）

- 画板一（组织管理页 `/system/orgs`）：表格（名称/成员数/项目数/状态 tag/创建时间/操作：编辑·成员·结束/恢复·删除）；「新建组织」按钮（社区版 disabled+锁 Tooltip）；新建弹窗（名称+管理员邮箱选择器-既有用户搜索+描述）；删除二次确认弹窗（红色警示「将删除 N 个项目及其全部数据，输入组织名确认」）。
- 画板二（顶栏切换器）：TopBar 项目切换器左侧新增组织切换器（单组织时隐藏）；下拉=组织列表+「组织管理」入口；切换后项目切换器列表即过滤；/org 菜单组页面随切换联动。
- 空态/二态：社区版（管理页只读+顶部社区版限制提示条）；多组织（切换器出现）；ENDED（状态灰 tag+「恢复」操作）；重名校验红框。

## 4. 技术架构

- 数据模型：零 DDL；级联删除复用项目删除服务（S1 PROJ-001 已有项目域级联）。
- 契约（packages/shared/src/entp/schemas.ts）：`orgCreateSchema`（name/ownerEmail/description?）、`orgUpdateSchema`（name?/description?/status?）、`personalOrgItemSchema`。
- 端点：
  - `GET/POST /api/v1/system/orgs`（ENTP_ORG:READ/CREATE；POST 门控 MULTI_ORG）→ 列表含统计（成员数/项目数）
  - `PATCH/DELETE /api/v1/orgs/{orgId}`（ENTP_ORG:UPDATE/DELETE；均门控）——PATCH 复用于结束/恢复/编辑
  - 组织成员移除沿用既有 `DELETE /api/v1/orgs/{orgId}/members/{userId}`（ORG_MEMBER:UPDATE，owner 保护已有）
  - `GET /api/v1/personal/orgs`（withAuth 本人）
  - `GET /api/v1/personal/projects` 扩展 `?orgId=` 查询参数（向后兼容）
- 服务：`apps/web/src/server/domains/entp/org-admin.service.ts`（CRUD/级联/统计）；`personal.service` 扩展 orgs+projects 过滤。
- 错误码：`ORG_DELETE_CONFIRM_REQUIRED 90020`（422）、`ORG_OWNER_IMMUTABLE 90021`（422，移除 owner/最后成员）、`ORG_DEFAULT_PROTECTED 90022`（409，删默认组织）；重名 `ORG_NAME_EXISTS 90023`（409）。90001/90005 门控。
- 权限点：`ENTP_ORG:READ|CREATE|UPDATE|DELETE`（SYSTEM_ADMIN 全量；rbac §6 预登记语义兑现）。
- 前端：`/system/orgs/page.tsx`；`components/OrgSwitcher.tsx`；stores/org.ts（zustand persist `rabbit-org`）；`hooks/useOrgContext.ts`（current org 解析：切换器→回落项目派生）；/org/* 各页 orgId 取值改造（org-projects/members/groups/templates）。
- 审计：org.create/update/end/restore/delete（SYS-008 口径）。

## 5. 测试用例

- ENTP-001-T1（jmx 四类）：组织 CRUD 主链（建→列含统计→编→结束→恢复）；401/403（无 ETP_ORG 点/无 License 90001）；422（ownerEmail 不存在/needConfirm 缺失 90020/重名 90023）；personal/orgs+projects?orgId= 过滤信封断言。
- ENTP-001-T2（spec 主链路）：加 License→系统组织页新建组织（管理员=第二用户）→ 该用户登录顶栏出现切换器 → 切换 → 项目列表仅剩新组织（空态）→ 新建项目挂该组织（UI+Console+接口）。
- ENTP-001-T3（spec 二态）：社区版（删 License）新建组织按钮 disabled+POST 403 90001；结束组织后切换器消失、projects?orgId 不返回其项目；默认组织删除 409 90022。
- ENTP-001-T4（spec 删除级联）：组织下建项目+用例 → 删除组织（输入名确认）→ 项目/用例/成员全量不可查（API 404）→ 审计含 org.delete。
- 单测（`apps/web/src/server/domains/entp/__tests__/org-admin.test.ts`）：创建事务（org+member+presets）；级联删除拓扑序；ENDED 过滤；owner 保护；重名。

## 6. 竞品深度对标

基线 12.1 全量核对：创建✓ 编辑✓ 成员✓ 结束✓ 删除连带数据✓ 社区版 1 组织✓。差异：①管理员限既有用户（无邀请注册——登记范围排除）；②删除即硬删+输入名确认（基线未明示撤销期；项目级 30 天撤销语义不外溢到组织级，登记 Backlog 软删）；③切换器为前端持久化状态（基线为服务端当前组织——本项目组织仅为数据分组维度，会话不绑组织，架构决策见 test-domain-model §3）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：orgs 五端点+personal/orgs。联调点：useOrgContext 切换链路（/org 页面回归）。验收=§5 全绿+概览主线「组织」段。

## 8. 勘误登记

无。
