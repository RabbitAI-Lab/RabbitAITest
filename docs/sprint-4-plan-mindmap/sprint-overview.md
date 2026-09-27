# Sprint 4 — 计划完整与脑图 · 迭代概览

| 元信息项   | 内容                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint 4                                                                                      |
| 迭代名称   | 计划完整与脑图（M5 里程碑）                                                                   |
| 周期       | 第 12-14 周（15 个工作日）                                                                    |
| 覆盖优先级 | **P2 计划完整与报告导出 + 脑图**（需求文档 §四 M4/M5：测试点/计划执行/脑图三态/计划报告；§七 M5 W14）|
| 文档数     | 7 份（4 PLAN + 2 CASE + 1 DASH）                                                              |
| 文档状态   | Implemented（2026-09-27 交付：规格/原型/契约 v4/引擎/前后端/测试全量；走查随验收）|
| 上游依据   | [需求文档](../需求文档.md) §四 M4「测试计划」、§七 M5；功能清单 §五/§四                       |
| 前置迭代   | [Sprint 3](../sprint-3-scenario-automation/sprint-overview.md)（场景执行链 refType=scenario、报告分享链路）|
| 阻塞下游   | Sprint 5 MSG-001（关注变更通知）、Sprint 6 INTG（计划关联三方需求）                           |

---

## 1. 迭代目标

**把 Sprint 1 的「功能用例手工计划」升级为「三类用例统一规划 + 引擎真实执行 + 脑图操作」的完整测试计划域，并补齐工作台七维度跟进。**

端到端可演示路径（浏览器操作主线）：

```
建计划 → 测试规划（测试点树分层：添加点/配置继承）→ 关联三类用例（功能/接口/场景）挂点
→ 执行配置（环境/资源池/串并行/失败停止——占位激活）→ 引擎执行（接口/场景真实调度，
依赖用例 FAIL → 关联用例 BLOCKED）→ 脑图执行模式（S/E/B 快捷键标记功能用例）
→ 计划报告（测试点维度明细/一键总结/阈值判定）→ 分享链接 / 导出 PDF
→ 计划分组（组视图/组聚合报告）与归档 → 工作台：我关注的（七维度）/我创建的/待办（含接口域）
```

四条成功判定：

| 维度           | 目标                                                                              | 判定方式                                                     |
| -------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 规划分层可用   | 测试点树（增删改/拖拽排序/配置继承链）+ 用例挂点；无点平铺兼容 PLAN-001           | E2E 断言点树操作与报告按点分组明细                           |
| 引擎执行真实   | 计划内 api_case/scenario 经契约 v4 plan 命令真实调度；依赖 FAIL→BLOCKED；自动更新状态激活；实时通过率 | E2E 断言 ExecTask type=plan 终态回写 PlanCaseRef 与报告      |
| 脑图双向同步   | 用例列表/脑图双模式；模块→用例→步骤层级；快捷键（Enter/Tab/C/M/Backspace…）；计划脑图执行 S/E/B | E2E 脑图建用例→列表可见；S/E/B 标记→状态回写                 |
| 跟进与导出闭环 | 我关注的七维度筛选+项目维度；我创建的按创建人修正；计划报告 PDF 导出/分享          | E2E 关注计划→工作台筛选可见；导出打印页快照断言              |

**本迭代不追求**：关注消息通知（S5 MSG-001）、计划关联三方需求（S6 INTG）、报告批量导出（Backlog）、组整体一键执行的并行调度编排（登记简化：组执行=逐成员计划执行）、AI 总结（S7）。

## 2. 交付范围（7 项 / 7 规格）

