# 默认组织/项目初始化与项目切换

| 元信息项     | 内容                                                                |
| ------------ | ------------------------------------------------------------------- |
| 文档编号     | SYS-003                                                             |
| 所属迭代     | Sprint 0 — POC                                                      |
| 优先级       | P0                                                                  |
| 文档状态     | Verified（用户验收通过 2026-09-26）                                 |
| 最后更新日期 | 2026-09-26                                                          |
| 上游依赖     | SYS-001、INFRA-003                                                  |
| 下游消费     | CASE-001/API-001（一切项目内功能的容器）、DASH（Sprint 1）          |
| 上游依据     | 需求文档 M1/M2；功能清单 §九.1（组织与项目）、§二（左上角项目切换） |
| 对标基线     | 功能清单 §二「切换项目：左上角下拉」；开源版单组织（对齐）          |
| 高保真确认   | 待确认（docs/design/SYS-003-org-project-init/）                     |

## 1. 概述

### 范围边界

✅：注册事务内创建默认组织（名=用户名+的组织）+默认项目（`演示项目`，num=1）+ProjectMember(owner)；种子模块树根节点（scene=case，名=未规划用例）与 ModuleNode(scene=api)；顶栏项目切换下拉（列出我参与的项目）；`GET /api/v1/personal/projects`。
❌：多项目创建/管理页（Sprint 1 PROJ-001）；组织管理；组织切换（单组织）。

## 2. 业务逻辑

初始化（与注册同事务）：Organization(name, owner) → Project(orgId, name=演示项目, num=1) → ProjectMember(role=OWNER) → ModuleNode ×2（case/api 两 scene 的默认根）。切换项目：下拉选中 → 前端 store 更新 currentProjectId（persist）→ 业务页数据按项目重取。

## 3. UI/UX 设计（高保真 docs/design/SYS-003-org-project-init/index.html）

顶栏左侧项目下拉（项目名+编号徽标），下拉面板列项目（名称/角色/成员数占位）；选中即切换并刷新当前页数据；空态（无项目）显示引导卡。

## 4. 技术架构

- `POST /api/v1/auth/register` 内 service 调用（非独立端点）
- `GET /api/v1/personal/projects` → `[{id, name, num, role}]`
- 前端：Zustand `useProjectStore`（currentProjectId + list），顶栏 `ProjectSwitcher` 组件（AntD Dropdown）

## 5. 测试用例

- SYS-003-T1（jmx）：注册响应含 projectId；/personal/projects 返回 1 项且 role=OWNER
- SYS-003-T2（spec）：注册后顶栏显示「演示项目」；下拉展开可见项目卡片（UI 断言）；切换项目触发列表接口重取（接口断言 Query 带 projectId）

## 6. 竞品深度对标

完全复刻基线 §二交互（左上角切换、资源按项目隔离）；「注册即建组织」为基线简化（基线由管理员建）。

## 7. 里程碑与验收

验收标准 2「默认项目可见」；为 CASE/API 提供容器。
