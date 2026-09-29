# 缺陷协作与回收站（批量回收 · @提及 · 关注通知）

| 字段         | 内容                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | BUG-002                                                                                                                                         |
| 所属迭代     | Sprint 5 — 协作通知                                                                                                                             |
| 优先级       | P2（迭代内 P1）                                                                                                                                 |
| 所属模块     | bug 域 + crosscut（评论/关注横切，comment/review 域消费）                                                                                       |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测（批量/提及矩阵并入 s5 系）+ JMeter 1 + Playwright 2 全绿；走查随验收）                                  |     |
| 最后更新日期 | 2026-09-28                                                                                                                                      |
| 上游依赖     | BUG-001（本地缺陷全量：软删/restore/purge 已有单条端点）、MSG-001（dispatch 分发，**迭内硬依赖**）、CASE-003（评论 Tab）、DASH-002（Follow 表） |
| 下游消费     | S8 QA-001/002（覆盖率核对「缺陷回收站」行）                                                                                                     |
| 上游依据     | 需求文档 §三 M5（回收站/评论回复编辑删除）、§二角色-场景（开发工程师处理缺陷）；功能清单 §七、§二通用-回收站                                    |
| 对标基线     | 功能清单 §七：缺陷列表删除（本地缺陷进回收站，不影响三方平台）、回收站恢复/彻底删除、详情评论（编辑/回复/删除）、关注；§二：回收站通用能力      |
| 关联架构文档 | test-domain-model.md §4（回收站横切约定）；api-conventions.md §4（recycled/restore/purge/batch-action）；rbac §3（PROJECT_BUG）                 |
| 高保真确认   | 待确认（原型 docs/design/BUG-002-bug-collaboration-recycle/，人工确认待 Sprint 验收走查）                                                       |
| 工作量估算   | 后端 1.5 人日 / 前端 1.5 人日 / 联调 1 人日                                                                                                     |

## 1. 概述

### 1.1 功能定位

BUG-001 已交付本地缺陷管理主体（含单条 restore/purge 端点）与 S6 已交付三方同步（INTG-001/002）。本规格交付**协作面增强**：回收站视图与批量操作、评论 @提及（缺陷+评审两处横切兑现 CASE-003 登记）、关注变更通知（兑现 DASH-002 登记），并把缺陷 5 事件接入 MSG-001 通知（兑现 BUG-001「流转触发通知」登记的通知半边）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                       | P1 ✅ | 后续                                       |
| ------------------------------------------------------------------------------------------ | ----- | ------------------------------------------ |
| 回收站视图：缺陷列表「回收站」Tab（?recycled=true：标题/状态/删除时间/操作 恢复·彻底删除） | ✅    | —                                          |
| 批量恢复：`POST bugs/batch-restore {ids}`，恢复后回正常列表（校验 id 均在回收站）          | ✅    | —                                          |
| 批量彻底删除：`POST bugs/batch-purge {ids}`（物理删+级联横切表，同 BUG-001 单条口径）      | ✅    | —                                          |
| 评论 @提及：评论框 @ 成员选择（项目成员）→ `mentions` userIds 落库 → 被提及人站内信必收    | ✅    | 邮件/机器人渠道提及（当前提及仅站内信）    |
| 评审评论 @提及：同一横切（CASE-003 登记兑现）                                              | ✅    | —                                          |
| 关注变更通知：缺陷 更新/流转 → 关注者收站内信（操作人剔除）                                | ✅    | 用例/计划关注通知 Backlog                  |
| 缺陷事件接入 MSG-001：创建/更新/删除/评论/流转 五事件 dispatch（接收人按事件配置）         | ✅    | 缺陷同步结果通知（INTG 平台侧事件）Backlog |
| 处理人转派：编辑缺陷改 handleUserId（触发 BUG_UPDATED+关注者通知，S1 编辑能力沿用）        | ✅    | 转派独立确认流程 Backlog                   |
| 本地删除不推三方平台（回收站口径重申，与 INTG-001「删除同步延后」一致）                    | ✅    | 删除同步 Backlog（INTG-001 登记延续）      |

### 1.3 前置依赖

- `bugs.deletedAt` 软删 + `bugs/{id}/restore` + `?purge=true` 单条端点已交付（BUG-001）；`comments.mentions Json @default("[]")` 列已建（S0，零 DDL）
- `follows` 表与 follow.service 已交付（DASH-002）
- MSG-001 dispatch 服务（迭内先行）

### 1.4 对标基线核对

完全复刻：回收站恢复/彻底删除（基线 §七/§二）；评论（编辑/回复/删除——S1 已有，本规格加 @提及即基线评论协作面）；关注（S1 已有按钮，本规格接通知）。简化实现：批量操作上限（单批 ≤100，基线未限）；@提及通知渠道仅站内信（基线按事件配置渠道，提及人必收已超出基线明示）。超出基线：批量恢复（基线只有单条恢复）；提及人选择器限定项目成员（基线未明示范围）。

## 2. 业务逻辑

