# 接口用例 AI 生成（单条按定义 · OpenAPI 批量）

| 元信息项     | 内容                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 文档编号     | AI-003                                                                                                      |
| 所属迭代     | Sprint 7 — AI 能力                                                                                          |
| 优先级       | P2（AI 主能力之一）                                                                                         |
| 所属模块     | ai 域 + api_test 域（只读消费 ApiDefinition，经 API-003 创建端点导入）                                       |
| 文档状态     | Implemented（2026-09-27 交付）                                                                              |
| 最后更新日期 | 2026-09-27                                                                                                  |
| 上游依赖     | AI-001（模型网关）、API-002（接口定义/OpenAPI 解析器）、API-003（接口用例创建端点）、AI-005（提示词模板）     |
| 下游消费     | 无硬下游                                                                                                    |
| 上游依据     | 需求文档 §六；功能清单 §4.4「AI 生成用例（单条按 API 信息+提示词；批量按 Swagger/OpenAPI 文档生成多条）」     |
| 对标基线     | 功能清单 §4.4（接口测试域 AI 生成）；§十 版本对比「支持 AI 生成接口用例」两版均支持                          |
| 关联架构文档 | test-domain-model.md §2.8；api-conventions.md §3                                                            |
| 高保真确认   | 待确认（原型 docs/design/AI-003-api-case-generation/）                                                       |
| 工作量估算   | 后端 2.5 人日 / 前端 2 人日                                                                                  |

## 1. 概述

### 1.1 功能定位

接口测试域 AI 生成：**单条**模式按选中 ApiDefinition（method/path/请求结构）+ 提示词生成接口用例草稿（请求差量+断言建议）；**批量**模式粘贴/上传 OpenAPI(Swagger) 文档→复用 S2 解析器提取接口清单（≤20/批）→逐条生成→勾选导入（走 API-003 既有创建端点）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                          | P1 ✅ | 后续                                                     |
| ----------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| 单条生成：接口定义列表选中 1 条→「AI 生成」→草稿（name/请求差量 headers·query·body/断言建议列表） | ✅ | 按接口定义批量全选生成（Backlog）                        |
| 批量生成：粘贴或上传 OpenAPI 3.x JSON→解析出接口清单（method+path+summary）→逐条生成草稿 | ✅ | Swagger URL 拉取（SSRF 面扩大，登记；粘贴先行）    |
| 批次上限：单批 ≤20 接口（超出 422 提示分批）；每接口 1 条草稿                  | ✅     | 每接口多条（正/反/边界，Backlog）                        |
| 草稿结构：name/request{headers?,query?,bodyJson?}/assertions[{source(path/status/body),expression,operator,expected}] | ✅ | 前后置脚本/变量提取建议（Backlog）                 |
| 断言算子约束：status 精确/body-jsonpath/body-contains/headers-contains/响应时间上限（映射 S2 六断言子集） | ✅ | —                                                        |
| 勾选导入：逐条调 API-003 创建端点（apiId 关联真实校验）；留痕 AiGenRecord（scene=api_gen/api_gen_batch） | ✅ | 整体事务（部分成功，登记）                          |
| 模板联动：AI-005 scene=api_gen 模板可选（占位符 {{api_spec}}/{{design_method}}） | ✅     | —                                                        |

### 1.3 前置依赖

AI-001 网关；API-002 的 OpenAPI 解析器（import 链路已有，抽复用）；API-003 创建端点（已交付）。

### 1.4 对标基线核对

完全复刻：单条按 API 信息+提示词生成、批量按 Swagger/OpenAPI 文档生成多条。边界：AI-003 批量=**用例草稿生成**，不做接口定义存量同步（API-011 S6 口径，不重叠）；URL 拉取延后（粘贴/上传先行）。

## 2. 业务逻辑

