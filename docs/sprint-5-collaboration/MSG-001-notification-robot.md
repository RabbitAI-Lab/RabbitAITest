# 通知机器人（5 渠道 · 事件配置 · 站内信中心）

| 字段         | 内容                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | MSG-001                                                                                                                                                                       |
| 所属迭代     | Sprint 5 — 协作通知                                                                                                                                                           |
| 优先级       | P2（迭代内 P1）                                                                                                                                                               |
| 所属模块     | message 域（web 内服务；engine 不感知通知——dependency-graph「MSG 订阅事件，业务域不反向依赖 MSG」）                                                                           |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测 9 + JMeter 1 + Playwright 3 全绿；走查随验收）                                                                                        |     |
| 最后更新日期 | 2026-09-28                                                                                                                                                                    |
| 上游依赖     | SYS-001（会话/withAuth）、SYS-005（SMTP 配置与 nodemailer）、S1 BUG-001（缺陷事件源）、S3 执行回调与定时任务、S6 出站 URL 守卫与 AES-GCM 先例                                 |
| 下游消费     | BUG-002（缺陷事件接线/提及/关注）、S8 QA-002（SSRF 收口核对）                                                                                                                 |
| 上游依据     | 需求文档 §三 M8、§二角色-场景表；功能清单 §8.4、§二通用-消息通知、§一一级菜单                                                                                                 |
| 对标基线     | 功能清单 §8.4：通知渠道 5 种（站内信/邮件/企微/钉钉/飞书）、机器人管理、通知场景 5 大类×事件粒度、按事件配置接收人（同人去重）；§二：右上角近 3 个月站内信+标记已读           |
| 关联架构文档 | test-domain-model.md §2（Notification/Robot/AppSetting 表）；api-conventions.md §1（personal 段）/§2/§3；rbac-permission-model.md §3；rules/security.md（SSRF/密钥/日志脱敏） |
| 高保真确认   | 待确认（原型 docs/design/MSG-001-notification-robot/，人工确认待 Sprint 验收走查——不可由 AI 代签，见 ai-collaboration §5）                                                    |
| 工作量估算   | 后端 3 人日 / 前端 2.5 人日 / 联调 1.5 人日                                                                                                                                   |

## 1. 概述

### 1.1 功能定位

项目级消息管理 + 个人级站内信中心：项目设置里维护通知渠道（机器人 CRUD + 按事件配置接收人），业务事件发生时由 message 域统一分发（站内信落库 / 邮件尽力投递 / 三方机器人 webhook），顶栏铃铛聚合查看与已读。兑现 S1-S4 各规格登记的「去向=S5 MSG-001」欠账（DASH-002 关注通知、CASE-003 @提及、BUG-001 流转通知、SYS-005 真实投递、INTG-003 回调登记）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                             | P1 ✅ | 后续                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| 机器人 CRUD：name/channel(inapp\|email\|wecom\|dingtalk\|feishu)/webhook(机器人渠道必填，inapp·email 留空)/enabled；上限 10/项目                                                 | ✅    | 加签 secret（钉钉/飞书验签）——Robot 无密钥列，Backlog |
| webhook SSRF 守卫：私网/环回/元数据/CGNAT/IPv6 ULA 拒 + DNS 复检（复用 S6 出站守卫）；测试发送实时校验                                                                           | ✅    | 管理员白名单粒度细化                                  |
| 事件配置：5 大类事件 × {enabled, robotIds, receiverUserIds}；存储=AppSetting key `message.events`                                                                                | ✅    | —                                                     |
| 同人去重：接收人∪关注者∪被提及人 − 操作人，去重后投递                                                                                                                            | ✅    | —                                                     |
| 站内信中心：顶栏铃铛+未读数徽标+近 3 个月列表+单条已读+全部已读                                                                                                                  | ✅    | 通知深链跳转（Notification 无来源列）Backlog          |
| 邮件投递：复用 SYS-005 SMTP 配置，异步尽力投递，未配置/失败仅日志不留错误面                                                                                                      | ✅    | 发送失败重试队列 Backlog                              |
| 事件接线：缺陷 创建/更新/删除/评论(@提及)/流转；评审评论(@提及)；用例评论(@提及，CASE_COMMENT)；计划执行完成；场景执行完成(手动+定时 notify)；定时任务 启用/停用；关注者变更通知 | ✅    | 接口定义/用例/Mock 增删粒度事件、误报事件细分 Backlog |
| 测试消息发送：任一机器人发一条测试消息（含 SSRF 实时校验与投递结果回显）                                                                                                         | ✅    | —                                                     |
| 自定义消息模板（变量插入/实时预览）                                                                                                                                              | ❌    | 【企业版】ENTP-005（P2 红线）                         |
| 消息内容：固定默认模板（标题=事件+对象名，正文=操作人+时间+摘要），无模板配置入口                                                                                                | ✅    | ENTP-005                                              |

