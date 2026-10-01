# UIT-004 Runner 环境自检与项目级 Runner（安装·隔离）

| 元信息项     | 内容                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | UIT-004                                                                                                                                                                                                |
| 所属迭代     | Sprint 14 — UI 测试 Runner 环境化                                                                                                                                                                      |
| 优先级       | P1（用户直提：runner 要自带环境检测 checklist；项目要能安装自己的 runner 且跨项目隔离）                                                                                                                |
| 所属模块     | UIT UI 测试 / EXEC 执行（引擎 runner 解析与安装）                                                                                                                                                      |
| 文档状态     | **Implemented**（随批实现完成 2026-10-01：契约 v7/UiRunner 表/引擎 runner-jobs+预检/前端管理面/三件套；待 PR 合并 CI 绿后验收走查→Verified）                                                                                    |
| 最后更新日期 | 2026-10-01                                                                                                                                                                                             |
| 上游依赖     | UIT-003（脚本 runner 子进程直执行）、UIT-002（ExecTask ui_* 任务面/事件流帧）、FILE-001（internal/files）、EXEC-002（BullMQ 队列/停止链先例）                                                          |
| 下游消费     | P2：多浏览器矩阵（firefox/webkit）、Runner 版本升级巡检、组织级共享 Runner                                                                                                                             |
| 上游依据     | 用户诉求（2026-10-01）：「runner 是不是要自带环境检测？检查哪些必须安装的工具是否安装，有个 checklist。需要允许项目安装自己的 runner，项目安装的 runner，留在当前项目，项目之间看不到非自己的 runner」 |
| 对标基线     | MeterSphere功能清单（v1/v2/v3 均无 UI Runner 环境管理概念——执行机即装即用，环境问题以报错堆栈形式暴露）；本项目差异化：检测前置化、checklist 可视化                                                    |
| 关联架构文档 | engine-execution-architecture.md、test-domain-model.md（§6 新表评审）、api-conventions.md、rules/engine.md（§6 例外口径延续）、rules/security.md（供应链）                                             |
| 高保真确认   | **已确认**（确认人：xujialiang；确认日期：2026-10-01；确认口径：「原型可以，请继续开发」；原型链接：docs/design/UIT-004-runner-env/index.html）                                                                                   |
| 工作量估算   | 后端+引擎 2.5 人日 + 前端 2 人日 + 测试 1.5 人日（合计 ≈ 6 人日）                                                                                                                                      |

## 1. 概述

### 1.1 功能定位

UIT-003 落地了「标准 Playwright 脚本直录直执行」，但 runner（官方 `@playwright/test` + chromium 二进制）是**全局单份、隐式存在**的：环境缺失时用户只能从测试失败 stderr 里反推（`Executable doesn't exist…`），且所有项目共用引擎自带的一份 runner，无法按项目锁版本。本规格补齐两件事：

