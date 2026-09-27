# 场景参数化（常量/列表/CSV·作用域·优先级体系）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-007                                                                                                                               |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                                                 |
| 优先级       | P1（迭代内）                                                                                                                          |
| 所属模块     | 接口测试（api_test 域）+ 引擎（engine）                                                                                               |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                                                                                |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | API-006（五配置区载体）、PROJ-003（环境变量，优先级体系下界）、PROJ-004（文件管理，CSV 关联）                                        |
| 下游消费     | RPT-003（变量终值视图）、API-008（批量执行参数快照）                                                                                  |
| 上游依据     | 需求文档 §五「CSV/列表/常量参数化（优先级体系）」；功能清单 §6.5 参数区                                                              |
| 对标基线     | 功能清单 §6.5：参数（常量/列表/CSV，CSV 可本地上传或关联文件管理，作用域分场景/步骤）                                                |
| 关联架构文档 | engine-execution-architecture.md §3（渲染管线）；test-domain-model.md §2.7（config Json 五配置区）                                   |
| 高保真确认   | 待确认（原型 docs/design/API-007-scenario-params-csv/）                                                                               |
| 工作量估算   | 后端 2 人日 / 前端 3 人日 / 引擎 2 人日                                                                                               |

## 1. 概述

### 1.1 功能定位

场景的数据驱动层：常量（固定值）、列表（有序值集，供 ForEach 与取用）、CSV（行列数据集，逐行驱动）三类参数 + 场景/步骤两级作用域 + 渲染优先级体系，使同一编排可按数据集重复执行。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                       | P1 ✅ | 后续                                     |
| -------------------------------------------------------------------------- | ----- | ---------------------------------------- |
| 常量参数：name/value/描述；场景级与步骤级                                   | ✅     | —                                        |
| 列表参数：name/values[]（≤1000 项）；供 `${name}` 取首/当前与 ForEach 迭代 | ✅     | 列表策略（随机/轮询取值，登记 Backlog）  |
| CSV 参数：本地上传（存 FileRecord）或关联文件管理 fileId；预览前 10 行      | ✅     | 在线编辑 CSV 内容（登记 Backlog）        |
| CSV 配置：分隔符（,/;/\t）/编码 UTF-8 固定/首行表头开关/列名映射            | ✅     | 多字符分隔符、GBK（登记）                |
| 作用域：场景级（config.params）与步骤级（step.config.params）；同名就近覆盖 | ✅     | —                                        |
| ForEach 绑定：循环步骤 source=列表名或 CSV 列名，逐值/逐行迭代注入变量      | ✅     | 并行迭代（引擎串行语义，登记简化）       |
| 优先级体系：步骤提取 temp > 步骤参数 > 场景参数 > 环境变量（渲染取值）     | ✅     | —                                        |
| 变量总览：编辑页变量视图（四级来源合并预览）；报告变量终值视图（RPT-003）  | ✅     | —                                        |

### 1.3 前置依赖

API-006 config.params 结构；PROJ-004 文件上传/下载（CSV 落 FileRecord，校验 .csv 后缀与大小上限）；渲染管线 renderString（kernel/render.ts）扩展取值链。

### 1.4 对标基线核对

完全复刻：常量/列表/CSV 三类、本地上传与文件管理关联、场景/步骤作用域。简化实现：CSV 仅 UTF-8+单字符分隔符；列表取值=顺序当前值（随机/轮询策略 Backlog）；ForEach 串行迭代（基线并行线程组语义，自研内核登记简化）。

## 2. 业务逻辑