| #   | 交付项         | 内容                                                                                                | 文档       |
| --- | -------------- | --------------------------------------------------------------------------------------------------- | ---------- |
| 1   | 测试规划与测试点 | 测试点树 CRUD/排序/配置继承（inheritConfig 祖先链回退 plan 执行配置）；三类用例挂点关联；无点平铺兼容；报告按点分组 | `PLAN-002` |
| 2   | 计划执行       | 接口用例/场景真实调度（契约 v4 plan 命令、ExecTask type=plan、串行/并行 p-limit、失败停止）；执行配置激活（环境/资源池选择器）；功能用例脑图执行（S/E/B）；依赖 FAIL→BLOCKED；自动更新状态激活；实时通过率 SSE | `PLAN-003` |
| 3   | 计划分组与归档增强 | 计划组 CRUD（type=GROUP）、成员移入移出、列表组视图折叠、组聚合报告与总结、组归档级联；归档批量操作 | `PLAN-004` |
| 4   | 计划报告导出   | 测试点维度明细视图；一键总结（统计草稿）+编辑保存；分享链接（ReportShare 复用）；导出 PDF（打印友好 fullPage）+ CSV 明细 | `PLAN-005` |
| 5   | 脑图模式       | 通用脑图组件（右向树 SVG 连线）+ 用例列表/脑图双模式双向同步；模块→用例→步骤层级；快捷键体系（Enter/Tab/Ctrl+Enter/M/C/Backspace）；节点侧栏编辑；批量删除/移动 | `CASE-007` |
| 6   | 用例依赖与历史 | S1 基础（依赖 Tab/CRUD/变更时间线）上补齐：循环依赖检测（422）、依赖选择器（搜索/模块树）、计划执行依赖联动（BLOCKED）、变更 diff 字段级摘要增强 | `CASE-008` |
| 7   | 待办跟进创建   | 我关注的七维度（case/plan/review/api_case/scenario/bug）+ 项目维度筛选；我创建的修正为创建人口径 + 接口域维度；Follow 写入口补齐（计划/场景/接口用例/评审详情）；待办 exec 含接口域 refs | `DASH-002` |

## 3. 范围排除（防蔓延红线）

- 不做：关注/创建的消息通知（S5）、脑图评审模式（CASE-005 后续增强，登记 Backlog）、计划定时任务（场景侧已有 SYS-006 口径，计划级定时登记 Backlog）、组内计划跨项目、报告批量导出 zip、PDF 服务端渲染（打印页方案）、Excel 原生 xlsx（CSV Excel 兼容口径）
- 计划执行仅调度 api_case/scenario（功能用例保持人工口径——基线一致）；脑图执行仅功能用例标记
- 依赖联动仅在计划执行边界生效（人工标记不触发 BLOCKED 推导，登记简化）
- 组报告只聚合统计+成员链接（不聚合步骤明细，钻取走成员计划报告）
- 我关注的主体维度=实体类型七选一；项目维度筛选=仅当前项目（跨项目关注列表登记 Backlog）

## 4. 验收标准（现场跑通）

1. 测试规划：建计划→加父点「支付」子点「扫码」→扫码点继承配置关闭→显式配 env→关联接口用例挂到扫码点→执行配置生效（报告 envSnapshot 断言）
2. 引擎执行：计划含 2 api_case + 1 scenario→执行→ExecTask(type=plan) 1 任务 3 item→报告页按 plan 视图呈现→PlanCaseRef 状态回写 PASS/FAILED→通过率/阈值徽标实时刷新
3. 失败停止与依赖：stopOnFail 开→首 item FAILED→余 item SKIPPED；功能用例 A 依赖 B，B FAIL→A 显示 BLOCKED
4. 自动更新状态：开启设置→接口用例 PASS→同计划关联的功能用例状态自动更新（CASE-006 关联对）
5. 脑图双模式：列表模式建用例→切脑图→树中可见；脑图 C 新建用例（步骤 Tab/回车）→保存→列表模式可见；M 加模块；Backspace 删除空节点
6. 脑图执行：计划脑图 Tab→S 标记成功/E 失败/B 阻塞→右侧详情面板回写→列表模式状态同步
7. 计划分组：建组→拖入 2 计划→组视图折叠展示→组报告聚合通过率→组归档→成员级联只读
8. 报告导出：计划报告→一键总结生成草稿→编辑保存→分享链接（免登录可读）→导出 PDF 打印页完整呈现→CSV 明细下载行数=关联数
9. 工作台：关注计划+场景→我关注的筛选「计划」只见计划、筛选「场景」见场景；我创建的（接口用例）仅本人创建；待办-我的执行含接口用例行
10. 权限二态：仅 `PROJECT_PLAN:READ` 计划只读（执行/规划/归档隐藏+直发 403 10003）；脑图编辑受 `PROJECT_CASE:UPDATE` 门控
11. 自动化测试齐备（rules/testing.md）：每功能点 Vitest + JMeter（四类场景×四项断言）+ Playwright（三类断言）全绿；主链路 E2E MAINFLOW-s4（建计划→测试点→关联三类→执行→报告→导出→工作台跟进）