### 1.3 前置依赖

- 表已建齐（S0 INFRA-003）：`notifications`（userId/type/title/content/readAt+索引）、`robots`（projectId/name/channel/webhook?/enabled）——**零 DDL**
- 事件配置存储复用 `app_settings`（projectId+key 复合主键，value Json）——零 DDL
- SMTP：SYS-005 已交付配置面（host/port/user/pass加密/from/ssl + verify）；本规格只做投递消费
- 出站守卫：S6 API-011 `guardOutboundUrl`（DNS 复检）与测试栈 `OUTBOUND_ALLOW_PRIVATE=1` 先例

### 1.4 对标基线核对

完全复刻：5 渠道机器人管理（新建/编辑/删除/启停）；按事件配置接收人；同人去重（基线「创建人=操作人不发」与需求文档「同人去重」统一为：**操作人不接收自己触发的事件通知**）；右上角近 3 个月站内信+标记已读；通知场景 5 大类（计划/缺陷/用例与评审/接口测试/定时任务）。简化实现：消息内容为固定默认模板（基线自定义模板=企业版）；事件粒度取每类核心事件（增删改/评论/流转/执行完成/定时开关），细分事件（Mock 增删/误报/评审结果逐人）登记 Backlog；邮件为尽力投递无重试。超出基线：站内信未读数徽标与「全部已读」批操作（基线只有标记已读）；关注者通知纳入接收人并集（基线未明说，依 DASH-002 登记）。

## 2. 业务逻辑

- **渠道模型**：一个机器人=一条渠道配置。inapp 机器人（站内信，无 webhook，投递=notifications 落库给接收人）；email 机器人（无 webhook，投递=SMTP 发接收人邮箱）；wecom/dingtalk/feishu 机器人（webhook 必填，投递=POST 该 webhook，消息体按平台 msgtype 形态）。
- **事件目录**（shared `MESSAGE_EVENTS`，key 即 notifications.type 前缀）：`BUG_CREATED`/`BUG_UPDATED`/`BUG_DELETED`/`BUG_COMMENT`/`BUG_TRANSITION`；`REVIEW_COMMENT`；`CASE_COMMENT`；`PLAN_EXEC_COMPLETED`；`SCENARIO_EXEC_COMPLETED`；`SCHEDULE_ENABLED`/`SCHEDULE_DISABLED`。@提及与关注者为**接收人扩展机制**（不占事件开关）：评论事件中被提及人必收（事件开关关闭则不收）；BUG_UPDATED/BUG_TRANSITION 关注者必收站内信（机器人渠道仍按事件配置）。
- **分发流程**：业务点调用 `notifyService.dispatch({projectId, event, title, content, actorId, receivers:{userIds, mentionIds, followerIds}})` → 读事件配置（无配置=默认全关）→ 计算接收人并集去重（−actorId）→ 启用的 inapp/email 机器人投给接收人；启用的三方机器人各投一条（与接收人无关，机器人=渠道广播）→ 全过程不抛错（投递失败仅结构化日志）。
- **同人去重**：actorId 恒被剔除；同一事件多来源并集后去重（Set）。
- **站内信窗口**：列表只返回近 90 天（createdAt ≥ now-90d）；更早数据由 S6 CLEANUP 队列保留策略自然清理（登记：通知保留 90 天并入既有清理任务的类型扩展）。
- **测试发送**：`POST robots/{id}/test` 对 inapp（给自己发一条）/email（SMTP verify 后发操作人）/三方（webhook 实时 POST）分别回显 `{delivered, detail}`；SSRF 拦截返回 422 ROBOT_WEBHOOK_BLOCKED。
- **审计**：机器人 CRUD 与事件配置 PUT 走 `recordAudit`（SYS-008 口径）。
- **删除级联**：删机器人时从事件配置 robotIds 中移除引用。

