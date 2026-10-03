# 测试资产生成管线（代码库+文档+需求 → 测试点/用例/脚本·三阶段结构化生成·草稿确认导入）

| 字段         | 内容                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | AGENT-002                                                                                                                                                                                                                                                                                                                                                                              |
| 所属迭代     | Sprint 14 — 项目 Agent（第二规格）                                                                                                                                                                                                                                                                                                                                                     |
| 优先级       | P1                                                                                                                                                                                                                                                                                                                                                                                     |
| 所属模块     | project 域（agent 子域：pipeline 模式执行器/Context Builder/草稿与导入）+ ai 域复用（模型网关）+ scm 域复用（仓库读取）+ file 域复用（FileItem/FileRepo）                                                                                                                                                                                                                              |
| 文档状态     | **Implemented（2026-10-02 PR #53 合入 main：92f39d1，CI 15/15；待用户走查→Verified）**                                                                                                                                                                                                                                                                                     |
| 最后更新日期 | 2026-10-02                                                                                                                                                                                                                                                                                                                                                                             |
| 上游依赖     | **AGENT-001（ProjectAgent.mode/pipelineConfig 列、AgentRun/AgentRunMessage 轨迹、BullMQ 运行时、SSE、A2A 面）**、AI-002/003（case_gen/api_gen 场景先例——本管线为其泛化）、SCM-001（git-adapters 仓库读取·含分支列表/文件树）、FILE-001（FileItem/FileRepo 平台文档源）、API-009/011（OpenAPI 导入与同步）、UIT-002（UI 用例 8 指令 DSL）、UIT-003（Playwright 脚本模式与受信脚本概念） |
| 下游消费     | Backlog：AGENT-003 Runner 沙盒（脚本干跑验证）、pgvector 语义装配、需求变更增量生成、生成报告导出、A2A 面自动导入开关                                                                                                                                                                                                                                                                  |
| 上游依据     | 用户需求（2026-10-01）：基于代码库、文档、需求，生成测试用例及测试脚本；且不采用外部 Agent 框架（AGENT-001 §7 决策 8 自研路线）                                                                                                                                                                                                                                                        |
| 对标基线     | **超出 MeterSphere 基线**（社区版 AI 能力=提示词模板生成用例/接口用例两场景，无仓库/文档上下文装配与多阶段管线，自有增强）                                                                                                                                                                                                                                                             |
| 关联架构文档 | api-conventions.md（信封/长任务 taskId/错误码）、test-domain-model.md §6（建模纪律/门禁 3）、rules/security.md（注入缓解/出站守卫）、rules/testing.md（三类断言/四类场景）                                                                                                                                                                                                             |
| 高保真确认   | 待确认（原型 `docs/design/AGENT-002-asset-generation/` 已产出，待人工确认；确认人/日期待填）                                                                                                                                                                                                                                                                                           |
| 工作量估算   | 后端 5 人日 / 前端 4 人日 / 测试联调 3 人日（依赖 AGENT-001 P1 合入）                                                                                                                                                                                                                                                                                                                  |

## 1. 概述

### 1.1 功能定位

给项目 Agent 增加 **pipeline 运行模式**（`ProjectAgent.mode=pipeline`，列已在 AGENT-001 建齐）：面向「测试资产生成」这条具体生产线的**阶段化结构化生成管线**——不是自由对话循环，而是固定阶段序列，每阶段 LLM 输出**过 zod 校验的结构化产物**，全部先落**草稿区**，经 **diff 预览 + 人工确认**后走既有 service 导入。LLM 永不直写生产数据。

**输入源**（Context Builder 装配，预算制确定性采样，不引向量库；2026-10-02 用户决策定稿——文档双源、需求不接三方，§7 决策 9）：

1. **代码仓库**：项目绑定的 ScmRepository（多选，**每仓库选分支**——默认 defaultBranch）；**任务前置 ensure**：Agent 工作目录 `repos/` 未克隆则 clone、checkout 所选分支并 pull 最新（AGENT-001 §4.4 工作目录模型），装配从工作区本地读取（文件树 → 打分 → 定向读取）；
2. **仓库文档**：从所选仓库的文件树勾选文本类文件（md/txt/yaml/json 等，非文本置灰不可选）——与代码同源的文档；
3. **平台文档**：项目文件管理（FILE-001：FileItem 文件库/FileRepo 存储库）勾选，文本类 ≤1MB/文件；任务前置同步至工作目录 `platform-docs/`（全量、按 updatedAt 增量跳过）——**定位=不在仓库里的团队资产**（规范类/标准类/约定类：测试用例编写规范、安全测试基线、术语表等）；与 Skills 的分工：Skills=指令性（教 Agent 怎么做，注入提示词），平台文档=参考性（作为上下文数据装配）；
4. **需求**：粘贴文本（≤32KB）；**本版不做三方需求平台关联**（CaseDemandRef 消费与需求集成联动登记 Backlog）+（可选）既有功能用例作为参照集。

**三阶段**（可勾选组合，顺序执行）：

