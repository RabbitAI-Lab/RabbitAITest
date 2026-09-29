# 接口测试报告完整版（用例级钻取·分享·保留）

| 元信息项     | 内容                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | RPT-002                                                                                                                                   |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                                   |
| 优先级       | P1                                                                                                                                        |
| 所属模块     | 报告（report 域）                                                                                                                         |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例）       |
| 最后更新日期 | 2026-09-27                                                                                                                                |
| 上游依赖     | RPT-001（报告页/SSE 基线）、API-003（api_case 任务与 item 口径）、EXEC-002（重跑）、SYS-005（清理任务基建）、API-004（提取/断言结果结构） |
| 下游消费     | S3 API-010（误报规则命中）、RPT-003（场景报告/批量导出/分享增强）、S4 PLAN-005（计划报告导出）                                            |
| 上游依据     | 需求文档 M6（报告）；功能清单 §6.8                                                                                                        |
| 对标基线     | 功能清单 §6.8：两类报告、点步骤看请求响应、分享（有效期）、单个/批量导出、删除；误报规则（→S3）                                           |
| 关联架构文档 | test-domain-model.md §2.7/§5（报告=事件视图、分享快照预留）；api-conventions §1（/share/{token} 免登路由）                                |
| 高保真确认   | 待确认（原型 docs/design/RPT-002-api-report-full/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                           |
| 工作量估算   | 后端 3 人日 / 前端 4 人日 / 联调 1 人日                                                                                                   |

## 1. 概述

### 1.1 功能定位

把 RPT-001 单请求报告升级为用例级（多 item）报告：列表入口、item 表+步骤钻取、分享只读链接、保留期清理、失败重跑入口。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                              | P1 ✅ | 后续                                            |
| --------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------- |
| 报告列表（/reports）：名称/类型徽标（调试/接口用例）/状态/耗时/创建人/时间/操作（详情·分享·删除）；类型筛选；批量删除             | ✅    | 批量导出（S3 RPT-003）                          |
| 报告详情 v2：api_debug 保留 S0 视图；api_case=汇总头（结果徽标/统计 通过÷总/耗时）+ **用例级表格**（用例名/状态/耗时/断言通过率） | ✅    | —                                               |
| 步骤钻取：点用例行→该 item 全帧视图（渲染后请求快照/响应/断言表含实际值/提取值表/日志流）                                         | ✅    | 多步骤树（场景 S3 RPT-003）                     |
| 实时：RUNNING 报告 SSE 增量（既有 stream 消费）+ item 级状态实时                                                                  | ✅    | —                                               |
| 分享：创建链接（有效期 1h/1d/7d/30d 单选）→免登只读页 `/share/report/{token}`；撤销分享；过期/不存在统一 404 页                   | ✅    | 密码保护与可导出开关（基线项，登记 S3 RPT-003） |
| 报告保留：系统参数 api.reportRetentionDays（默认 30，0=永久）→ BullMQ 定时清理（报告+任务+帧级联软清）                            | ✅    | 项目级保留策略（基线应用设置口径，S5）          |
| 失败重跑入口：报告头部「重跑」（复用 EXEC-002 端点，生成新报告）                                                                  | ✅    | —                                               |
| 误报标记                                                                                                                          | ❌    | S3 API-010（FalseAlarmHit 表已建）              |

### 1.3 前置依赖

API-003 item 帧结构（itemId 分组）；SYS-005 定时任务基建（cleanup repeatable job 扩展分支）。

### 1.4 对标基线核对

完全复刻：两类报告/步骤看请求响应/分享有效期/删除。简化实现：批量导出=S3（登记）；分享无密码/导出开关（登记）；快照列仍不启用（实时读，架构 §2.7 预留，报告数据量小口径成立）。超出基线：保留期清理参数化（基线应用设置，本项目系统参数先行）。

## 2. 业务逻辑

- 报告生成：任务终态回调时创建（S0 既有）；api_case 报告 summary={total,passed,failed,durationMs}（item 聚合）。
- 分享：token=随机 128 位（ReportShare 表既有）；同报告重复创建=新 token 旧 token 保留（多链接并存）；撤销=DELETE 指定 share；只读页数据=reportDetail 同构裁剪（无重跑/操作按钮）。
- 清理：每日 job 删除 `createdAt < now - retentionDays` 的 Report+ReportShare+ExecStepResult+ExecItem+ExecTask（物理删，附审计日志 AuditLog 一条汇总）；retentionDays=0 跳过。
- 删除报告：级联上述五表同删（任务中心同步消失——单口径，SYS-006 登记互斥）。