- **环境检测 checklist（runner 自带体检）**：任何 runner（内置/项目级）可一键「体检」，产出结构化 checklist（node 运行时 / runner 包与版本 / chromium 二进制 / 磁盘空间 / ffmpeg·warn 级 / npm·registry（安装场景）），UI 逐项 ✓/✗/⚠ 展示并给处置指引；**执行/校验任务下发前预检**，fail 项直接以 checklist 帧落报告（CONFIG_ERROR 语义），不再让用户看裸 stderr 猜环境；
- **项目级 Runner 安装与隔离**：项目可安装**自己的** runner（npm registry 拉取精确版本 `@playwright/test@x.y.z` 到引擎主机的项目隔离目录），安装体留在项目内、列表/操作/API/磁盘四级隔离——**项目之间看不到非自己的 runner**；未配置项目 runner 时自动回落**系统内置 runner**（引擎自带版本，存量用例与 e2e 零影响）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                     | P1 ✅ | 后续                                                  |
| ---------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| Runner 管理面（UI 测试页入口；内置 runner 卡 + 项目 runner 列表，仅当前项目可见）        | ✅    | 组织级共享 runner（P2）                               |
| 环境检测 checklist（六项：node/runner 包/chromium/磁盘/ffmpeg⚠/npm+registry⚠）           | ✅    | firefox/webkit 检测位（P2，warn 预留）                |
| 检测触发（手动「重新检测」+ 安装完成自动 + 执行前预检缓存 ≤5min 复用）                   | ✅    | 定时巡检 + 异常通知（P2）                             |
| 执行/校验前预检（fail 项 → 任务直接 FAILED，报告页渲染 runner-check 帧；warn 不阻断）    | ✅    | 「忽略警告仍执行」开关（P2 再议）                     |
| 项目 runner 安装（npm registry 精确版本；引擎子进程 npm install；装后自动装 chromium）   | ✅    | 离线 tarball 导入、版本自动升级建议（P2）             |
| 项目 runner 生命周期（删除=软删+目录清理、设为项目默认）                                 | ✅    | 多 runner 并存按用例级选择（P2；P1 仅项目级单默认）   |
| 跨项目隔离（API withProjectScope 404 防枚举 + 磁盘按 projectId 分域 + 引擎解析校验归属） | ✅    | —                                                     |
| 内置 runner 只读展示（版本/检测；不可删不可改）                                          | ✅    | —                                                     |
| 安装失败可观测（状态 FAILED + 日志尾部 2000 字 + 重试）                                  | ✅    | 安装进度百分比细化（P1 三段式：下载安装/浏览器/检测） |
| 用例级 runner 覆盖选择                                                                   | ❌    | P2 登记（P1 项目级默认，全项目脚本用例生效）          |
| 自定义浏览器下载镜像 / 代理配置                                                          | ❌    | P2（PLAYWRIGHT_DOWNLOAD_HOST 透传预留，本规格仅登记） |

### 1.3 前置依赖

UIT-003 全链（ui-cases/validate-script/run 端点、引擎 script-runner、事件流 step-op/ui-screenshot/ui-trace 帧）；引擎 Node 运行时与 npm CLI（安装链路；缺失时 checklist 呈 fail/warn 且安装按钮禁用）；PLAYWRIGHT_BROWSERS_PATH 浏览器缓存目录（检测目标）。

### 1.4 对标基线核对

| 基线行为（MeterSphere v1/v2/v3）                        | 本项目实现                                                                    | 口径     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | -------- |
| 无 runner 环境管理（执行机即装即用，环境问题=报错堆栈） | 检测前置化：六项 checklist + 执行预检阻断 + 报告页结构化渲染                  | 差异化   |
| 无项目级执行器版本概念                                  | 项目 runner 安装 + 四级隔离 + 内置回落                                        | 差异化   |
| UI 自动化依赖 Selenium/浏览器驱动手工配置               | 官方 playwright runner + chromium 二进制检测/自动安装（UIT-003 冻结口径延续） | 简化实现 |

## 2. 关键决策（评审焦点）

| #   | 决策                                                                                                                                                             | 理由                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| D1  | **双轨制**：系统内置 runner（引擎依赖，只读）+ 项目 runner（npm 安装，可删可设默认）；未配置→回落内置                                                            | 存量用例/e2e 零迁移；「允许项目安装自己的 runner」语义完整；内置版作为冒烟基准永在          |
| D2  | **安装执行体=引擎**（BullMQ job → 子进程 `npm install`，无 shell、字面量 argv、10min 超时、SIGTERM 树杀）                                                        | 引擎是既有子进程执行体与安全口径载体（rules/engine.md §6 例外延续）；web 不新增 npm 依赖面  |
| D3  | **检测结果不出引擎文件系统猜测，全部实测**：chromium 用 playwright-core `registry.executablePath()` 落盘 stat                                                    | 版本↔浏览器 revision 映射由 registry 权威给出，防「装了别的版本浏览器」误判                 |
| D4  | **隔离四级**：API 层 withProjectScope（404 防枚举）+ 表层 projectId 必填过滤 + 磁盘层 `{runnersRoot}/{projectId}/` 分域 + 引擎解析层 runnerId↔projectId 归属校验 | 「项目之间看不到非自己的 runner」在每一层独立成立，无穿透面                                 |
| D5  | **预检阻断仅 fail 项**（node 缺失/runner 包不可解析/chromium 二进制缺失/磁盘<1GB）；warn（ffmpeg、npm/registry 非安装场景）不阻断                                | 阻断=必然失败的环境；warn 项不构成执行失败（video=P2、安装场景才需 registry）               |
| D6  | **安装源=npm registry 默认官方**，仅接受 `@playwright/test` 精确 semver；registry 可达性属 checklist warn 项                                                     | 供应链最小面（rules/security.md：不引入第三方源）；精确版本保证复现                         |
| D7  | **契约 v6→v7**：新增 job kind `ui_runner_install` / `ui_runner_check` + internal 回调 `POST /api/v1/internal/runners/report`；`EXPECTED_ENGINE_VERSION` 两端同步 | 新 job 类型属不兼容扩展；S13 教训「契约版本两端不同步=静默拒收」直接适用                    |
| D8  | 浏览器安装：runner 安装完成后自动 `node cli.js install chromium`（该版本 revision 写入共享 PLAYWRIGHT_BROWSERS_PATH）                                            | revision 键控并存不冲突（如 chromium-1243/chromium-1223）；免手工；失败落 checklist fail 项 |