- **阶段 A 需求分析** → 测试点 + 功能用例草稿（AI-002 case_gen 的泛化：输入从「单段需求文本」升级为「装配后的上下文包」）；
- **阶段 B 接口资产提取** → 接口定义 + API 用例 + 场景草稿（两条路自动判优：仓库内检出 OpenAPI/Swagger 文档 → 复用既有 import.service 口径生成草稿；未检出 → 从路由/controller 代码提取接口清单 → AI-003 api_gen 泛化生成 API 用例与场景）；
- **阶段 C 脚本生成** → 场景用例 DSL（ScenarioStep 步骤树）/ UI 用例（UIT-002 八指令）/ Playwright 脚本（UIT-003 mode=script 形态，**默认开启**——生成侧 AST 静态校验 + 草稿人工确认 + 执行侧受信脚本口径三层兜底，§7 决策 5）。

消费面：UI **生成向导**（三步：源选择 → 阶段与选项 → 运行）与 **产物预览页**（草稿 diff、逐项勾选、批量导入）；A2A 面（外部 AI `SendMessage` 触发生成，产物=DataPart 草稿摘要——**导入仅限 UI 人工确认**，§7 决策 2）。

与 AGENT-001 关系：复用其 Agent 实体（mode 区分）、运行时宿主（BullMQ/Redis Stream/SSE）、轨迹（AgentRunMessage）、A2A 面与调试台壳（pipeline 模式调试台显示阶段进度而非对话）。

### 1.2 能力行（P1 全覆盖 → §5 用例映射）

| #   | 能力               | 交互口径                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 生成 Agent 创建    | AGENT-001 新建入口模板新增**「资产生成」**（mode=pipeline，role=CUSTOM）；pipeline 模式编辑抽屉：上下文默认源（仓库/文档目录过滤）·阶段默认开关·预算·高级参数（同 chat：模型/提示词追加段/runAs）                                                                                                                                                                                                                                                                                                                 |
| 2   | 上下文源配置       | 生成向导第一步：仓库多选卡片（**含分支下拉**[默认 defaultBranch，平台 REST 拉取]）·**仓库文档**文件树（**默认展开 docs/ 并一次获取其全部子目录**[递归 ≤500 截断]，其余目录懒加载；**默认不勾选任何文件**；**搜索框过滤 docs 目录与文件**；非文本置灰）·**平台文档**多选（FILE-001 文件库/存储库，文本类 ≤1MB/文件——规范类团队资产；**支持关键词搜索后勾选**，范围过滤 文件库/存储库/全部）·需求文本 textarea（≤32KB)·参照用例集开关（既有用例前 N 条入上下文供风格对齐，N≤20）；**不接三方需求关联**（§7 决策 9） |
| 3   | 阶段与选项         | 向导第二步：阶段 A/B/C 勾选（B 可选「仅 OpenAPI 路线/仅代码提取路线/自动」；C 可选产物形态：场景 DSL/UI 指令/Playwright 脚本，三形态默认全开可按需取消勾选）+ 每阶段数量上限（用例 ≤50/接口 ≤100/场景 ≤30）+ 附加指令 textarea（并入阶段提示词）                                                                                                                                                                                                                                                                  |
| 4   | 运行与进度         | 向导第三步 → AgentRun（source=UI）；阶段进度条（stage-start/stage-end/draft-append SSE 帧）+ 每阶段 LLM 调用与校验重试计数；可取消（阶段间隙）；轨迹复用 AgentRunMessage（role=assistant 带 stage 标记，role=tool 带装配/导入步骤）                                                                                                                                                                                                                                                                               |
| 5   | 阶段 A 产物        | 测试点（模块归属+一句话要点）+ 功能用例草稿（名称/前置/步骤/预期/模块/优先级/标签），结构化输出过 `functionalCaseDraftSchema`；校验失败项自动剔除并在草稿上标注 `INVALID_REMOVED`（不熔断整阶段）                                                                                                                                                                                                                                                                                                                 |
| 6   | 阶段 B 产物        | OpenAPI 检出 → 接口定义草稿（method/path/summary/参数骨架）；未检出 → 路由提取清单（用户确认口径：路径+方法+名称，置信度标记）；随后 API 用例草稿（断言骨架/环境变量引用）与场景草稿（步骤树骨架）；全部 `apiDefinitionDraftSchema` 等三 schema 校验                                                                                                                                                                                                                                                              |
| 7   | 阶段 C 产物        | 场景 DSL 草稿（引用阶段 B 接口，步骤树 ≤20 步）/ UI 用例草稿（八指令，元素引用 `elementId` 需存在于 UiElement 库否则标记 `ELEMENT_MISSING` 走占位）/ Playwright 脚本草稿（**默认开启**；静态 AST 校验通过才入草稿——失败项 INVALID 剔除；导入后按 UIT-003 受信脚本口径执行）                                                                                                                                                                                                                                       |
| 8   | 草稿冲突检测       | 产物预览页三态：**新增**（无冲突）/ **冲突**（功能用例=同模块同名；接口=同 method+path；场景/UI=同名——命中即标「与既有 X 冲突」，默认不勾选）/ **无效剔除**（校验失败被剔除项灰显留痕）                                                                                                                                                                                                                                                                                                                           |
| 9   | 产物预览与勾选     | 分类型 tab（测试点/功能用例/接口定义/API 用例/场景/UI 用例/脚本）；列表行展开预览（字段表格/步骤树/脚本代码块只读）；逐项勾选+全选；顶部统计条（各类型 新增 n·冲突 n·已选 n）；token 用量与耗时展示                                                                                                                                                                                                                                                                                                               |
| 10  | 确认导入（含去向） | 「导入所选」→ 逐项走既有 service（case.service/api import/scenario.service/ui service）落库；**部分成功**允许（失败项行内红字+错误码，可重试单条）；导入完成态：草稿置 IMPORTED/PARTIAL，引用 id 回写草稿（importedRef）。**导入去向双通道**（功能用例）：① 直接入库（status=PREPARING 未评审态，后续自行发起评审）② 入库并发起评审单（自动创建 CaseReview 纳入本次导入用例，评审通过后状态走既有工作流流转——**默认通道**）；接口/场景/UI 等其余类型直接入库（平台无对应评审域，登记说明）                        |
| 11  | 生成任务与留痕     | **每次生成即一个任务**（AgentRun，runId 唯一可追踪）：按平台长任务约定登记**任务中心**（进度=status，api-conventions §4）；Agent 页「运行记录」tab 为主查看入口（列表+详情），运行详情含草稿统计卡与「查看产物」直达按钮，产物预览页可回跳运行；AiGenRecord 扩展 scene=`pipeline_a                                                                                                                                                                                                                                | pipeline_b | pipeline_c`（promptSnapshot=上下文包 manifest+阶段提示词；generated/imported 计数） |
| 12  | A2A 触发生成       | pipeline Agent 开 A2A 后，`SendMessage`（输入=生成指令文本，如「对登录模块生成功能用例与场景」）→ 走 agent.pipelineConfig 默认源+阶段 → 产物=TextPart 摘要 + DataPart `{draftRunId, counts:{assetType:{new,conflict}}, a2aImport:false}`；导入仍需 UI 人工确认                                                                                                                                                                                                                                                    |
| 13  | 权限与配额         | 发起生成=PROJECT_AGENT:RUN；导入按资产类型既有权限点逐项断言（无权类型该 tab 禁用+提示）；每项目生成并发 1（队列内互斥同 agent）、单 Run 预算≤96K tokens+时长 ≤900s（Playwright 形态不再设额外权限开关——安全由 AST 校验+草稿人工确认+执行侧受信口径承载，§7 决策 5）                                                                                                                                                                                                                                              |
| 14  | 空态与引导         | 仓库/平台文档/需求文本**全空** → 下一步禁用+提示至少一项（仓库文档与参照用例为可选增强项）；无可用模型 → 顶部黄条（AGENT-001 #16 同口径）；阶段 B 无 OpenAPI 且无路由命中 → 产出行内提示改走阶段 A/C                                                                                                                                                                                                                                                                                                              |
| 15  | 采纳率统计         | **Run 级**：产物预览页统计条与运行详情显示「已采纳 n · 待决策 n · 采纳率 n%」；**Agent 累计级**：pipeline Agent 卡片显示累计采纳率（如 78.8%，127/161）；口径=已采纳(IMPORTED)/已决策(IMPORTED+DISCARDED+过期未决)，INVALID 剔除项不计分母；30 天到期未决草稿由清理任务置 DISCARDED（meta 标 expire）；数据源=agent_gen_drafts 聚合（AiGenRecord 计数同源校验）                                                                                                                                                   |

