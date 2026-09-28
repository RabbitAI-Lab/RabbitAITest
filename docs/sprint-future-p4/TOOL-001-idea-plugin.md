# IDEA 插件服务端同步契约（TOOL-001 · 外部工具承接面）

| 元信息项     | 内容                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 文档编号     | TOOL-001                                                                                                                                         |
| 所属迭代     | Sprint future — 远期 P4                                                                                                                          |
| 优先级       | P4（远期增强级）                                                                                                                                 |
| 所属模块     | TOOL 外部工具 / API 接口定义（同步目标）                                                                                                         |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                                                                    |
| 最后更新日期 | 2026-09-28                                                                                                                                       |
| 上游依赖     | INTG-003（APIKEY 第三通道、withApiKey 守卫、10 QPS 限流、数据范围=本人可见项目）、API-002（ApiDefinition 仓储契约）                              |
| 下游消费     | IDEA 插件（外部仓库交付，见 §1.2 边界）、TOOL-002（浏览器插件复用同一 open 面）                                                                  |
| 上游依据     | 需求文档 §优先级 P4「IDEA/浏览器插件（TOOL）」；清单 §6.2「IDEA 插件：本地一键同步 API」、§11「API 导入：IDEA 插件（本地调试+API 同步）=社区版」 |
| 对标基线     | MeterSphere功能清单 §11（IDEA 插件=社区版功能，本地调试+API 同步）                                                                               |
| 关联架构文档 | api-conventions.md（信封/分页）、rules/security.md（密钥与限流）                                                                                 |
| 高保真确认   | 不适用（纯后端契约类；以本规格 §4 契约评审替代——OpenAPI schema 随实现生成）                                                                      |
| 工作量估算   | 后端 1.5 人日（含幂等 upsert 与单测）                                                                                                            |

## 1. 概述

### 1.1 功能定位

交付 IDEA 插件所依赖的**服务端同步契约**：插件在 IDEA 内本地调试接口后，一键把接口定义批量同步（upsert）到 RabbitAITest 项目。本仓为纯 TypeScript monorepo（技术栈约束），IntelliJ 平台插件为 JVM 产物**不在本仓实现**；本规格冻结其服务端 API 契约与鉴权口径，插件本体在外部仓库按本契约实现。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                              | P1 ✅ | 后续                                                 |
| ----------------------------------------------------------------- | ----- | ---------------------------------------------------- |
| `POST /api/v1/open/api-sync`：批量 upsert 接口定义（≤100 条/批）  | ✅    | —                                                    |
| 幂等键=(projectId, method, path)：存在即更新、不存在即新建        | ✅    | 软删除记录复活策略（新建，登记 §2）                  |
| `GET /api/v1/open/api-definitions`：分页回读（插件侧对账/回显）   | ✅    | 全量导出（登记）                                     |
| APIKEY 鉴权（Basic ak:sk / Bearer ak.sk）+ 10 QPS 限流 + 审计留痕 | ✅    | （INTG-003 既有能力复用，零新增）                    |
| 同步来源标记（name 前缀不变、version 自增、变更历史）             | ✅    | —                                                    |
| IDEA 插件本体（IntelliJ Platform 插件、本地调试转发）             | ❌    | 外部仓库交付（本规格 §4 契约 + §6 附录即其接口文档） |

### 1.3 前置依赖

INTG-003 open/exec 端点族与 withApiKey 守卫已交付；API-002 定义创建链路（num 分配/模块树/RequestBundle 结构）已稳定。

### 1.4 对标基线核对

| 基线行为（清单 §11）                | 本项目实现                                         | 口径                                         |
| ----------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| IDEA 插件本地一键同步 API（社区版） | 服务端批量 upsert 契约交付；插件本体外部仓库       | 简化实现（拆分：承接面在本仓、插件面在外仓） |
| 本地调试（插件内发起请求）          | 不在本仓（插件本体外置后其本地调试直接打目标服务） | 登记不做                                     |

## 2. 业务逻辑

- **upsert 语义**：批量内按 (projectId, method, path) 匹配**未软删**定义——命中→更新 name/description（并入 request.spec.headers/query/body 可选片段）+ version+1；未命中→新建（num=项目内递增、moduleId=payload 可选缺省项目根模块、protocol=HTTP、status=DEBUG、request=最小 RequestBundle）。同批重复 (method,path) → 第二条起拒绝整批（422·10023），保证批内幂等。
- **软删除记录**：命中集合只查未删记录；已软删的同名 (method,path) 视为不存在→新建（复活不覆盖，变更历史可溯）。
- **响应**：逐条 `{apiId, num, method, path, action: "created"|"updated"}` + 汇总 `{created, updated}`。
- **边界与异常**：批>100 → 422·10024；载荷非法（method 枚举外/path 空/超长）→ 422·10023（首批校验，全量拒绝不部分写入）；projectId 不可见 → 403（守卫既有）；限流 → 429（守卫既有）。

