# UIT-003 UI 测试脚本模式（Playwright 直录直执行）

| 元信息项     | 内容                                                                                                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | UIT-003                                                                                                                                                        |
| 所属迭代     | Sprint 13 — UI 测试脚本化（AI 时代工作流）                                                                                                                     |
| 优先级       | P1（用户直提：AI 时代表单式步骤编排不满足要求，须直录 Playwright 脚本 + runner 直执行）                                                                        |
| 所属模块     | UIT UI 测试 / EXEC 执行（引擎 ui script runner）                                                                                                               |
| 文档状态     | **Implemented**（PR #38：脚本直录/官方 runner 直执行/校验干跑/测试树+trace 报告全量交付；**远端 CI 全绿**（run 36844501785：e2e×3/JMeter×2/lint+unit/build/迁移重放/审计/性能基线/CLI 11 作业 + perf 工作流），待用户走查翻 Verified） |
| 最后更新日期 | 2026-10-01                                                                                                                                                     |
| 上游依赖     | UIT-002（UI 测试模块：任务面/事件流/截图上传/报告页先例）、EXEC-002（池/队列/停止链）、FILE-001（internal/files 存储）                                         |
| 下游消费     | AI 生成 UI 脚本（对接 AI-004 对话式生成，P2）、内嵌 trace viewer（P2）、录制器（不做，红线同 UIT-002）                                                         |
| 上游依据     | 用户诉求（2026-10-01）：「UI 测试，ai 时代这样是不满足要求的，需要支持直接录入 playwright 脚本，并且 runner 需要能够直接执行 playwright 脚本」                 |
| 对标基线     | MeterSphere功能清单 §12.10（v1/v2 UI 测试=Selenium 指令序列，无脚本直录）；AI 时代工作流：AI 助手直接产出标准 Playwright Test 脚本                             |
| 关联架构文档 | engine-execution-architecture.md、tech-stack.md（engine 增 @playwright/test、web 增 CodeMirror 6 依赖登记）、rules/engine.md §6（沙箱例外修订）                |
| 高保真确认   | **已确认**（确认人：xujialiang；确认日期：2026-10-01；原型链接：docs/design/UIT-003-playwright-script/index.html；确认口径：「执行吧」——三项架构决策一并认可） |
| 工作量估算   | 后端+引擎 2.5 人日 + 前端 2.5 人日 + 测试 1.5 人日（合计 ≈ 6.5 人日）                                                                                          |

## 1. 概述

### 1.1 功能定位

AI 时代测试脚本的生产方式已变：人 + AI 助手直接产出**标准 Playwright Test 脚本**。平台价值不再是「表单化编排步骤」，而是**收下脚本 → 稳定执行 → 可视化报告 → 持续回归**。本规格把 UI 测试模块的主形态从「步骤指令序列」（UIT-002）升级为「Playwright 脚本直录直执行」：

- **直接录入**：用例编辑器以代码编辑器为主体，粘贴/编写标准 Playwright Test 脚本（AI 产出零改造直接可用）；
- **直接执行**：引擎子进程运行**官方 `playwright test` runner**（语义零漂移：fixtures/test.describe/beforeEach/expect web-first 断言全支持），复用既有 ExecTask 任务面与事件流；
- **增强报告**：测试树（describe>test 两级）+ 失败错误代码帧 + 失败截图 + **trace.zip 下载回放**；
- **存量兼容**：步骤模式（UIT-002）全量保留可编辑可执行，脚本模式为新建默认形态。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                         | P1 ✅ | 后续                                          |
| ---------------------------------------------------------------------------- | ----- | --------------------------------------------- |
| 脚本用例 CRUD（mode=script；script≤100KB；软删）                             | ✅    | —                                             |
| 代码编辑器（CodeMirror 6：TS 高亮/行号/搜索；模板下拉四套）                  | ✅    | API 自动补全/格式化（P2）                     |
| **校验脚本**（引擎干跑 `playwright test --list`：用例清单/编译错误定位）     | ✅    | —                                             |
| 参数注入（用例级 KV → 子进程 env `RABBIT_PARAM_*`，脚本 `process.env` 读取） | ✅    | 项目级环境参数联动（对接 PROJ-003，P2）       |
| 执行（引擎子进程官方 runner；headless chromium；test 级超时+任务总超时）     | ✅    | 视口/设备矩阵、多浏览器（firefox/webkit，P2） |
| 停止（复用 exec 停止链：kill 进程树 SIGTERM→SIGKILL）                        | ✅    | —                                             |
| 报告（测试树/错误代码帧/失败截图/trace.zip 下载+`show-trace` 指引）          | ✅    | 内嵌 trace viewer 网页回放（P2，登记）        |
| 批量执行（ui_batch 复用 items 面，每 item 一子进程）                         | ✅    | —                                             |
| 粘贴导入（列表页直达：大文本框粘贴→建用例）                                  | ✅    | 文件上传 .spec.ts / zip 批量导入（P2）        |
| 步骤模式共存（存量用例不动；编辑器模式 Segmented 切换，双列数据独立保留）    | ✅    | 步骤↔脚本互转（不做自动互转，登记）           |
| AI 生成脚本（AI-004 对话产出直填编辑器）                                     | ❌    | P2 登记（对接 S7 AI 域）                      |
| 录制器 / Selenium 导入 / 移动端                                              | ❌    | 不做（红线继承 UIT-002 §1.2）                 |