### 1.3 前置依赖

- **AGENT-001 P1 合入**（ProjectAgent.mode/pipelineConfig、AgentRun/AgentRunMessage、运行时宿主、SSE）；本规格新表一张（§4.1 agent_gen_drafts）。
- AI-002/003 的提示词模板与 JSON 解析先例（generate.service 泛化改造，保持既有 scene 不动）；AiModel 可用。
- SCM-001 仓库绑定与 git-adapters（含分支列表与文件树读取）；FILE-001 文件库/存储库（平台文档源）。

### 1.4 对标基线核对

超出 MeterSphere 基线：社区版 AI 仅「需求文本→功能用例 / OpenAPI→接口用例」两固定场景；本规格引入仓库/文档多源上下文装配、三阶段管线、场景/UI/脚本多形态产物与草稿冲突 diff 确认，均为自有增强。安全底线（草稿先行/人工确认/预算制装配）为基线未明示的本项目惯例增强。

## 2. 业务逻辑

### 2.1 Context Builder（装配器，纯函数 `packages/shared/src/agent/pipeline/builder.ts`）

**打分规则**（可测常量表 `CONTEXT_SCORING`）：

| 信号         | 权重 | 规则                                                                |
| ------------ | ---- | ------------------------------------------------------------------- |
| 扩展名       | +30  | `.http/.rest/.openapi/.swagger/.json(openapi 标记)/.md/.ts/.js/.py` |
| 目录约定     | +25  | 路径含 `src/api                                                     | routes | controller | endpoint | test | spec | docs` |
| 需求关键词   | +20  | 文件名/路径命中需求文本分词（去停用词，Top 20 词）                  |
| OpenAPI 特征 | +40  | 文件内容含 `openapi:`/`swagger:` 头部探测（前 2KB）                 |
| 排除         | −∞   | `node_modules/dist/build/.git/lock/minified` 与二进制扩展名         |
| 大小惩罚     | −10  | 单文件 >64KB（读入时截断至 64KB 并标注）                            |

