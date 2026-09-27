# 计划报告导出（点维度明细 · 总结 · 分享 · PDF/CSV）

| 元信息项     | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLAN-005                                                                                                                                                               |
| 所属迭代     | Sprint 4 — 计划完整与脑图                                                                                                                                              |
| 优先级       | P2                                                                                                                                                                     |
| 所属模块     | 测试计划（plan 域）+ 报告（rpt 域）                                                                                                                                     |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                              |
| 最后更新日期 | 2026-09-27                                                                                                                                                             |
| 上游依赖     | PLAN-001（计划报告最小版：通过率+用例结果+总结编辑）、PLAN-002（测试点维度）、PLAN-003（引擎执行报告聚合）、RPT-002/003（分享链路 ReportShare）                          |
| 下游消费     | —（S5 MSG 消费报告完成通知）                                                                                                                                            |
| 上游依据     | 需求文档 §四 M4「报告：自动生成、总结、测试点维度明细、分享、导出 PDF」；功能清单 §五                                                                                  |
| 对标基线     | 功能清单 §五：执行自动生成报告；报告总结（可保存/一键总结）；按测试点维度查看用例明细；支持分享链接、导出 PDF；计划组同样有报告与总结（PLAN-004 承接）                   |
| 关联架构文档 | api-conventions.md（下载语义）、test-domain-model.md §2.9（Report/ReportShare）                                                                                        |
| 高保真确认   | 待确认（原型 docs/design/PLAN-005-plan-report-export/；人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                    |
| 工作量估算   | 后端 3 人日 / 前端 4 人日 / 联调 1 人日                                                                                                                                |

## 1. 概述

### 1.1 功能定位

把 PLAN-001 的最小计划报告升级为完整版：测试点维度明细视图、一键总结、分享链接（免登录）、PDF 导出（打印友好页）与 CSV 明细导出。报告数据源=PlanCaseRef 聚合（人工标记+引擎执行统一时间线）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | S4 ✅ | 后续                                            |
| ---------------------------------------------------------------------- | ----- | ----------------------------------------------- |
| 报告自动生成（执行完成刷新）+ 手动刷新                                 | ✅     | —                                               |
| 概览卡：通过率/进度/阈值判定/失败数/阻塞数/误报数（FAKE_ERROR 单列）   | ✅     | —                                               |
| 测试点维度明细：按点分组折叠的用例结果表（三类混排+类型徽标）          | ✅     | —                                               |
| 报告总结：人工编辑保存 + **一键总结**（服务端统计草稿生成）            | ✅     | AI 总结（S7 AI-004 接入点预留）                  |
| 分享链接：ReportShare token 免登录只读（有效期四档沿用）               | ✅     | —                                               |
| 导出 PDF：打印友好 fullPage（自动 window.print）                       | ✅     | 服务端渲染 PDF（无头浏览器，登记 Backlog）       |
| 导出 CSV：用例明细（Excel 兼容，UTF-8 BOM）                            | ✅     | 原生 xlsx 多 sheet（登记 Backlog）               |
| 引擎执行明细钻取：api_case/scenario 行链接对应 exec 报告               | ✅     | —                                               |

### 1.3 前置依赖

Report.reportType 预留 `plan`；ReportShare 链路成熟（RPT-002/003）。

### 1.4 对标基线核对

完全复刻：自动生成/总结（保存+一键）/点维度明细/分享/PDF。简化实现：PDF=打印页方案（基线 fullPage+浏览器打印同源思路；服务端渲染登记 Backlog）；CSV 替代基线 Excel 导出（Excel 兼容口径，原生 xlsx 登记后续）。

## 2. 业务逻辑

- **报告生成**：`getPlanReport` 升级——聚合 PlanCaseRef（含点分组）+最近一次引擎任务统计（fakeError 数）+阈值判定；执行终态自动刷新（PLAN-003 回调）；手动刷新按钮重算。
- **一键总结**：服务端按模板渲染统计草稿（「共 N 条用例，已执行 X，通过率 Y%（阈值 Z% 达标/未达标）；失败 F 条、阻塞 B 条、误报 E 条；最薄弱测试点：{点名}（通过率最低）；最近执行 {time}」），**不覆盖**已保存总结（二次确认才覆盖）；保存走既有 summary 端点。
- **分享**：`POST /plans/{planId}/report/shares`（复用 createShare token 生成；share 页渲染计划报告只读版）。
- **PDF 导出**：`/share/report/{token}/print` 与登录态 `/plans/{planId}/report/print` 打印友好页（隐藏导航/操作钮、A4 版式、分页断点），前端 window.print()；口径=浏览器打印为 PDF（MeterSphere fullPage 同源思路）。
- **CSV 导出**：`GET /plans/{planId}/report/export?format=csv`——列：测试点/用例类型/编号/名称/执行人/状态/实际结果摘要/最近执行时间/报告链接；UTF-8 BOM；attachment 下载（非信封，S2 export 先例）。