### 1.3 前置依赖

UIT-002 全链（UiElement/UiTestCase 表、ExecTask type=ui_case/ui_batch、事件流 ui-screenshot 帧、internal/files 上传）；引擎 Node 运行时（子进程 spawn）；chromium 浏览器供给（PLAYWRIGHT_BROWSERS_PATH 与 e2e 同源，沿用 UIT-002 §1.3）。

### 1.4 对标基线核对

| 基线行为（MeterSphere v1/v2 UI 测试） | 本项目实现                                                | 口径       |
| ------------------------------------- | --------------------------------------------------------- | ---------- |
| UI 用例=步骤指令序列（表单编排）      | 步骤模式保留 + **脚本模式为主形态**（差异化升级）         | 超越基线   |
| 元素库（定位仓库）                    | 保留（步骤模式引用；脚本模式只读参考复制定位器）          | 完全复刻   |
| 浏览器驱动执行                        | 官方 `playwright test` 子进程（Selenium→Playwright 冻结） | 简化实现   |
| 报告截图/失败现场                     | 失败截图 + 错误代码帧 + trace.zip（基线无 trace）         | 超越基线   |
| 脚本直录（基线无：v1/v2 仅指令序列）  | 标准 Playwright Test 脚本直录直执行（AI 产出零改造）      | 差异化创新 |

## 2. 业务逻辑

- **生命周期**：复用 ExecTask.type=`ui_case`（单用例）/`ui_batch`（批量）+ `ui_validate`（校验干跑，新增 type，不起浏览器、秒级完成）；命令载荷按 `case.mode` 分支：script 模式下发 `script` 文本 + `params` KV，steps 模式沿用既有展开定位器命令（零改动）。
- **脚本语义**：标准 Playwright Test 文件（TS/JS，`import { test, expect } from '@playwright/test'` 或等价）；一个脚本可含多个 `test()`（报告呈测试树）；fixtures/test.describe/beforeEach/expect 全语义由官方 runner 保障。
- **参数注入**：用例级 KV 参数 → 子进程环境变量 `RABBIT_PARAM_{KEY 大写下划线}`；脚本内 `process.env.RABBIT_PARAM_BASEURL` 读取；空值/非法键名（非 `[A-Za-z0-9_]`）422。
- **校验（防呆）**：保存时 web 侧宽松预检（非空/≤100KB/含 `test(`）；**校验脚本**按钮创建 `ui_validate` 任务，引擎干跑 `playwright test --list`（TS 编译+收集，不启浏览器），返回 test 标题清单或编译错误（文件:行:列）；校验失败不阻断保存（允许存草稿），执行前无强校验。
- **执行语义**：引擎生成临时工作区（见 §4）→ spawn `playwright test --config` → 解析官方 JSON reporter 产物 → 映射事件帧与报告行；**test 级超时**=用例 timeoutMs（脚本模式默认 30s，区间 5s-300s）；**任务总超时**=600s 硬顶（防 hang，超时 kill 进程树终态 FAILED/超时分类）。
- **停止**：复用 exec 停止链 isStopped 轮询 → kill 子进程树（SIGTERM，3s 后 SIGKILL）→ 终态 STOPPED。
- **附件**：失败截图（screenshot=only-on-failure）与 trace.zip（trace=on）经 internal/files 上传（X-Internal-Token，复用 UIT-002 链路）→ 事件帧携带 fileId（`ui-screenshot` 复用 + 新增 `ui-trace` 帧）；报告页经既有 files 端点展示/下载。
- **存量兼容**：既有 steps 用例零迁移（mode 默认 steps）；编辑器顶 Segmented 可切换模式，`steps` 与 `script` 两列数据独立保留（切换不丢另一侧内容，保存以当前模式为准）；不提供步骤↔脚本自动互转。
- **边界**：script≤100KB；params≤20 组、value≤2048；批量上限沿用 20；目标域不设白名单（内网定位，同 UIT-002 口径——浏览器导航不走 SSRF 守卫，登记）；chromium 缺失=CONFIG_ERROR+安装指引（沿用）。

