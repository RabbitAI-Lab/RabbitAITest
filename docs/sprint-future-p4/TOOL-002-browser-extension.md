# 浏览器插件采集导入契约（TOOL-002 · 外部工具承接面）

| 元信息项     | 内容                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | TOOL-002                                                                                                                    |
| 所属迭代     | Sprint future — 远期 P4                                                                                                     |
| 优先级       | P4（远期增强级）                                                                                                            |
| 所属模块     | TOOL 外部工具 / API 接口定义（采集落库）                                                                                    |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                                                                                                    |
| 最后更新日期 | 2026-09-28                                                                                                                  |
| 上游依赖     | INTG-003（APIKEY 通道）、TOOL-001（open 面与回读端点复用）、API-002（定义创建）                                             |
| 下游消费     | 浏览器插件（外部仓库交付）、后续 Postman/Har 导入增强（复用采集载荷结构）                                                   |
| 上游依据     | 需求文档 §优先级 P4「IDEA/浏览器插件（TOOL）」；清单 §11「浏览器插件=两版均有（pricing 对比页列出，与 IDEA/Jenkins 同列）」 |
| 对标基线     | MeterSphere功能清单 §11（浏览器插件仅一行定价页证据，功能细节清单未覆盖——超出基线，自主设计）                               |
| 关联架构文档 | api-conventions.md、rules/security.md（headers 脱敏）                                                                       |
| 高保真确认   | 不适用（纯后端契约类；契约评审=本规格 §4）                                                                                  |
| 工作量估算   | 后端 1 人日                                                                                                                 |

## 1. 概述

### 1.1 功能定位

交付浏览器插件所依赖的**采集导入契约**：插件抓取浏览器实际发出的请求（URL/方法/头/体），批量提交为 RabbitAITest 接口定义草稿。基线清单对浏览器插件仅有定价页一行（功能细节未覆盖），本规格按「抓包→接口定义」这一MeterSphere 插件族通行语义自主设计，登记为超出基线。插件本体（MV3 扩展）外部仓库交付，本仓冻结服务端契约。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | P1 ✅ | 后续                                           |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------------- |
| `POST /api/v1/open/api-capture`：批量提交抓包请求（≤100 条/批）        | ✅    | —                                              |
| URL 解析：path+query 拆解进 RequestBundle（query 逐键）                | ✅    | cookie/storage 关联采集（登记）                |
| 敏感头脱敏入库（authorization/cookie/set-cookie 置 `***`）             | ✅    | 可配置脱敏名单（登记）                         |
| 自动命名：`METHOD /path 尾段` + 描述标记「浏览器插件采集 · 来源域名」  | ✅    | —                                              |
| 重复提交语义：同 (projectId, method, path) 已存在→跳过（返回 skipped） | ✅    | upsert 模式（与 TOOL-001 差异化，登记理由 §2） |
| 回读：复用 TOOL-001 `GET /api/v1/open/api-definitions`                 | ✅    | —                                              |
| MV3 扩展本体（devtools 抓包面板/一键提交）                             | ❌    | 外部仓库交付                                   |

### 1.3 前置依赖

同 TOOL-001（open 面基础设施全部复用）。

### 1.4 对标基线核对

基线仅有「浏览器插件=两版均有」一行，无功能细节——本规格功能面全部登记为**超出基线，自主设计**（对齐插件族语义：浏览器抓包→接口定义，与 IDEA 同步形成「本地调试/浏览器采集」双入口）。

## 2. 业务逻辑