## 3. 数据模型与 API

### 3.1 新表 `UiRunner`（门禁 3 说明：新功能域表一次建齐，非既有核心表加列）

| 列                            | 类型         | 说明                                                                                  |
| ----------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| id                            | uuid PK      |                                                                                       |
| projectId                     | uuid         | 所属项目（必填；唯一复合索引 `(projectId, deletedAt)` 上的活跃集）                    |
| name                          | varchar(64)  | 展示名（默认 `pw-{version}`；项目内唯一（活跃集））                                   |
| kind                          | enum         | `project`（内置 runner **不入表**，运行时从引擎常量推导）                             |
| version                       | varchar(32)  | 精确 semver（安装时锁定）                                                             |
| status                        | enum         | `INSTALLING` / `READY` / `FAILED` / `INSTALL_CANCELLED`                               |
| isDefault                     | boolean      | 项目内至多一个 true（事务内先清后置）                                                 |
| installLogTail                | text?        | npm/浏览器安装 stdout+stderr 尾部 ≤2000 字（失败定位）                                |
| lastCheckAt                   | timestamp?   | 最近一次检测完成时间                                                                  |
| checkItems                    | json?        | `runnerCheckItemSchema[]`（§3.2），检测快照                                           |
| browsers                      | json?        | P2 预留：`{chromium:true, firefox:false, webkit:false}` + revision 号                 |
| installSource                 | varchar(255) | 默认 `https://registry.npmjs.org`（P2 离线导入时存 `local`）                          |
| createdById                   | uuid         | 安装人                                                                                |
| createdAt/updatedAt/deletedAt | —            | 软删（删除=软删行+引擎目录异步清理；被删 runner 的执行回落内置并在任务 message 注明） |

### 3.2 共享 schema（packages/shared，OpenAPI 生成源）

```ts
runnerCheckItemSchema = z.object({
  key: z.enum(["node", "runner_pkg", "chromium", "disk", "ffmpeg", "npm_registry"]),
  label: z.string(),
  status: z.enum(["ok", "warn", "fail"]),
  detail: z.string(), // "chromium-1243 @ ~/Library/Caches/ms-playwright/chromium-1243"
  hint: z.string().optional(), // fail/warn 的处置指引（复制命令/跳转）
});
```

事件流新增帧 `runner-check`（eventFrameSchema 扩展，v7）：`{ type:"runner-check", itemId, items: runnerCheckItemSchema[] }`——预检失败任务作为首帧落库，报告页渲染 checklist 卡。

### 3.3 API（全部 withProjectScope；响应信封/分页/软删遵 api-conventions）

