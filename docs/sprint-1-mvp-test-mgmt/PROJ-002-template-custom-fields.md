# 模板与动态自定义字段（含缺陷工作流）

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | PROJ-002 |
| 所属迭代 | Sprint 1 — 测试管理 MVP |
| 优先级 | P1 |
| 所属模块 | 项目管理（project 域） |
| 文档状态 | Approved（2026-09-26 评审通过：AI 会话内按需求文档/架构文档一致性自评审；用户终审随 Sprint 验收——沿用 S0 §8.1 目标授权先例） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | PROJ-001（项目设置入口与权限）、dynamic-template-fields.md（模型定稿） |
| 下游消费 | CASE-002/003（用例表单/列表/详情动态字段）、BUG-001（缺陷模板+工作流）、CASE-005（评审字段展示）、Sprint 6 INTG-001（platform_binding） |
| 上游依据 | 需求文档 M2（模板管理）；功能清单 §8.2（模板管理）、§9.2（组织模板） |
| 对标基线 | 功能清单 §8.2：组织/项目两级模板（项目模板启用不可逆）、用例/缺陷自定义字段（多类型）、缺陷模板上限 20、工作流（初始态唯一/结束态可多）、复制/设默认 |
| 关联架构文档 | dynamic-template-fields.md（§1 模型、§2 十类字段、§3 关键规则、§4 索引） |
| 高保真确认 | 待确认（原型已产出 docs/design/PROJ-002-template-custom-fields/，人工确认待 Sprint 验收走查——不可由 AI 代签，见 ai-collaboration §5） |
| 工作量估算 | 后端 4 人日 / 前端 4.5 人日 / 联调 1.5 人日 |

## 1. 概述

### 1.1 功能定位
全系统「动态表单」引擎：字段定义 → 模板绑定（required/visible_in_list 覆写）→ 实例 JSONB 存值。用例与缺陷共用一套机制；缺陷叠加工作流矩阵。

### 1.2 范围边界

| 能力 | P1 ✅ | 后续 |
| --- | --- | --- |
| 字段定义 FieldDef：scene(case/bug)、10 类（input/textarea/number/date/single_select/multi_select/checkbox/radio/member/url）、required/default/options、长度/正则校验、启停（类型不可改） | ✅ | 组织级字段跨项目引用计数视图 |
| 模板 Template：两级（org/project）、scene、绑定字段+覆写、设默认、复制；系统默认模板预置不可删 | ✅ | 接口模板（api scene，Sprint 2 评估） |
| 项目模板开关：启用后组织模板对本项目失效且不可逆（确认弹窗双确认） | ✅ | — |
| 缺陷工作流：状态 CRUD（start 唯一/end 可多/serial）、流转矩阵、默认「待处理→处理中→已关闭」预置 | ✅ | 状态变更触发器（INTG 同步联动） |
| 缺陷模板上限 20；模板删除前引用计数校验 | ✅ | — |
| 动态字段渲染组件：表单控件 ×10 类型、列表单元格、详情只读 | ✅ | — |
| platform_binding（三方字段映射） | ❌ | INTG-001/002（随对接生成） |

### 1.3 前置依赖
PROJ-001 项目设置路由；字段引擎 zod 动态校验器为 B/C 线表单的公共依赖（第 8 天前冻结）。

### 1.4 对标基线核对
完全复刻：两级不可逆、10 类字段对齐基线「输入框/文本/单选/多选/复选/成员等」超集、上限 20、工作流初始/结束态语义、复制/设默认。简化实现：基线字段类型含「日期」等全部覆盖；基线组织模板的跨项目同步细节以 level+引用实现。

## 2. 业务逻辑

- 模板变更传播：字段增删不回写存量实例（编辑时按新模板校验，缺失字段提示补填）；删除字段若有存量值 → 保留数据仅表单不再展示（软停用优先）。
- 工作流约束：初始态不可删；结束态不计「待处理」统计；流转矩阵按 from→to 白名单，非法流转 422（code 10006 WORKFLOW_DENIED）。
- 默认模板：每 scene 恰一（切换即取消前默认）；新建用例/缺陷默认带入。
- 项目模板启用校验：项目内已有实例引用组织模板时，弹窗列明「将按字段交集继续有效」，确认后组织模板对本项目不可见。

## 3. UI/UX 设计（高保真 docs/design/PROJ-002-template-custom-fields/）

- 组织 › 模板管理 / 项目 › 设置 › 模板管理（同一组件 level 参数）：Tab=字段/模板/工作流（bug scene 才显示工作流 Tab）。
- 字段 Tab：表格（名称/标识 key/类型/场景/必填/状态），新建抽屉含类型选择器（10 类型图标）与类型化选项区（select 选项编辑、member 范围、正则）。
- 模板 Tab：列表 + 详情抽屉（字段绑定表格：拖拽排序/必填覆写/列表显示覆写）；「设默认」「复制」行操作。
- 工作流 Tab：左状态列表（start/end 徽标、串号），右矩阵表格（行=from 列=to，勾选=允许），非法勾选（涉及已删状态）即时禁用。
- 不可逆开关：红色警示 Modal + 输入项目名确认。

## 4. 技术架构

- 数据模型（已建齐，无新列）：FieldDef / Template / WorkflowState / WorkflowTransition（见 dynamic-template-fields §1）。
- 端点：`GET/POST/PUT/DELETE /api/v1/orgs/{org}/field-defs?scene=`、`GET/POST/PUT/DELETE /api/v1/projects/{pid}/templates`、`PUT /api/v1/projects/{pid}/templates/{id}/fields`、`POST .../templates/{id}/default|copy`、`POST /api/v1/projects/{pid}/template-mode/enable`、`GET/POST/PUT/DELETE /api/v1/projects/{pid}/workflows/{stateId}` + `PUT .../workflows/transitions`。
- 字段引擎：`packages/shared/fields/` —— fieldTypeSchema（判别联合）+ `buildValidator(fieldDefs)` 动态产出 zod schema（供 case/bug service 复用）+ `renderKind` 元数据（前端控件映射）。
- 索引：FunctionalCase/Bug 的 fields JSONB GIN（迁移补建，属「索引」允许项）。
- 权限点：ORG_TEMPLATE:READ|UPDATE、PROJECT_TEMPLATE:READ|UPDATE（随本规格入库）。
- 前端：`<DynamicFieldForm scene template/>`、`<DynamicFieldCell/>` 公共组件（packages/ui）。

## 5. 测试用例
- PROJ-002-T1（jmx 四类）：字段/模板/工作流 CRUD；401/403（非管理员）；key 重复 422、缺陷模板第 21 个 422；分页信封。
- PROJ-002-T2（spec）：组织建「严重程度」单选字段→绑定用例模板必填→用例表单出现必填标记、缺省提交被拦（UI+接口 422）→列表按该字段筛选生效。
- PROJ-002-T3（spec）：工作流加「挂起」态与矩阵→BUG 详情选择未允许的目标状态被拒（接口 422 code 10006，UI 红提示）。
- 单测：buildValidator 10 类型×（必填/默认/长度/正则/选项）矩阵；模板传播（存量不回写）。

## 6. 竞品深度对标
基线 §8.2 全项对齐（见 §1.4）。差异化：基线字段校验散在前端，本项目 buildValidator 服务端单一来源（zod），前端同源消费——与门禁 4 契约纪律一致。三方模板 platform_binding 结构已建模、能力随 INTG 开启（对齐基线「第三方模板不可改」的延后路径）。

## 7. 里程碑与验收
DoD 前置：高保真人工确认。验收对应 sprint-overview 验收 2/3；字段引擎第 8 天冻结联调。
