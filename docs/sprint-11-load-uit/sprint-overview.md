# Sprint 11 — 性能测试 / UI 测试模块兑现 · 迭代概览

| 元信息项   | 内容                                                                                                                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint 11（worktree `../RabbitAITest-s6`（槽位 6，目录为既有槽位名），分支 `sprint-11-load-uit`，基线 main bed4a9e / PR #14 合并后）                              |
| 迭代名称   | 性能测试 / UI 测试模块兑现：LOAD-003 + UIT-002（企业版 License 门控）                                                                                            |
| 周期       | 规划 W28+（需求文档 §优先级 P4 行「P4 再议」兑现）                                                                                                                |
| 覆盖优先级 | **P4 远期增强级 → 企业版方向兑现**（需求文档 §范围红线第 3 条「执行引擎不自研性能压测内核（P4 再议）」再议结论）                                                   |
| 文档数     | 3 份（1 概览 + 2 规格）                                                                                                                                           |
| 文档状态   | Implemented（2026-09-30 交付：功能+三层测试全绿；走查随验收）                                                                                                     |
| 上游依据   | [需求文档](../需求文档.md) §范围边界/§优先级 P4 行；[MeterSphere功能清单](../MeterSphere功能清单.md) §12.10（v1/v2 UI=Selenium、性能=JMeter 分布式；v3 社区版移除） |
| 前置迭代   | S0-S8 全量 + S9（ENTP-007 License 门控基建、ENTP-008 编号已占用）+ S-future P4（LOAD-001/UIT-001 占位资产、LOAD-002 架构稿冻结）                                    |
| 阻塞下游   | ENTP 深化（多节点分布式施压调度、UI 录制器/浏览器网格）                                                                                                           |

---

## 1. 迭代目标

**兑现需求文档「P4 再议」**：把 LOAD-001/UIT-001 的企业版方向占位替换为真实模块，与 MeterSphere v1/v2 功能面对齐、与技术栈约束自洽（纯 Node 施压内核、Playwright 驱动 UI 执行），标准版口径不变（License 未激活=社区版同款占位页）。两模块均走 **modules 开关 ∧ 权限点 ∧ License 特性** 三重门控。

| 维度           | 目标                                                                                                   | 判定方式                                    |
| -------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 性能测试全链路 | 施压计划 CRUD→执行（阶梯加压/稳态/即时停止）→秒级时间线（TPS/失败率/RT 分位）→报告曲线                  | 单测（调度器/聚合器纯函数）+ jmx + e2e 真执行 |
| UI 测试全链路  | 元素库 CRUD→UI 用例步骤编排→执行（chromium 驱动 goto/click/fill/assert）→逐步截图报告                    | 单测（步骤编译/解析）+ jmx + e2e 真执行       |
| 门控一致性     | 无 License→90001 占位页；License+开关+权限三满足→真实模块                                               | jmx 门控组 + e2e 三态                        |
| 红线兑现       | 「P4 再议」落定：Node 施压内核（不引 JVM/不自研通用内核）+ Playwright 选型登记                          | 需求文档/AGENTS/tech-stack 同 PR 修订        |

**本迭代不追求**：多节点分布式调度面（拓扑/契约已冻结，实施留 ENTP 深化）、UI 录制器与浏览器网格、trace 回放、压测 jmx 兼容、Selenium 用例导入。

## 2. 交付范围（2 规格）

| #   | 交付项             | 内容                                                                                     | 文档       |
| --- | ------------------ | ---------------------------------------------------------------------------------------- | ---------- |
| 1   | 性能测试模块       | 施压计划 CRUD+执行/停止+秒级时间线报告（SVG 曲线）；EntpFeature.LOAD_TEST；池 DTO 激活    | `LOAD-003` |
| 2   | UI 测试模块        | 元素库+UI 用例步骤编排+chromium 执行+截图报告；EntpFeature.UI_TEST                        | `UIT-002`  |

**编号口径**：S9 已占用 ENTP-001~008（ENTP-008=用户扩容与部门），本迭代按域内系列延续：LOAD-001（占位）→LOAD-002（架构稿）→**LOAD-003（模块实施）**；UIT-001（占位）→**UIT-002（模块实施）**。

## 3. 范围排除（防蔓延红线）

- **不做**：多节点分布式施压调度（LOAD-002 Phase 2）、压测 jmx 兼容执行、UI 录制器/浏览器插件、trace 录制回放、Selenium Grid、移动端 UI 测试、多资源池路由（ENTP-006 面）
- 标准版（无 License）行为不变：占位页+90001，门禁 6 前半句「标准版不做」**保持有效**
- 红线修订仅一处：需求文档「明确不做（P4 远期）」行与 AGENTS 门禁 6 第 3 条「执行引擎不做性能压测内核」→ 修订为「企业版方向已兑现（S11，License 门控；内核=Node 施压进程，非通用压测引擎）」

## 4. 验收标准（现场跑通）

1. License 门控：社区版（无 License）进 /load /ui-test → 占位页+90001 提示；签发含 LOAD_TEST/UI_TEST 特性的 License → 三重门控满足 → 真实模块页
2. 性能测试：新建施压计划（对 mock /ping，10s 持续+阶梯）→ 执行 → 监控页秒级曲线实时推进 → 停止/完成后报告页 TPS/失败率/RT P50/P95/P99 曲线+结论
3. UI 测试：元素库建定位器 → UI 用例编排步骤（对 mock 演示页 goto/fill/click/assert）→ 执行 chromium 驱动 → 报告逐步截图+结论
4. 自动化测试齐备：Vitest（调度器/聚合器/步骤编译核心分支）+ JMeter（每规格四类×四断言，License 门控组走预计算 License UDV）+ Playwright（三类断言、真执行链路）全绿
5. OpenAPI 快照 --check 过；typecheck/lint/format 全绿
6. 远端 CI 全绿（门禁 9）

