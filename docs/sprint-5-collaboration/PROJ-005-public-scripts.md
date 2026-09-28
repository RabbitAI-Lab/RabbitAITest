# 公共脚本（脚本库 · 在线调试 · 前后置引用）

| 字段         | 内容                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PROJ-005                                                                                                                                                |
| 所属迭代     | Sprint 5 — 协作通知                                                                                                                                     |
| 优先级       | P2（迭代内 P1）                                                                                                                                         |
| 所属模块     | project 域（web 管理面）+ execution 契约（构建期展开，engine 保持无感知）                                                                               |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测 6（沙箱）+ JMeter 1 + Playwright 3 全绿；走查随验收）                                                           |     |
| 最后更新日期 | 2026-09-28                                                                                                                                              |
| 上游依赖     | PROJ-001（项目设置容器）、API-004（前后置处理器契约，登记「公共脚本引用(S5)」）、EXEC-003（内置函数）、PROJ-004（JAR 启用制登记）                       |
| 下游消费     | S8 QA-001（覆盖率核对「公共脚本」行）                                                                                                                   |
| 上游依据     | 需求文档 §三 M2（公共脚本：参数定义+多语言+在线调试+前后置引用）；功能清单 §8.5、§6.6                                                                   |
| 对标基线     | 功能清单 §8.5：项目级脚本库、定义传递参数（支持 Mock/JMeter 函数）、多语言脚本编写、在线调试（控制台）、前后置中引用执行、编辑/删除（删除影响引用用例） |
| 关联架构文档 | test-domain-model.md §2（public_scripts 表）；engine-execution-architecture §4（quickjs 沙箱 API 面）；api-conventions §4/§6（additive 契约变更）       |
| 高保真确认   | 待确认（原型 docs/design/PROJ-005-public-scripts/，人工确认待 Sprint 验收走查）                                                                         |
| 工作量估算   | 后端 2.5 人日 / 前端 2 人日 / 联调 1 人日                                                                                                               |

## 1. 概述

### 1.1 功能定位

项目级脚本库：集中维护可复用脚本（参数化），在线调试验证，被接口用例/场景步骤/环境全局的前后置处理器以 `scriptRef` 引用——构建期展开为内联脚本（engine 无感知，零执行契约破坏）。兑现 API-004「公共脚本引用(S5)」登记。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                                             | P1 ✅ | 后续                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------- |
| 脚本 CRUD：name(1-128,项目内唯一)/language 固定 javascript/tags(≤10)/params 定义/content；上限 100/项目                                                                                          | ✅    | —                                              |
| 参数定义：params=[{name, defaultValue, required}]（name 唯一 ≤64，默认值 ≤1024 支持 `${__fn}`/`@mock` 字面量——运行期由渲染链解析）                                                               | ✅    | 参数校验表达式 Backlog                         |
| 状态二态：DRAFT（默认）→ ENABLED（发布）↔ DRAFT（停用）；仅 ENABLED 可被引用；调试不限状态                                                                                                       | ✅    | 版本历史 Backlog                               |
| 在线调试：`POST {id}/debug {vars, params}` → `{logs, result, durationMs}`；web 侧 quickjs 沙箱（API 面与 engine processors 对齐：log/getVar/setVar/envGet/randomInt/now）；5s 超时强杀           | ✅    | 断点调试 Backlog                               |
| 前后置引用：处理器 script 类型新增可选 `scriptRef:{scriptId, params: Record<string,string>}`；构建期展开：content 内联+参数注入 vars（显式>默认>不注入）；api 用例/场景步骤/环境全局前后置三链路 | ✅    | 引用变更通知（脚本被改后提示引用方）Backlog    |
| 删除保护：被引用（扫描 api_cases/scenarios/environments 配置）→ 409 SCRIPT_IN_USE 附引用清单；`?force=true` 强删（引用处执行期按缺失处理 CONFIG_ERROR）                                          | ✅    | —                                              |
| 多语言：python3/groovy/beanshell                                                                                                                                                                 | ❌    | Backlog（引擎 quickjs-only，技术差异登记）     |
| 脚本引用 JAR（PROJ-004 jarEnabled 打通）                                                                                                                                                         | ❌    | Backlog（JS 沙箱无 JVM classpath，无法类加载） |