**定位=上下文指引层（pi 会话驱动后收敛）**：打分排序产出**推荐路径清单**（manifest 留痕）与参照用例切片，由阶段消息指给 pi；**文件内容由 pi 在工作区自主读取**（不受平台装配预算约束，受 pi 会话上下文与迭代上限约束）；`contextBudgetTokens` 重新定义为**平台侧注入内容预算**（参照用例集/OpenAPI 清单摘要/需求文本）。**两轮装配**：① 拉文件树（≤2000 节点，超出按目录聚合采样；来源=工作区）→ 打分排序取 Top N（N=预算/均值的启发式）；② 定向读取 → 累计 tokens 超预算 → 低分项降级为「路径+首行摘要」，仍超则剔除。产物 **ContextBundle**：`{manifest:[{repoId,path,score,bytes,truncated}], sections:[{kind:repo|doc|requirement|cases, text}], tokenEstimate, truncated}`（tokenEstimate 为运行时留痕值，无向导预估展示）——**全量快照入 AgentRun.snapshot**（重放可复现），manifest 在预览页可见。

### 2.2 三阶段执行器（**pi 会话驱动 + draft.submit 工具桥**——§7 决策 10，2026-10-02 用户定稿）

```
出队 → 工作目录 ensure（repos checkout+pull / platform-docs 同步 / **创建 tasks/{taskId}（软链 repos·platform-docs 只读 + output/）**，AGENT-001 §4.4）
[阶段 B 且检出 OpenAPI] 平台确定性解析接口清单 → 写工作区 output/openapi-interfaces.json（不经 LLM，§7 决策 6）
拉起 pi 子进程（**cwd=tasks/{taskId}**；模型=Agent 配置；挂平台工具桥 + draft.submit 工具；repos//platform-docs/ 只读护栏=提示词声明+工具桥 realpath 拦截）
for stage of 勾选阶段（A→B→C 顺序消息，同一 pi 会话）:
  stage-start（SSE 帧 + 轨迹）
  发 pi 阶段任务消息 = 阶段指令模板（shared 单一来源，含输出契约=draft.submit 各 assetType schema 说明）
                    + 上下文指引（工作区相对路径清单：已选择文档/参照用例切片/OpenAPI 接口清单路径）
                    + agent.systemPrompt 追加段 + 用户附加指令
  pi 自主工作：读写工作区（repos/platform-docs）· 可调平台工具 · 经 draft.submit 分批提交草稿
      draft.submit（worker 侧执行）：zod 校验 → 非法项错误即时回传 pi 自纠（同项二次失败→剔除记 INVALID_REMOVED）
      → 数量上限服务端强制（超出拒收）→ conflict 批查 → 逐项写 agent_gen_drafts → draft-append SSE 帧
  阶段消息轮次结束（pi 终文答复）→ stage-end（帧含 counts）
终态 COMPLETED（output={counts, draftRunRefs}）| FAILED（供应商/超时/迭代超限，AGENT-001 §2.2 错误族 + 70852）
产物落位：结构化草稿走 draft.submit；**非结构化产物（报告/中间文件/脚本原件）由 pi 写 tasks/{taskId}/output/**——Run 完成后产物列表入运行详情（可下载/一键存入文件库，FILE-001 复用）；task 目录随草稿 30 天清理
```

阶段 B 路线：检出 OpenAPI → 接口定义草稿由确定性解析直出（不经 pi），pi 基于接口清单生成 API 用例/场景；未检出 → pi 从代码路由提取（产物带 confidence，低置信项默认不勾选）。阶段 C 依赖：场景形态需 B 已产接口（否则该形态禁用）；UI 形态消费 A 的用例步骤语义；Playwright 形态消费 A/B 任一。

### 2.3 需求提示词 AI 生成（向导内轻量调用）

- **默认提示词**：需求输入框预填「请根据文档，及所选代码库，生成测试用例。」（用户可直接使用/清空/编辑）；
- **AI 生成**：按钮触发**单次 LLM 调用**（agent 所配模型，`callChat` 无工具循环，不建 Run）：输入=已选仓库文档+平台文档的「文件名+每份首 2KB 摘录」（总量 ≤16K tokens，超限截断），系统指令=输出 ≤1K 字符精简中文提示词（聚焦测试目标/范围/关注点，不罗列文档原文）；结果回填 textarea 可编辑；
- **边界**：未选任何文档 → 按钮禁用（接口侧 422 复用 70804 语义）；失败 toast 可重试；token 用量记 `logFor("agent-pipeline")`（不建 Run、不入 AiGenRecord——非生成任务）。

### 2.4 草稿模型与冲突口径

- 草稿行级表 `agent_gen_drafts`（§4.1）；conflict 检测在写入时批查：功能用例 `moduleId+name`、接口 `method+path`、场景/UI/脚本 `name`——命中=CONFLICT（携带既有对象引用展示），默认 `selected=false`；
- 草稿生命周期：`PENDING → IMPORTED | FAILED | SKIPPED | DISCARDED`（行级；FAILED 可重试回 PENDING，DISCARDED=显式废弃不可恢复）；Run 级汇总 `DRAFT | PARTIAL | IMPORTED | DISCARDED`；
- 重复导入防护：已 IMPORTED 行不可再选；Run 终态后草稿保留 30 天（随清理任务——cleanup 先例），到期未决行由清理任务置 DISCARDED（meta 标 expire）后删除——保证采纳率分母可收敛。

### 2.5 导入与采纳（人工确认红线）

