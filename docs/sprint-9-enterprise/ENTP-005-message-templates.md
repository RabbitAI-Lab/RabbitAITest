# 自定义消息模板（事件模板 · 变量插入 · dispatch 渲染挂钩）

| 字段         | 内容                                                                                                                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | ENTP-005                                                                                                                                                                       |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                          |
| 优先级       | P3（迭代内 P1）                                                                                                                                                                |
| 所属模块     | message 域（模板 CRUD+渲染挂钩）；消费 MSG-001 dispatch 管线；engine/mock 不感知                                                                                               |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                   |
| 最后更新日期 | 2026-09-28                                                                                                                                                                     |
| 上游依赖     | MSG-001（dispatch/事件目录 11 键/固定文案挂点 5 处）、ENTP-007（MSG_TEMPLATE 特性门控）、SYS-005（邮件投递复用）                                                               |
| 下游消费     | —（通知内容全渠道经模板渲染）                                                                                                                                                  |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 消息通知-【企业版】自定义消息模板、§十二 12.5                                                                                                   |
| 对标基线     | 功能清单 12.5：前置=消息管理已开启通知渠道；在消息设置中自定义模板：消息脚本展示内容与变量，字段分用例字段/自定义字段等，点击插入标题/内容；支持更新模板、实时预览、保存后预览 |
| 关联架构文档 | test-domain-model.md §6（message_templates 例外登记）；rbac-permission-model.md §6（MSG_TEMPLATE）                                                                             |
| 高保真确认   | 待确认（原型 docs/design/ENTP-005-message-templates/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                             |
| 工作量估算   | 后端 1.5 人日 / 前端 1.5 人日 / 联调 1 人日                                                                                                                                    |

## 1. 概述

### 1.1 功能定位

项目消息管理新增「模板」Tab：11 事件逐一定制标题/正文（`${var}` 变量插入、实时预览、恢复默认）；dispatch 分发前按事件读模板渲染（无模板回退 MSG-001 固定默认文案），渲染结果进全部渠道（站内信/邮件/三方机器人同一内容）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                                         | P1 ✅ | 后续                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------- |
| MessageTemplate 表：项目×事件唯一（11 键），title 1-128/content 1-1024                                                                                                                       | ✅    | 多语言/渠道差异化模板 Backlog（全渠道同渲染）                                                         |
| 变量目录 `TEMPLATE_VARS[event]`：公共（project/actorName/time）+ 对象变量（bug：title/status/severity/assignee…；plan：name/result…；scenario：name/result/duration…；schedule：name/cron…） | ✅    | 用例自定义字段入变量（基线「字段分用例字段/自定义字段」的自定义字段半边——依赖字段服务，登记 Backlog） |
| 变量插入 UI：编辑器上方变量 chip 点击插入光标处（标题/内容分别可插）                                                                                                                         | ✅    | 富文本模板 Backlog（纯文本+换行）                                                                     |
| 实时预览：服务端渲染（示例数据填充）`POST .../preview`；保存后预览=再点预览                                                                                                                  | ✅    | —                                                                                                     |
| CRUD：PUT upsert（项目×事件）/DELETE 恢复默认（幂等）；GET 列表（含未定制事件=「默认」标记）                                                                                                 | ✅    | 模板启用开关（单事件停用=回默认，等价删除）不做独立开关                                               |
| dispatch 挂钩：`dispatch({event, vars})`——模板存在→渲染 title/content；否则回退默认组装（MSG-001 文案不变）；挂点 5 处改传 vars                                                              | ✅    | —                                                                                                     |
| 渠道一致性：同一渲染结果投站内信/邮件/机器人（基线语义一致）                                                                                                                                 | ✅    | 机器人平台文案裁剪（超长截断由平台侧，不做模板侧差异）                                                |
| 门控：模板写端点+Tab 经 MSG_TEMPLATE 特性；dispatch 读模板不门控（已有模板+License 过期→回退默认，不报错）                                                                                   | ✅    | License 过期保留模板数据（不删）                                                                      |

### 1.3 前置依赖

- `message_templates` 新表（门禁 3 例外登记：变量目录形状依赖本规格定型）
- MSG-001 五挂点（bug/caseDetail 评论/exec/schedule/robot test）现以硬编码 title/content 调 dispatch——本规格改造为传 vars
- AppSetting 不复用（模板为结构化行非 Json 键值，便于唯一约束与审计）

### 1.4 对标基线核对

完全复刻：消息设置内自定义模板✓ 变量展示与点击插入✓ 更新模板/实时预览/保存后预览✓ 前置=通知渠道已开✓。简化实现：变量目录=事件相关核心字段（基线「用例字段/自定义字段」中的系统字段半边；自定义字段 Backlog）；纯文本模板（基线消息脚本为富文本语义不明，登记）。