## 3. UI/UX 设计（高保真 docs/design/PLAN-005-plan-report-export/）

- 报告 Tab 升级：头部操作区（刷新/一键总结/分享/导出 PDF/导出 CSV）+ 概览卡六枚 + 阈值判定横幅（达标绿/未达标红）。
- 测试点维度：点分组折叠表（点名列+该点通过率徽标；行=用例，类型徽标三色；接口/场景行带「查看报告」链接跳 exec 报告）。
- 总结区：只读展示+编辑切换；一键总结弹确认（已有内容时提示覆盖）。
- 分享管理弹窗：既有报告分享样式复用（token 列表/新建/吊销/有效期四档）。
- 打印页：无侧栏顶栏、白底 A4、卡片区+点分组表+总结页脚。
- 原型画板：①报告 Tab 完整版（概览+点分组+总结+操作区）②分享弹窗+打印页预览 ③CSV 导出 Toast+文件示意。

## 4. 技术架构

- 数据模型：零迁移（Report.reportType=plan 已预留；报告 JSON 结构扩展存 Report.summary/content Json 列——沿用现有懒创建机制扩展 content 结构 `{ overview, points:[{pointId,name,rows}], generatedAt }`）。
- 契约（shared `plan/schemas.ts`）：`planReportViewSchema`（概览+点分组+总结）、`planReportCsvQuerySchema`；shareCreateSchema 复用（RPT-002）。
- 端点（前缀 `/api/v1/projects/{pid}/plans/{planId}/report`）：
  - `POST /refresh`（重算，PLAN:UPDATE）
  - `POST /shares`、`GET /shares`、`DELETE /shares/{token}`（权限沿用 RPT-002 口径）
  - `GET /export?format=csv`（PLAN:READ，attachment）
  - 免登录：`GET /api/v1/share/plan/{token}`（shareDetail 扩展 plan 分支）
- 页面：`/plans/[id]` 报告 Tab 重构；`/plans/[id]/report/print` 打印页；`/share/plan/[token]` 免登录报告页 + `/share/plan/[token]/print`。
- 服务：`plan-report.service.ts`（从 plan.service 拆出：构建视图/一键总结模板/CSV 行组装）；分享复用 exec.service 的 token 生成与吊销（抽 `share.service.ts` 共用）。
- 前端：api-client s4.ts planReportApi。

## 5. 测试用例

- PLAN-005-T1（jmx 四类）：refresh/shares/export 正常路径（refresh 后 content 结构断言、share 免登录 200 只读、export csv 行数与 BOM）；401/403/404；422（无效 expireHours）；报告 GET 信封。
- PLAN-005-T2（spec 报告主链路）：执行完计划→报告 Tab 点分组呈现→一键总结草稿→编辑保存→分享链接打开免登录页（UI+Console+接口）。
- PLAN-005-T3（spec 导出二态）：导出 CSV 下载（行数=关联数、BOM 头断言）；导出 PDF 打印页完整（无侧栏、点分组、总结）断言。
- 单测（shared）：一键总结模板纯函数（空数据/未达标/最薄弱点边界）、CSV 行组装转义（逗号引号换行）。

## 6. 竞品深度对标

基线 §五主体覆盖。差异：①PDF 打印页方案（基线同源 fullPage 思路，服务端渲染登记）；②CSV 替代 Excel（xlsx 登记）；③一键总结=模板统计（基线企业版 AI 总结，S7 预留接入）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（S0 §8.1 先例）。联调重点：报告 content 结构在刷新/分享/导出三链路一致性；打印页样式隔离（不动全局布局）。

## 8. 勘误登记

- 勘误 1（2026-09-27，端点形态对齐）：报告视图端点为 GET/POST /plans/{id}/report/view（POST=手动刷新）、草稿 POST /report/draft；一键总结「生成并覆盖」确认在前端 Modal（服务端不覆盖未确认总结）；shares 列表响应含 total。
