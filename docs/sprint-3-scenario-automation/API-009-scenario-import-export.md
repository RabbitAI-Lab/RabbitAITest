# 场景导入导出（Rabbit JSON·jmx·MeterSphere 兼容）

| 元信息项     | 内容                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-009                                                                                                   |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                     |
| 优先级       | P2（迭代内）                                                                                              |
| 所属模块     | 接口测试（api_test 域）                                                                                   |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                        |
| 最后更新日期 | 2026-09-27                                                                                                |
| 上游依赖     | API-006（步骤树与引用模型）、API-007（params）、PROJ-004（文件，CSV 随包）                                |
| 下游消费     | S6 API-011（Swagger 同步参照导出格式）                                                                    |
| 上游依据     | 需求文档 §六「JMeter jmx 场景导入」；功能清单 §6.5 导入导出                                               |
| 对标基线     | 功能清单 §6.5：导入 MeterSphere/JMeter 格式；导出可选「保留引用关系」；需求文档 §六兼容性                 |
| 关联架构文档 | api-conventions.md（导入幂等与信封）；engine-execution-architecture.md §1（jmx 仅导入格式、不作执行内核） |
| 高保真确认   | 待确认（原型 docs/design/API-009-scenario-import-export/）                                                |
| 工作量估算   | 后端 4 人日 / 前端 2 人日                                                                                 |

## 1. 概述

### 1.1 功能定位

场景资产的可迁移层：导出 Rabbit JSON（两种模式：保留引用关系 / 展开为自定义请求快照）、导入 Rabbit JSON 与 JMeter jmx（子集映射）及 MeterSphere v3 导出 JSON（基础字段映射），完成跨项目/跨平台迁移。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                             | P1 ✅ | 后续                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 导出单场景/勾选批量：Rabbit JSON（meta+config+steps 树+formatVersion）                                                                                           | ✅    | —                                                |
| 导出模式「保留引用」：引用步骤存 refKind+业务键（method+path+name 匹配导入）                                                                                     | ✅    | 按项目整体导出（S4 计划导出随 PLAN-005）         |
| 导出模式「展开」：引用步骤递归展开为 custom 快照（含子场景，深度≤5）                                                                                             | ✅    | —                                                |
| CSV 随包：场景 CSV 参数文件内容内嵌（inline 块）；导入自动重建 FileRecord                                                                                        | ✅    | 二进制附件（无此场景，不支持）                   |
| 导入 Rabbit JSON：按业务键重挂引用（命中多条取最新+警告）；模块可选                                                                                              | ✅    | 冲突交互式合并（登记 Backlog，当前直接新建）     |
| 导入 jmx（子集）：TestPlan→场景；ThreadGroup 循环/次数；HTTPSamplerProxy→custom 步骤；CSVDataSet→CSV 参数+foreach 循环；JSR223Sampler→script；ConstantTimer→wait | ✅    | 嵌套控制器全量/BeanShell/HTTP 默认值继承（登记） |
| 导入 MeterSphere JSON（v3 导出格式）：场景/步骤/变量/断言基础字段映射                                                                                            | ✅    | 高级配置全量（登记简化）                         |
| 导入预览：解析结果摘要（步骤数/类型分布/警告列表）确认后落库                                                                                                     | ✅    | —                                                |

### 1.3 前置依赖

S2 PROJ-002 jmx 模板经验（XML 解析安全口径：禁 DTD/外部实体）；文件上传通道复用。

### 1.4 对标基线核对

完全复刻：双格式导入+导出保留引用选项。简化实现：jmx 子集映射（登记映射表）；MeterSphere JSON 基础字段（method/path/body/断言状态码）；导入冲突策略=新建（基线可覆盖合并）。

## 2. 业务逻辑

