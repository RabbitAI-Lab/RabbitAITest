# 环境组与全局参数（项目级变量域兜底 · 多环境打包按序执行）

| 字段         | 内容                                                                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PROJ-006                                                                                                                                                        |
| 所属迭代     | Sprint 5 — 协作通知                                                                                                                                             |
| 优先级       | P2（迭代内 P1）                                                                                                                                                 |
| 所属模块     | project 域（web 管理面+快照构建）+ exec 域（按组展开建任务）                                                                                                    |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测（展开矩阵并入 s5-project）+ JMeter 1 + Playwright 3 全绿；走查随验收）                                                  |     |
| 最后更新日期 | 2026-09-28                                                                                                                                                      |
| 上游依赖     | PROJ-003（环境管理与 config schema、变量作用域链登记、buildEnvSnapshot 合并逻辑已实现）、API-008（场景批量执行）、PLAN-003（计划执行）                          |
| 下游消费     | S8 QA-001（覆盖率核对「环境组与全局参数」行）                                                                                                                   |
| 上游依据     | 需求文档 §三 M2（环境管理：环境组与全局参数）；功能清单 §8.6（环境组与全局参数）                                                                                |
| 对标基线     | 功能清单 §8.6：「环境组与全局参数（前端路由与后端模块均有环境组/全局参数能力）」——基线仅此一句，交互细节自主设计（plan §一 执行原则 1）                         |
| 关联架构文档 | test-domain-model.md §2（env_groups/global_params 表）；glossary.md（EnvGroup=多环境打包供计划/场景按序选用）；engine-execution-architecture §2（变量优先级链） |
| 高保真确认   | 待确认（原型 docs/design/PROJ-006-env-group-global-params/，人工确认待 Sprint 验收走查）                                                                        |
| 工作量估算   | 后端 1.5 人日 / 前端 1.5 人日 / 联调 1 人日                                                                                                                     |

## 1. 概述

### 1.1 功能定位

交付 PROJ-003 登记的两项延后能力：①**全局参数**——项目级单例 KV 变量域，作为环境变量之下的兜底层（作用域链=临时>环境变量>全局参数；`buildEnvSnapshot` 合并逻辑 S2 已实现，本规格交付管理入口）；②**环境组**——有序环境集合，场景批量执行/计划执行可按组选用，按组内顺序逐环境各生成一个执行任务（glossary「按序选用」语义）。兑现 PROJ-003 §1.2「组=S5 PROJ-006」登记。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                             | P1 ✅ | 后续                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| 全局参数：项目级单例编辑（KV 表格：key 1-64/value ≤2048/描述 ≤200；key 唯一，上限 100 条）；PUT 全量替换                                                         | ✅    | 参数启用勾选（当前全量生效）Backlog                   |
| 变量作用域链生效：临时 > 环境变量 > 全局参数（既有 buildEnvSnapshot 合并，入口交付后对全部执行链路自动生效）                                                     | ✅    | —                                                     |
| 环境组 CRUD：name(1-128 项目内唯一)+有序 environmentIds（去重、≤10 环境）；上限 20 组/项目                                                                       | ✅    | 组描述列（表无该列）Backlog                           |
| 按组执行：`POST scenarios/execute {scenarioIds, envGroupId}` 与计划执行 `{envGroupId}` → 按组内顺序逐环境各创建一个 ExecTask（任务名后缀 `@{环境名}`，串行创建） | ✅    | 组内环境并行策略 Backlog                              |
| 组内环境被删/失效过滤：展开时跳过软删环境；全失效→422 ENV_GROUP_EMPTY                                                                                            | ✅    | —                                                     |
| 引用校验：创建/编辑组时 environmentIds 须为项目内未删除环境（422 非法 id 列表）                                                                                  | ✅    | —                                                     |
| 组软删/恢复                                                                                                                                                      | ❌    | 表无 deletedAt 列——组为轻量编排对象，物理删除（登记） |
| 组导入导出                                                                                                                                                       | ❌    | Backlog（环境导入导出已有，组暂不跟随）               |
| 全局参数跨项目引用/组织级参数                                                                                                                                    | ❌    | Backlog                                               |

### 1.3 前置依赖

- `env_groups`（projectId/name/environmentIds Json）与 `global_params`（projectId 唯一/params Json）表已建齐（S0，零 DDL）。
- `buildEnvSnapshot`（environment.service L158-183）已实现 GlobalParam 底层合并——管理入口交付即全链路生效。
- 执行入口：`scenarios/execute`（API-008 批量）与 `plans/{id}/execute`（PLAN-003）请求体 additive 增 `envGroupId`。

### 1.4 对标基线核对

基线仅一句「环境组与全局参数（前后端均有该能力）」。完全复刻：能力存在性（管理入口+执行消费）。简化实现：组交互细节全部自主设计（基线无细节）——按序逐环境各建一任务（非基线明确语义，依 glossary「按序选用」推导并登记）；组物理删除。超出基线：无（克制）。

## 2. 业务逻辑