### 1.3 前置依赖

- `public_scripts` 表已建齐（S0，零 DDL）：projectId/name/language/status/tags/params/content/deletedAt+updatedAt。
- 执行契约：processor `script` 类型（shared execution schemas）——本规格 additive 扩展可选 `scriptRef`。
- 构建期命令组装点：`exec.service buildApiCaseCommands/buildScenarioCommands` 与环境 `config.prePost` 组装（S2/S3 已有）。

### 1.4 对标基线核对

完全复刻：脚本库 CRUD、传递参数定义（默认值支持函数字面量）、在线调试控制台、前后置引用执行、删除影响引用用例（409 保护+强删）。简化实现：多语言→仅 JavaScript（本项目引擎为 quickjs 纯 TS 沙箱，无 JVM/Python 运行时——基线五语言为 JMeter 生态差异，登记技术差异）；「内置代码片段插入公共脚本」不单独做编辑器片段面板（编辑器为纯文本域+函数提示文案）。超出基线：状态二态（DRAFT/ENABLED，配合「仅发布可引用」安全口径）；引用扫描清单返回（基线只说「影响」，本项目给出明确引用列表）。

## 2. 业务逻辑

- **发布/停用**：`PATCH {status}`（DRAFT→ENABLED=发布校验：content 非空、params 无重名；ENABLED→DRAFT=停用，既有引用不追溯阻断——执行期仍展开（引用处保留 scriptId+内容已展开于构建期，停用后新建引用禁止/执行时 scriptId 查不到→CONFIG_ERROR））。**执行口径定稿：展开发生在每次任务构建期**（非引用创建期快照），故停用/删除后新执行失败，历史报告不受影响。
- **调试语义**：`vars`（调用方注入变量池，String KV）+ `params`（本脚本参数值）；沙箱内 `getVar/setVar` 读写 vars 副本；`log()` 累积输出；返回 `{logs[], vars, durationMs}`；超时/运行时异常→422 SCRIPT_DEBUG_FAILED（msg 带首行错误）。
- **引用展开**（构建期，`resolveScriptRefs` 纯函数）：processor 为 script 且含 `scriptRef` 时——查脚本（不存在/非 ENABLED/DRAFT→该步骤 CONFIG_ERROR 语义：api 用例构建抛 422 引用无效；场景构建同）→ 参数合并 `params_explicit > params_default` 注入 vars 前缀 `param.{name}` → 生成内联 script processor（content 原文+头部注释标记来源）。
- **删除保护**：扫描 `api_cases.config`（processors JSON）+ `scenarios.steps` + `environments.config.prePost` 中 scriptRef.scriptId；命中→409（data 引用清单 [{type, id, name}]）；force=true 跳过保护物理软删。
- **上限**：100/项目（软删不计）；422 超限。

## 3. UI/UX 设计（高保真 docs/design/PROJ-005-public-scripts/）

- 入口：项目设置组「公共脚本」`/settings/public-scripts`（LeftNav `nav-settings-public-scripts`，perm `PROJECT_SCRIPT:READ`）。
- 列表页：工具栏（搜索+标签筛选+新建按钮）+ 表格（名称/标签/参数个数/状态 tag（草稿灰·已发布绿）/更新时间/操作 编辑·调试·发布/停用·删除（被引用删除弹确认显示引用清单））。
- 新建/编辑抽屉：名称/标签/参数定义表格（名/默认值/必填，行增删）/脚本内容 textarea（等宽字体，顶部提示可用 API：log/getVar/setVar/envGet/randomInt/now 与函数提示）。
- 调试抽屉：左=参数与变量注入表单（key/value 行编辑），右=控制台输出（日志行+耗时+结果 vars），底部「运行」按钮与超时错误红条。
- 空态：无脚本引导新建；停用状态行置灰但仍可编辑/调试。
- 引用侧：API-004 处理器编辑与场景步骤/环境前后置的「脚本」处理器类型下拉新增「引用公共脚本」——选择脚本（仅 ENABLED）+参数值表单（预填默认值）。

## 4. 技术架构