- **跳过语义（与 sync 的 upsert 区分）**：采集是高频快照行为，重复提交同一接口不应反复 bump version 污染变更历史——已存在（含软删）即跳过并计数 `skipped`；响应 `{items:[{apiId?, method, path, action: "created"|"skipped"}], created, skipped}`。
- **解析规则**：仅接受 http/https URL；host 丢弃（环境变量承载域名，对齐 PROJ-003 环境体系）；query 逐键入 spec.query；headers 经脱敏名单后入 spec.headers；body 仅保留 text/json 两类（≤64KB，二进制丢弃并计数 `droppedBodies`）。
- **边界与异常**：批>100 → 422·10024（复用 TOOL-001 限流码）；载荷非法（非 URL/method 枚举外）→ 422·10025 `OPEN_CAPTURE_INVALID`；全批先校验后写入（原子）。

## 3. UI/UX 设计

无 UI（open API）。

## 4. 技术架构

- **契约**（packages/shared/src/tool/schemas.ts 增补）：`openApiCaptureSchema`：`{projectId: uuid, requests: array({url: http(s) URL ≤2048, method ∈ HTTP_METHODS, headers? Record ≤50, body? {kind: "text"|"json", text ≤64KB}}) length 1..100}`。
- **路由**：`apps/web/src/app/api/v1/open/api-capture/route.ts`（POST，withApiKey，审计 `open.api-capture`）。
- **服务**：`open-sync.service.ts` 增 `captureApiDefinitions()`——URL 解析+脱敏+建定义（num 分配/根模块/RequestBundle 最小构造复用 TOOL-001 私有函数）。
- **错误码**：`OPEN_CAPTURE_INVALID: 10025`（422）；复用 10024。
- **脱敏名单常量**（shared 导出）：`authorization, cookie, set-cookie, proxy-authorization, x-api-key`。

## 5. 测试用例

| 编号        | 类型   | 前置               | 步骤                              | 预期                                   |
| ----------- | ------ | ------------------ | --------------------------------- | -------------------------------------- |
| TOOL-002-T1 | Vitest | 种子项目+APIKEY    | 采集 3 条（含 query/敏感头）→重放 | created=3；header 脱敏；重放 skipped=3 |
| TOOL-002-T2 | Vitest | 同上               | 二进制 body/超长 URL/非 http URL  | droppedBodies 计数 / 422·10025         |
| TOOL-002-T3 | jmx    | api-test 栈+APIKEY | Bearer 头采集 2 条 + 回读对账     | 200 信封 + GET items 断言              |
| TOOL-002-T4 | jmx    | 错 APIKEY          | 采集调用                          | 401                                    |
| TOOL-002-T5 | jmx    | 有效 APIKEY        | 非法载荷（ftp URL）与超限批       | 422·10025 / 422·10024                  |
| TOOL-002-T6 | e2e    | —                  | 豁免登记（无 UI 面）              | —                                      |

四类场景：正常=T3；权限=T4；校验=T5；分页=复用 TOOL-001 T6（同端点，登记不重复建计划）。

## 6. 竞品深度对标

基线无功能细节（定价页一行）。本项目自主设计双入口语义：IDEA 同步=upsert（开发态，变更要留痕）；浏览器采集=skip-if-exists（浏览态，快照去重）。差异化理由：两种工具的使用节奏不同（IDEA 侧定义演进、浏览器侧高频重复浏览），统一 upsert 会让 version 噪音化。

## 7. 里程碑与验收

DoD：端点+脱敏+跳过语义+T1-T5 全绿+OpenAPI 快照含新路径。演示：curl 模拟插件提交 2 条抓包→web 端列表出现「浏览器插件采集」描述的定义。回归：TOOL-001 用例（共享 service 与限流码）。

## 8. 勘误登记

1. **droppedBodies 计数裁撤**：规格 §2 预写二进制 body 以 `droppedBodies` 计数放行——实现口径为 schema 层直接 422 拒绝非 text/json body（`openApiCaptureRequestSchema.body.kind` 枚举外无通道），响应仅含 items/created/skipped。
2. **来源标记承载**：规格 §2 的「描述标记 浏览器插件采集 · 来源域名」——域模型无 description/tags 列，来源以变更历史 `diff.after.source: browser-capture` 与 `host` 字段承载（列表页名称=METHOD /尾段）。