- **单条 Prompt**：system 开头固定 `你是 RabbitAITest 的接口用例生成助手`（mock 分支依赖）；用户消息=模板渲染+ApiDefinition 摘要（method/path/headers/query/body schema JSON 化，>8KB 截断）；输出 JSON 数组（1 条，多给取首条并提示）。
- **批量流程**：`parseOpenApiForAi(doc)`（复用/包装 S2 解析器）→`{method,path,summary}[]`（≤20）→并发逐条组装 prompt（p-limit 3，登记节流）→逐条 ChatClient→解析→草稿数组（带 apiIndex 对位）。
- **草稿校验**：operator 白名单（eq/contains/lt/jsonpath-eq）外剔除；bodyJson 非法 JSON 剔除（skipped 明细）。
- **导入**：逐条 POST 接口用例创建端点（apiId=单条模式的定义 id；批量模式=**只生成草稿不自动建定义**，导入需先选目标定义或走「存为该接口用例」选择器——批量草稿导入绑定用户在接口定义树选中的目标，登记简化）。
- **留痕**：AiGenRecord scene=api_gen（单条）/api_gen_batch（批量，generated=成功草稿数）。

## 3. UI/UX 设计（高保真 docs/design/AI-003-api-case-generation/）

- 接口定义页（三页签之「定义」）行操作/工具栏「AI 生成用例」→ 抽屉 720px，两模式 Tab：
  - **单条**：顶部展示当前定义摘要（method Tag+path+name），模板/模型选择，「生成」→草稿卡片（name/请求差量 chips/断言表 source·expression·operator·expected）→「导入」
  - **批量**：OpenAPI JSON 粘贴框（或文件上传）→「解析」→接口清单表格（method/path/summary checkbox 列，≤20 提示）→「批量生成」→进度（n/总数）→草稿列表按接口分组→勾选导入
- 空态/异常：无可用模型引导；解析失败 70502 重试；OpenAPI 非法 422（复用 API-002 错误口径）。

## 4. 技术架构

- 契约：`aiGenerateApiCaseSchema`（apiId/modelId?/templateId?/designMethod?）、`aiGenerateApiCaseBatchSchema`（openapiDoc string 1-512KB）、`aiApiCaseDraftSchema`、响应同 AI-002 风格（drafts/skipped/genRecordId）。
- 端点：`POST /api/v1/projects/{pid}/ai/generate/api-cases`、`POST .../api-cases/batch`（均 PROJECT_AI:READ；不落库用例）。
- 服务：generate.service.ts 扩展（单条/批量）；`API_CASE_GEN_SYSTEM_PROMPT`+ApiDefinition 摘要序列化放 shared 纯函数。
- 错误码：`AI_OPENAPI_INVALID 70503`（422，批量文档解析失败）、复用 70502/70404/70444/70501。
- 前端：`ApiCaseGenerateDrawer.tsx`（apis 页挂载，复用页面既有 OpenAPI 上传交互）。

## 5. 测试用例

- AI-003-T1（jmx 四类）：单条生成（预置定义+mock 模型）→drafts 1 条含断言；401/403/404（坏 apiId 40414）；422（坏 modelId 70404/无模型 70444）；信封+耗时。
- AI-003-T2（jmx 批量）：贴 3 接口 OpenAPI→3 草稿；422（非法文档 70503/超 20 接口）。
- AI-003-T3（spec 单条全链路）：选中定义→生成→草稿断言表可见→导入→接口用例列表新增（关联/断言数）；Console+网络 payload 断言。
- AI-003-T4（spec 批量）：粘贴 OpenAPI→解析表格 3 行→生成进度→草稿分组→部分勾选导入。
- 单测：ApiDefinition 摘要序列化（8KB 截断/JSON 稳定）、批量解析复用矩阵（paths 无 method/空文档）、operator 白名单剔除、p-limit 并发顺序留痕、70503 分支。

## 6. 竞品深度对标

基线主体覆盖（单条+批量两口径）。差异：①每接口 1 条草稿（基线未承诺多条）；②批量导入绑定既有定义（不自动建定义——与 API-011 边界）；③无 URL 拉取（粘贴/上传先行）；④无前后置脚本建议。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例）。联调点：mock 供应商按「接口用例生成助手」开头返回固定单条草稿（含 2 断言）。

## 8. 勘误登记

**勘误 1（2026-09-27，错误码段与批量解析映射）**：60xxx → 70xxx；批量文档解析失败统一映射 `AI_OPENAPI_INVALID 70503`（parseOpenApi3 内部错误 catch 转译，不透出 40422）。