## 3. UI/UX 设计

无 UI（open API）。管理面复用个人中心-安全设置 APIKEY 页（SYS-005/INTG-003 既有）。

## 4. 技术架构

- **契约**（zod，packages/shared/src/tool/schemas.ts 新建）：
  - `openApiSyncSchema`：`{projectId: uuid, apis: array({name ≤512, method ∈ HTTP_METHODS, path ≤1024, description? ≤1000, request? {headers? Record<string,string> ≤50, query? 同, body? {kind, text ≤64KB}}}) length 1..100}`；
  - `openApiDefinitionQuerySchema`：`{projectId: uuid, page=1, pageSize=20 ≤100, keyword?}`；
  - 响应 `{items: [{apiId, num, name, protocol, method, path, updatedAt}], total}`（分页信封对齐 api-conventions）。
- **路由**：`apps/web/src/app/api/v1/open/api-sync/route.ts`（POST）、`api/v1/open/api-definitions/route.ts`（GET）——`withApiKey` 包装（会话优先协商+限流+审计 `open.api-sync`/`open.api-definitions`）。
- **服务**：`apps/web/src/server/domains/api/open-sync.service.ts`——事务内批处理；num 分配复用 API-002 既有分配器（同项目互斥，避免并发冲突）。
- **错误码**：`OPEN_SYNC_VALIDATION_FAILED: 10023`（422）、`OPEN_SYNC_LIMIT_EXCEEDED: 10024`（422）。
- **权限**：无权限点（APIKEY 即身份，数据范围=本人可见项目，与 open/exec 同口径）。
- **审计**：动作 `open.api-sync`，detail 含批次规模与 created/updated 计数。

## 5. 测试用例

| 编号        | 类型   | 前置               | 步骤                                              | 预期                                               |
| ----------- | ------ | ------------------ | ------------------------------------------------- | -------------------------------------------------- |
| TOOL-001-T1 | Vitest | 种子项目+APIKEY    | 同步 3 条→重放同批→再同步 1 改 1 增               | 首次 created=3；重放 updated=3/created=0；改增=1/1 |
| TOOL-001-T2 | Vitest | 同上               | 批内重复 (method,path) 101 条超限；软删除后重同步 | 422·10023 / 422·10024 / 新建复活                   |
| TOOL-001-T3 | jmx    | api-test 栈+APIKEY | Basic 与 Bearer 两种头同步各 1 次                 | 200 信封 code=0，items 断言                        |
| TOOL-001-T4 | jmx    | 无/错 APIKEY       | 同步调用                                          | 401·10001（缺头）/ 401（错密）                     |
| TOOL-001-T5 | jmx    | 有效 APIKEY        | 非法载荷（method=FOO）与超限批                    | 422·10023 / 422·10024                              |
| TOOL-001-T6 | jmx    | 有效 APIKEY        | GET api-definitions 分页 keyword                  | 200 分页信封（total/page/pageSize/items）四断言    |
| TOOL-001-T7 | e2e    | —                  | 豁免登记（无 UI 面；open API 以 jmx+单测覆盖）    | —                                                  |

四类场景：正常=T3/T6；权限(401)=T4；校验(422)=T5；分页=T6。

## 6. 竞品深度对标

MeterSphere IDEA 插件（社区版）以 pf4j 插件直连平台 API，接口未公开文档化；本项目**契约优先**——open API 全部走生成式 OpenAPI 快照（门禁 4），插件作者以快照为唯一事实源。差异化决策：① 插件本体出仓（技术栈红线：本仓纯 TS）；② 幂等键显式冻结为 (method,path)（MeterSphere 以编号/名称为主键同步，冲突语义未文档化）；③ 批量上限 100+全量拒绝（原子性优于部分成功，登记理由=对账简单）。

## 7. 里程碑与验收

DoD：两端点+幂等语义+T1-T6 全绿 + OpenAPI 快照含新路径（快照 diff 进 PR）。演示：curl 以 APIKEY 同步 3 条接口→web 端接口定义列表可见（sprint-overview 主线一环）。回归：INTG-003 open/exec 既有用例与 APIKEY 管理用例。

## 8. 勘误登记

1. **description 字段裁撤**：规格 §4 初稿的 api-sync 项含 `description` 可选字段——实现时确认 `ApiDefinition` 域模型无 description 列（API-002 冻结面），同步项契约收敛为 name/method/path/request（shared `openApiSyncItemSchema` 同步）；插件侧描述信息以变更历史 diff（`source: idea-sync`）承载。
2. **审计动作口径**：规格 §4 预写 `open.api-sync`/`open.api-definitions` 独立动作——实现复用 INTG-003 `withApiKey` 守卫（动作统一 `open.exec`，detail.path 区分端点），不新增审计动作枚举。