- 逐资产类型走既有 service 事务（功能用例 case.service 批量、接口 api import、场景 scenario.service、UI ui.service），导入身份=操作用户（非 runAs——生成是 Agent 的事，导入是人的事）；
- **导入去向双通道**（仅功能用例，导入时单选；其余类型直接入库——平台无对应评审域，登记说明）：
  - **直接入库**：FunctionalCase 以 `status=PREPARING`（未评审态）入库，后续由用户自行发起评审（既有 CASE-005 流程）；
  - **入库并发起评审**（**默认**）：导入同时自动创建 CaseReview（名称=`AI 生成·{MMDD}·{模块}`，reviewers 默认=操作人可改，mode=SINGLE），本次导入用例逐条挂 ReviewCase；评审通过后用例状态按既有工作流流转——「review 后才生效」由既有评审域背书；
- 权限断言按资产类型既有权限点（PROJECT_CASE:CREATE 等，发起评审另需既有评审创建权限），无权类型 tab 禁用；
- 部分成功：失败行 `error` 落库+行内展示+可重试单条；成功行 `importedRef={type,id,num}` 回写（评审去向额外记 `{type:"review",id}`）；
- **废弃（显式不采纳）**：行级/批量「废弃」动作 → DISCARDED（不可恢复，留痕）；30 天到期未决由清理任务置 DISCARDED（meta.expire=true）后物理清理——保证采纳率分母可收敛；
- **采纳率口径**：`已采纳 IMPORTED / 已决策（IMPORTED + DISCARDED 含过期）`；INVALID 剔除项不计分母，CONFLICT 项决策后计入对应态；Run 级与 Agent 累计级双展示（§1.2 #15）；
- AiGenRecord 留痕：scene=`pipeline_{a|b|c}`，promptSnapshot=manifest+阶段提示词，generatedCount/importedCount 落库（既有列表页可查，与 drafts 聚合互校）。

### 2.6 审计与观测

- 审计：`agent_gen.run`（源摘要+阶段+预算）/`agent_gen.import`（类型计数+成功失败数+去向 direct|review）/`agent_gen.discard`（计数）；导入内层由既有 service 审计兜底；
- 日志 `logFor("agent-pipeline")`：runId/stage/llmCalls/retryCount/tokens/draftCounts；
- 指标：复用 prom-client 既有面（stage 耗时直方图、校验剔除计数、采纳率 gauge）——INFRA-007 惯例。

## 3. UI/UX 设计（高保真 `docs/design/AGENT-002-asset-generation/`——已产出，待人工确认）

- **生成向导**（入口：pipeline Agent 卡片「发起生成」/ 运行记录空态；全屏向导三步，perm=PROJECT_AGENT:RUN）：
  - 步骤①**上下文源**：仓库卡片多选（平台徽标/**分支下拉**/最近提交）→ **仓库文档**文件树面板（**默认展开 docs/ 一次拉全子目录**、其余懒加载、**默认全不勾**、**搜索框过滤 docs 目录与文件**、非文本置灰；提示代码文件由阶段 B 自动采样可不勾）→ **平台文档**面板（**搜索框+范围过滤（全部/文件库/存储库）后勾选**，行显示文件名/大小/来源 tag，非文本置灰；典型=规范类团队资产）→ 需求 textarea（**预填默认提示词**+**「AI 生成」按钮**[sparkles 图标，未选文档置灰，生成中 loading，回填可编辑]+**勾选文档自动拼接「已选择文档:」末行**[前端联动，幂等替换；条目=工作区相对路径 repos/… · platform-docs/…]；无三方需求选择器）+ 参照用例开关；**无装配预估**（预算为 Agent 级配置[pipelineConfig.contextBudgetTokens，编辑抽屉·默认 48K·16K–96K]，运行时超限自动按分数裁剪并在 Run 结果标注 truncated——2026-10-02 用户决策去掉向导内预估展示与 dry-run 接口）；
  - 步骤②**阶段与选项**：阶段 A/B/C 卡片勾选（各含产物形态与上限输入；B 路线三选；C 三形态开关默认全开，Playwright 带「AST 校验+人工确认+受信执行」说明 tooltip）+ 附加指令 textarea；
  - 步骤③**运行**：阶段进度条（三段式，当前阶段旋转指示）+ 实时轨迹滚动（stage-start/LLM 调用/校验剔除计数/draft-append 逐条出现）+ 取消按钮；完成态显示汇总计数卡+「查看产物」主按钮。
- **产物预览页**（向导完成跳转，亦可从运行记录进入，perm=READ+导入需对应 CREATE）：
  - 顶部统计条：各类型 tab（测试点 n·功能用例 n·接口 n·API 用例 n·场景 n·UI 用例 n·脚本 n）+ 新增/冲突角标 + **采纳率**（已采纳 n · 待决策 n · n%，悬停展开口径）+ token/耗时；右上「导入所选 (n)」「废弃所选」；
  - 导入去向（功能用例 tab 内）：单选「直接入库（未评审态）」/「入库并发起评审（默认，评审通过后生效）」+ 评审人下拉；
  - 列表行：勾选框（冲突/无效默认不勾）+ 名称 + 关键字段摘要 + 三态徽标（新增绿/冲突橙·悬停展示既有对象链接/无效灰·悬停展示剔除原因）+ 展开预览（功能用例=字段表+步骤；场景=步骤树；UI=指令序列表；脚本=只读代码块）+ 行操作（废弃）；
  - 导入结果态：成功行绿勾+落库编号（CASE-0123；评审去向追加评审单链接）、失败行红字错误码+「重试」、废弃行灰态 DISCARDED；底部完成条（成功 n/失败 n/废弃 n）。
