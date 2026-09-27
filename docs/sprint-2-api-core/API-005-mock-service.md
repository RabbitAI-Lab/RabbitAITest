# Mock 服务（规则匹配·独立服务）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-005                                                                                                                               |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                               |
| 优先级       | P2（迭代内高优）                                                                                                                      |
| 所属模块     | 接口测试（api_test 域）+ mock 服务（apps/mock）                                                                                       |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | API-002（MOCK 页签与定义响应）                                                                                                        |
| 下游消费     | 联调/前端挡板（用户使用面）；S3 场景前置挡板实践                                                                                      |
| 上游依据     | 需求文档 M6（Mock 服务）；功能清单 §6.4                                                                                               |
| 对标基线     | 功能清单 §6.4：MOCK 页签匹配（头/Query/REST/体→响应）、json/xml 格式化、跟随 API、Mock 调试、复制 Mock 地址外调                        |
| 关联架构文档 | engine-execution-architecture.md §6（Mock：规则快照 Redis+失效重载、无状态横向扩容）                                                  |
| 高保真确认   | 待确认（原型 docs/design/API-005-mock-service/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                         |
| 工作量估算   | 后端/服务 3 人日 / 前端 2 人日 / 联调 1 人日                                                                                          |

## 1. 概述

### 1.1 功能定位

以独立 Hono 服务（apps/mock，:4000）提供项目级 Mock：规则挂在接口定义下（MOCK 页签管理），web 侧变更全量快照写 Redis，mock 服务懒加载+失效重载——两进程零 DB 耦合。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                       | P2 ✅ | 后续                                   |
| -------------------------------------------------------------------------- | ----- | -------------------------------------- |
| 规则 CRUD（定义 MOCK 页签）：名称/匹配条件/响应（状态/头/体/延迟 ms）/启用开关 | ✅     | —                                      |
| 匹配条件：method+path 模板（REST 参数 `{id}`）+ 可选 请求头/Query/请求体（包含匹配） | ✅     | 匹配模式多选（基线单口径，登记）       |
| 跟随 API（followApi）：未显式配响应体时取定义默认响应                      | ✅     | —                                      |
| Mock 地址：页签展示+复制 `http://{host}:{port}/mock/{项目号}{path}`        | ✅     | 独立域名 mock.{domain}（部署口径）     |
| 命中语义：多规则按「匹配条件最多者」优先（精确>宽松），未命中 404（code 40401） | ✅     | —                                      |
| 规则热更新：web 变更即失效重载（Redis 快照版本+PUBLISH）                   | ✅     | —                                      |
| Mock 调试：规则「调试」按钮发一次示例请求展示命中/未命中                   | ✅     | 服务端/本地双模式（本地=S5 个人中心）  |
| 响应体 json/xml 格式化编辑                                                 | ✅     | —                                      |

### 1.3 前置依赖

API-002 定义与默认响应；Redis（规则快照通道，global-setup 已具备）。

### 1.4 对标基线核对

完全复刻：匹配四维/跟随 API/Mock 地址/启用开关/延迟。简化实现：基线内嵌 mockserver-netty→独立 Hono 服务（架构既定：规则快照 Redis，无状态扩容）；「调试」经 web 代理发请求（基线前端直连）。

## 2. 业务逻辑

- 规则快照：任一规则/定义响应变更 → web 重写 `mock:rules:{projectId}`（全量数组：{projectId, projectNum, apis:[{method, path, response}], rules:[{id, name, enabled, method, path, matchers, response, followApi, apiResponse}] }）+ 版本号+1 + `PUBLISH mock:invalidate {projectId}`；mock 服务订阅失效、按需重载。
- 匹配算法：路径模板归一匹配（`{param}` 捕获）→method 相等→头/Query 键存在且值相等→体包含；候选按条件数降序取首；全不过→404 `{"code":40401,"message":"无匹配 Mock 规则"}`。
- 延迟：响应前 sleep(delayMs≤10000)。
- 未启用规则不参与匹配（禁用=透明下线）。

## 3. UI/UX 设计（高保真 docs/design/API-005-mock-service/）

- 定义详情 MOCK 页签：顶部 Mock 地址卡（完整 URL+复制按钮+服务状态点）；规则表格（名称/匹配摘要（method+path+条件数）/响应摘要（状态+体前 40 字）/启用开关/操作：调试·编辑·删除）+「新建规则」。
- 规则编辑弹窗：匹配区（method 下拉/path 模板/头 KV/Query KV/体包含文本）+ 响应区（状态码/头 KV/体 textarea（json/xml 格式化按钮）/延迟 ms）+ 跟随 API 开关（开启则响应体区禁用）。
- 调试弹窗：示例请求（可改 query/头）→发送→命中结果（命中规则名+返回体）或 404 提示。

## 4. 技术架构

- 数据模型（已建齐）：ApiMock(apiId/name/matchers JSONB/response JSONB/followApi/enabled)。
- 端点：`GET/POST /api/v1/projects/{pid}/apis/{apiId}/mocks`、`PUT/DELETE .../mocks/{id}`、`GET .../apis/{apiId}/mock-url`（返回拼好的地址）；调试 `POST /api/v1/projects/{pid}/mocks/{id}/debug`（web 服务端代发到 mock 服务，避免浏览器跨域）。
- zod：mockUpsertSchema（matchers {headers[],query[],bodyContains?}/response {status,headers[],body,delayMs}）。
- mock 服务（apps/mock）：`/healthz`、`/hello`（既有 e2e 目标保留）+ `ALL /mock/{projectNum}/{...path}`；Redis 只读连接（规则快照+失效订阅）；内存缓存 LRU（项目级，≤64 项目）。
- 权限点：PROJECT_API:*（规则 CRUD 复用）；mock 服务端点无鉴权（对齐基线 Mock 公开访问口径，仅含规则数据不含业务数据）。
- 错误码：`MOCK_NOT_FOUND 40434`（web 侧）；mock 服务 40401。
- 配置：`MOCK_PORT`（默认 4000，既有）；`MOCK_PUBLIC_URL`（拼地址展示，默认 `http://127.0.0.1:{MOCK_PORT}`）。

## 5. 测试用例

- API-005-T1（jmx 四类）：规则 CRUD/mock-url；401/403/404；matchers 结构非法 422；规则列表信封。
- API-005-T2（spec 主链路）：定义 `/pets/{id}`+规则（Query kind=dog→200 响应体）→复制 Mock 地址→直发 `GET /mock/{项目号}/pets/1?kind=dog` 命中返回体（接口断言体与状态）；`kind=cat` 未命中 40401（UI 调试弹窗同步断言）。
- API-005-T3（spec 二态+热更新+跟随）：规则禁用→原请求 404；改响应体→立即生效（无重启）；followApi 开→返回定义默认响应；延迟 300ms（接口断言 duration≥300）。
- 单测：匹配算法矩阵（模板/头/Query/体/优先级/禁用）、快照构建、路径模板捕获。

## 6. 竞品深度对标

基线 §6.4 全覆盖；差异：①mockserver-netty→Hono+Redis 快照（架构 §6 既定：无状态横向扩容、与 web 零 DB 耦合）；②匹配优先级「条件最多者」（基线未明示，自主设计登记）；③独立域名=部署口径（S2 单机 path 路由）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。热更新链路（web 写→PUBLISH→mock 重载）是关键验证点；验收对应 sprint-overview 验收 6。

## 8. 勘误登记

（暂无）