| 端点                                                 | 权限                      | 说明                                                                           |
| ---------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------ |
| `GET /projects/{id}/ui-runners`                      | PROJECT_UIT:READ          | **仅本项目** runner + 内置 runner 虚拟卡（kind=builtin）                       |
| `POST /projects/{id}/ui-runners`                     | PROJECT_UIT:RUNNER_MANAGE | 安装：body `{version}`（semver 校验，非法=90086/422）→ 建 INSTALLING 行 + 入队 |
| `POST /projects/{id}/ui-runners/{runnerId}/check`    | PROJECT_UIT:READ          | 触发检测（入队，幂等：INSTALLING 中拒绝 422 90088）                            |
| `PATCH /projects/{id}/ui-runners/{runnerId}/default` | PROJECT_UIT:RUNNER_MANAGE | 设为项目默认                                                                   |
| `DELETE /projects/{id}/ui-runners/{runnerId}`        | PROJECT_UIT:RUNNER_MANAGE | 软删 + 引擎目录清理 job（READY/FAILED 可删；INSTALLING 拒绝）                  |
| `GET /projects/{id}/ui-runners/{runnerId}`           | PROJECT_UIT:READ          | 详情（含 checkItems/installLogTail）                                           |
| `POST /internal/runners/report`（X-Internal-Token）  | —                         | 引擎回调：安装/检测结果回写（引擎无 DB 纪律）                                  |

错误码新增（90xxx 段顺延）：`UI_RUNNER_NOT_FOUND 90085`（404 防枚举）、`UI_RUNNER_VERSION_INVALID 90086`（422）、`UI_RUNNER_INSTALL_FAILED 90087`（安装受理后异步失败落 status，不用于同步响应）、`UI_RUNNER_BUSY 90088`（422，安装/检测进行中）。

### 3.4 引擎侧

- 目录：`{ENGINE_ROOT}/.runners/{projectId}/{runnerId}/`（node_modules + package.json；`.gitignore` 增补；projectId/runnerId 白名单正则防穿越——沿用 sanitizeRunKey 口径）。
- 安装 job：`execFile("npm", ["install", "--prefix", dir, "--registry", source, "--no-audit", "--no-fund", "@playwright/test@"+version])`（无 shell；用户输入仅 version 经 `^\d+\.\d+\.\d+$` 白名单后拼接）→ 成功后 `execFile(node, [cli.js, "install", "chromium"])` → 自动检测 → 回调。
- 检测 job（§1.2 六项；纯函数核 + 注入 fs/registry 的单测面）：node=process.version≥18；runner_pkg=require.resolve 该目录包+版本一致；chromium=registry.executablePath() stat+可执行位；disk=工作盘≥1GB；ffmpeg=warn 级（video=P2）；npm_registry=仅安装场景（fetch registry/-/ping，SSRF 守卫：仅 https、host 白名单=安装源域名）。
- 执行/校验任务改造：解析 runner（项目默认 READY runner → 内置）；**预检**（checkItems 缓存 >5min 或无 → 现场快测）；fail → 任务 FAILED（failureKind=CONFIG_ERROR，message=「环境预检未通过：N 项失败」）+ runner-check 帧；pass → 照旧（工作区 cwd 改为 runner 隔离目录旁挂：`.uit-run/{runKey}/` 内 symlink `node_modules` → runner 目录，使 `@playwright/test` 解析到项目版本）。

### 3.5 前端

UI 测试页 header 增「Runner」胶囊（当前生效：内置·版本·✓/⚠/✗）；Runner 管理抽屉（内置卡只读 + 项目列表 + 安装/检测/设默认/删除）；checklist 组件（三态行+hint+复制）；报告页 runner-check 帧渲染；安装弹窗（版本输入+推荐=内置同版本 tag+三段进度+失败日志尾部）。

## 4. 安全与合规

安装链路=供应链入口：仅 `@playwright/test` 官方包名+精确 semver；registry 默认官方 https（SSRF 守卫：URL 校验+host 白名单，禁内网/环回—— Mimosa 约束 §请求前校验 host 一致适用于 npm_registry 检测与安装源配置）；npm 子进程无 shell、argv 字面量+白名单 version；安装目录路径净化（uuid 白名单）；PROJECT_UIT:RUNNER_MANAGE 独立权限点入审计日志。审计与权限门禁延续 rules/engine.md §6「受信全功能脚本」例外口径。