- **运行任务查看**（§1.2 #11）：「运行记录」tab（AGENT-001 复用）为主入口——pipeline 行草稿徽标显示「采纳 n/m」；运行详情抽屉追加**草稿统计卡**（各类型 计数/已采纳/采纳率）+**任务产物区**（tasks/{taskId}/output/ 文件列表：下载/一键存入文件库——FILE-001 复用）+「查看产物」直达；pipeline Run 同步登记**任务中心**（进度=status）；pipeline Agent 卡片显示累计采纳率（AGENT-001 §3 卡片字段的本规格扩展）。
- **pipeline 模式编辑抽屉变体**（AGENT-001 编辑抽屉复用，工具/Skills 分区隐藏）：基本信息（mode=pipeline 标记）→ 模型与参数 → 提示词（追加段）→ **上下文默认源**（仓库/文档目录过滤/需求模板）→ **阶段默认**（A/B/C 勾选与上限/路线/形态）→ 高级（runAs/预算/**默认导入去向**）→ A2A（同 AGENT-001）。
- 空态与引导三态（无源/无模型/阶段 B 无命中）按 §1.2 #14。

## 4. 技术架构

### 4.1 数据模型（一张新表；ProjectAgent 两列已在 AGENT-001 建齐）

```prisma
/// 生成管线产物草稿（AGENT-002；行级——支持部分导入与逐项状态；30 天清理）
model AgentGenDraft {
  id            String   @id @default(uuid())
  runId         String   @map("run_id")
  run           AgentRun @relation(fields: [runId], references: [id])
  projectId     String   @map("project_id")
  project       Project  @relation(fields: [projectId], references: [id])
  stage         String   @db.VarChar(16) // A | B | C
  assetType     String   @map("asset_type") @db.VarChar(32) // test_point|functional_case|api_definition|api_case|scenario|ui_case|playwright_script
  name          String   @db.VarChar(255)
  payload       Json // 类型化草稿载荷（shared 各 assetType schema）
  meta          Json? // 置信度/来源文件/INVALID_REMOVED 原因等
  conflictStatus String  @default("NEW") @map("conflict_status") @db.VarChar(16) // NEW | CONFLICT | INVALID
  conflictRef   Json?    @map("conflict_ref") // 冲突既有对象 {type,id,num,name}
  selected      Boolean  @default(false) // 预览页勾选态（持久化——刷新不丢）
  importStatus  String   @default("PENDING") @map("import_status") @db.VarChar(16) // PENDING|IMPORTED|FAILED|SKIPPED|DISCARDED（DISCARDED=显式废弃/过期未决，meta.expire 区分）
  importedRef   Json?    @map("imported_ref") // {type,id,num}；评审去向追加 {type:"review",id}
  error         String?  @db.VarChar(512)
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  @@index([runId, assetType])
  @@index([projectId, createdAt])
  @@map("agent_gen_drafts")
}
```

AgentRun 增反向 `genDrafts AgentGenDraft[]`；Project 增 `agentGenDrafts AgentGenDraft[]`。`pipelineConfig` 形状（zod，shared）：`{repos:[{repoId,branch}], stages:{a:bool,b:"auto"|"openapi"|"extract"|"off",c:{scenario:bool,ui:bool,playwright:bool}}, limits:{cases,apis,scenarios}, contextBudgetTokens, docPathFilter?(仓库文档默认路径过滤·正则), requirementTemplate?}`。

### 4.2 契约（packages/shared/src/agent/pipeline/：builder.ts + stages.ts + drafts.ts）

- `contextBundleSchema`/`CONTEXT_SCORING`/`pipelineConfigSchema`；
- 阶段产物 schema：`testPointSchema`/`functionalCaseDraftSchema`/`apiDefinitionDraftSchema`/`apiCaseDraftSchema`/`scenarioDraftSchema`（对齐 execution ScenarioStep）/`uiCaseDraftSchema`（对齐 uit uiStepSchema）/`playwrightScriptDraftSchema`（string + AST 校验标记）——**尽量 re-export 既有域 schema 再扩展草稿字段**，避免双源漂移；
- `genRunRequestSchema`（sources+stages+options）/`draftListSchema`/`draftImportRequestSchema`/`suggestRequirementSchema`（{repoIds,docPaths,fileIds}→{text}）；
- 阶段指令模板（三段，含注入缓解守则）`STAGE_PROMPTS`。

### 4.3 API 端点（会话面；A2A 面复用 AGENT-001 不新增）

```
GET  /api/v1/projects/{pid}/agents/{aid}/sources/repo-tree  # 仓库文档树（?repoId&branch&path=；缺省返回根+docs/ 递归子树一次拉全[≤500 截断]，指定 path=按需懒加载）PROJECT_AGENT:READ+PROJECT_REPO:READ
     # 平台文档搜索复用 FILE-001 既有文件列表接口（keyword+来源过滤），不新增端点
POST /api/v1/projects/{pid}/agents/{aid}/suggest-requirement # 需求提示词 AI 生成（单次 LLM；未选文档 422）PROJECT_AGENT:RUN
POST /api/v1/projects/{pid}/agents/{aid}/generate          # 发起管线 → {runId}              PROJECT_AGENT:RUN
GET  /api/v1/projects/{pid}/agent-runs/{runId}             # AGENT-001 既有（output 扩展 counts）
GET  /api/v1/projects/{pid}/agent-runs/{runId}/drafts      # 草稿分组信封（assetType 分组+冲突标注） PROJECT_AGENT:READ
PUT  /api/v1/projects/{pid}/agent-runs/{runId}/drafts/select  # 勾选态批量保存               PROJECT_AGENT:READ（操作本人草稿）
POST /api/v1/projects/{pid}/agent-runs/{runId}/drafts/import   # 导入选中（逐类型权限断言；body 含去向 direct|review） 按资产类型 CREATE 权限
POST /api/v1/projects/{pid}/agent-runs/{runId}/drafts/discard  # 批量废弃（显式不采纳）       PROJECT_AGENT:READ（同 select）
GET  /api/v1/projects/{pid}/agents/{aid}                    # AGENT-001 既有（详情聚合追加 累计生成/采纳/采纳率）
```

pipeline Run 建立时按长任务约定登记**任务中心**（进度=status 同步；api-conventions §4——具体登记走既有 task-center service，不另起端点）。

### 4.4 运行时（复用 AGENT-001 宿主）

pipeline 执行器注册为 `agent-run` 队列的第二类 job processor（`jobKind: "chat" | "pipeline"`，同 Agent 分组串行——与 chat 共享工作目录与 ensure 步骤：出队后先执行 repos checkout+pull 与 platform-docs 同步，轨迹留痕）；**pipeline 同样由 pi 子进程执行**（§2.2：同一 pi 会话按 A→B→C 顺序消息推进，草稿经 draft.submit 工具桥提交——zod 校验/上限/conflict 全在 worker 侧）；SSE 帧扩展 `stage-start/stage-end/draft-append`（帧 schema 进 shared，与既有帧并集）；OpenAPI 解析复用 import.service 解析器抽出纯函数（不落库、产出草稿 payload）；Playwright AST 校验用既有 playwright-core 依赖（UIT-003 已引）做 `parse`（不执行）。

### 4.5 安全与配额

- clone/pull 出站=git 协议至仓库 host（SCM-001 绑定时已验证；凭据经环境变量注入子进程不落盘）；装配只读工作区本地 FS；文档读取限文本类 ≤1MB/文件；
- 注入缓解：仓库/文档内容全部走 ContextBundle 定界包裹（AGENT-001 §4.5 同法），阶段指令含「产物只允许本 schema 字段」强约束；
- 配额：单项目同 agent 生成并发 1（BullMQ jobId 互斥——UIT-004 重试安装 jobId 时戳坑的正面用法）；预算 ≤96K tokens、时长 ≤900s、各类型数量上限（§1.2 #3）；A2A 触发同配额。

### 4.6 错误码（envelope.ts 单一来源；AGENT-001 706xx/707xx 之后顺延 708xx）

```
// 708xx 生成管线（AGENT-002）
AGENT_GEN_SOURCE_EMPTY: 70804      // 未选仓库且需求文本为空（422）
AGENT_GEN_CONTEXT_EMPTY: 70805     // 装配后无有效内容（422，与 70804 区分：有源但全被裁剪/排除）
AGENT_GEN_BUDGET_INVALID: 70822    // 预算/上限参数越界（422）
AGENT_DRAFT_NOT_FOUND: 70834
AGENT_DRAFT_NOT_IMPORTABLE: 70839  // 非 PENDING/已导入（409）
AGENT_GEN_BUSY: 70841              // 同 Agent 已有进行中生成（409）
AGENT_GEN_STAGE_FAILED: 70852      // 阶段重试后仍失败（Run FAILED 载因，产物部分保留）
```

## 5. 用例表（tests/ 映射）

| 用例编号          | 类型       | 覆盖（能力行 #）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AGENT-002-U1..U13 | Vitest     | builder 打分/两轮装配/预算裁剪/truncated、**需求提示词 AI 生成（输入拼装/2KB 摘录截断/输出 ≤1K 字符/未选文档 422——mock callChat）**、draft.submit 工具桥（zod 校验/自纠二次失败剔除/上限拒收——mock pi 适配层）、任务目录创建与软链（含失败 70704）、只读护栏 realpath 拦截（写 repos//platform-docs 拒、写 output/ 放行）、output/ 产物列表与存文件库、三阶段顺序消息推进、OpenAPI 探测分支与接口清单落工作区、conflict 三态检测、部分导入与重试、**导入去向双通道（评审单自动创建+reviewers 默认）**、**采纳率聚合口径（含过期未决/INVALID 不计分母）**、**废弃与 30 天过期清理**、**任务中心登记**、AiGenRecord 留痕、pipelineConfig 校验、并发互斥 jobId、SSE 帧扩展 |
| AGENT-002-T1..T6  | JMeter     | generate 正常路径、源全空 422（未选仓库且需求为空）、无权导入 403、草稿列表信封、import 幂等（重复导入 409）、generate 409（AGENT_GEN_BUSY）、discard 后再导入 409、import 去向 review 评审单创建断言                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AGENT-002-E1..E5  | Playwright | 向导三步联动（仓库树默认展开 docs/且全不勾+搜索过滤、平台文档搜索+范围过滤[mock tree/文件接口]、**需求框默认值断言+AI 生成按钮态与回填[mock suggest]+勾选/取消文档后「已选择文档:」行实时更新**）、运行进度+取消（mock SSE）、产物预览勾选/冲突徽标/导入结果三态/**去向 radio+评审人下拉**/废弃（mock LLM 产物）、运行记录草稿徽标与详情统计卡跳产物、pipeline 编辑抽屉变体；全程 console/network 断言                                                                                                                                                                                                                                                                  |