## 3. UI/UX 设计（高保真 docs/design/RPT-002-api-report-full/）

- /reports 列表页：筛选条（类型下拉/关键字）+表格（名称/类型徽标/状态徽标（含 STOPPED 灰）/统计（api_case 报告 通过/总）/耗时/创建人/时间/操作：详情·分享·删除）+批量删除条。
- 详情页（/reports/[taskId]）：头部（名称+状态徽标+统计三卡 通过/失败/总耗时+操作：重跑·分享·返回列表）；api_case 呈现用例表格（行点击展开/下钻）；单请求（api_debug）保留 S0 布局。
- 步骤钻取视图：左（请求快照卡：method/URL/headers/body 高亮 `${var}` 渲染后值）右（响应卡+断言表：类型/期望/实际/结果+提取值表：变量/值/作用域）+底部日志流（级别着色）。
- 分享弹窗：有效期单选+生成后复制链接+已存在链接列表（撤销按钮）。
- 免登页 /share/report/{token}：与详情同构只读+「分享链接已过期」空态。

## 4. 技术架构

- 数据模型（已建齐）：Report/ReportShare/ExecTask/ExecItem/ExecStepResult/FalseAlarmHit（S3）。
- 端点：`GET /api/v1/projects/{pid}/reports`（列表 query：reportType/keyword/page）、`DELETE .../reports/{taskId}`（级联删）、`GET .../reports/{taskId}`（既有，扩展 item 视图：`items:[{itemId,name,status,durationMs,assertPassed,assertTotal}]`+`frames(itemId)` 按需：`GET .../reports/{taskId}/items/{itemId}/frames`）；分享 `POST .../reports/{taskId}/shares`、`GET .../shares`、`DELETE .../shares/{token}`、免登 `GET /api/v1/share/report/{token}`。
- zod：reportListQuerySchema、shareCreateSchema（expireHours ∈ {1,24,168,720}）。
- 权限点：PROJECT_REPORT:READ|SHARE（既有）；删除=READ? ——**删除复用 PROJECT_REPORT:READ+SHARE?** 否——登记：删除落 PROJECT_REPORT:READ 且仅项目成员可删（报告无独立 DELETE 点，rbac §3 动作集无 EXPORT/SHARE 外扩展——SHARE 承接敏感操作口径，删除随 READ 简化，登记勘误候选）；免登端点无权限（token 即凭证）。
- 错误码：`REPORT_NOT_FOUND 60404`、`SHARE_NOT_FOUND 60414`。
- 清理：SYS-005 cleanup job 分支扩展（参数组 api.reportRetentionDays 新增系统参数项）。
- 前端：`/reports/page.tsx` 列表（S0 无列表页，新增）；详情页重构为 `item 表+钻取`；`/share/report/[token]/page.tsx`（免登布局组，console 布局外）。

## 5. 测试用例

- RPT-002-T1（jmx 四类）：报告列表/详情 item 视图/分享创建-免登读-撤销；401/403（无 REPORT:READ）/404（他项目报告、坏 token）；share expireHours 非法 422；列表分页信封。
- RPT-002-T2（spec 主链路）：批量执行 2 用例（1 成功 1 断言失败）→报告列表出现→详情用例表两行两态→点失败行→断言表「实际值」与提取值呈现（UI+Console+接口）。
- RPT-002-T3（spec 分享二态）：创建 1h 分享→退出登录/隐身访问免登页可读且无操作按钮→撤销→再访问 404 页；过期 token（直改库造旧 expireAt）同 404。
- RPT-002-T4（spec 清理+删除）：报告删除→列表消失且任务中心同步消失；retentionDays=0 不清理（单测）；删除报告后 SSE 流关闭。
- 单测：item 聚合矩阵（SKIPPED/STOPPED 计数）、清理 cutoff 边界、token 生成唯一性、级联删清单完整性。

## 6. 竞品深度对标

基线 §6.8 主体覆盖；差异：①导出=S3 RPT-003（plan 既定拆分）；②分享快照列不启用（实时读——报告=事件视图架构决策，数据量口径成立，登记）；③保留策略系统参数先行（基线项目应用设置，S5）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。钻取视图与 API-004 结果结构强耦合（提取/断言字段名一致）；验收对应 sprint-overview 验收 5。

## 8. 勘误登记

（暂无）
