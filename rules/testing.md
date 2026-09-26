# rules/testing.md — 自动化测试规范（JMeter 接口测试 + Playwright UI 测试）

> 由 AGENTS.md 门禁 7 引用。**硬性规定：任何功能点「开发完成」= 功能代码 + 单测 + JMeter 接口用例 + Playwright UI 用例全部交付且 CI 全绿**，缺任何一项 PR 不予合并。

## 1. 目录与命名（与规格文档编号一一对应）

```
tests/
├── api/                          # JMeter 接口自动化
│   └── {MODULE}-NNN-{slug}.jmx   #   每个功能点 ≥1 个（如 CASE-001-case-crud.jmx）
├── e2e/                          # Playwright UI 自动化
│   ├── fixtures/                 #   公共夹具：authedPage / expectNoConsoleErrors / expectApi
│   └── {MODULE}-NNN-{slug}.spec.ts   # 每个界面功能点 ≥1 条
└── unit 随代码同目录 *.test.ts（Vitest）
```

规格文档 §5「测试用例」的用例表逐条映射到上述文件（编号一致）；PR 描述必须链接对应规格与测试文件。

## 2. JMeter 接口测试规范（tests/api/）

1. **覆盖面（每个功能点必测四类）**：
   - 正常路径（200 + 业务 `code:0` + 关键字段值）
   - 未认证 401 / 无权限 403（权限点验证）/ 资源不存在或越域 404
   - 入参校验失败 422（zod 拒绝）
   - 列表接口：分页信封 `{total, items}` 结构与排序
2. **每个采样器四项断言必备**：
   - HTTP 状态码（Response Assertion）
   - 响应体业务码 `code`（JSON Assertion，`$.code == 0`）
   - 关键业务字段（JSONPath 断言，如 `$.data.name}`、`$.data.total >= 1`）
   - 响应时间上限（Duration Assertion，按 api-conventions 性能预算）
3. **环境与数据**：
   - `${BASE_URL}` 与 `${TOKEN}` 全局参数化；Token 由 setup 线程组登录获取
   - 用例**自建数据、自清理**（tearDown 删除），或使用种子测试项目，禁止依赖执行顺序
4. **执行**：`pnpm test:api`（封装 `jmeter -n -t … -l results.jtl`，CI 对本地 baseline 服务执行）；jtl 由脚本校验失败数 = 0，输出进 CI 报告。

## 3. Playwright UI 测试规范（tests/e2e/）

### 3.1 三类断言（每条 UI 用例必须同时包含，缺一即不合规）

| #   | 断言类型         | 要求                                                                              | 实现方式                                                                                                                                |
| --- | ---------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **UI 断言**      | 验证界面结果：元素可见/消失、文本与状态标签、表格行数与列值、表单回显、Toast 提示 | `expect(locator).toBeVisible()/toHaveText()/toHaveCount()/toHaveValue()`                                                                |
| 2   | **Console 断言** | 页面全程**无 console.error、无未捕获 pageerror**；warning 需显式白名单登记        | fixture `expectNoConsoleErrors(page)`（收集 `page.on('console')` + `page.on('pageerror')`，用例结束统一断言）                           |
| 3   | **接口断言**     | 关键链路的网络请求：状态码、响应体关键字段、**请求负载**（payload 正确性）        | `expectApi(page, 'GET /api/v1/projects/*/cases*')` 封装 `page.waitForResponse` / `page.route`，断言 `status`、`body.data.*`、`postData` |

三类断言通过 `tests/e2e/fixtures/` 公共夹具提供，**禁止**各用例手写收集逻辑。

### 3.2 编写规范

1. 选择器优先级：`getByRole` > `getByText` > `data-testid="{module}-{name}"`；**禁止**脆弱的 CSS/XPath 选择器。
2. **用户路径完整（2026-09-26 走查②新增）**：功能用例必须从首页（`/` 工作台；未登录场景则由 `/` 被守卫重定向至 `/login`）出发，经**真实可见导航**（左侧菜单/顶栏/页面内主按钮）到达被测功能——**禁止 `page.goto` 直跳目标页**。理由：录屏供人工走查与验收，必须呈现功能入口路径。例外（可在 PR 说明）：守卫/未登录重定向类断言的「再次访问」、纯 API 无页面用例。
3. 稳定性：等待以 locator 断言为准，**禁止 `waitForTimeout` 硬等待**；每条用例独立数据（setup 创建、teardown 清理），用例间零依赖。
   - antd 5.29+ Select 虚拟列表下**可见选项无 `role=option`**（隐藏 a11y 镜像反而有）——实现侧对需测试的下拉统一 `virtual={false}`（S1 走查③教训）；中文 2 字按钮自动插空格（确 定），按 `/^(确\s*定|OK)$/` 正则定位。
4. 登录态：使用 `authedPage` fixture（storageState 复用），每条主链路用例另备一条「未登录跳转」断言。
5. 权限视角：涉及权限的功能至少两条用例（管理员视角成功 + 普通成员视角 403/隐藏）。
6. Mock 边界：UI 测试**不 mock** 业务 API（走真实服务，保证 console/接口断言真实性）；仅允许 mock 外部三方（如 AI provider、第三方缺陷平台）与时间。

### 3.3 录屏、Trace 与测试产物（失败必须可回放）

Playwright 全局配置（`playwright.config.ts`，禁止用例级关闭）：

