# UI 测试模块实施（UIT-002 · 企业版 License 门控）

| 元信息项     | 内容                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | UIT-002                                                                                                                                           |
| 所属迭代     | Sprint 11 — 性能测试 / UI 测试模块兑现                                                                                                            |
| 优先级       | P4→企业版兑现级                                                                                                                                   |
| 所属模块     | UIT UI 测试 / EXEC 执行（引擎 ui 内核）/ SYS 系统设置（License 特性）                                                                             |
| 文档状态     | **Verified**（2026-09-30 人工验收走查通过：验收演示视频 demo/s11-acceptance-demo.webm 九段主线复核；功能+三层测试全绿）                           |
| 最后更新日期 | 2026-09-30                                                                                                                                        |
| 上游依赖     | UIT-001（占位资产）、ENTP-007（License 门控）、EXEC-002（池/队列）、FILE-001（internal/files 存储，S5）                                           |
| 下游消费     | ENTP 深化（trace 回放、浏览器网格、录制器）                                                                                                       |
| 上游依据     | 需求文档 §范围边界「明确不做（P4 远期）：UI 测试（Selenium）」→ 本 PR 修订为「企业版方向已兑现（UIT-002，License 门控，选型 Playwright）」        |
| 对标基线     | MeterSphere功能清单 §12.10（v1/v2 UI 测试=Selenium：用例步骤指令+元素库+报告截图）；UIT-001 §6 已明确选型属后续决策，本规格冻结 Playwright        |
| 关联架构文档 | engine-execution-architecture.md、tech-stack.md（引擎新增 playwright-core 依赖登记）                                                              |
| 高保真确认   | **已确认**（确认人：xujialiang；确认日期：2026-09-30；原型链接：docs/design/UIT-002-ui-test/index.html；验收演示：demo/s11-acceptance-demo.webm） |
| 工作量估算   | 后端+引擎 2.5 人日 + 前端 2 人日 + 测试 1 人日                                                                                                    |

## 1. 概述

### 1.1 功能定位

把 UIT-001 占位替换为**真实 UI 测试模块**（企业版 License 门控，标准版口径不变）。交付**元素库**（定位器仓库）、**UI 用例**（步骤指令序列编排）、**执行**（引擎内 playwright-core 驱动 headless chromium）、**报告**（逐步结果+失败现场截图）。选型 **Playwright**（差异化决策见 §6）：本项目 e2e 体系已重度使用（驱动/断言/浏览器供给同源），纯 Node 无 JVM，能力超 Selenium（自动等待/内置定位器）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                          | P1 ✅ | 后续                                  |
| ----------------------------------------------------------------------------- | ----- | ------------------------------------- |
| 元素库 CRUD（名称/定位方式 css·xpath·testid·text·role/定位器/备注）           | ✅    | 元素跨项目共享（ENTP 深化）           |
| UI 用例 CRUD（名称+步骤序列，软删；步骤引用元素库或内联定位器）               | ✅    | 用例复制/批量移动                     |
| 步骤指令集：goto/click/fill/select/assert-text/assert-visible/wait/screenshot | ✅    | 拖拽编排（P1 用表单行编辑，登记简化） |
| 执行（引擎 chromium 驱动，逐步事件帧+失败自动截图，超时控制）                 | ✅    | 本地执行模式客户端分流（ENTP 深化）   |
| 报告（逐步状态/耗时/截图网格+结论）                                           | ✅    | trace 录制回放（ENTP 深化）           |
| 批量执行（多用例任务，复用 ExecTask items 面）                                | ✅    | —                                     |
| 用例录制器（浏览器插件/IDE）/ Selenium Grid / 移动端                          | ❌    | 不做（红线+范围排除）                 |
| Selenium 侧用例（side/json）导入                                              | ❌    | 不做（选型差异化，登记）              |

### 1.3 前置依赖

- UIT-001 占位资产；ENTP-007 门控链；EXEC-002 队列/心跳（engine 绑定池即 UI 执行节点）；internal/files 上传端点（S5 FILE-001，X-Internal-Token）；e2e/CI chromium 浏览器供给（PLAYWRIGHT_BROWSERS_PATH 同源）。