## 5. 测试用例表（§1.2 能力行映射；命名 rules/testing §1.1）

| 用例编号    | 覆盖能力行                                                              | 文件                             | 类型       |
| ----------- | ----------------------------------------------------------------------- | -------------------------------- | ---------- |
| UIT-004-T01 | 管理面·仅本项目可见（隔离）                                             | tests/e2e/UIT-004-runner.spec.ts | Playwright |
| UIT-004-T02 | checklist 六项三态渲染+hint                                             | tests/e2e/UIT-004-runner.spec.ts | Playwright |
| UIT-004-T03 | 安装状态机（0.0.1 负路径：受理→busy→FAILED 日志→重试复用→删除）        | tests/e2e/UIT-004-runner.spec.ts | Playwright |
| UIT-004-T04 | 预检阻断（缺环境→任务 FAILED + runner-check 帧；口径见注②）            | tests/e2e/UIT-004-runner.spec.ts + engine 单测 | Playwright+Vitest |
| UIT-004-T05 | 隔离 API（B 项目访问 A runner=404；无权限=403）                         | tests/api/UIT-004-runner.jmx     | JMeter     |
| UIT-004-T06 | 安装/检测/设默认/删除 四类场景×四断言                                   | tests/api/UIT-004-runner.jmx     | JMeter     |
| UIT-004-T07 | version 非法 422·90086；busy 422·90088；分页信封                        | tests/api/UIT-004-runner.jmx     | JMeter     |
| UIT-004-T08 | checklist 纯函数（注入假 fs/registry：ok/warn/fail 全矩阵）             | packages/shared 或 engine 单测   | Vitest     |
| UIT-004-T09 | runner 解析与归属校验（跨项目 runnerId 拒绝）、预检缓存 5min、回落内置  | engine 单测                      | Vitest     |
| UIT-004-T10 | 安装 argv 构造（无 shell、白名单 version、registry 拼接）与目录净化     | engine 单测                      | Vitest     |

注①（真安装口径）：真 npm 安装不做 CI 用例（外网+时长不可控）——T03 以 0.0.1 负路径（npm 404 秒级 FAILED+日志尾部+重试复用）覆盖安装状态机；本地验收走查已实测真安装全链（1.62.0：npm 拉包→chromium-1234 自动补装→六项检测绿→READY 设默认→执行走项目 runner 成功）。
注②（T04 拆分口径）：阻断态（fail 项→runner-check 帧+CONFIG_ERROR）由引擎单测覆盖（T08 三态矩阵+T09 解析缺失语义）；e2e T04b 覆盖缺省态（正常执行无阻断卡+接口 runnerChecks 空）——共享 e2e 栈无法破坏浏览器目录而不伤及其他用例，环境相关三态（warn 行文案等）归单测，e2e 只断言环境无关项（豁免登记）。

## 6. 非目标与红线

不做执行机集群分发（runner 装在引擎所在主机；资源池分发=P2 连同 EXEC-004 评估）；不做 runner 市场/多来源；内置 runner 不可删改；预检不做「强制跳过」；红线继承 UIT-002/003（不做录制器/Selenium 导入/内嵌 viewer）。

## 7. 交付物清单

schema.prisma（UiRunner）+ migration + 种子（示例项目不预装）；packages/shared（schema/错误码/权限点/契约 v7）；web 端点×6 + internal 回调 + 前端四组件；engine（install/check job、runner 解析、预检、symlink 工作区）；原型目录；三件套用例；文档状态流转（本文件 + sprint-overview + rules/engine.md §6 补注）。

## 8. 勘误登记

| 编号  | 日期       | 内容                                                                                                                                                                                                                                                                                             | 状态         |
| ----- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| 勘误1 | 2026-10-01 | 走查发现：粘贴导入/模板默认脚本断言 `toHaveText('提交成功，rabbit-e2e')` 与 mock demo 页实际输出 `…（normal）` 后缀不同步→首跑必败；已改 `toContainText`（ui-test/page.tsx、UiCaseForm.tsx 两处），dev 实测首跑 1/1 绿；随本规格 PR 一并提交 | 已修复随批提交 |
