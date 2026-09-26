# 用例详情页与关联体系

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | CASE-003 |
| 所属迭代 | Sprint 1 — 测试管理 MVP |
| 优先级 | P1 |
| 所属模块 | 测试用例（case 域） |
| 文档状态 | Implemented（2026-09-26 代码合并：单测 49 + JMeter 11 计划 + Playwright 38 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | CASE-002（导航骨架）、PROJ-002（动态字段渲染）、BUG-001（缺陷关联目标，联调期并行） |
| 下游消费 | CASE-005（评审入口）、PLAN-001（计划关联展示）、DASH-001（我关注的数据源） |
| 上游依据 | 需求文档 M3（9 Tab 详情、关注/分享/复制）；功能清单 §四.1（用例详情页 Tab） |
| 对标基线 | 功能清单 §四.1：详情 Tab=详情/用例(关联接口)/需求/缺陷/依赖关系/用例评审/测试计划/评论/变更历史 |
| 关联架构文档 | test-domain-model.md §3（多态引用 Provider）、§4（评论/变更历史横切） |
| 高保真确认 | 待确认（原型已产出 docs/design/CASE-003-case-detail-association/，人工确认待 Sprint 验收走查——不可由 AI 代签，见 ai-collaboration §5） |
| 工作量估算 | 后端 3 人日 / 前端 5 人日 / 联调 1.5 人日 |

## 1. 概述

### 1.1 功能定位
用例从「单页表单」升级为「多 Tab 工作台」：编辑态详情 + 六类关联信息 + 协作（评论/历史）。Tab 容器与横切组件（评论/变更历史）为缺陷详情复用。

### 1.2 范围边界

| 能力 | P1 ✅ | 后续 |
| --- | --- | --- |
| Tab=详情：表单升级（受限 Markdown 富文本：粗体/斜体/列表/链接/代码块/表格；步骤富文本同构）+ 动态自定义字段区（按模板）+ 附件 | ❌ 附件→BUG-001 统一后评估复用 | 富文本完整版/附件（Sprint 5 FILE） |
| Tab=依赖关系：前置/后置用例添加（搜索选择）、双向同步展示、删除依赖 | ✅ | 循环依赖检测提示（登记勘误候选） |
| Tab=用例评审：该用例参与的评审列表（评审名/结果/时间）+ 跳转 | ✅ | — |
| Tab=测试计划：关联计划列表（计划名/执行状态/我的执行结果）+ 跳转 | ✅ | — |
| Tab=缺陷：关联缺陷列表 + 「关联已有/新建缺陷」入口（新建带出用例与步骤） | ✅ | — |
| Tab=评论：发表/回复/编辑/删除（本人或项目管理员） | ✅ | @提及通知（MSG-001） |
| Tab=变更历史：时间线（操作人/时间/字段 diff 白名单）只读 | ✅ | — |
| 头部操作：关注/取关（星标）、分享（复制链接）、复制（转 CASE-002）、编辑/保存（Ctrl+S） | ✅ | — |

### 1.3 前置依赖
CASE-002 骨架；BUG-001 联调前缺陷 Tab 以空态+禁用入口占位。

### 1.4 对标基线核对
基线 9 Tab 中「需求」Tab（三方平台）整体 ❌→INTG-001（Sprint 6）；「用例」Tab（关联接口/场景用例）❌→CASE-006（Sprint 2，接口域就绪后）。其余 7 Tab 全实现。富文本简化为受限 Markdown（基线 CKEditor），语义损失=图片粘贴与复杂排版，登记 Sprint 5 增强。

## 2. 业务逻辑

- 依赖关系：CaseDependency(pre_case/post_case) 单向；B 依赖 A 则 A 详情后置列表含 B；删除任一侧即解除。
- 评论与变更历史走横切组件（test-domain-model §4）：Comment(entity 多态)/ChangeLog(seq 递增)。
- 变更历史 diff 白名单：name/level/steps/tags/module/动态字段（旧值→新值）；评论数不进历史。
- 保存并发：沿用 CASE-001 乐观锁 version→409。
- 「新建缺陷」预填：标题=用例名、描述=失败步骤 Markdown、关联自动建立（BugCaseRef）。

## 3. UI/UX 设计（高保真 docs/design/CASE-003-case-detail-association/）

- 页面头：面包屑（模块树路径）+ 用例名 + 状态/等级标签 + num；右侧星标关注、分享、复制、编辑/保存按钮组。
- Tab 条横排 7 个（P1 集合），当前 Tab 记忆到用户偏好；Tab 徽标计数（评论数/缺陷数）。
- 详情 Tab：分区卡片=基本信息/前置与步骤（Markdown 双栏编辑：左编辑右预览切换）/自定义字段区（DynamicFieldForm 只读态↔编辑态）。
- 依赖 Tab：两列（前置/后置）列表 + 添加弹窗（搜索用例，排除自身）；评审/计划 Tab：精简表格 + 空态引导。
- 评论 Tab：楼中楼两级（回复扁平挂主楼）；变更历史：垂直时间线，diff 行内红绿。
- 权限态：只读权限下所有编辑入口隐藏；已归档计划内的用例计划 Tab 不受影响（计划侧控制）。

## 4. 技术架构

- 数据模型（已建齐）：CaseDependency、Comment、ChangeLog、Follow（Sprint 0 已建）。
- 端点：`GET/POST/DELETE /api/v1/projects/{pid}/cases/{id}/dependencies`；`GET /api/v1/projects/{pid}/cases/{id}/reviews`、`.../cases/{id}/plans`（聚合只读）；`GET/POST /api/v1/projects/{pid}/cases/{id}/bugs`、`DELETE .../bugs/{bugId}`（关联解绑）；评论横切端点 `GET/POST /api/v1/projects/{pid}/comments?entity=case:{id}`、`PUT/DELETE .../comments/{cid}`；`GET .../cases/{id}/changes`。
- zod：dependencyUpsertSchema、commentUpsertSchema（≤4000 字）、markdownSchema（受限语法白名单转义，防 XSS——security.md）。
- 权限点：PROJECT_CASE:READ|UPDATE；评论删除=作者或 PROJECT_CASE:UPDATE。
- 前端：`<DetailTabs/>` 容器 + `<CommentThread/>` `<ChangeTimeline/>`（packages/ui，bug 详情复用）；Markdown 渲染 sanitize 白名单。

## 5. 测试用例
- CASE-003-T1（jmx 四类）：依赖/评论/变更历史端点；401/403/404；自依赖 422、评论超长 422；信封分页。
- CASE-003-T2（spec 主链路）：详情 7 Tab 切换（UI 断言各 Tab 渲染）→ 加前置依赖 → 对方用例后置列表同步出现（接口断言双向）→ 评论回复/编辑/删除 → 变更历史含本次 diff。
- CASE-003-T3：Markdown 输入 `<script>` 注入 → 渲染转义（Console 零错误 + DOM 断言无 script 节点）。
- 单测：diff 白名单、依赖双向查询、评论删除权限矩阵。

## 6. 竞品深度对标
基线 9 Tab：7 实现 + 2 登记去向（见 §1.4）。基线评论支持@与消息联动 → 本迭代纯评论，通知面 Sprint 5 统一（对齐「通知场景 5 大类」总设计而非散做）。变更历史从「落库无 UI」（Sprint 0）补齐为时间线，对齐基线。

## 7. 里程碑与验收
DoD 前置：高保真人工确认。验收：详情页 7 Tab 全可用、依赖双向、评论/历史完整；组件被 BUG-001 复用。