## 2. 业务逻辑

- **渲染**：`${var}` 全量替换（未知变量保留原样——容错不报错）；title/content 均渲染；渲染在 dispatch 入口统一做（挂点不再自行拼文案）。
- **默认回退**：无模板行或 License 失效→`defaultCompose(event, vars)`（MSG-001 既有文案函数化，行为与 S5 完全一致——零回归基线）。
- **vars 契约**：挂点传 `{project, actorName, time, ...对象字段}`；缺失字段（如评论无 assignee）=不插值（未知变量规则）。
- **preview**：`POST preview {event, title, content}` → 服务端以固定示例 vars 渲染返回 `{title, content}`（不落库）。
- **审计**：template.upsert/template.reset（event 维度）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-005-message-templates/）

- 画板（模板 Tab）：左事件列表（11 事件分组 5 大类+「默认/已定制」标记）；右编辑区（标题输入+内容 textarea+变量 chip 区（公共/对象两组）+「实时预览」按钮→预览抽屉渲染效果+「保存」「恢复默认」）。
- 空态/二态：全默认（列表全「默认」标记+引导）；已定制（标记+编辑态回填）；社区版（Tab 禁用+锁条「自定义消息模板为企业版能力」——MSG-001 既有 banner 升级）；校验红框（超长 128/1024）。

## 4. 技术架构

- 数据模型：`message_templates`（id/projectId/event VarChar(48)/title VarChar(128)/content VarChar(1024)/createdAt/updatedAt；@@unique([projectId,event])）。例外登记 test-domain-model §6。
- 契约（packages/shared/src/message/schemas.ts 扩展）：`messageTemplateUpsertSchema`（event∈MESSAGE_EVENTS/title/content）、`templateVarItemSchema`；`TEMPLATE_VARS` 常量（事件→变量名+中文描述，前端插入 UI 与服务端校验同源）。
- 端点（项目域，复用 PROJECT_MESSAGE 权限）：
  - `GET /api/v1/projects/{projectId}/message-templates`（READ）→ 11 事件全量（未定制=默认标记）
  - `PUT /api/v1/projects/{projectId}/message-templates`（UPDATE，门控 MSG_TEMPLATE）→ upsert 单事件
  - `DELETE /api/v1/projects/{projectId}/message-templates/{event}`（UPDATE，门控）→ 恢复默认
  - `POST /api/v1/projects/{projectId}/message-templates/preview`（READ）→ 示例渲染
- 服务：`template.service.ts`（CRUD/渲染/默认组装）；`notify.service.dispatch` 签名扩展 `vars?`（title/content 可选二选一传入——传 vars 时走模板/默认组装）；五挂点改造传 vars。
- 错误码：`TEMPLATE_EVENT_INVALID 90050`（422 路径 event 非法）。
- 前端：settings/messages/page.tsx 第三 Tab「模板」（license 态禁用）；api-client s9。

## 5. 测试用例

- ENTP-005-T1（jmx 四类）：模板 CRUD 主链（PUT 定制→GET 标记已定制→preview 渲染→DELETE 恢复）；401/403（无点/无 License 90001）；422（event 非法 90050/超长）；列表信封（11 行全量）。
- ENTP-005-T2（spec 渲染主链路）：定制 BUG_CREATED 标题 `[${project}] ${actorName} 提交了缺陷 ${title}` → 开事件通知（接收人=另一成员）→ 建缺陷 → 该成员站内信标题按模板渲染+mock 机器人收包同文（UI+Console+接口）。
- ENTP-005-T3（spec 二态）：未定制事件=默认文案（回归 S5 形态断言）；社区版 Tab 禁用+PUT 403；License 过期后已有模板→dispatch 回退默认（单测覆盖，e2e 免——过期态构造重）。
- 单测（`apps/web/src/server/domains/message/__tests__/s9-template.test.ts`）：11 事件变量目录完备性；渲染矩阵（全插/部分缺/未知变量保留/转义）；默认回退= S5 文案逐字对齐；upsert 幂等/唯一冲突路径。

## 6. 竞品深度对标

基线 12.5 核对：消息设置内模板✓ 变量展示插入✓ 更新/实时预览/保存后预览✓。差异：①变量=系统字段目录（自定义字段 Backlog）；②纯文本；③全渠道同渲染（基线未明示渠道差异，取一致语义）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：templates 四端点+TEMPLATE_VARS。联调点：dispatch 改造回归（MSG-001 既有 e2e 必须全绿）。验收=§5 全绿+概览主线「模板」段。

## 8. 勘误登记

无。