## 5. 规格清单与状态

| 编号       | 名称                         | 状态       | 原型                                           |
| ---------- | ---------------------------- | ---------- | ---------------------------------------------- |
| PLAN-002   | 测试规划与测试点             | Approved   | docs/design/PLAN-002-test-planning-points/     |
| PLAN-003   | 计划执行（引擎调度·脑图执行）| Approved   | docs/design/PLAN-003-plan-execution/           |
| PLAN-004   | 计划分组与归档增强           | Approved   | docs/design/PLAN-004-plan-group-archive/       |
| PLAN-005   | 计划报告导出                 | Approved   | docs/design/PLAN-005-plan-report-export/       |
| CASE-007   | 脑图模式                     | Approved   | docs/design/CASE-007-mindmap-mode/             |
| CASE-008   | 用例依赖与历史增强           | Approved   | docs/design/CASE-008-case-dependency-history/  |
| DASH-002   | 待办跟进创建（七维度）       | Approved   | docs/design/DASH-002-todo-follow-create/       |

## 6. 工程债承接（S1/S3 遗留清偿）

- **PLAN-001 执行配置占位激活**：环境/资源池选择器、串并行、失败停止（S1 ❌→本迭代 ✅）
- **PLAN-001 自动更新状态开关激活**：S1 仅存配置，本迭代按 CASE-006 关联对回写功能用例执行状态
- **S3 遗留 loop 控制器名帧携带**：契约 v4 顺带 additive（step-start/step-result 帧 optional `stepName`）——报告树 loop 节点名修复
- **S3 遗留场景关注（DASH-002 去向）**：场景详情 Follow 入口补齐
- **S3 遗留 ApiRefPanel 场景引用呈现**：随 CASE-007 脑图 Tab 收口（引用计数徽标）

## 7. 交付自查（Sprint 收尾时回填）

| 验收标准 | 结果 | 证据 |
| -------- | ---- | ---- |
| 1. 测试规划（点树/继承/挂点） | ✅ | JMeter PLAN-002（点 CRUD/环 30456/非空 30455/挂点计数）；e2e PLAN-002-01/02；resolvePointChain 单测矩阵（显式截断/根回退/环防御/深度上限） |
| 2. 引擎执行（plan 任务/回写/报告） | ✅ | JMeter PLAN-003（execute 201→轮询终态→executions/type=plan→详情回写 FAIL→报告可读）；e2e PLAN-003-01（报告页「计划执行」）；engine plan 单测 4 条（分派/env 优先级/STOPPED 透传） |
| 3. 失败停止与依赖 BLOCKED | ✅ | stopOnFail 串行 SKIPPED（JMeter T1 链路）；CASE-008 e2e（B FAIL→标记 B 响应 blockedBy.caseId=A）；assertNoDependencyCycle BFS 单测（经 jmx 反向环 30484/自引用 30485） |
| 4. 自动更新状态（PASS 方向） | ✅ | JMeter PLAN-003 T4-5/T4-6（单跑正向→功能用例 NOT_RUN→PASS contains）；curl 实证（auto-fn→PASS） |
| 5. 脑图双模式（快捷键/同步） | ✅ | e2e CASE-007-01（列表↔脑图往返/M 键建模块/保存 201/脑图见 API 建的用例）；layoutMindmap 纯函数（父子居中/折叠/环防御）+ 快捷键状态机单测 |
| 6. 脑图执行（S/E/B） | ✅ | e2e PLAN-003-02（S 键→exec status=PASS 接口断言→列表「通过」同步） |
| 7. 计划分组（组视图/聚合/级联） | ✅ | JMeter PLAN-004（组 CRUD/移入/聚合 memberCount=2/级联归档成员只读 10008/恢复）；e2e PLAN-004-01/02（组报告页） |
| 8. 报告导出（总结/分享/PDF/CSV） | ✅ | JMeter PLAN-005（view 概览/draft 含总结/summary 保存/分享免登录 200→吊销 404/CSV BOM+表头）；e2e PLAN-005-01（分享页+打印页+CSV 断言） |
| 9. 工作台七维度 | ✅ | JMeter DASH-002（followed kind 二态/created createdBy/待办含 api_case/幂等/404 30504）；e2e DASH-002-01/02（关注星 UI+维度筛选+我的执行徽标） |
| 10. 权限二态（PLAN READ 只读） | ✅ | e2e 沿用 S1 口径回归（PLAN-001 计划组全绿）；points/execute 端点 requirePerm(PROJECT_PLAN:UPDATE) 门禁在路由层 |
| 11. 自动化测试齐备 | ✅ | Vitest 108（shared 76 + engine 32）；JMeter 36 计划全绿（新增 7）；Playwright 119 全绿（新增 12 含 MAINFLOW-s4）；OpenAPI 快照 214 paths 审计通过；lint/边界检查 PASS |

