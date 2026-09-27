# AI 智能助手（顶部对话入口 · 会话管理 · 流式输出）

| 元信息项     | 内容                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 文档编号     | AI-004                                                                                                      |
| 所属迭代     | Sprint 7 — AI 能力                                                                                          |
| 优先级       | P2（v3.x 重点新增的门面能力）                                                                               |
| 所属模块     | ai 域（个人级会话，无项目维度）                                                                              |
| 文档状态     | Implemented（2026-09-27 交付）                                                                              |
| 最后更新日期 | 2026-09-27                                                                                                  |
| 上游依赖     | AI-001（模型网关/ChatClient/SSE 流式）、SYS-002（认证）                                                      |
| 下游消费     | 无硬下游（S5 MSG 通知不关联）                                                                                |
| 上游依据     | 需求文档 §六；功能清单 §十「AI 智能助手：顶部导航对话入口，辅助用例生成、故障排查、文档解读；会话管理」       |
| 对标基线     | 功能清单 §十；§9 services/system-setting「AI 对话」                                                         |
| 关联架构文档 | test-domain-model.md §2.8（AiConversation/AiMessage）；tech-stack（SSE Route Handler 流式）                  |
| 高保真确认   | 待确认（原型 docs/design/AI-004-ai-assistant/）                                                              |
| 工作量估算   | 后端 2 人日 / 前端 2 人日                                                                                    |

## 1. 概述

### 1.1 功能定位

顶栏全局入口（不依赖项目上下文）→ 右侧滑出对话面板：个人会话列表 + 消息流 + **SSE 流式打字机输出**；会话可新建/重命名/删除（软删）；模型可选（启用模型，默认 isDefault）。system prompt 注入平台身份与测试领域上下文（纯对话，不查库不执行动作）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                          | P1 ✅ | 后续                                                   |
| ----------------------------------------------------------------------------- | ----- | ------------------------------------------------------ |
| 顶栏入口：任意控制台页面可见（登录态），图标+未读不计                          | ✅     | 消息通知角标（S5 MSG 联动）                             |
| 会话管理：列表（按 updatedAt 倒序，标题=首条用户消息前 20 字）/新建/重命名/删除（软删 30 天清理任务复用） | ✅ | 会话搜索/置顶（Backlog）                          |
| 消息流：用户/助手气泡；markdown 基础渲染（代码块复制）；历史分页（50 条/页，倒序取） | ✅ | 图片/附件输入（Backlog）                          |
| 流式对话：POST SSE（`delta`/`done`/`error` 帧）；打字机效果；中断=停止生成（AbortController） | ✅ | 中断后续传（一次性流，登记）                      |
| 上下文窗口：最近 20 条消息进 prompt（超出截断，标注不计 token）                 | ✅     | Token 计量与自动压缩（Backlog）                         |
| 模型选择：面板内下拉（启用模型，默认 isDefault），按会话记忆（会话列 modelId）  | ✅     | —                                                        |
| 平台上下文：system prompt 固定开头 `你是 RabbitAITest 测试平台智能助手`（身份/测试领域能力清单/拒答边界） | ✅ | 工具调用（查项目数据/执行操作——ChatToolEngine 对标，Backlog） |
| 个人级隔离：仅本人可见自己的会话（service 层 userId 过滤，防枚举 404）          | ✅     | —                                                        |

### 1.3 前置依赖

AI-001 网关与流式 ChatClient；AiConversation/AiMessage 表（S7 建）。

### 1.4 对标基线核对

完全复刻：顶部导航对话入口、会话管理、辅助定位（用例生成引导/排查思路/文档解读均为纯文本能力）。简化实现：无工具调用引擎（基线 ChatToolEngine+内置工具，深水区登记 Backlog）；上下文=固定条数窗口（无 token 计量）。

## 2. 业务逻辑

