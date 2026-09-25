# 功能用例 CRUD 与回收站

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | CASE-001 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0 |
| 文档状态 | Implemented（Sprint 0 交付，验收自查见 sprint-overview §7） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | SYS-002/003、INFRA-003 |
| 下游消费 | Sprint 1 CASE-002~005 全系列、PLAN-001 |
| 上游依据 | 需求文档 M3；功能清单 §四.1（P0 子集） |
| 对标基线 | 功能清单 §四.1：创建（名称/前置/步骤/等级/标签/附件）、回收站恢复/彻底删除、列表。P0 简化：无富文本（纯文本）、无附件、无模块树导航（默认根模块）、无自定义字段 |
| 高保真确认 | 待确认（docs/design/CASE-001-case-crud/） |

## 1. 概述

### 1.2 范围边界

| 能力 | P0 ✅ | 后续 |
| --- | --- | --- |
| 创建/编辑（名称必填 ≤512、前置条件、步骤列表[{步骤,预期}]、等级 P0-P3、标签[]） | ✅ | 富文本/附件/模板字段（Sprint 1） |
| 列表（分页信封、名称/等级筛选、按 num 排序、行内等级标签） | ✅ | 模块树/全字段筛选/自定义视图（CASE-002/011） |
| 详情页（查看+编辑同页，Ctrl+S 保存） | ✅ | 9 Tab 关联体系（CASE-003） |
| 软删除 → 回收站（`?recycled=true`）→ 恢复 / 彻底删除 | ✅ | — |
| 变更历史（白名单字段 diff） | ✅ 只落库 | UI 时间线（CASE-008） |
| 乐观锁 version→409 | ✅ | — |

## 2. 业务逻辑

创建：module=默认根 → nextNum(cases) → Insert → ChangeLog(seq=1, action=create)。
编辑：version 校验 → 更新白名单字段 → ChangeLog(diff)。
删除：软删（deletedAt）；列表默认排除；恢复置空；彻底删除物理删（级联横切表 Cascade）。

## 3. UI/UX 设计（高保真 docs/design/CASE-001-case-crud/：list.html + form.html）

- 列表页 `/cases`：顶部「新建用例」主按钮；表格列=编号/名称/等级(色点)/标签/更新时间/操作(编辑·删除)；筛选条（名称关键字、等级下拉）；分页器；「回收站」入口（tab 或按钮切换 ?recycled=true，行操作变恢复/彻底删除+确认）
- 表单页 `/cases/new` `/cases/{id}`：名称必填、前置条件多行、步骤动态行（步骤+预期，可增删排序）、等级单选、标签输入（AntD Select tags）；保存成功 toast+跳列表或留页；删除需 Modal 确认
- 空态：无用例时引导插画+新建按钮；回收站空态文案区分

## 4. 技术架构

- 端点：`GET/POST /api/v1/projects/{pid}/cases`、`GET/PUT/DELETE /api/v1/projects/{pid}/cases/{id}`、`POST .../cases/{id}/restore`、`DELETE .../cases/{id}?purge=true`
- zod：`caseCreateSchema/caseUpdateSchema/caseListQuerySchema`（packages/shared/case）
- 前端：列表 TanStack Query `['case','list',filters]`；表单受控+dirty 提示；api-client 方法 `cases.list/create/update/remove/restore/purge`
- 权限：withProjectScope（P0 全员读写）

## 5. 测试用例
- CASE-001-T1（jmx 四类）：正常 CRUD 全码断言（code0、`$.data.num`、列表信封 total）；未登录 401；他项目 404；名称缺失 422(10xxx 段 code)
- CASE-001-T2（spec 主链路）：新建（含 3 步骤）→列表可见行（UI）；recycle→回收站可见→恢复回列表（UI+接口断言 DELETE/restore 状态码与响应）；全页 console 零错误；purge 二次确认弹窗断言
- CASE-001-T3：并发编辑 version 冲突 → 409 提示刷新

## 6. 竞品深度对标
基线 §四.1 完整对标表：创建字段=完全复刻子集；回收站=完全复刻；简化项（富文本/附件/脑图/导入导出）均已登记去向。编号展示 P0 用 num 列（前缀展示 Sprint 1）。

## 7. 里程碑与验收
验收标准 3（创建→列表→回收站→恢复）全链路。
