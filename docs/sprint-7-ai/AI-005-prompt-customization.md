# 提示词自定义（项目级模板 · 占位符 · 默认语义）

| 元信息项     | 内容                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| 文档编号     | AI-005                                                                                          |
| 所属迭代     | Sprint 7 — AI 能力                                                                              |
| 优先级       | P2（AI-002/003 的定制面）                                                                       |
| 所属模块     | ai 域（项目级）                                                                                 |
| 文档状态     | Implemented（2026-09-27 交付）                                                                  |
| 最后更新日期 | 2026-09-27                                                                                      |
| 上游依赖     | AI-001（网关）、AI-002/AI-003（消费方）                                                         |
| 下游消费     | 无硬下游                                                                                        |
| 上游依据     | 需求文档 §六；功能清单 §十「可自定义提示词/用例模板与设计方法（后端含『用户 AI 提示词』接口）」 |
| 对标基线     | 功能清单 §十；MeterSphere 「用户 AI 提示词」接口（本项目落位项目级，差异见 §6）                 |
| 关联架构文档 | test-domain-model.md §2.8（AiPromptTemplate）；api-conventions.md §3                            |
| 高保真确认   | 待确认（原型 docs/design/AI-005-prompt-customization/）                                         |
| 工作量估算   | 后端 1.5 人日 / 前端 1.5 人日                                                                   |

## 1. 概述

### 1.1 功能定位

项目级提示词模板管理：scene 两类（case_gen 功能用例/api_gen 接口用例）；模板正文含 `{{requirement}}/{{module}}/{{design_method}}`（api_gen 为 `{{api_spec}}/{{design_method}}`）占位符；设计方法字段（等价类/边界值/场景法…）；同 scene 默认模板唯一，生成抽屉默认预选。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                     | P1 ✅ | 后续                            |
| ---------------------------------------------------------------------------------------- | ----- | ------------------------------- |
| 模板 CRUD：name（项目内唯一）/scene/template（1-8000 字）/designMethod/isDefault/enabled | ✅    | 系统级模板与继承覆盖（Backlog） |
| 占位符：定义域校验（未知占位符 422 提示合法集）；渲染时缺失变量回退空串                  | ✅    | 变量默认值语法（Backlog）       |
| 默认语义：同 scene 设默认=清旧置新（事务）；停用模板不可为默认                           | ✅    | —                               |
| 内置默认：shared 常量两份（case_gen/api_gen）——无项目模板时的回退，不可删不可改          | ✅    | —                               |
| 生成侧联动：AI-002/003 抽屉模板下拉（★默认/内置默认项/停用不列）                         | ✅    | 模板版本 diff（Backlog）        |
| 设计方法：自由文本（建议 chips 快捷填入等价类/边界值/场景法/判定表/错误推测）            | ✅    | 结构化设计方法枚举（Backlog）   |

### 1.3 前置依赖

AiPromptTemplate 表（S7 建）；AI-002/003 生成链路（本规格为其定制面，同 Sprint 联调）。

### 1.4 对标基线核对

覆盖基线「可自定义提示词/用例模板与设计方法」。落位差异：基线为**用户级**（个人提示词），本项目落**项目级**（团队共享一致口径——测试资产属项目，个人级待 SYS-007 个人中心后随 AI-001 个人模型一并评估，登记）。

## 2. 业务逻辑

- **占位符定义域**：case_gen 合法集 `{requirement,module,design_method}`；api_gen `{api_spec,design_method}`；保存时扫描 `{{...}}` 未知名→422（提示合法集）。
- **渲染**：`renderTemplate(template, vars)` 纯函数——逐占位符替换，缺失变量替换为空串（生成侧保证 requirement/api_spec 恒有值）。
- **默认事务**：设默认在同一事务清同 scene 旧默认；enabled=false 的模板设默认→422。
- **消费**：生成抽屉模板下拉=项目模板（enabled）+「内置默认」伪项（templateId 空→shared 常量）；默认预选=isDefault 模板或内置。
- **边界**：名称重复（项目内）→409（复用 VERSION_CONFLICT 分段？——新码 `AI_PROMPT_DUP 70504`，422）；删除默认模板→连带清默认（生成侧回退内置）。

## 3. UI/UX 设计（高保真 docs/design/AI-005-prompt-customization/）

- 项目设置→「AI 提示词」页（`/settings/ai-prompts`）：scene Tab（功能用例/接口用例）+表格（名称/设计方法 chips/默认★/启用/更新时间/操作：编辑·设默认·删除）+「新建模板」。
- 编辑抽屉：名称/scene（新建可选，编辑锁定）/模板正文 textarea（等宽字体，占位符高亮提示条：合法占位符 chips 可点击插入）/设计方法（输入+建议 chips）/启用/设默认开关。
- 顶部说明条：占位符语义表（变量名/含义/示例）。

## 4. 技术架构

- 数据模型：AiPromptTemplate（`@@unique([projectId,name])`；随 S7 建表）。
- 契约：`aiPromptSaveSchema`（name 1-64/template 1-8000/scene enum/designMethod?≤128/isDefault/enabled）、`renderTemplate`/`PROMPT_PLACEHOLDERS`（shared 纯函数+常量，单测主力）。
- 端点：`GET/POST /api/v1/projects/{pid}/ai/prompt-templates`、`PUT/DELETE .../{id}`（PROJECT_AI:READ/CREATE/UPDATE/DELETE；与模型管理权限分段——项目模板=项目权限）。
- 错误码：`AI_PROMPT_NOT_FOUND 70424`、`AI_PROMPT_DUP 70504`、`AI_PROMPT_PLACEHOLDER_INVALID 70505`（422）。
- 前端：`AiPromptsPage.tsx`（settings 挂载新 tab）。

## 5. 测试用例

- AI-005-T1（jmx 四类）：模板 CRUD/设默认；401/403（PROJECT_MEMBER 仅 READ）/404（坏 id 70424）；422（未知占位符 70505/名称重复 70504/停用设默认）；列表信封。
- AI-005-T2（spec 模板二态）：新建模板（含合法占位符）→列表可见→设默认★→生成抽屉（AI-002）默认选中该模板→生成 payload 断言 templateId；停用→生成抽屉不列。
- 单测：renderTemplate 矩阵（全占位/缺失回退空串/未扫描文本原样/重复占位符全替换）、占位符定义域扫描（合法/未知/嵌套花括号）、默认事务（清旧置新原子）、删除默认回退。

## 6. 竞品深度对标

基线能力覆盖（提示词/设计方法自定义+生成联动）。差异：①项目级 vs 基线用户级（登记评估）；②无模板版本管理；③设计方法自由文本。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例）。联调点：AI-002/003 抽屉下拉数据源与默认预选。

## 8. 勘误登记

**勘误 1（2026-09-27，错误码段）**：60xxx → 70xxx（60xxx 已被报告域占用，envelope.ts 分段顺延）。
