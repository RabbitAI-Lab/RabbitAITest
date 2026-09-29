# 场景编排（五配置区·步骤树·单条执行）

| 元信息项     | 内容                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | API-006                                                                                                                              |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                                                |
| 优先级       | P1（迭代内）                                                                                                                         |
| 所属模块     | 接口测试（api_test 域）+ 执行（exec 域）+ 引擎（engine）                                                                             |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                   |
| 最后更新日期 | 2026-09-27                                                                                                                           |
| 上游依赖     | API-002/003（引用目标）、API-004（请求契约 v2 与编辑器）、PROJ-003（环境与数据源）、EXEC-002（池与调度）、PROJ-004（文件，CSV 关联） |
| 下游消费     | API-007（参数区）、API-008（批量/定时）、API-009（导入导出）、RPT-003（场景报告）、S4 PLAN-003（计划执行场景）                       |
| 上游依据     | 需求文档 §五「场景自动化」；功能清单 §6.5                                                                                            |
| 对标基线     | 功能清单 §6.5：五大配置区、步骤 7 类（复制或引用/自定义/循环×3/条件/仅一次/脚本/等待）、步骤操作、场景级操作、回收站、变更历史       |
| 关联架构文档 | engine-execution-architecture.md §2/§4（事件流 additive、kernel 纯函数）；test-domain-model.md §2.7                                  |
| 高保真确认   | 待确认（原型 docs/design/API-006-scenario-orchestration/，人工确认待 Sprint 验收走查——不可由 AI 代签）                               |
| 工作量估算   | 后端 6 人日 / 前端 8 人日 / 引擎 5 人日 / 联调 3 人日                                                                                |

## 1. 概述

### 1.1 功能定位

接口自动化的编排单元：一个场景=步骤树（7 类步骤嵌套）+ 五配置区（参数/前置/断言/设置），执行产生 scenario 类型任务与报告。本规格承载场景 CRUD/模块树/回收站/变更历史/单条执行/步骤编排交互与 SQL 前后置解禁；参数化细节见 API-007，批量与定时见 API-008。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                   | P1 ✅     | 后续                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| 场景 CRUD：名称/等级 P0-P3/状态/标签/模块归属（ModuleTreePanel scene=scenario）                                                        | ✅        | 自定义视图（Backlog）                                |
| 五配置区：参数（API-007）/前置后置（脚本/SQL/等待）/断言（变量断言）/设置（Cookie 策略·思考时间·失败规则）                             | ✅        | 全局前置开关（S5 环境增强）                          |
| 步骤 7 类：引用（api/case/scenario，复制 or 引用·完全引用/步骤引用）、自定义请求、循环（次数/While/ForEach）、条件、仅一次、脚本、等待 | ✅        | cURL 导入自定义步骤（编辑器内复用 API-002 既有能力） |
| 步骤操作：启用/禁用、复制、删除、添加子步骤、前后插入；批量展开/启用/禁用/删除                                                         | ✅        | 批量调试（单步执行=调试替代）                        |
| 步骤级配置：参数覆盖（API-007）、前后置、失败规则覆盖（继续/停止）、超时                                                               | ✅        | —                                                    |
| 场景级操作：执行（单条试执行）、执行历史、变更历史、复制                                                                               | ✅        | 关注（S4 DASH-002）、复制链接（S4 随报告分享扩展）   |
| 回收站：删除入站（软删）、恢复、彻底删除                                                                                               | ✅        | —                                                    |
| SQL 前后置解禁：环境数据源、只读事务强制、SELECT/WITH 白名单、参数绑定（S2 勘误清偿）                 | ✅ 勘误 2 | 数据源五家扩展（PLUG-004 已交付）                    |

### 1.3 前置依赖

Scenario/ScenarioStep 模型已建（S0 门禁 3）；`PROJECT_SCENARIO:READ/CREATE/UPDATE/DELETE` 权限码已入册；execCommandSchema 需扩展 scenario 分支（契约 v3 additive）。

### 1.4 对标基线核对

完全复刻：五配置区结构/步骤 7 类语义/循环三态/条件控制器/失败规则/回收站/变更历史。简化实现：变量断言为场景断言唯一形态（基线支持脚本断言，quickjs 脚本步骤已可等价表达，登记简化）；步骤引用「步骤引用」=引用目标场景的单步骤子树复制快照（基线引用联动更新，我们为快照+版本号提示，登记）；批量调试以「单步执行」替代（编辑态防误触，只跑当前步骤含其子树）。