- 数据模型：`public_scripts` 零 DDL。
- 契约（packages/shared/src/project/schemas.ts 增量）：`publicScriptUpsertSchema`、`publicScriptDebugSchema`（vars/params）、processor schema 增可选 `scriptRef:{scriptId, params}`（execution 契约 additive，v4 兼容）。
- 端点：
  - `GET/POST /api/v1/projects/{projectId}/public-scripts`（READ/CREATE）
  - `GET/PATCH/DELETE /api/v1/projects/{projectId}/public-scripts/{id}`（READ/UPDATE/DELETE，PATCH 支持字段与 status 流转；DELETE 支持 ?force）
  - `POST /api/v1/projects/{projectId}/public-scripts/{id}/debug`（UPDATE 语义，调试）
  - `GET /api/v1/projects/{projectId}/public-scripts/{id}/references`（READ——引用清单，删除确认用）
- 服务：`apps/web/src/server/domains/project/public-script.service.ts`（CRUD/状态/引用扫描）、`script-sandbox.ts`（web 侧 quickjs：`runScriptDebug(content, vars, timeoutMs)`，复用 quickjs-emphasis 同款 API 面）；`exec.service` 构建 `resolveScriptRefs` 展开注入三链路。
- 沙箱：quickjs-emscripten（web 新增依赖，与 engine 同库）；5s 超时；日志上限 200 行截断。
- 权限点：`PROJECT_SCRIPT` 扩为四动作 `READ|CREATE|UPDATE|DELETE` 入库（预置组同步：PROJECT_ADMIN 全量、PROJECT_MEMBER 增 READ|CREATE、ORG_ADMIN 增 READ）。
- 错误码（20xxx）：`SCRIPT_NOT_FOUND 20450`、`SCRIPT_IN_USE 20451`、`SCRIPT_DEBUG_FAILED 20452`、`SCRIPT_INVALID_REF 20453`（引用不存在/非启用）、`SCRIPT_LIMIT_EXCEEDED 20454`（100）。
- 前端：`settings/public-scripts/page.tsx`（列表+两抽屉）；处理器编辑组件（api 用例/场景/环境三处）增「引用公共脚本」模式；api-client s5.ts。

## 5. 测试用例

- PROJ-005-T1（jmx 四类）：CRUD 主链（建含参数脚本→发布→列表断言 status）/引用清单；401/403（无 PROJECT_SCRIPT:CREATE）/404（坏 id）；422（重名/参数重名/超上限/引用非 ENABLED）；分页信封断言。
- PROJ-005-T2（spec 主链路）：新建脚本（定义参数 token 默认值）→ 调试抽屉运行（控制台日志+参数注入生效）→ 发布 → 列表状态 tag（UI+Console+接口）。
- PROJ-005-T3（spec 引用链路）：接口用例前置处理器引用该脚本（参数覆盖默认值）→ 执行 → 报告步骤日志含脚本 log 输出（参数值=覆盖值）；场景步骤引用同验；被引用脚本删除 → 409 引用清单弹窗 → force 删除 → 再执行 422（三类断言）。
- PROJ-005-T4（spec 二态）：DRAFT 不可被引用（引用下拉不出现+直连 API 422）；停用后再执行 422 SCRIPT_INVALID_REF；调试两态均可用。
- 单测：resolveScriptRefs 展开矩阵（显式>默认/缺参 required/非 ENABLED/嵌套场景步骤）；sandbox（log 采集/vars 读写/超时强杀/运行时错误映射）；引用扫描三处命中；上限与重名校验。

## 6. 竞品深度对标

基线 §8.5 全量核对：脚本库✓ 传递参数✓ 在线调试控制台✓ 前后置引用✓ 删除影响引用✓。差异：①多语言→JavaScript-only（quickjs 沙箱 vs JMeter JVM 生态，登记）；②JAR 引用不可行（无 classpath，Backlog）；③超出基线：状态二态、引用清单返回、参数默认值函数字面量沿既有渲染链。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：public-scripts 端点 + processor `scriptRef` additive 扩展（OpenAPI 快照 diff）。联调点：T3 三链路执行展开与报告日志断言。验收=§5 用例全绿 + 概览演示主线「公共脚本」段。

## 8. 勘误登记

无。