- **全局参数形态**：`global_params.params Json` 存 `Record<string,string>`（与 buildEnvSnapshot 消费形态一致）；UI 表格行编辑→前端序列化对象→PUT 全量替换（无乐观锁列，最后写胜，登记）；执行合并语义：环境 vars 覆盖同名全局参数（S2 既有）。
- **组展开**：`expandEnvGroup(groupId)` → 读组→过滤软删环境→返回有序 envId+envName 列表；空→422。
- **按组执行**：执行入口收 `envGroupId`（与 `envId` 互斥，同传 422）：对组内每个环境**串行**调用既有单环境建任务逻辑（任务名 `{原名}@{环境名}`），返回 taskId 数组；任一环境建任务失败即中止返回已建清单（幂等性由调用方重试保证，登记）。
- **删除保护**：删除环境不校验组引用（组展开时过滤即可，双向解耦）；删除组不影响历史任务（任务快照已内嵌）。
- **审计**：global-params PUT 与 env-groups CRUD 走 recordAudit。

## 3. UI/UX 设计（高保真 docs/design/PROJ-006-env-group-global-params/）

- 入口：环境管理页 `/settings/environments` 顶部增两 Tab：「环境」（既有）、「环境组」、「全局参数」（testid `tab-env-groups`/`tab-global-params`）。
- 环境组 Tab：工具栏新建+表格（组名/包含环境（有序 tag 列表，可拖拽排序）/环境数/更新时间/操作 编辑·删除）；新建/编辑弹窗：名称+环境多选（穿梭框或勾选列表，仅未删除环境）+已选有序区（上下移按钮调序）。
- 全局参数 Tab：KV 表格（key/value/描述，行增删复制）+ 保存按钮（整表全量提交）；顶部说明文案（作用域链提示：临时 > 环境变量 > 全局参数）。
- 执行侧：场景批量执行弹窗与计划执行弹窗的环境下拉新增「环境组」分组（组名展示+成员环境 tooltip）；选组后隐藏单环境下拉。
- 空态：组/参数均引导新建；组内环境全被删后执行弹窗该组置灰不可选。

## 4. 技术架构

- 数据模型：`env_groups`/`global_params` 零 DDL（组无软删列——物理删除，登记本规格 §8 勘误区之外的 §2 口径）。
- 契约（packages/shared/src/project/schemas.ts 增量）：`envGroupUpsertSchema`（name/environmentIds 1-10 去重）、`globalParamsUpsertSchema`（KV 数组→服务端转 Record，上限 100）；`scenarioExecuteSchema`/计划执行 schema 增可选 `envGroupId`（additive）。
- 端点：
  - `GET/POST /api/v1/projects/{projectId}/env-groups`（PROJECT_ENV:READ/CREATE）
  - `PATCH/DELETE /api/v1/projects/{projectId}/env-groups/{id}`（UPDATE/DELETE）
  - `GET/PUT /api/v1/projects/{projectId}/global-params`（READ/UPDATE）
  - 既有 `POST /api/v1/projects/{projectId}/scenarios/execute`、`POST /api/v1/projects/{projectId}/plans/{id}/execute` 增 `envGroupId`（互斥校验）
- 服务：`environment.service.ts` 增 `listEnvGroups/upsertEnvGroup/deleteEnvGroup/expandEnvGroup`、`upsertGlobalParams`；`exec.service` 执行入口增组分支（串行逐环境建任务）。
- 权限点：复用 `PROJECT_ENV:*`（无新增）。
- 错误码（20xxx）：`ENV_GROUP_NOT_FOUND 20460`、`ENV_GROUP_EMPTY 20461`（展开后无可用环境）。
- 前端：environments 页两 Tab+两弹窗；执行弹窗（场景批量/计划）组选择；api-client s5.ts。

## 5. 测试用例

- PROJ-006-T1（jmx 四类）：env-groups CRUD 主链/global-params PUT→GET 回读；401/403（无 PROJECT_ENV:CREATE）/404（坏组 id）；422（重名/环境 id 非法/超 10 环境/组超 20/KV key 重复超 100）；列表信封断言。
- PROJ-006-T2（spec 全局参数主链路）：全局参数设 `host=mock`（值指向 mock 域名变量）→ 场景引用 `${host}` 执行 → mock 收到请求（或报告变量终值断言）→ 改环境变量同名 key 覆盖生效（UI+Console+接口）。
- PROJ-006-T3（spec 环境组主链路）：建两环境（不同 vars）入组→场景批量执行选组→任务列表出现 2 个任务（名含 @环境名）→ 两任务报告变量取值各随其环境（三类断言）。
- PROJ-006-T4（spec 二态）：组内环境全删→执行选组 422 ENV_GROUP_EMPTY；envId 与 envGroupId 同传 422；无 PROJECT_ENV:CREATE 成员建组 403。
- 单测：expandEnvGroup 过滤/空判定；global-params 序列化（数组→Record/重复 key 拒绝）；按组执行任务名与顺序（mock exec.service 或集成服务级）；互斥校验。

## 6. 竞品深度对标

基线一句能力声明，本规格补齐前后端实体与执行消费即全覆盖。差异（均为基线无细节下的自主设计，登记）：①按序逐环境各建一任务；②组物理删除；③全局参数无启用勾选（全量生效）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：env-groups/global-params 端点 + 执行入口 envGroupId（additive，OpenAPI 快照 diff）。联调点：T2 变量链（mock 收包）、T3 双任务报告。验收=§5 用例全绿 + 概览演示主线「环境组/全局参数」段。

## 8. 勘误登记

无。