§1.2 #11/#12/#13/#14/#15 由 U×T×E 组合覆盖（交叉映射表随实现 PR 展开）。

## 6. Backlog（登记不实现）

pgvector 语义装配升级 · **三方需求平台联动输入源**（需求集成打通后：CaseDemandRef/PlatformSync 快照作为阶段 A 输入）· 需求变更增量生成（diff 需求→补充用例建议）· 脚本干跑验证（AGENT-003 Runner：草稿一键 dry-run 出报告）· A2A 面自动导入开关（白名单外部主体+二次确认）· 生成报告导出（markdown/excel）· 失败用例反馈迭代生成 · 多语种 UI 用例（元素库自动建元素草稿）。

## 7. 实现决策（评审重点——如有异议请批注）

1. **管线模式挂在 ProjectAgent（mode=pipeline），不另起 GenJob 实体**：复用 AGENT-001 运行/轨迹/A2A/权限全套；管线与对话是同一实体的两种模式，配置面与运行台账一份。
2. **A2A 只生成不导入**：外部 AI 可触发生成拿草稿摘要，**导入永远 UI 人工确认**——LLM 产物进生产数据的人为红线；后续「自动导入开关」作为 Backlog 带白名单再议。
3. **上下文装配确定性打分，v1 不引向量库**：预算制+规则打分可单测可复现（快照留痕）；pgvector 升级登记 Backlog（涉及中间件引入，届时架构评审）。
4. **草稿行级表+部分导入**：行级状态支撑勾选/重试/留痕；30 天清理复用 cleanup。
5. **阶段 C 三形态默认全开（2026-10-02 修订，原「Playwright 默认关+UPDATE 权限开启」经用户质询后放开）**：生成测试脚本是管线核心诉求，安全由三层既有机制承载——①生成侧 AST 静态校验（失败项 INVALID 剔除不入草稿）；②草稿人工确认导入红线（与其他产物同权）；③执行侧 UIT-003 受信脚本口径（导入后执行仍按既有受信管理）。不设额外权限开关；干跑验证作为 AGENT-003 增强（导入前可选 dry-run 报告）。
6. **OpenAPI 路线确定性优先**：检出即由平台确定性解析直出接口定义草稿（不经 pi），解析产物写入工作区供 pi 生成用例/场景引用——能确定的不让模型编。
7. **依赖节奏**：AGENT-001 P1 → 本规格 PR-3（AGENT-001 P2 A2A 面可与本规格并行，无依赖）。
8. **人工评审前置与采纳率（2026-10-02 用户要求回填）**：产物**永不直写用例库**——草稿 → 人工决策（导入/废弃）两动作收敛，30 天过期未决自动计未采纳（分母可收敛、采纳率不虚高）；功能用例导入默认走「**入库并发起评审**」复用 CASE-005 既有域（评审通过才翻已评审态），「直接入库」= PREPARING 未评审态二选一；采纳率=IMPORTED/(IMPORTED+DISCARDED 含过期)，Run 级+Agent 累计双展示，AiGenRecord 计数互校；每次生成=一个任务（AgentRun 登记任务中心），运行记录 tab 为主查看入口。
9. **输入源定稿（2026-10-02 用户决策，两轮）**：① 仓库维度增**分支选择**（默认 defaultBranch，git-adapters 拉分支列表，repo.* 工具与 pipelineConfig.repos 均带 branch）；② 文档**双源**——仓库文档（从仓库文件树勾选，与代码同源）+ **平台文档保留**（FILE-001 文件库/存储库，定位=不在仓库里的规范类/标准类/约定类团队资产；与 Skills 分工：Skills=指令性注入提示词，平台文档=参考性装配上下文）；③ 需求=粘贴文本，本版不接三方需求平台（平台虽有 CaseDemandRef 既有能力，不作为生成输入，联动登记 Backlog）。
10. **两种模式统一由 pi 生成（2026-10-02 用户两轮定稿）**：初版我曾把 pipeline 设计为平台侧 chat-client 直调（阶段确定性/可测性），用户定稿推翻——**生成就是 Agent 的活，pipeline 同样跑 pi 子进程**：同一 pi 会话按 A→B→C 顺序消息推进，pi 在工作区自主读代码/文档；结构化产物经 **draft.submit 工具桥**回 worker（zod 校验即时反馈自纠、数量上限服务端强制、conflict 批查），草稿人工确认红线与采纳率口径不变。确定性保留在两处：OpenAPI 解析直出（决策 6）、draft 层 zod 合同；可测性以 mock pi 适配层（AgentRuntimeKernel 薄接口）实现。