### 7.1 工程债清偿

- **PLAN-001 执行配置占位**：✅ 全激活（env/serial/stopOnFail 经 resolvePointChain 点链生效；poolId 落任务）
- **自动更新状态**：✅ 激活（回调 applyPlanTaskResult：PASS 的 api_case/scenario→CASE-006 关联功能用例自动 PASS，execHistory source=auto）
- **S3 loop 帧名**：✅ 契约 v4：控制器命名帧 log kind=node-name + 树聚合消费（报告树 loop/condition/once 节点名修复；实现形态与规格「step-start+stepName」措辞有偏差→见 PLAN-003 勘误 1）
- **S3 场景关注入口**：✅ 场景详情 FollowStar（followApi.scenario）
- **ApiRefPanel 场景引用呈现**：⚠️ 未收口（脑图 Tab 承载的是计划执行视图；场景引用计数徽标移入 Backlog——诚实登记）

### 7.2 走查与确认状态

- 高保真人工确认：待用户验收（S0 §8.1 目标授权先例：实现先行、走查随验收补——不可由 AI 代签）
- 走查批次：S4 批次走查待用户执行（证据输入：每用例自动截屏、trace.zip、jtl、HTML 报告）

### 7.3 交付过程中发现并修复的缺陷（实现侧 10 处）

zod 裸 .parse 落 500（guard 增 zodParse 统一 20422）/ S4 新错误码未入 guard 404/422 分段（POINT/GROUP/DEPENDENCY/MINDMAP/FOLLOW/PLAN_NO_EXECUTABLE）/ scenarios 路由 slug 命名冲突 [scenarioId]→[id]（Next 构建报错）/ createPlanTask 空场景集仍调 buildScenarioCommands 抛 40474 / exec-tasks type 枚举缺 plan / addPlanCases added 计数仅功能口径（改三类 before/after）+ api/scenario 行漏落 execUserId / listPlanGroups 未分组计划被 where 排除（列表恒空）/ CaseMindmapView pageSize 500 超列表契约上限 100 / 关联 Toast 文案随 added 口径翻倍 / pool EXPECTED_ENGINE_VERSION 滞留 0.3.0 致 v0.4.0 节点 UNMATCHED。详见 CHANGELOG v0.5.0「修复」。

## 8. 遗留与展望（收尾时回填）

- 计划级定时任务：登记 Backlog（场景侧 SYS-006 repeatable 模式可复用）
- 脑图评审模式（模块级批量评审）：CASE-005 增强，登记 Backlog
- 组整体并行编排执行：本迭代组执行=逐成员计划顺序执行（登记简化）
- 跨项目关注列表（我关注的-项目维度跨仓聚合）：登记 Backlog
- PDF 服务端渲染（无头浏览器）：打印页方案替代，登记口径
- 下游：S5 MSG-001 消费 Follow 表发通知；S6 INTG 消费计划-需求关联扩展