### 1.4 对标基线核对

| 基线行为（v1/v2 UI 测试）             | 本项目实现                                | 口径     |
| ------------------------------------- | ----------------------------------------- | -------- |
| UI 用例=步骤指令序列（Selenium 指令） | 步骤 schema（8 指令，zod 校验）           | 简化实现 |
| 元素库（定位仓库，用例引用）          | UiElement 表+引用解析（内联定位器兜底）   | 完全复刻 |
| 浏览器驱动执行（Selenium/本地与远端） | 引擎 playwright-core+headless chromium    | 简化实现 |
| 报告截图/失败现场                     | 逐步 screenshot 指令+失败自动截图（jpeg） | 完全复刻 |
| 社区版无模块                          | License 未激活=占位页+90001               | 完全复刻 |

## 2. 业务逻辑

- **生命周期**：ExecTask.type=`ui_case`（单用例）/`ui_batch`（批量），复用 PENDING→RUNNING→SUCCESS/FAILED/STOPPED 任务面与事件流（item-start/item-final 帧逐步复用，报告=事件视图先例）。
- **步骤执行语义**：goto（URL 必须绝对 http(s)，走 SSRF 守卫）→ 交互指令（click/fill/select：元素库引用 `elementId` 或内联定位器，解析失败=CONFIG_ERROR）→ 断言指令（assert-text/assert-visible：失败=ASSERT_FAILED 并自动截图）→ wait（ms 上界 30s）。每步超时 15s（用例级可调 5-60s），超时=ASSERT_FAILED。
- **截图**：`screenshot` 指令与失败自动截图经 internal/files 上传（X-Internal-Token），事件帧携带 `fileId`（不内联 base64，防 Stream/DB 膨胀）；报告页经既有 files download 端点展示。
- **门控链**：`assertEntpEnabled("UI_TEST")` → `withPermission(PROJECT_UIT:*)` → 页面 modules.uit ∧ perm ∧ useEntp().can("UI_TEST")；不满足→占位页。
- **边界**：步骤数上限 50/用例；批量上限 20 用例；目标域不限白名单（企业版内网定位，SSRF 守卫兜底）；chromium 缺失（浏览器未安装）=CONFIG_ERROR+明确 message（引导安装命令）。

## 3. UI/UX 设计

- 高保真原型：`docs/design/UIT-002-ui-test/index.html`（四画板：用例列表/步骤编辑器/元素库/执行报告截图网格）。
- 页面：`/ui-test`（用例列表）/ `/ui-test/cases/{id}`（编辑器：步骤行=指令下拉+元素选择+参数+超时；元素库入口）/ `/ui-test/elements`（元素库表格+新建）/ `/ui-test/tasks/{taskId}`（报告：步骤时间线+截图网格+结论）。占位页降级同 LOAD-003。

## 4. 技术架构

- **数据模型**（门禁 3 一次建齐）：`UiElement`（id/projectId/name/locatorType/locator/description/moduleId?/timestamps/deletedAt）、`UiTestCase`（id/projectId/name/steps(Json 指令数组)/timeoutMs/createdBy/timestamps/deletedAt）；ExecTask.type 增 `ui_case|ui_batch`；Report.reportType 增 `ui`。元素删除时用例内引用悬空→执行时 CONFIG_ERROR（不级联删用例，登记语义）。
- **shared**：`packages/shared/src/uit/schemas.ts`（zod：element create/update、case create/update、step 指令 discriminatedUnion、事件帧扩展 `ui-screenshot` fileId 字段）+ 权限 `PROJECT_UIT:READ|CREATE|UPDATE|DELETE|EXECUTE` + `ENTP_FEATURES` 增 `{key:"UI_TEST", spec:"UIT-002"}`。
- **web API**：`GET/POST /ui-elements`、`PUT/DELETE /ui-elements/{id}`、`GET/POST /ui-cases`、`GET/PUT/DELETE /ui-cases/{id}`、`POST /ui-cases/{id}/run`、`POST /ui-tasks/{taskId}/stop`（复用 exec 停止链）；执行复用既有 exec 创建/回调/报告端点（type 分支），报告读复用事件回放。
- **引擎**（apps/engine/src/uit/）：`runner.ts`（playwright-core chromium：指令→PW API 映射，元素引用解析→locator 构造，自动等待默认，失败 try/catch→截图+事件帧）；截图上传走 internal/files（复用 callback.ts 的 X-Internal-Token 模式）；批量=items 循环复用单用例执行。**依赖**：引擎增 `playwright-core`（版本与仓库 @playwright/test 对齐，浏览器二进制经 PLAYWRIGHT_BROWSERS_PATH 与 e2e 同源共享，tech-stack 登记）。
- **mock**：apps/mock 增 `GET /uit/demo` 静态演示页（输入框+按钮+动态文案，无鉴权）供 e2e/jmx 演示链路。

