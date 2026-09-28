# 报告高级分析（RPT-004 · 趋势统计）

| 元信息项     | 内容                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 文档编号     | RPT-004                                                                                                   |
| 所属迭代     | Sprint future — 远期 P4                                                                                   |
| 优先级       | P4（远期增强级）                                                                                          |
| 所属模块     | RPT 报告（统计聚合）/ DASH 工作台族入口                                                                   |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                             |
| 最后更新日期 | 2026-09-28                                                                                                |
| 上游依赖     | RPT-002（报告列表/summary 结构）、PLAN-005（计划报告 reportType=plan）、QA-001（报告详情聚合先例）        |
| 下游消费     | 工作台看板后续增强（DASH 族）、企业版质量度量方向                                                         |
| 上游依据     | 需求文档 §优先级 P4「报告高级分析」                                                                       |
| 对标基线     | MeterSphere功能清单 §6.8（社区版报告=场景/用例两类+分享+导出+误报，无跨报告统计）——**超出基线，自主设计** |
| 关联架构文档 | api-conventions.md（分页/信封）、rules/database.md（窗口查询）                                            |
| 高保真确认   | 待确认（原型：docs/design/RPT-004-report-analytics/；确认人/日期后补）                                    |
| 工作量估算   | 后端 1.5 人日 + 前端 2 人日（自绘 SVG 趋势图最重）                                                        |

## 1. 概述

### 1.1 功能定位

为既有报告数据补一层**跨报告统计视图**：项目维度近 N 天（7/14/30）执行趋势（总量/通过/失败/误报/通过率逐日序列）、报告类型分布（api_case/scenario/plan 三类计数与通过率）、失败 TOP5 报告清单。社区版基线无此功能，登记为超出基线自主设计；它同时是 LOAD/UIT 企业版激活后质量度量页的落点（占位页链接指向）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                      | P1 ✅ | 后续                      |
| ------------------------------------------------------------------------- | ----- | ------------------------- |
| `GET /api/v1/projects/{pid}/reports/stats?days=7                          | 14    | 30`                       | ✅  | 自定义区间（登记） |
| 趋势序列：连续日期补零、{date,total,passed,failed,fakeError,passRate}     | ✅    | 按模块/负责人下钻（登记） |
| 类型分布：三类报告 {total,passed,failed,passRate}                         | ✅    | 计划组维度（登记）        |
| 失败 TOP5：{taskId,name,reportType,failed,durationMs} 按 failed 降序      | ✅    | TOP N 可配（登记）        |
| 统计页 `/reports/stats`：筛选 7/14/30 + 自绘 SVG 趋势图 + 分布卡 + TOP 表 | ✅    | 多项目对比/导出（登记）   |
| 组织级/跨项目统计                                                         | ❌    | 企业版方向（ENTP）        |
| 报告对比（两份报告 diff）                                                 | ❌    | 后续迭代（登记不做）      |

### 1.3 前置依赖

Report 表既有 summary 字符串（JSON：{total,passed,failed,fakeError,durationMs}）与 reportType 枚举——数据源零 schema 变更。

### 1.4 对标基线核对

基线社区版报告域无统计面（§6.8 全部为单报告视图与分享导出）→ 本规格整体登记**超出基线，自主设计**。设计约束：不引入图表库（供应链红线+零依赖先例），SVG 自绘。

## 2. 业务逻辑

- **窗口**：`days ∈ {7,14,30}`（默认 14），窗口=[今天-days+1, 今天]，本地时区日界。
- **趋势序列**：逐日聚合当日 createdAt 落窗的报告：total=报告数、passed/failed=各报告 summary.passed/failed 求和、fakeError 同、passRate=Σpassed/Σtotal（分母 0 → null，前端显示「—」）；**无报告日期补零行**（序列连续，图不断轴）。
- **类型分布**：窗口内按 reportType 分组同口径聚合。
- **失败 TOP5**：窗口内按 summary.failed 降序取前 5（并列按 durationMs 降序），供快速定位劣化报告。
- **边界与异常**：days 非法 → 422·60422 `REPORT_STATS_INVALID`；项目无报告 → 200 全零序列+空 TOP（空态由前端呈现，不是错误）。