- 参数存储：`config.params = { constants: [{name,value,description?}], lists: [{name, values[]}], csv?: {fileId?, upload?{id}, delimiter, hasHeader, columns?[] } }`；步骤级 `step.config.params` 同构（csv 仅场景级，步骤级限常量/列表）。
- CSV 解析（web 侧任务创建时）：读文件文本 → 按分隔符切行列 → hasHeader 取首行为列名（否则 col1..colN）→ `{columns, rows: string[][]}` 内嵌 command（行数≤10000、单行≤8KB 超限 422 50032）。
- ForEach 迭代：source 为列表名→values 逐个注入 `${var}`；为 CSV 列名→逐行注入该列值且整行所有列可经 `row.列名` 取用（`row` 保留字）。
- 渲染取值链（kernel）：`tempVars → stepParams → scenarioParams（constants+lists 当前值+CSV 当前行 row）→ envSnapshot.vars`；`renderString` 逐段解析 `${...}`（与函数库 EXEC-003 共用词法：`var|func(args)|pipeline`）。
- 提取写回：scope=temp 只在本场景 tempVars（不回环境）；scope=env 汇总回调写回（S2 语义不变）。

## 3. UI/UX 设计（高保真 docs/design/API-007-scenario-params-csv/）

- 参数区（场景编辑页「参数」Tab）：三分区卡片——常量（可编辑行：名/值/描述）、列表（名/值集 chips 或多行文本）、CSV（来源切换：本地上传/文件管理选择器；分隔符与首行表单开关；预览表格前 10 行高亮列名）。
- 步骤参数：步骤配置 Tab 内折叠面板「参数覆盖」（常量/列表子集，提示就近覆盖同名场景参数）。
- 变量视图：右侧抽屉四级来源合并表（来源徽标：temp/步骤/场景/环境 + 最终生效值），随编排实时预览。
- ForEach 绑定：循环步骤配置 source 下拉（列出场景列表名+CSV 列名）+ var 名输入。

## 4. 技术架构

- 数据模型：零新表新列（config.params 承载）；FileRecord 复用（csv 类型文件）。
- 契约：`scenarioParamsSchema`（constants/lists/csv 判别）、`csvTableSchema={columns,rows}`（command 内嵌）；422 错误码 `CSV_TOO_LARGE 50032`、`CSV_PARSE_FAILED 50033`（坏行/列不一致容忍策略：跳过坏行计数提示）。
- 端点：无独立端点（随 scenarios PUT 保存）；`GET /scenarios/{id}/params/preview`（CSV 解析预览，编辑页用，上限 10 行）。
- 服务：scenario.service 内 `parseCsvFile(fileId, cfg)`（shared 纯函数 `parseCsv(text,cfg)` 单测覆盖：分隔符/表头/引号转义/空行/坏行）；exec.service createScenarioTask 组装 params（CSV→rows 内嵌）。
- 引擎：kernel/render.ts 取值链扩展（row/列表当前值）；runScenario foreach 注入（API-006 §4 执行器）。
- 权限点：随 PROJECT_SCENARIO（无新增）。
- 前端：参数区组件 `ScenarioParamsPanel.tsx`、CSV 预览 `CsvPreviewTable.tsx`、变量视图 `VarsOverlayPanel.tsx`。

## 5. 测试用例

- API-007-T1（jmx）：params 随场景保存/读取断言；CSV fileId 不存在 404/422；超限行数 50032；分页信封（随场景列表）。
- API-007-T2（spec CSV 数据驱动）：上传 3 行 CSV→foreach 绑定→执行→3 迭代帧+每迭代请求负载含当行数据（接口断言 payload）；报告迭代分组（UI）。
- API-007-T3（spec 优先级二态）：同名变量 env<场景<步骤<temp 四级覆盖，报告 requestSnapshot 断言最终生效值；CSV 当前行 row.列 取值。
- 单测：parseCsv 矩阵（分隔符×表头×引号×坏行）、取值链四级覆盖序、foreach 注入与 row 保留字、列表当前值语义。

## 6. 竞品深度对标

基线参数区主体覆盖；差异：①列表取值策略仅顺序（基线随机/轮询，Backlog）；②CSV 编码仅 UTF-8；③并行迭代延后（自研内核串行保证变量链确定性）。文件管理关联与本地双通道与基线一致。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。风险点：CSV 解析与引擎 foreach 的列语义对齐（row 注入），以 T2/T3 双 E2E 锁定。

## 8. 勘误登记

（暂无）