| 项             | 配置                                                | 说明                                                                    |
| -------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| **录屏 video** | `video: 'on-with-retry'`（size 1280×720）           | **每条 UI 用例必须留有录屏证据**；重试全过程保留，最终失败的视频必留存  |
| Trace          | `trace: 'retain-on-failure'`                        | 失败自动保留 trace，可离线回放（Trace Viewer）逐帧查看 DOM/网络/console |
| 截图           | `screenshot: 'only-on-failure'`                     | 失败即时现场                                                            |
| HTML 报告      | `reporter: [['html', { open: 'never' }], ['list']]` | 报告内嵌每条用例的 video/trace/截图入口                                 |

产物管理：

1. 本地产物目录 `test-results/`、`playwright-report/`（gitignore）；CI 作为 **artifact 上传**：HTML 报告 always，video/trace/截图 on-failure。
2. CI 产物保留 30 天；PR 失败时在检查摘要附报告链接——**评审失败的 UI 用例必须看录屏/trace 定位，禁止只看断言消息**。
3. Bug 单必须附失败用例的录屏或 trace 链接（复现证据链）。
4. **录屏首帧即用户路径起点**：视频必须从首页/登录页开始并包含导航点击过程（§3.2.2）；录屏看不到「从哪进入」视为不合规，走查打回。

### 3.6 UI 截屏（每条 UI 用例必备，2026-09-26 新增）

1. **自动截屏**：fixtures 对每条 UI 用例结束时自动整页截屏（无论成败），存 `test-results/screenshots/<用例名>.png`，与录屏/trace 一同作为走查与人工评审证据。
2. **视觉快照**：`VISUAL-snapshots.spec.ts` 为每个有高保真原型的页面产出稳定态截图（视口 1280×800 对齐原型画布、无 toast/loading、贴近原型示例数据），存 `tests/visual/snapshots/*.png`；命令：`pnpm test:visual`。
3. 截屏缺失的 UI 用例视为交付不完整（与录屏同等要求）。

### 3.7 视觉还原度比对（高保真 ↔ 实现，多模态评审）

1. **流程**：`pnpm visual:diff`（`scripts/visual-diff.mjs`）——渲染 `docs/design/**` 原型为 PNG → 与 §3.6 快照成对送 **GLM-5.3-Flash（多模态）** 对比 → 产出 `tests/visual/report.md`（还原度总分 + 布局/颜色/细节分项 + 差异清单 + 建议）。
2. **判定**：similarity ≥80 pass；60–79 warn（登记差异，允许带伤通过并在走查记录）；<60 fail。CI 在配置了 `GLM_API_KEY` 时以 `--enforce` 运行，低于阈值阻塞合并（key 未配置时跳过并在日志说明）。
3. **时机**：UI 功能 PR 必附快照与比对报告；走查（AGENTS 门禁 2）以该报告为客观输入，人工确认仍不可省略。
4. **环境**：`GLM_API_KEY`（或 `ZHIPUAI_API_KEY`）、`GLM_VISION_MODEL`（默认 glm-5.3-flash）、`GLM_VISUAL_THRESHOLD`（默认 80）、`GLM_BASE_URL`（默认智谱开放平台）。
5. 示例数据内容差异不计入扣分，只评估视觉/布局/样式（提示词内置该约定）。

### 3.4 执行与 CI

- 本地：`pnpm test:e2e`（自动起 web + engine + mock + embedded-postgres，Playwright 全量）。
- 重试策略：CI `retries: 2`（仅 CI；本地 `retries: 0` 保持失败敏感——本地偶现即视为不稳定用例，必须修复或标记）。
- 并行：CI 按 worker 并行执行；用例数据独立（§3.2）保证可并行，禁止用例间共享状态。
- CI：PR 触发「新增/变更用例 + 主链路冒烟」，main 每日全量；失败即阻塞合并。
- **Release Gate**：主链路 E2E（docs/需求文档.md §二）+ 全量 tests/ 绿。

### 3.5 断言与 fixture 质量（源自 RabbitProjects 实践教训）

1. **断言作用域化**：接口断言只针对本用例触发的请求（URL 模式圈定），console 断言异常必须定位到本用例操作——全局断言会把别人页面的错误算进本用例造成误报；确需豁免的 console 噪声显式登记白名单并注明来源。
2. **fixture 一律自造**：测试所需文件（图片/CSV/JAR）由测试代码生成或随测试资产提交，**禁止依赖本机路径残留**（曾因依赖 `/tmp` 下的手工 PNG 导致他人环境必挂）。
3. **限流与 429 容错**：CI 环境触发服务端限流时，用例按策略「allow + 重试」处理并在结果中标注，不得静默放宽断言。
4. **console 断言是后端 500 的探测器**：历史上有两处 API 500 仅被「e2e 控制台零错误断言」破获（前端静默吞掉的失败请求）——console 断言从 POC 起接入（Sprint 0 验收第 8 条），禁止延后。
5. **录屏脚本容错**：批量录屏/取证脚本对空响应等异常要重试与降级（曾因录屏取数空 body 导致整批重录）。

## 4. 单元测试（Vitest）

1. 域服务/引擎 kernel（变量渲染、断言提取、步骤树解释器）必须有分支级单测；UI 组件只测纯逻辑（hooks/utils）。
2. `packages/shared` 的 zod schema 附 round-trip 单测（合法/非法样例各一组）。
3. 覆盖率：核心域 ≥ 70%（Release Gate），PR 内新增代码行覆盖 ≥ 80%。

## 5. 与文档体系的联动

1. 规格 §5 用例表 = 自动化用例的清单来源，编号一一对应（`CASE-001-03` ↔ spec 内 test('CASE-001-03 …')）。
2. 用例新增/变更必须与功能同 PR；「先合功能后补测试」不允许。
3. Bug 修复必须附「回归用例」：先写失败用例复现，再修复转绿（prevent regression）。
