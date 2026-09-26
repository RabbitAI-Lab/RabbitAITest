# 用户与三级用户组管理

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | SYS-004 |
| 所属迭代 | Sprint 1 — 测试管理 MVP |
| 优先级 | P1 |
| 所属模块 | 系统设置（system 域） |
| 文档状态 | Draft（待评审） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | SYS-001/002（认证与守卫）、rbac-permission-model（权限点单一来源） |
| 下游消费 | PROJ-001（项目成员/组复用本组件）、全部业务模块（withPermission 生效） |
| 上游依据 | 需求文档 M1（三级管理体系、用户、用户组）；功能清单 §9.1（用户管理/用户组管理）、§9.2（组织级） |
| 对标基线 | 功能清单 §9.1/9.2：用户创建/编辑/重置密码/禁用/删除；预置 6 组只读 + 三级自定义组菜单权限勾选；恢复默认/重命名/删除 |
| 关联架构文档 | rbac-permission-model.md（§2 预置组、§3 权限点、§4 检查链） |
| 高保真确认 | 待确认（docs/design/SYS-004-user-group-management/，原型待产出） |
| 工作量估算 | 后端 3 人日 / 前端 4 人日 / 联调 1 人日 |

## 1. 概述

### 1.1 功能定位
把 Sprint 0 的「全员读写」升级为真实权限体系：系统管理员管理用户；系统/组织/项目三级各自可建自定义用户组并勾选权限点；`withPermission()` 检查链全量生效（权限并集、禁用交集）。

### 1.2 范围边界

| 能力 | P1 ✅ | 后续 |
| --- | --- | --- |
| 用户：创建（邮箱+姓名+初始密码）、编辑（姓名/手机）、重置密码、启用/禁用、软删除、列表（搜索/分页） | ✅ | 邮箱邀请注册、Excel 批量导入（Sprint 5+，依赖 SMTP/批量基建） |
| 三级自定义用户组 CRUD：名称、描述、勾选权限点（树形菜单）、组成员添加/移除/批量 | ✅ | — |
| 预置组（系统/组织管理员与成员、项目管理员/成员）只读展示；自定义组恢复默认/重命名/删除 | ✅ | — |
| 权限点清单登录下发（菜单守卫 + 按钮指令） | ✅ | v-permission 指令抽象（随前端组件化沉淀） |
| 社区版 30 用户上限 | ✅ 代码硬校验 | 用户扩容=ENTP-008 |

### 1.3 前置依赖
- `packages/shared/permissions.ts` 权限点常量入库（rbac 文档 §3 全集），本规格是首个消费者，随评审入库。

### 1.4 对标基线核对
完全复刻：预置组只读、三级自定义组、权限点勾选、恢复默认。简化实现：权限点勾选为「资源:动作」平铺树（基线为前端菜单树勾选），语义等价。超出基线：无。

## 2. 业务逻辑

- 组删除：校验组内成员数=0，否则 422（提示先移出成员）；预置组与含成员的默认组不可删。
- 用户删除：软删（deletedAt）→ 登录失效、成员关系保留痕迹；邮箱唯一校验含软删用户（复用邮箱需先彻底清理，与基线口径一致：删除用户不清理业务数据）。
- 禁用用户：立即失效 Session（登出该用户全部会话）；禁用取交集——用户所在任一组将该资源置禁用即整体禁用（rbac §1）。
- 权限判定：`permissions = ∪(成员各组权限点) −(任一组的 deny 位)`；本迭代 deny 仅作用于组级禁用资源清单（JSONB `disabled` 数组）。

## 3. UI/UX 设计（高保真 docs/design/SYS-004-user-group-management/）

- 系统设置 › 用户管理：表格（邮箱/姓名/手机/状态/创建时间/操作），新建抽屉（邮箱+姓名+初始密码生成）、重置密码 Modal（展示一次性新密码）、禁用 Switch + 确认。
- 系统设置 › 用户组管理：左右布局——左组列表（预置组带锁标、自定义组可增删）；右侧组详情（成员表格 + 权限点勾选树，按 `{SCOPE}_{RESOURCE}` 分组、动作复选）。
- 组织 › 用户组、项目 › 用户设置复用同一组件（scope 参数区分）。
- 空态/权限态：无 SYSTEM_USER:READ 时菜单不出现；有读无写时按钮隐藏。

## 4. 技术架构

- 数据模型（已建齐，无新列）：User / Group(scope, permissions JSONB, disabled JSONB) / GroupMember(group, user, scope_id)。
- 端点：`GET/POST /api/v1/system/users`、`PUT/DELETE /api/v1/system/users/{id}`、`POST /api/v1/system/users/{id}/reset-password`、`POST /api/v1/system/users/{id}/status`；`GET/POST /api/v1/{system|orgs/{org}|projects/{pid}}/groups`、`PUT/DELETE .../groups/{id}`、`POST .../groups/{id}/members`、`DELETE .../groups/{id}/members/{userId}`、`POST .../groups/{id}/restore-default`。
- zod：userCreateSchema / groupUpsertSchema / permissionPointSchema（枚举校验，防私造权限点）。
- 权限点：SYSTEM_USER:READ|CREATE|UPDATE|DELETE；组管理按 scope 使用 SYSTEM_GROUP:* / ORG_GROUP:* / PROJECT_GROUP:*（随本规格入库）。
- 前端：设置页路由组 `/system/*`（菜单守卫），组组件 `<GroupManager scope/>>`；Session 附带 permissions 数组下发。

## 5. 测试用例
- SYS-004-T1（jmx 四类）：用户 CRUD 全码断言；未登录 401；非系统管理员 403（10003）；邮箱重复 422；组分页信封。
- SYS-004-T2（spec）：建自定义组仅勾 PROJECT_CASE:READ → 该组成员登录 → 用例列表可见 + 新建按钮隐藏 + 直发 POST 403（UI+接口+Console 三类断言）。
- SYS-004-T3：预置组 PUT 返回 403/422（只读）；删除非空组 422；禁用用户后原 Session 请求 401。
- 单测：权限并集/禁用交集矩阵（≥12 组合）契约测试先行。

## 6. 竞品深度对标
基线 §9.1：预置 6 组完全对齐；权限勾选树=平铺资源树（语义等价，降低菜单耦合）；30 用户硬上限对齐（代码校验）。基线「批量添加至项目/用户组」本迭代以组成员批量添加覆盖单维，跨维批量登记后续增强。

## 7. 里程碑与验收
DoD 前置：高保真人工确认。验收对应 sprint-overview 验收 1。演示：建受限组→受控行为→恢复默认。