## 3. UI/UX 设计

- 高保真原型：`docs/design/UIT-003-playwright-script/index.html`（画板一 用例列表 / 画板二 脚本编辑器（含粘贴导入弹层、模式切换确认）/ 画板三 执行报告·失败态 / 画板四 执行报告·成功态+trace）。
- 页面：`/ui-test`（列表：模式列、新建默认脚本、粘贴导入入口）；`/ui-test/cases/new|{id}`（编辑器双模式：脚本=CodeMirror 6 代码区+右侧参数/元素库栏+校验按钮与结果条；步骤=现有行编辑器保留）；`/ui-test/tasks/{taskId}`（报告：脚本模式=测试树+错误代码帧+截图+trace 卡；步骤模式=现有时线不变）。

## 4. 技术架构

- **数据模型**（门禁 3 说明）：`UiTestCase` 增列 `mode`（steps|script，默认 steps 兼容存量）与 `script`（Text?）；`steps` 列对 script 模式存 `[]`（shared 校验放宽为 mode 条件式：steps 模式 min(1) 不变）。**增列理由**：脚本模式需求诞生于 2026-10-01（用户直提），S11 建表时该能力不存在，属新能力域而非漏建；本节即架构评审记录（用户确认规格即放行）。
- **shared**（`packages/shared/src/uit/schemas.ts` 扩展）：`uiCaseCreate/Update` 增 `mode`/`script`/`params`（KV 数组）；`uiCaseItemCommand` 增 script 分支；新增 `uiValidateResultSchema`（testCount/titles[]/error{message,file,line,column}?）；事件帧增 `ui-trace`（fileId）；`UIT_SCRIPT_LIMITS`（scriptMax 100KB、paramsMax 20、paramValueMax 2048、timeoutMs 5000-300000 默认 30000、taskTotalTimeoutMs 600000）。
- **web API**：CRUD/run 端点复用（mode 分支）；新增 `POST /ui-cases/validate-script`（body=script → 创建 ui_validate 任务 → 202+taskId，前端轮询事件流取结果）；权限沿用 `PROJECT_UIT:*`（script 属受信载荷：创建/更新含 script 须 CREATE/UPDATE 权限，审计留痕 createdBy/updatedAt）。
- **引擎**（`apps/engine/src/uit/script-runner.ts` 新增）：
  - 临时工作区 `{engine}/.uit-run/{taskId}-{itemId}/`：`case.spec.ts`（用户脚本原样落盘）、`playwright.config.ts`（生成：workers=1、retries=0、timeout=timeoutMs、reporter=json、use.trace='on'、screenshot='only-on-failure'、headless）——目录置于 engine 包内使 `@playwright/test` 依赖可解析；执行后清理（保留 report.json 供排障，上限清理策略随 EXEC-002 心跳）。
  - spawn `node_modules/.bin/playwright test --config`（env 注入 RABBIT_PARAM_*）；stdout/stderr 采集入事件帧（log 帧透传，rules/engine.md §6.2 口径）。
  - 解析 `report.json`：suites→specs→tests→results（passed/failed/timedOut/flaky/skipped/interrupted）→ 映射 `UiStepResult` 兼容行（每 spec 一行）+ `step-op` 事件帧；error.message+error.location → 错误代码帧（读 spec 源文件定位行，截 ±3 行上下文入报告 message）。
  - 附件：results.attachments（image/*→上传为截图→`ui-screenshot` 帧；trace/zip→上传→`ui-trace` 帧）。
  - 停止/超时：kill 进程树（SIGTERM→3s→SIGKILL）→ STOPPED/FAILED（超时）。
- **安全例外登记**（随实现 PR 修订 rules/engine.md §6）：UI 脚本=**受信全功能脚本**，不走 quickjs 沙箱（Playwright 驱动需真实 Node 运行时，quickjs 无原生绑定不可行；MeterSphere 脚本模块/Groovy 同信任口径）。补偿控制：权限点门禁（PROJECT_UIT:CREATE/UPDATE）+ 脚本入库可审计 + 独立子进程执行（独立 cwd、可强杀、崩溃不伤引擎主进程）+ 任务总超时硬顶。
- **web 前端**：CodeMirror 6（`@uiw/react-codemirror` + `@codemirror/lang-javascript`，新依赖登记 tech-stack）；右侧参数/元素库栏；校验按钮→轮询 ui_validate 任务→结果条（标题清单/错误定位可点击跳编辑器行）；模板下拉（空模板/登录冒烟/表单提交/断言套例）。
- **mock**：沿用 `GET /uit/demo` 演示页（UIT-002 已有，零新增）。

## 5. 测试用例

| 编号        | 类型   | 前置                                          | 步骤                                                  | 预期                                                                         |
| ----------- | ------ | --------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| UIT-003-T1  | Vitest | schema 矩阵                                   | mode×script/steps/params 合法非法组合                 | 条件校验精确（steps 模式 min(1) 保留；script 空/超限/坏 params 422 语义）    |
| UIT-003-T2  | Vitest | config 生成纯函数                             | timeoutMs/trace/screenshot 入参 → 生成 config 文本    | 幂等、字段齐（workers=1/retries=0/reporter=json）                            |
| UIT-003-T3  | Vitest | report.json 样本（成/败/超时/跳过四 fixture） | 解析→UiStepResult+事件帧                              | 状态映射齐；error.location→代码帧截取正确；附件分类正确                      |
| UIT-003-T4  | Vitest | 引擎级：mock /uit/demo                        | 真子进程跑 3 test 脚本（2 成 1 败）                   | 报告树 2✓1✗；失败行含代码帧与截图 fileId；trace 帧 fileId 非空               |
| UIT-003-T5  | Vitest | 引擎级：超时/停止                             | 死循环脚本（test 超时）/ 执行中 stop                  | 超时=FAILED（超时分类）；stop=STOPPED；进程树被回收（无孤儿进程）            |
| UIT-003-T6  | jmx    | admin                                         | 脚本用例 CRUD 四类（正常/401·403/422/分页）           | 四项断言全过                                                                 |
| UIT-003-T7  | jmx    | admin                                         | validate-script → 轮询终态（合法脚本/语法错误两轮）   | 202+taskId；合法=testCount≥1+t titles；非法=error 含 file:line               |
| UIT-003-T8  | jmx    | admin                                         | run → 轮询任务终态                                    | 终态 SUCCESS/FAILED；data 含测试树行数与 trace fileId                        |
| UIT-003-T9  | e2e    | admin                                         | 粘贴导入→编辑器回显→校验（绿）→执行→报告树+trace 下载 | UI：树 3 行全绿+trace 卡可见；Console：无 error；接口：run 202+帧含 ui-trace |
| UIT-003-T10 | e2e    | admin                                         | 失败脚本执行                                          | 报告失败行展开错误代码帧+失败截图可见                                        |
| UIT-003-T11 | e2e    | admin                                         | 存量 steps 用例回归（UIT-002 T7 链路）                | 步骤模式执行/报告与 S11 口径一致（零回归）                                   |

四类场景映射：正常路径=T6/T8·T9；权限=T6 的 403 组；校验（422）=T6 的 422 组+T1；分页=T6 的 list 组。

## 6. 竞品深度对标

MeterSphere v1/v2 UI 测试=**Selenium 指令序列 + 元素库**，无脚本直录形态（其「脚本模块」属接口域 Groovy/BeanShell，非 UI 域）；v3.x 社区版无 UI 测试模块。**AI 时代差异化**：测试脚本的主产地已迁移到 AI 助手（产出标准 Playwright Test 脚本），平台的核心竞争力从「低门槛编排」转为「**零改造收编 AI 产出 + 稳定执行 + trace 级可观测**」。本项目执行侧用**官方 runner 子进程**而非自研指令映射/shim：语义 100% 同源（fixtures/describe/web-first expect/trace 全支持），AI 生成的任何标准脚本可直接粘贴执行——这是「直接录入+直接执行」诉求的唯一无损路径。

## 7. 里程碑与验收

- DoD 前置：高保真四画板人工确认（原型已产出，待确认人/日期回填）+ 本规格评审 Approved。
- 契约冻结：§4 script 命令/事件帧/validate 结果 schema（实现前评审）。
- 验收：T1-T11 全绿 + 步骤模式零回归（UIT-002 e2e 全量）+ 概览演示（粘贴 AI 脚本→校验→执行→trace 下载全链）。

## 8. 勘误登记

无。
