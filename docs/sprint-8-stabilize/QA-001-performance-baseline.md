# 性能基线（QA-001 · 百并发任务与万级数据基准）

| 元信息项     | 内容                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | QA-001                                                                                                               |
| 所属迭代     | Sprint 8 — 稳定化                                                                                                    |
| 优先级       | P2（Release Gate 性能维度唯一判定源）                                                                                |
| 所属模块     | 横切：CASE 列表查询 / RPT 报告详情 / EXEC 引擎吞吐                                                                   |
| 文档状态     | Implemented（2026-09-28 交付：脚本+CI+mock 端点+三层测试全绿；走查=复跑 pnpm perf:baseline）                         |
| 最后更新日期 | 2026-09-28                                                                                                           |
| 上游依赖     | S1 用例列表（CASE-002）、S2/S4 执行与报告（EXEC/RPT）、apps/mock（基准采样目标）、INFRA-004 metrics（场景 C 数据源） |
| 下游消费     | Release Gate（需求文档 §六 性能维度）；后续任何性能回归以本基线脚本复跑                                              |
| 上游依据     | 需求文档 §四 性能：「单节点 100 并发接口任务稳定执行；万级用例列表筛选 < 1s；报告页 < 2s」                           |
| 对标基线     | MeterSphere v3 社区版无性能基准工具（企业版方向）——本项目自建轻量基线，非复刻项                                      |
| 关联架构文档 | rules/observability.md §6（指标=基线数据源）；rules/testing.md（CI 执行）                                            |
| 高保真确认   | 不适用（纯脚本/引擎类；基准脚本 CLI 契约见 §4）                                                                      |
| 工作量估算   | 后端 3 人日（含查询优化排查）                                                                                        |

## 1. 概述

### 1.1 功能定位

把需求文档 §四 的三条性能指标变成**可一键复跑、带阈值断言、进 CI** 的基准资产：`scripts/perf-seed.mjs`（万级种子）+ `scripts/perf-baseline.mjs`（三场景基准）+ `.github/workflows/perf.yml`（PR 快速口径 / main 完整口径）。基线跑完产出 `perf-baseline-report.{json,md}` 归档。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | P1 ✅ | 后续                         |
| ---------------------------------------------------------------------- | ----- | ---------------------------- |
| 场景 A：万级用例列表筛选（10k 用例，列表+关键词/模块筛选，P95 < 1s）   | ✅    | 全路由基准（登记不做）       |
| 场景 B：报告详情（场景执行产报告后详情 API，P95 < 2s）                 | ✅    | 报告导出基准（登记）         |
| 场景 C：100 并发接口任务稳定执行（100 任务全终态 SUCCESS，附吞吐/P95） | ✅    | 千级并发（企业版资源池方向） |
| perf-seed：幂等万级种子（10k 用例 + 1k 接口定义，专用 perf 项目）      | ✅    | 更大规模种子                 |
| 阈值断言 + 报告：JSON 原始数据 + markdown 人读报告；失败非零退出       | ✅    | 历史趋势对比（登记）         |
| CI：perf.yml（PR=快速口径 1k/20 并发、main push+manual=完整口径）      | ✅    | 性能回归自动 bisect（登记）  |
| 慢查询排查：基准暴露的 N+1/缺索引在本规格内修复                        | ✅    | —                            |

### 1.3 前置依赖

S1-S4 已交付的列表分页/报告/执行链路；apps/mock 提供 `/mock/perf/echo` 快速回显端点（若无则本规格新增）；embedded-postgres 或外部 PG。

### 1.4 对标基线核对

非复刻项（基线社区版无此工具）。自建口径与需求文档 §四 逐字对齐。

## 2. 业务逻辑

- **场景 A（列表）**：perf-seed 造 10k 用例（10 模块 × 1000）后，基准循环请求 `GET /api/v1/projects/{pid}/cases?page=1&pageSize=20` 与带 `keyword`/`moduleId` 筛选变体，采样 ≥ 30 次，取 P95。断言 `P95 < 1000ms`。
- **场景 B（报告）**：先执行一个 10 步场景（mock 目标）生成报告，基准循环 `GET /api/v1/projects/{pid}/reports/{id}`（详情聚合视图），采样 ≥ 30 次，断言 `P95 < 2000ms`。
- **场景 C（并发任务）**：并发提交 100 个单步 api_case 任务（目标 mock echo），轮询至全部终态；断言 `success+total == 100`（需求口径「稳定执行」= 全部成功，失败/超时即红）；统计提交→全终态耗时与任务 durationMs P50/P95（信息项，不设阈值——单节点池并发槽吞吐依赖硬件，阈值只卡「全成功」）。
- **口径纪律**：计时含 HTTP 往返（客户端视角）；每场景先跑 ≥ 3 次预热再采样；JSON 报告含环境元信息（node 版本/机器/口径）。

## 3. UI/UX 设计

无 UI（脚本 + CI）。人读产物=markdown 报告。

## 4. 技术架构

- **种子**：`scripts/perf-seed.mjs`——独立 `perf-baseline` 项目（幂等：存在即跳过重建，`--reset` 清理重建）；用例 createMany 分批 500/事务。
- **基准**：`scripts/perf-baseline.mjs`——`--scope quick|full`（quick=1k 用例/20 任务，full=10k/100）；直连 web API（登录 session）；并发用 `Promise.all` 分批；报告写 `test-results/perf/`。
- **mock 端点**：`apps/mock` 增加 `GET/POST /perf/echo`（回显 body+固定延迟 0ms）——基准采样目标，避免外网抖动。
- **CI**：`.github/workflows/perf.yml`——postgres+redis 服务容器（同 e2e 口径），build web → seed → baseline（quick），`push: main` + `workflow_dispatch` 跑 full；上传报告 artifact。
- **package.json**：`perf:seed` / `perf:baseline` / `perf:baseline:quick` 三脚本。
- **性能优化约定**：若基准红，优先修查询（N+1/缺索引/深分页），禁止调大阈值掩盖——阈值即需求文档原文。

## 5. 测试用例

- QA-001-T1（单测）：perf-seed 幂等（二次运行跳过）；基准报告结构（三场景字段齐全）；阈值断言函数（超阈→fail）。
- QA-001-T2（jmx）：mock `/perf/echo` 四类（200 回显 / 405 错方法 / 无鉴权 404 变体 / 延迟头）。基准脚本本身无 REST 面故 jmx 仅覆盖其依赖端点。
- QA-001-T3（e2e）：不适用（无 UI）——豁免登记：脚本类能力行以 CI 红绿为验收（rules/testing §1.2 豁免口径），Playwright 不为脚本造页面。
- CI：perf.yml PR quick 口径全绿=门禁。

## 6. 竞品深度对标

基线无对应工具（性能测试为企业版方向）。本项目自建轻量基线，登记为超出基线的质量资产。

## 7. 里程碑与验收

DoD：三场景 full 口径本地全绿 + perf CI quick 口径全绿 + 报告归档进 PR 描述。走查=复跑 `pnpm perf:baseline`。

## 8. 勘误登记

1. 种子项目标识：num 为 Int（组织内递增编号），改用 name「性能基线专用」唯一标识（规格 §4 初稿按 num=PERF-BASELINE 表述，实现修正）。
2. perf-seed 直插 SQL 需补 created_at/updated_at（Prisma @default(now()) 只在 ORM 层生效，裸 SQL 必须显式给值）。