## 3. UI/UX 设计（高保真 docs/design/MSG-001-notification-robot/）

- 入口：项目设置组新增「消息管理」`/settings/messages`（LeftNav `nav-settings-messages`，perm `PROJECT_MESSAGE:READ`）；顶栏右侧铃铛（全角色可见，badge=未读数）。
- 消息管理页两 Tab：**机器人**（表格：名称/渠道 tag/_webhook 掩码显示_/启用开关/操作 编辑·测试·删除；新建/编辑弹窗：名称+渠道单选+webhook（渠道为 inapp/email 时禁用置灰）+启用）；**事件配置**（事件按 5 大类分组行：事件名+总开关+接收人多选（项目成员）+机器人多选（仅启用的））。
- 铃铛下拉：最近 10 条（标题+时间+未读点），底部「查看全部」→ `/personal/notifications` 全列表页（分页/未读筛选/单条点选已读/全部已读按钮）。
- 空态：无机器人（引导新建文案）；事件全关（提示「未启用任何通知」）；铃铛无未读（无 badge，下拉空态插画文案）。
- 状态二态：机器人 启用/停用（停用不出现在事件配置机器人多选）；事件 开/关；webhook 必填校验红框。

## 4. 技术架构

- 数据模型：`robots`/`notifications`/`app_settings(message.events)` 既有表零 DDL（test-domain-model §2）；notifications.type=事件 key（如 `BUG_CREATED`）。
- 契约（packages/shared/src/message/schemas.ts）：`robotUpsertSchema`（name 1-128/channel 枚举/webhook url 可空-渠道条件必填/enabled）、`messageEventsConfigSchema`（Record<事件 key, {enabled, robotIds[], receiverUserIds[]}>）、`notificationItemSchema`；`MESSAGE_EVENTS` 常量+事件分组目录。
- 端点（全部 Route Handler，`runtime=nodejs`）：
  - `GET/POST /api/v1/projects/{projectId}/robots`（READ/CREATE）
  - `PATCH/DELETE /api/v1/projects/{projectId}/robots/{id}`（UPDATE/DELETE）
  - `POST /api/v1/projects/{projectId}/robots/{id}/test`（UPDATE）——测试发送
  - `GET/PUT /api/v1/projects/{projectId}/message-config`（READ/UPDATE）
  - `GET /api/v1/personal/notifications?page&pageSize&unread`（withAuth，本人）
  - `GET /api/v1/personal/notifications/unread-count`（withAuth）
  - `POST /api/v1/personal/notifications/{id}/read`、`POST /api/v1/personal/notifications/read-all`（withAuth）