- **对话流程**：POST `/ai/chat`（conversationId?/content/modelId?）→无 conversationId 则建会话（标题=content 前 20 字）→落用户消息→取该会话最近 20 条（含本条）→拼接 system prompt→ChatClient **stream** →逐 delta 转 SSE 帧下发→完成后落助手消息→`done` 帧（messageId/conversationId/title）。
- **错误流**：上游失败→`error` 帧（code/message，70501 等）→**助手消息不落库**（半截不留）；客户端展示错误气泡+重试。
- **停止**：客户端 abort→服务端 AbortSignal 级联取消上游 fetch→半截内容丢弃（简化：不落库不续传，登记）。
- **清理**：软删会话消息保留（恢复语义？——不提供恢复入口，30 天清理任务物理删，与项目软删同窗口，登记简化）。
- **边界**：会话不存在/非本人→70414（404 防枚举）；模型禁用→70404；无可用模型→70444；content 1-8000。

## 3. UI/UX 设计（高保真 docs/design/AI-004-ai-assistant/）

- 顶栏右侧图标（ sparkle 图标）→ 右侧 Drawer 560px 全高：
  - 左栏 200px 会话列表：「+ 新对话」+会话项（标题/相对时间，hover 显重命名/删除图标）
  - 右侧消息区：气泡流（用户右对齐蓝底/助手左对齐白底+markdown）、底部输入区（textarea 自适应 4 行+发送/停止按钮切换）+模型下拉（折叠在输入区上方）
  - 流式态：助手气泡内打字机+闪烁光标；停止按钮红色
- 空态：新对话引导文案（能力提示：用例生成思路/接口排查/文档解读）。

## 4. 技术架构

- 数据模型：AiConversation/AiMessage（随 S7 建表；消息 content Json `{text}`）。
- 契约：`aiChatSchema`（conversationId?/content 1-8000/modelId?）、SSE 帧常量（shared：`AI_SSE_DELTA/DONE/ERROR`）；会话行/消息行 schema。
- 端点（withAuth，个人级无权限点——登录即个人空间，与 personal 域同口径）：`GET/POST /api/v1/ai/conversations`、`GET .../{id}/messages`、`PUT/DELETE .../{id}`、`POST /api/v1/ai/chat`（**响应 text/event-stream**）。
- 服务：`chat.service.ts`（会话 CRUD/上下文窗口/消息落库）；SSE 用 ReadableStream 直写（复用 stream 惯例，无 Redis——对话一次性流不续传，与 exec 事件流差异登记）。
- 错误码：`AI_CONVERSATION_NOT_FOUND 70414`、复用 70404/70444/70501。
- 前端：`TopBar` 挂入口 + `AiAssistantDrawer.tsx`（fetch reader 消费 SSE，AbortController 停止）。

## 5. 测试用例

- AI-004-T1（jmx 四类）：会话 CRUD/消息历史；401（未登录）/404（他人会话 70414 防枚举）/422（content 空/超长）；列表信封。
- AI-004-T2（jmx chat 非流式兼容断言）：`stream:false` 参数分支返回完整 JSON（信封）→SSE 端点兼容模式（简化断言：HTTP 200+content-type 事件流）。
- AI-004-T3（spec 全链路）：顶栏图标→面板开→新对话→发消息→打字机出现完整回复（mock 确定性文本）→刷新页面→历史仍在→重命名→删除；Console 无错+网络断言（POST /ai/chat 200+event-stream）。
- AI-004-T4（spec 停止与异常）：发送中点停止→气泡中断且无 error；无可用模型→错误气泡+引导。
- 单测：上下文窗口截断（21 条取 20）、标题截断、SSE 帧序列（delta*→done）、错误帧不落库、软删后消息不可见、个人隔离（他人 id 过滤）。

## 6. 竞品深度对标

基线主体覆盖（入口/会话管理/流式/平台身份）。差异：①无工具调用引擎（最大差异，登记 Backlog 首位）；②无 token 计量；③无消息搜索/导出；④上下文固定条数。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例）。联调点：mock 供应商按「智能助手」开头返回固定流式文本（分 3 片 delta，断言打字机与完成态）。

## 8. 勘误登记

**勘误 1（2026-09-27，错误码段）**：60xxx → 70xxx（60xxx 已被报告域占用，envelope.ts 分段顺延）。
