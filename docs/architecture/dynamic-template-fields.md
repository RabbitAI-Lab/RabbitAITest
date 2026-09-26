# 模板与动态自定义字段技术方案

| 元信息项 | 内容                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------- |
| 文档层级 | 架构文档（全局约束）                                                                            |
| 状态     | 已确认（Approved）                                                                              |
| 对标基线 | MeterSphere 功能清单 §8.2（模板管理：用例/缺陷模板、自定义字段、缺陷工作流、组织/项目两级模板） |
| 下游消费 | PROJ-002、BUG-001、CASE-003/005、INTG-001/002                                                   |

---

## 1. 模型

```
FieldDef        # 字段定义（可复用）
  ├─ scene: case | bug | api
  ├─ name / key / type / required / default
  ├─ options JSONB（选项、成员范围等）
  └─ level: org | project（组织定义可被项目模板引用）

Template        # 模板
  ├─ scene 同上 / name / is_default / is_system
  ├─ level: org | project（项目模板启用后组织模板失效且不可逆，对齐基线）
  ├─ fields: [ {field_id, required, visible_in_list} ]   # 绑定与覆写
  └─ platform_binding JSONB（对接三方平台时的字段映射：本地字段 ↔ 平台字段 ↔ API 字段名）

WorkflowState / WorkflowTransition   # 仅 bug scene
  ├─ State: start(唯一)/end(可多)/serial；初始态不可删，结束态不计待处理
  └─ Transition: from_state → to_state 允许矩阵（流转规则）
```

实例侧（FunctionalCase / Bug）以 `template_id + fields JSONB` 存值：`{"severity": "P1", "module_owner": "uuid"}`。

## 2. 字段类型枚举（首版 10 类）

`input / textarea / number / date / single_select / multi_select / checkbox / radio / member（项目成员）/ url`

校验器随类型内建（长度/范围/正则可选配置）；类型不可变更，只能停用后新建（避免存量数据语义漂移）。

## 3. 关键规则

| 规则         | 内容                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------- |
| 两级模板     | 组织模板组织内共用；项目启用「项目模板」开关后组织模板对该项目失效且**不可逆**（对齐基线）                     |
| 系统模板     | 每场景预置一套系统默认模板不可删除；缺陷本地模板上限 20（对齐基线）                                            |
| 模板变更传播 | 字段增删不回写存量实例（存量保留旧值，编辑时按新模板校验）；模板删除前校验引用数                               |
| 三方模板     | 对接 Jira/禅道/TAPD 时按平台字段自动生成模板（platform_binding），本地编辑受限（对齐基线「第三方模板不可改」） |
| 工作流联动   | Bug 状态流转受 Transition 矩阵约束；同步场景状态映射见 INTG 规格                                               |

## 4. 查询与索引

- 列表筛选按动态字段：`fields JSONB` 建 GIN 索引；高频筛选字段（severity/status）由规格决定是否提冗余列
- 列表列配置（显示哪些动态字段）为前端用户偏好，不落模板

## 5. API 形态（详见 PROJ-002）

```
GET/POST/PUT/DELETE  /api/v1/orgs/{org}/field-defs?scene=bug
GET/POST/PUT/DELETE  /api/v1/projects/{p}/templates?scene=case
PUT                  /api/v1/projects/{p}/templates/{id}/fields      # 绑定与覆写
GET/PUT              /api/v1/projects/{p}/bug-workflow               # 状态与流转矩阵
```