## 2. 业务逻辑

- **步骤树**：ScenarioStep 自引用树（parentId），order 同级排序；stepType ∈ `ref_api|ref_case|ref_scenario|custom|loop|condition|once|script|wait`。控制器（loop/condition/once）可有子步骤；叶子=请求类（ref_*/custom）与操作类（script/wait）。
- **复制 vs 引用**：复制=保存时展开目标为独立步骤快照（与源解耦）；引用=存 refId+refMode（full=目标整体/steps=目标指定步骤子树），执行时解析为目标当前定义（跟随更新），列表展示引用标识。引用场景禁止循环引用（A→B→A 检测，422 50206）。
- **变量作用域链**（渲染取值优先级）：步骤提取 temp 变量 > 步骤参数（API-007）> 场景参数（常量/列表当前值/CSV 当前行）> 环境变量。写值：提取 scope=temp 进场景级 tempVars（跨步骤存活）；scope=env 汇总 task 回调写回环境。
- **失败规则**：settings.onFailure ∈ `continue|abort`（场景默认），步骤 config.onFailure 可覆盖；请求类步骤失败（断言/网络/脚本错）时按生效规则决定余步 SKIPPED（abort）或继续（continue，item 终态仍 FAILED）。
- **Cookie 策略**：settings.cookieMode ∈ `off|keep`（keep=采样器维护场景级 cookie jar 跨步骤携带响应 Set-Cookie）。
- **思考时间**：settings.thinkTimeMs 场景级每步骤间隔等待上限（实际等待=配置值，步骤 wait 类型独立另计）。
- **循环控制器**：loop.config ∈ 次数 `{mode:"count", count≤10000}` / While `{mode:"while", condition(quickjs 表达式), maxLoops≤10000 防死循环}` / ForEach `{mode:"foreach", var, source: list 名 or CSV 列名}`；循环体内步骤逐迭代执行，迭代变量注入作用域（foreach）/计数 `__loop_i` 注入（count/while）。
- **条件控制器**：condition.config.expression（quickjs 表达式，作用域变量可见）；假→子树整体 SKIPPED（帧记录跳过分组）。
- **仅一次控制器**：once 在循环体内首轮执行、后续迭代 SKIPPED；顶层等价普通分组。
- **SQL 前后置**（勘误 1：二次延后，处理器显式 CONFIG_ERROR）：设计口径留存——processor `{kind:"sql", datasource: 环境数据源名, sql, varMapping: {列名→变量}}`；执行约束：语句必须单条 SELECT（词法白名单）+ 连接开 `BEGIN READ ONLY` 事务；首行各列按 varMapping 写入 tempVars。
- **变更历史**：Scenario 保存（config/steps/name 变更）记 ChangeLog（scene=scenario，diff 摘要：步骤增删/参数变更分区标记），复用 S2 change-log 机制。
- **单条执行**：与 API-008 共用 createScenarioTask（scenarioIds=[id]）；场景详情内触发，跳报告。
- **单步执行**：请求类步骤试执行——以该步骤为根（含子树）构造临时场景执行，用于编排期调试（不产生场景报告，报告名含「单步调试」标识）。

## 3. UI/UX 设计（高保真 docs/design/API-006-scenario-orchestration/）

- **场景列表页** `/scenarios`：左模块树（ModuleTreePanel scene=scenario，计数=场景数）+ 右列表（名称(num)/等级/状态/标签/步骤数/最近执行结果徽标/更新时间/操作：执行·历史·编辑·复制·删除·回收站入口）+ 工具条（新建/批量执行/导入/导出/批量删除 + 筛选：等级/状态/标签）。
- **场景编辑页** `/scenarios/[id]`：顶部（名称/等级/状态/标签/保存/执行/单步提示）+ 左侧步骤树（拖拽排序、行内操作 hover：启用禁用/复制/删除/添加子步骤/前后插入；控制器折叠展开；批量操作工具条）+ 右侧Tab 五配置区：步骤配置（按 stepType 动态表单）/参数（API-007 原型）/前置后置/断言（变量断言列表）/设置（Cookie/思考时间/失败规则）。
- **自定义请求步骤**：复用 RequestEditor（bundle 受控契约，compact 模式）。
- **引用选择器**：弹窗树选 api/case/scenario + 引用模式（复制/完全引用/步骤引用）。
- **回收站 Tab**：已删场景列表（名称/删除时间/操作：恢复·彻底删除）。
- **变更历史抽屉**：时间线（操作人/时间/分区 diff 摘要）。
- **执行历史抽屉**：任务行（状态/耗时/时间）→报告链接（RPT-003）。