## 3. UI/UX 设计

- 原型：`docs/design/RPT-004-report-analytics/index.html`（三态：14 天有数据 / 全零空态 / 7 天切换）。
- 页面结构：PageHeader「报告统计」（reports 页签导航「列表 | 统计」）+ 窗口 Segmented(7/14/30) + 三块布局：
  - 趋势卡：自绘 SVG 双序列面积图（total 面积 + passRate 折线副轴），悬停显示逐日 tooltip（原生 title 即可，v1 不做浮层，登记走查）；
  - 分布卡：三类报告行式进度条（通过率着色，antd Progress）；
  - TOP 表：antd Table 5 行（name 链接跳报告详情）。
- 空态：无数据时趋势区显示「窗口内暂无报告」占位插画行+引导去执行。

## 4. 技术架构

- **契约**（packages/shared/src/report/schemas.ts 增补）：`reportStatsQuerySchema`（days 枚举）、`reportStatsSchema`（{range, trend[], byType[], topFailed[]}，passRate 可 null）。
- **路由**：`apps/web/src/app/api/v1/projects/[projectId]/reports/stats/route.ts`（GET，`withProjectScope("PROJECT_REPORT:READ")`）。
- **服务**：`report.service.ts`（或 exec.service.ts 报告族）增 `reportStats(projectId, days)`——一次窗口查询（select summary/reportType/createdAt/name/taskId）后内存聚合（窗口 ≤30 天报告量级 << 1 万，QA-001 口径无性能风险）；summary 解析复用 `parseSummary`。
- **错误码**：`REPORT_STATS_INVALID: 60422`（422）。
- **前端**：`apps/web/src/app/(console)/reports/stats/page.tsx` + `components/report/StatsTrendChart.tsx`（纯函数 SVG：输入序列输出路径串，便于单测）+ api-client 生成方法。

## 5. 测试用例

| 编号       | 类型   | 前置                      | 步骤                                     | 预期                                                                               |
| ---------- | ------ | ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------- |
| RPT-004-T1 | Vitest | 种子报告（跨 3 日含空日） | reportStats(14)                          | 补零连续序列；passRate 口径正确；类型分布与 TOP5 正确                              |
| RPT-004-T2 | Vitest | days=13 / "abc"           | 校验                                     | 422·60422                                                                          |
| RPT-004-T3 | Vitest | 序列数据                  | StatsTrendChart 路径生成（含空/满/单点） | SVG path 不含 NaN/undefined；单点退化为零宽                                        |
| RPT-004-T4 | jmx    | api-test 栈+种子报告      | GET stats days=14 / days=13 / 无会话     | 200 四断言 / 422·60422 / 401                                                       |
| RPT-004-T5 | jmx    | 无项目报告权限用户        | GET stats                                | 403                                                                                |
| RPT-004-T6 | e2e    | e2e 栈+预置报告           | 打开 /reports/stats →切换 7 天→悬停趋势  | UI：三块渲染+窗口切换刷新；Console：无 error；接口：GET stats 200 且负载 days 正确 |

四类场景：正常=T4①；权限=T4③/T5；校验=T4②；分页=不适用（聚合端点无分页面，登记豁免+理由）。

## 6. 竞品深度对标

基线社区版无对应功能（超出基线自主设计）。对标 MeterSphere v1/v2 时代「测试报告统计」（企业版报表方向的通行形态：时间趋势+通过率+TOP 失败），本项目取其最小可用子集落地标准版，差异化：零图表库（SVG 自绘纯函数组件，可单测）+ 数据零冗余（实时聚合不落表，避免统计表与报告表一致性问题）。

## 7. 里程碑与验收

DoD：端点+统计页+T1-T6 全绿+高保真走查（三态）。演示：执行一轮场景后打开统计页看到当日增量（sprint-overview 主线一环）。回归：报告列表/详情/分享既有用例（路由新增不侵入既有 handlers）。

## 8. 勘误登记

1. **服务落点拆分**：`reportStats` 未并入 `exec.service.ts`（规格 §4 初稿表述）——该文件导入链拉起 redis/队列副作用不利单测，拆独立 `report-stats.service.ts`（parseSummary 同形私有复刻 5 行，注释标注）。