- **回收站口径**：`deletedAt != null` 即回收站；恢复=清空 deletedAt（保留 num/字段不变）；彻底删除=物理删 bug+关联横切（BugCaseRef/Attachment/Comment/ChangeLog/Follow，同 BUG-001 purge 级联集）。三方平台缺陷（platform != LOCAL）同样进本地回收站，**不调用平台删除接口**。
- **批量校验**：ids 非空 ≤100；任一 id 不存在或不在回收站（deletedAt=null）→ 422 VALIDATION_FAILED（msg 列出非法 id）；权限同单条（PROJECT_BUG:UPDATE 恢复 / :DELETE 彻底删除）。
- **@提及**：评论创建/回复请求体新增可选 `mentions: string[]`（项目成员 userId 去重，≤20；包含评论者本人时自动剔除）；存 `comments.mentions`；dispatch `{event: BUG_COMMENT|REVIEW_COMMENT, mentionIds}`——提及人**必收站内信**（不受事件开关影响的部分：仅当该事件开关关闭时提及也不发？**口径：事件开关=总闸，提及/关注是接收人扩展**——总闸关则全不发）。
- **关注通知**：BUG_UPDATED/BUG_TRANSITION 时 `followerIds=follow.service.listFollowers("bug", bugId)` 并入接收人，仅投站内信。
- **事件载荷**（固定模板，MSG-001 约定）：标题=`[缺陷] {title} {动作}`，正文含 操作人/时间/状态变化（流转前后）/评论摘要（≤120 字截断）。
- **审计**：batch-restore/batch-purge 走 recordAudit（ids 清单入参留痕）。

## 3. UI/UX 设计（高保真 docs/design/BUG-002-bug-collaboration-recycle/）

- 缺陷列表页头部新增「回收站」Tab 切换（正常列表 ↔ 回收站；testid `tab-recycle`（沿用 BUG-001 既有 testid，避免破坏既有用例——S5 勘误））：回收站列表列=标题/严重程度/处理人/删除时间/操作（恢复·彻底删除，彻底删除二次确认弹窗红色警示）+ 顶部批量栏（勾选后「批量恢复」「批量彻底删除」）。
- 评论框（缺陷详情与评审详情通用组件）：文本域 + 「@」按钮弹出项目成员选择（搜索+勾选），插入 `@姓名` 高亮 token；已提交评论渲染提及高亮。
- 关注按钮既有；本规格无新 UI（通知在铃铛消费）。
- 空态：回收站无数据插画+「回收站是空的」；批量按钮未勾选时禁用。

## 4. 技术架构

- 数据模型：零 DDL（bugs/comments/follows 既有；comments.mentions 启用写入）。
- 契约（packages/shared/src/bug/schemas.ts 增量 + message 目录引用）：`bugBatchRestoreSchema`/`bugBatchPurgeSchema`（ids 1-100）、`commentMentionsSchema`（userId 数组，成员校验服务侧）；评论创建 schema 增可选 `mentions`。
- 端点（新增，均 withProjectScope+审计）：
  - `POST /api/v1/projects/{projectId}/bugs/batch-restore`（PROJECT_BUG:UPDATE）
  - `POST /api/v1/projects/{projectId}/bugs/batch-purge`（PROJECT_BUG:DELETE）
  - 既有评论端点（`bugs/{id}/comments`、`reviews/{id}/comments`）body 增 `mentions`（additive）
- 服务：`bug.service.ts` 增 `batchRestoreBugs/batchPurgeBugs`（复用单条校验与级联）；`comment` 写路径（bug/review 两处）落 mentions 并 dispatch；`bug.service` create/update/delete/transition 挂 dispatch（MSG-001 挂点）。
- 权限点：复用 `PROJECT_BUG:*`（无新增）。
- 错误码：复用 `VALIDATION_FAILED 20422`（批量非法/提及非成员），`BUG_NOT_FOUND 30444`；无新增码。
- 前端：`bugs/page.tsx` 回收站 Tab+批量栏；`components/CommentComposer.tsx`（@提及选择，缺陷/评审两处复用）；api-client s5.ts 增量。

## 5. 测试用例

- BUG-002-T1（jmx 四类）：batch-restore/batch-purge 主链（删两条→批量恢复→recycled 列表清空→再批量彻底删除）；401/403（无 PROJECT_BUG:DELETE）/404（坏 id）；422（空 ids/含未删除 id/超 100）；回收站列表分页信封断言。
- BUG-002-T2（spec 主链路）：删除缺陷→回收站 Tab 可见→勾选批量恢复→正常列表回归→再删→彻底删除→两处均不可见（UI+Console+接口）。
- BUG-002-T3（spec 协作链路）：成员 B 关注缺陷→admin 更新缺陷→B 铃铛收到变更通知（admin 无）；评论 @B→B 收到提及通知；被 @ 非成员 id → 422（三类断言）。
- 单测：批量校验矩阵（空/越界/混合态/全合法）；提及去重与本人剔除；purge 级联集断言（与单条一致）。

## 6. 竞品深度对标

基线 §七/§二：回收站恢复/彻底删除✓（批量为超出基线增强）、评论协作✓（@提及补齐）、关注✓（通知接通）。差异：①三方平台缺陷删除仍不推平台（基线「本地缺陷进回收站，不影响三方平台」口径一致，双向删除同步基线亦未要求）；②提及通知渠道仅站内信（基线按渠道配置，提及属接收人扩展超出明示）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：batch-restore/batch-purge 端点与 mentions 字段（additive）。联调点：MSG-001 dispatch（T3 依赖 mock 机器人与铃铛）。验收=§5 用例全绿 + 概览演示主线「回收站/协作」段。

## 8. 勘误登记

无。