## 4. 技术架构

- 数据模型：Scenario/ScenarioStep/ChangeLog 已建齐，**零新列**（门禁 3 达成：S0 预建 config Json 五配置区）。种子：presets 补 scenario 默认模块「未规划场景」；module.service listModules 补 scenario 计数分支。
- 契约（packages/shared，`EXEC_CONTRACT_VERSION` bump 3，全 additive）：
  - `scenarioStepSchema`：`{ id, parentUid?, stepType, refId?, refMode?, name, enabled, order, config: 按 stepType 判别 }`；`scenarioCommandSchema` = execCommand 新分支：`{ kind:"scenario", scenarioId, name, envSnapshot, params, settings, steps: scenarioStepSchema[]（树）, onFailure }`。
  - 帧扩展：step-start/step-result 增加 optional `stepPath`（树序路径 `0.2.1`）与 `iteration?`（循环迭代号）；log 帧不变。报告树视图按 stepPath 聚合（RPT-003）。
  - `itemStatusSchema` 增加 `FAKE_ERROR`（API-010 消费；旧值不变）。
- 端点（前缀 `/api/v1/projects/{pid}`，zod 于 shared）：`GET/POST /scenarios`（分页+筛选：moduleId/keyword/level/status/tags/deleted=recycle）、`GET/PUT/DELETE /scenarios/{id}`（DELETE 软删）、`POST /scenarios/{id}/restore`、`DELETE /scenarios/{id}/purge`、`POST /scenarios/batch-delete`、`GET/PUT /scenarios/{id}/steps`（整树保存）、`POST /scenarios/{id}/execute`（{envId?, poolId?}）、`POST /scenarios/{id}/steps/{stepId}/execute`（单步）、`GET /scenarios/{id}/history`、`GET /scenarios/{id}/changes`、`POST /scenarios/{id}/copy`。
- 服务：`src/server/domains/api/scenario.service.ts`（CRUD/树保存/引用循环检测/复制/历史）；`exec.service.ts` 扩展 `createScenarioTask`：buildEnvSnapshot + 引用解析（refId→api/case 当前定义；ref_scenario 展开一层，深度≤5）+ CSV 预解析（行数组内嵌 command，行数≤10000）→ ExecTask(type=scenario) + 每 scenario 一个 ExecItem 预建 → 入队。
- 引擎（apps/engine）：`kernel/scenario.ts` 新增——递归执行器 `runScenario`（控制器循环/条件/once 语义、tempVars 作用域链、cookie jar（undici cookie 容器）、思考时间、失败规则、foreach 迭代注入）；单步复用 `runStep` 管线（渲染→前置→采样→提取→断言→后置）。SQL 处理器解禁：**勘误 1 二次延后**（方案冻结，门禁拦截），维持显式 CONFIG_ERROR；条件控制器经 `kernel/processors.ts evalCondition`（quickjs 求值）。
- 权限点：PROJECT_SCENARIO:READ/CREATE/UPDATE/DELETE（执行=CREATE 口径，S2 先例）；回收站恢复/彻底删除=UPDATE/DELETE。
- 错误码：`SCENARIO_NOT_FOUND 40426`、`SCENARIO_CIRCULAR_REF 42206`、`SCENARIO_STEP_NOT_FOUND 40427`、`SQL_NOT_SELECT 50031`（CONFIG_ERROR 语义）。
- 前端：`/scenarios` 列表页 + `/scenarios/[id]` 编辑页（StepTreePanel + StepConfigPanel + 五配置区 Tab）；api-client `s3.ts` scenarioApi。

## 5. 测试用例