## 5. 规格清单与状态

| 编号    | 名称             | 状态                        | 原型/契约                                         |
| ------- | ---------------- | --------------------------- | ------------------------------------------------- |
| LOAD-003 | 性能测试模块实施 | Implemented（2026-09-30）   | 原型 docs/design/LOAD-003-load-test/（四画板）    |
| UIT-002  | UI 测试模块实施  | Implemented（2026-09-30）   | 原型 docs/design/UIT-002-ui-test/（四画板）       |

## 6. 迭代主线（浏览器可演示端到端）

admin 签发企业 License（含 LOAD_TEST/UI_TEST）→ ① 项目设置开启 load/uit 开关 → ② /load 新建施压计划（mock /ping，10s）→ 执行 → 监控页曲线推进 → 报告页查看 TPS/RT 分位 → ③ /ui-test 元素库建 3 个定位器 → 新建 UI 用例（4 步）→ 执行 → 报告逐步截图 → ④ 移除 License → /load /ui-test 回占位页。

## 7. 交付自查（2026-09-30 回填）

| 验收标准 | 结果 | 证据 |
| --- | --- | --- |
| 1. License 门控（社区版占位+90001；三重门控满足→真实模块） | ✅ | e2e S11-load-uit T9/T4/T3（占位页+API 90001）；jmx G6 门控组（90001/90005） |
| 2. 性能测试（CRUD→执行→监控曲线→报告） | ✅ | e2e LOAD-003-T8（mock /perf/echo 8s 真执行→监控曲线帧推进→报告结论）；jmx G2 执行链（run 202/metrics 帧/stop/终态）；引擎单测（调度表/聚合器/内嵌 echo 真施压+停键 ≤2s） |
| 3. UI 测试（元素库→步骤编排→chromium 执行→截图报告） | ✅ | e2e UIT-002-T7/T8（真 chromium 执行，成功/断言失败两侧+截图网格）；jmx G2（CRUD 四类+run 202+ui-tasks 详情帧）；引擎单测（schema 矩阵/PW 映射/内嵌静态页真执行） |
| 4. 三层测试齐备 | ✅ | Vitest 543 全绿（engine 127/web 227/shared 163/db 8/mock 14/runner 4）；JMeter LOAD-003 37 采样器+UIT-002 31 采样器 jtl 失败数=0；Playwright e2e S11 聚合 9/9 两连绿 |
| 5. OpenAPI 快照 --check 过 | ✅ | 320 paths（284→320）；CI quality job |
| 6. 远端 CI 全绿（门禁 9） | ✅ | **CI run 36681103838**：lint+typecheck+unit / 依赖审计 / 空库迁移 / go cli / next build / Playwright E2E 分片×2 / JMeter 分片×2 九 job 全 success；PR #29 已合入 main（merge commit 77c784e） |

### 7.1 实现过程缺陷与教训（首红/返工记录）

1. **真实缺陷修复（e2e 暴露）**：antd `Form.Item` 内 span wrapper 断受控链——`validateFields` 落 `initialValues`（元素 locatorType 恒 css 之因，现场复现定位后改直挂）；antd Select `data-testid` 不透传根 div（span 载体先例落地）。
2. **CI 高压竞态链**（8 聚合 workers 实证）：`expectApi` 后置监听漏窗口（收口 UI/URL 断言）/MAINFLOW-s4 报告 `waitForResponse` 误捕自动跳转残留请求（组件内 isLoading+轮询为真源）/antd Tab 切换动画 element not stable（force click）。
3. **License 全局态跨文件竞态**（顽固假红根因）：并行文件的 afterEach 摘除与自愈循环互相打架——License 互斥单文件收编（beforeAll 激活→功能段→社区版段→恢复→afterAll 清，S9 聚合文件先例）。
4. **CI 环境差异**：quality job 缺 chromium（engine uit 单测真浏览器执行）补安装步；nodemailer 9.1.1→10.0.13（GHSA-v53p-9fqp-m79j high 回溯阻塞审计，main 同病）。
5. **读一致性窗口**（License 写后首读偶发旧快照）：validLicense 50ms 复询兜底 + addLicense read-back（≤2s 至可见）+ useEntp staleTime=0/refetchOnMount=always + 页面级 refetchInterval 授权轮询。

## 8. 迭代教训（收尾回填）

- **「本地绿 ≠ CI 绿」在 e2e 层呈形态差**：本地 4 workers 全绿的断言写法在 CI 8 聚合下三类竞态（响应监听窗口/动画稳定性/异步聚合时长）概率化暴露——以后新增 e2e 断言时，凡依赖「事件后监听」的一律改为「先挂监听后触发」或 UI/状态轮询。
- **全局态（License/主题/系统参数）的 e2e 必须是互斥单文件**：跨文件并行共享 DB 全局态时，任何 per-test 加删生命周期都会在 worker 边界互踩（本迭代最长教训链）。
- **门禁 9 的 CI 循环要把「形态差异」当一等输入**：本地通过≠合并候选，远端 CI 的红必须按「是否 CI 形态特有」分类处置（本迭代 CI 侧红全部 CI 特有：chromium 缺失/审计回溯/8 聚合竞态）。

## 8. 迭代教训（收尾回填）

（交付时回填。）