- 服务：`apps/web/src/server/domains/message/robot.service.ts`（CRUD/测试发送/SSRF 校验）、`message-config.service.ts`（AppSetting 读写+删除机器人级联清理）、`notify.service.ts`（dispatch 分发：接收人并集去重/站内信落库/email 投递/robot 投递，全 try-catch 不抛出）、`robot-sender.ts`（三平台 payload 映射：dingtalk `{msgtype:"text",text:{content}}`、wecom 同形、feishu `{msg_type:"text",content:{text}}`）。
- 挂点接线（业务侧一行调用）：`bug.service`（create/update/delete/transition/comment）、`review.service`（评论）、`exec.service handleCallback`（任务终态→PLAN_EXEC_COMPLETED/SCENARIO_EXEC_COMPLETED，schedule 任务读取 notify 标志）、`schedule.service`（启停）；`follow.service` 提供 followerIds 查询。
- 邮件：复用 SYS-005 SMTP 读取与解密；无配置/verify 失败→跳过+日志。
- 权限点：新增入库 `PROJECT_MESSAGE:READ|CREATE|UPDATE|DELETE`（预置组同步：PROJECT_ADMIN 全量、PROJECT_MEMBER 增 READ、ORG_ADMIN 增 READ）；personal 通知端点无权限点（withAuth 本人）。
- 错误码（20xxx 项目与配置段）：`ROBOT_NOT_FOUND 20440`、`ROBOT_WEBHOOK_INVALID 20441`、`ROBOT_WEBHOOK_BLOCKED 20442`、`ROBOT_LIMIT_EXCEEDED 20443`（10/项目）、`MESSAGE_CONFIG_INVALID 20444`、`NOTIFICATION_NOT_FOUND 20445`、`ROBOT_SEND_FAILED 20446`（测试发送投递失败）。
- 前端：`apps/web/src/app/(console)/settings/messages/page.tsx`（两 Tab）；`components/HeaderBell.tsx`（badge+轮询 30s）；`app/(console)/personal/notifications/page.tsx`；api-client `s5.ts`。
- mock（apps/mock）：`/mock-robot/dingtalk|wecom|feishu`（POST 接收+记录）、`GET /mock-robot/_test/calls`（测试断言收包）、`POST /mock-robot/_test/clear`（清场）。

## 5. 测试用例

- MSG-001-T1（jmx 四类）：robots CRUD 主链（建/列/改/删+信封 total/items）；401（无 cookie）/403（无 PROJECT_MESSAGE 点）/404（坏 id）；422（webhook 非法 URL/机器人渠道缺 webhook/超上限第 11 条）；personal/notifications 分页信封断言。
- MSG-001-T2（spec 主链路）：消息管理新建钉钉机器人（指向 mock）→ 列表可见 → 「测试」回显送达 → mock `/mock-robot/_test/calls` 断言收到 1 条（UI+Console+接口）。
- MSG-001-T3（spec 事件链路）：事件配置开 BUG_CREATED（接收人=另一成员+inapp 机器人）→ 该成员登录铃铛未读+1、通知列表见条目 → admin（操作人）无该通知（同人去重）→ mock 收到 webhook（三类断言）。
- MSG-001-T4（spec 二态）：机器人停用后事件不投递（mock 收包数不变）；PROJECT_MEMBER 无 PROJECT_MESSAGE 点访问消息管理 403；通知已读态切换。
- 单测（`apps/web/src/server/domains/message/__tests__/`）：dispatch 矩阵（开关×渠道×接收人并集/去重/actor 剔除/提及必收/关注者站内信）；robot-sender 三平台 payload 形态；事件配置默认值与坏 id 机器人过滤；90 天窗口过滤。

## 6. 竞品深度对标

基线 §8.4 全量核对：5 渠道✓ 机器人管理✓ 事件×接收人✓ 同人去重✓ 站内信近 3 个月+已读✓ 定时任务开关事件✓。差异：①自定义模板=企业版（红线外）；②事件粒度取核心集（Mock/误报/评审结果细分登记 Backlog）；③邮件无重试队列（基线未明示重试语义）；④超出基线：未读数徽标、全部已读、关注者通知并集。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：robots/message-config/personal notifications 端点 + `MESSAGE_EVENTS` 目录（zod 与 OpenAPI 快照）。联调点：mock 机器人收包断言（T2/T3）与铃铛轮询。验收=规格 §5 用例全绿 + 概览演示主线「通知」段。

## 8. 勘误登记

无。