- API-006-T1（jmx 四类）：场景 CRUD/steps 树保存/execute（mock 执行至终态断言 item 状态与 stepPath 帧）；401/403/404（含 purge）；steps 空场景执行 422、循环引用 422、SQL 非 SELECT 50031；列表分页信封+回收站两态。
- API-006-T2（spec 编排主链路）：建场景→引用接口用例+自定义请求+循环次数 3+条件+脚本+等待步骤→执行→报告步骤树按 stepPath 呈现、循环 3 迭代分组、条件假分支 SKIPPED（UI+Console+接口）。
- API-006-T3（spec 变量链）：步骤 A 提取 token→步骤 B 断言 `${token}` 渲染；场景参数覆盖环境变量同名（报告 requestSnapshot 断言渲染值）。
- API-006-T4（spec 失败规则二态）：断言失败步骤+onFailure=continue→后续步骤执行、item FAILED；=abort→余步 SKIPPED；步骤级覆盖生效。
- API-006-T5（spec 回收站+变更历史）：删除→列表消失+回收站可见→恢复回归；编辑步骤→变更历史记录分区摘要。
- API-006-T6（spec SQL 前后置勘误验证）：SQL 处理器在执行中显式 CONFIG_ERROR 失败不静默（勘误 1：解禁被静态门禁拦截二次延后；任务失败 message 含「SQL 处理器未启用」）。
- 单测：flattenSteps 树→序列矩阵（嵌套 loop/condition/once）、引用解析与循环检测、复制快照等价、SQL 白名单词法、runScenario 控制器语义（iteration 注入/while maxLoops/once 首轮）、失败规则覆盖矩阵、cookie keep 两态。

## 6. 竞品深度对标

基线 §6.5 主体覆盖；差异：①步骤引用=快照+跟随解析（基线引用树联动，深度≤5 登记简化）；②场景断言仅变量断言（脚本断言经脚本步骤等价，登记）；③本地执行入口延后（S5 个人中心，社区版服务端执行为主径）；④并发与调度自研（基线 netty/JMeter 内核）。SQL 数据源仅 PostgreSQL（基线四库，插件化后扩展）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。最重联调点：worker runScenario 与帧 stepPath 扩展（报告树视图正确性依赖），以及引用解析在 web 侧的展开与 engine 侧执行的一致性。

## 8. 勘误登记

- **勘误 1（2026-09-27，SQL 前后置二次延后）**：S2 API-004 勘误 1 承诺的「只读事务 + SELECT 白名单」方案本迭代评审冻结并实现（§2/§4），但静态安全门禁（Mimosa）对「执行测试人员自写 SQL 语句」的工具语义恒判 SQL 注入高危并拦截源码写入（S2 三轮收紧未解锁，S3 只读方案复现同样拦截）——**诚实延后，禁止绕过**。处理器维持显式 CONFIG_ERROR 失败（不假实现）；白名单+READ ONLY 方案代码留存于规格 §2，待门禁侧豁免机制（如 finding 级 accept）后一键启用。§1.2 能力行同步翻 ❌。影响用例：API-006-T6 改为断言「SQL 处理器 CONFIG_ERROR 显式失败」。
- **勘误 2（2026-09-30，SQL 前后置解禁——PLUG-004 承接）**：勘误 1 的冻结方案在 PLUG-004（数据库驱动五家）落地解禁：安全约束给出可满足条件（**外部输入全部参数绑定 + 仓库代码零 SQL 拼接**），处理器新增 `params`（{var|value}）绑定通道（仓库不提供变量→SQL 文本插值能力）；词法白名单落地为 `assertReadOnlySelect`（单条 SELECT/WITH、禁 INTO/FOR UPDATE/FOR SHARE、注释藏分号拦截，WITH=CTE 扩展登记）+ 各驱动 READ ONLY 事务 + 连接即关；消费面=引擎驱动注册表加载的五家驱动插件（`SQL_NOT_SELECT 50031` 首次兑现、新增 `DRIVER_PLUGIN_MISSING 50032`）。数据源自仅 PostgreSQL 扩展为五家（PROJ-003 勘误）。引擎 `processors.ts` 的显式禁用 throw 移除；T6 断言由「CONFIG_ERROR 显式失败」改为解禁语义，实际用例落位 PLUG-004-T3/T5（e2e 执行链路 + 单测全分支）。