## 5. 测试用例

| 编号       | 类型   | 前置                   | 步骤                                                  | 预期                                                                                          |
| ---------- | ------ | ---------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| UIT-002-T1 | Vitest | 步骤 schema            | 8 指令合法/非法载荷矩阵                               | discriminatedUnion 精确报错；步骤数>50 拒绝                                                   |
| UIT-002-T2 | Vitest | 指令→PW 映射纯函数     | 指令+定位器→目标调用描述                              | 映射齐；元素引用悬空→CONFIG_ERROR 语义                                                        |
| UIT-002-T3 | Vitest | 内嵌静态页 http server | 真 chromium 跑 4 步用例（fill/click/assert 成败两侧） | 成功走完+失败自动截图文件产生；断言失败帧 status=FAILED                                       |
| UIT-002-T4 | jmx    | admin+License(UI_TEST) | 元素/用例 CRUD 四类（正常/401·403/422/分页）          | 四项断言全过                                                                                  |
| UIT-002-T5 | jmx    | 无 License             | POST /ui-cases                                        | 403·90001                                                                                     |
| UIT-002-T6 | jmx    | admin+License          | run→轮询任务→终态                                     | 202/终态 SUCCESS·data 结构含步骤数与截图 fileId                                               |
| UIT-002-T7 | e2e    | admin+License+开关     | 建元素 3 个→建用例（mock /uit/demo 4 步）→执行→报告   | UI：报告截图网格可见+结论 SUCCESS；Console：无 error；接口：run 200 帧含 ui-screenshot fileId |
| UIT-002-T8 | e2e    | 断言失败用例           | assert 错误文案→执行                                  | 报告 FAILED+失败现场截图可见                                                                  |
| UIT-002-T9 | e2e    | 移除 License           | 访问 /ui-test                                         | 占位页+90001                                                                                  |

四类场景映射：正常路径=T4/T6·T7；权限=T5+T4 的 403 组；校验（422）=T4 的 422 组（坏步骤载荷）；分页=T4 的 list 组。

## 6. 竞品深度对标

基线 v1/v2 UI 测试基于 Selenium（指令序列驱动浏览器、元素库、本地/远端执行、报告截图）。**差异化决策（冻结）**：驱动选 playwright-core 而非 Selenium——①本项目 e2e 体系已用 Playwright，浏览器供给/知识栈同源，引擎零额外运维；②纯 Node 无 JVM（技术栈约束同 LOAD-003 口径）；③自动等待/内置定位器（testid/role/text）能力超 Selenium 显式等待。**不做** Selenium 用例导入（语法面不兼容，社区按元素库+步骤重编排）。功能面（元素库/步骤用例/截图报告/批量）对齐基线。

## 7. 里程碑与验收

- DoD 前置：高保真四画板人工确认（目标式授权下原型先产出，确认随验收走查）。
- 契约冻结：步骤指令 schema+PW 映射表（§2/§4，实现前评审）。
- 验收：T1-T9 全绿 + 概览 §4-3 演示 + 回归（UIT-001 占位 e2e 无 License 态仍绿）。

## 8. 勘误登记

无。
