# 路由守卫与数据隔离

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | SYS-002 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0 |
| 文档状态 | Approved（P0 起步授权） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | SYS-001（会话）、INFRA-003 |
| 下游消费 | 全部项目级资源端点（CASE-001/API-001/RPT-001）与前端路由 |
| 上游依据 | 架构 rbac-permission-model §4/§5、api-conventions §4 |
| 对标基线 | 功能清单 §九权限体系（P0 仅「已登录+项目隔离」子集；三级用户组 Sprint 1） |
| 高保真确认 | 不适用（行为契约；登录跳转样式见 SYS-001 原型） |

## 1. 概述

### 范围边界
✅：`withAuth()`（未登录 API 401 code10001）；`withProjectScope()`（校验 projectId 存在+未删除+当前用户为其成员，否则 404 code10404/403 无权限位场景 P0 不涉及）；Next middleware 前端路由守卫（未登录 302 `/login?next=`）；跨项目资源访问一律 404。
❌：权限点体系/用户组（Sprint 1 SYS-004）；越权矩阵 E2E 三视角（Sprint 1 起，P0 仅登录态二视角）。

## 2. 业务逻辑

判定链：cookie 解密失败/无 → 401(10001) 或 302；projectId 参数路由 → ProjectMember 存在且 Project 未删 → 放行注入 `ctx={userId, projectId}`；资源实体查询自动带 `projectId` 与 `deletedAt: null`（DRY：scopedQuery helper）。

## 3. UI/UX 设计
未登录访问受保护页：跳登录页并保留 next 回跳；登录页已登录访问 → 跳 `/`。

## 4. 技术架构

- `src/server/guard/with-auth.ts`：包装 Route Handler，注入 session；401 信封
- `src/server/guard/with-project-scope.ts`：项目成员校验 + ctx 注入；404 信封（防枚举）
- `src/middleware.ts`：matcher `(console)` 页面组；302 逻辑
- 前端 `AuthGuard` 客户端组件兜底（菜单加载中=禁用，fail-closed）

## 5. 测试用例
- SYS-002-T1（jmx）：未登录访问 /api/v1/projects/{id}/cases → 401(10001)；登录后访问不存在项目 → 404；登录后访问他人项目（另一账号建）→ 404
- SYS-002-T2（spec）：未登录访问 `/cases` 302 至 /login?next=/cases；登录后回跳

## 6. 竞品深度对标
对齐基线「接口层拦截越权访问」；404/403 区分与 fail-closed 采用 rules/security §3（源自 RabbitProjects 权限竞态教训）。

## 7. 里程碑与验收
验收标准 2 后半（未登录跳转）；支撑验收 7 的「跨域引用静态检查」由 lint import 规则承担。