- 导出结构：`{ format:"rabbit-scenario", formatVersion:1, exportedAt, mode:"ref"|"flatten", scenarios:[{ name,level,status,tags,modulePath,config(params/prePost/asserts/settings),steps:[...树] }] }`；ref 模式引用步骤 `{stepType:"ref_case", refKind:"api_case", refKey:{method,path,name}}`；flatten 模式展开为 `{stepType:"custom", config:{bundle:{spec,asserts,pre,post,extracts}}}`。
- 导入匹配：ref 模式按 refKey 在目标项目（method+path 命中多条→取 updatedAt 最新，记 warning）；未命中→该步骤降级 custom（携带导出时快照，标记 warning）。
- jmx 映射（fast-parse XML → 步骤树）：`HTTPSamplerProxy`（method/path/domain+port→绝对 URL 当环境无关处理为 custom 步骤，body/headers 映射 7 类中 raw_json/raw_text/form_urlencoded）；`LoopController.loops`→loop count（forever→maxLoops 10000）；`CSVDataSet(filename,variableNames,delimiter)`→场景 CSV（文件不存在时 variableNames 构造空表 warning）+ 外层包 foreach 循环；`JSR223Sampler/PreProcessor`→script 步骤/前置（仅 javascript 语言，其余 warning 跳过）；`ConstantTimer.value`→wait。
- 安全：XML 解析禁 DTD/外部实体（S2 口径）；导入文件大小≤2MB；jmx 线程组仅取首个（多线程组 warning）。
- 幂等：导入=新建（num 分配同场景创建）；同名不查重（MeterSphere 同口径允许同名）。

## 3. UI/UX 设计（高保真 docs/design/API-009-scenario-import-export/）

- 场景列表工具条：导入按钮（弹窗：拖拽上传区（.json/.jmx）→解析预览表（场景名/步骤数/类型徽标/警告黄条）→目标模块选择→确认导入）；导出按钮（勾选后可用：模式 Radio 保留引用/展开+说明文案）。
- 导入预览：可展开步骤树抽样（首场景完整树）；警告列表（引用未命中降级/不支持节点跳过计数）。

## 4. 技术架构

- 数据模型：零新表；FileRecord 承载导入文件（.json/.jmx 类型白名单）。
- 端点：`POST /scenarios/export`（{ids[], mode}→JSON 下载流）；`POST /scenarios/import/preview`（multipart file→解析摘要不落库）；`POST /scenarios/import`（file+moduleId?→落库返回创建列表）。
- 服务：`scenario-io.service.ts`——`exportScenarios`（引用解析/展开递归）、`parseImport`（格式探测 json/jmx 分派）、`importRabbit`/`importJmx`/`importMeterSphere`；shared 纯函数 `jmx-to-steps.ts`（fast-xml-parser 禁 DTD）供单测。
- 权限点：导出=PROJECT_SCENARIO:READ；导入=PROJECT_SCENARIO:CREATE。
- 错误码：`IMPORT_FORMAT_UNKNOWN 50036`、`IMPORT_FILE_TOO_LARGE 50037`、`IMPORT_PARSE_FAILED 50038`。
- 前端：`ImportModal.tsx`（复用 S1 CASE-004 导入弹窗骨架）、导出模式弹窗。

## 5. 测试用例

- API-009-T1（jmx 四类）：export 返回体断言（JSONPath steps 数）；import 空文件/超大 422；401/403；非法格式 50036；分页信封（导入后列表）。
- API-009-T2（spec 往返）：建引用场景→导出（保留引用）→删除→导入（引用命中）→步骤树等价（UI 树断言）→执行通过；导出（展开）导入→custom 步骤快照执行通过。
- API-009-T3（spec jmx 导入）：预置 jmx（HTTP+循环+CSVDataSet+Timer）→导入预览警告/步骤数→落库→foreach+wait 结构断言→执行（mock 目标）通过。
- 单测：jmx 映射矩阵（采样器/循环/CSV/脚本/等待/不支持节点）、export flatten 递归深度、import refKey 命中/多命中/降级、MeterSphere JSON 字段映射。

## 6. 竞品深度对标

基线导入导出主体覆盖；差异：jmx 子集映射表登记（嵌套控制器全量/BeanShell/HTTP 默认值继承不支持）；MeterSphere JSON 基础字段；冲突合并策略=新建。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。风险点：jmx 现实样本多样性（以预置样例锁定；社区样本差异以 warning 容忍不失败）。

## 8. 勘误登记

（暂无）
