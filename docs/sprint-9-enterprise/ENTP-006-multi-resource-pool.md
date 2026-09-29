# 多资源池（池 CRUD · 按池队列路由 · 执行选池）

| 字段         | 内容                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-006                                                                                                                                                                                        |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                           |
| 优先级       | P3（迭代内 P1）                                                                                                                                                                                 |
| 所属模块     | system 域（池管理）+ exec 域（队列路由）+ engine（POOL_ID 绑定）；依赖链 `EXEC-002 ──→ ENTP-006`（plan 拆解 §五）                                                                               |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                    |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                      |
| 上游依赖     | ENTP-007（MULTI_POOL 门控）、EXEC-002（单默认池调度/心跳/并发热调）、API-008/PLAN-003（执行入口 poolId 通道已预留）、SYS-006（任务中心）                                                        |
| 下游消费     | 后续 K8S 池部署链、池间重调度（Backlog）；perf 基线（默认池口径不变）                                                                                                                           |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 资源池、§十二 12.6 多资源池/Controller、12.11「社区版限 1 默认池」                                                                                               |
| 对标基线     | 功能清单 12.6：企业版独立执行节点、资源池 CRUD（名称/类型 Node·K8S/应用组织全部或指定）、切换（执行时指定）、启用/禁用/删除；社区版单默认池不可删、创建按钮无 License 禁用；§十：编辑最大并发数 |
| 关联架构文档 | engine-execution-architecture.md（队列/心跳契约）；test-domain-model.md §2/§6（ResourcePool 建齐+orgScope 例外登记）；rbac-permission-model.md §6（ENTP_POOL 预登记）                           |
| 高保真确认   | 待确认（原型 docs/design/ENTP-006-multi-resource-pool/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                                            |
| 工作量估算   | 后端 2.5 人日 / 前端 1 人日 / 联调 1.5 人日（含 engine 验证）                                                                                                                                   |

## 1. 概述

### 1.1 功能定位

把 EXEC-002 的「单默认池」升级为多池：系统管理员按需建池（Node/K8S 类型、最大并发、应用组织），engine 进程以 `POOL_ID` 环境变量绑定到具体池并只消费该池队列（`exec-pool-{poolId}`（勘误 1：BullMQ 禁冒号）），执行入口（场景/计划）在弹窗中选池；默认池保持既有 `exec` 队列与全部现行为——**单引擎部署零感知、零回归**。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                          | P1 ✅ | 后续                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------- |
| 池 CRUD：POST 新建（name/type NODE\|K8S/maxConcurrency 2-64/orgScope ALL\|orgId[]）；PATCH 编辑与启停（ACTIVE↔DISABLED）；DELETE                              | ✅    | K8S 型 kubectl 部署链/Token/命名空间（本迭代仅类型枚举+展示）后续迭代 |
| 默认池保护：不可删（409）、不可禁用（422）；新建池 isDefault 恒 false                                                                                         | ✅    | 默认池迁移/更换 Backlog                                               |
| 按池队列路由：`execQueueNameFor(poolId)`——非默认池任务入 `exec-pool-{poolId}`（勘误 1：BullMQ 禁冒号），默认池任务仍入 `exec`（向后兼容）；5 个执行入口全接线 | ✅    | 池间任务漂移/重调度/故障转移 Backlog                                  |
| engine 池绑定：env `POOL_ID`（缺省=默认池）→ Worker 消费对应队列 + 心跳携带 poolId + 按池返回 maxConcurrency（热调保留）                                      | ✅    | 单 engine 进程多池消费 Backlog                                        |
| 心跳按池注册：`POST /internal/pools/register` 以 body.poolId 定位池（缺省回落默认池——旧引擎兼容），DISABLED 池心跳拒绝（90032/HTTP 502）                      | ✅    | 节点手动批量添加表单（IP:Port）Backlog（节点仍经心跳自动注册）        |
| 执行选池：场景执行/计划执行弹窗「资源池」下拉（ACTIVE 池+默认标记+按组织过滤 orgScope）；选 DISABLED/不存在池 422                                             | ✅    | 项目应用设置默认池（PROJECT 应用配置）Backlog                         |
| 社区版门控：POST/PATCH/DELETE 经 MULTI_POOL 特性；新建按钮社区版 disabled（现状保留）                                                                         | ✅    | —                                                                     |

### 1.3 前置依赖

- `resource_pools` 表 S0 建齐（type/isDefault/maxConcurrency/nodes）——仅新增 `orgScope` 列（门禁 3 例外登记：应用组织语义依赖本规格定型，S0 无 ENTP-006 输入，与 S5 file_items 同类）
- ExecTask.poolId 通道已预留（API-008 scenarioExecuteSchema.poolId / PLAN-003 execConfig.poolId / open API resourcePoolId）——本规格接通调度侧
- 心跳契约：heartbeatSchema 加 `poolId?`（向后兼容旧引擎）

### 1.4 对标基线核对

完全复刻：多池 CRUD✓ 应用组织（全部/指定）✓ 执行时切换池✓ 启用/禁用/删除✓ 社区版单默认池不可删+创建按钮 License 禁用✓ 编辑最大并发（EXEC-002 已有，保留）✓ 节点并发热调（心跳下发，保留）✓。简化实现：Controller 不做独立服务（基线「资源池 Controller」为独立部署组件——本项目由 web 内置调度+engine 绑定替代，架构决策见 §6）；K8S 型仅类型位；节点批量添加表单不做（心跳自动注册）。超出基线，自主设计：按池队列隔离方案（基线未公开实现细节；本项目以 BullMQ 队列名前缀实现池间隔离）。

## 2. 业务逻辑

- **建池**：`POST /system/pools`（门控）→ name 唯一（409 90035）、type 枚举、orgScope zod（"ALL" 或 uuid 数组）、status ACTIVE、isDefault false。新池 nodes 空——等待 engine 绑定心跳后出现节点。
- **启停**：PATCH status DISABLED → 执行入口选池列表过滤 + 心跳拒绝（已绑引擎停止接收新并发值，保持最后一次配置）；恢复 ACTIVE 即回到选池列表。默认池禁用 422 90031。
- **删除**：仅无历史任务的池可物理删（有 ExecTask 引用→软删=DISABLED+标记 DELETED？——**简化：有任务引用的池拒绝删除 409 90036**，任务历史保完整性）；默认池 409 90030。
- **队列路由**：`execQueueNameFor(poolId)`：`poolId && poolId !== DEFAULT_POOL_ID ? `exec:${poolId}` : "exec"`；exec.service 五处 enqueue（debug/api_case/adhoc/scenario/plan）统一改造；任务入队前校验池存在且 ACTIVE（否则 422 90032（池不存在沿用 50404））。
- **engine 绑定**：启动读 `POOL_ID`（缺省 config.defaultPoolId）→ 队列名同函数计算 → 心跳 body 带 poolId；register 路由按 poolId 查池返回 `{poolId, maxConcurrency, contractVersion}`——engine 侧按响应热调并发（既有机制不动）。
- **orgScope 语义**：执行入口选池下拉按任务所属项目→组织过滤（ALL 或含 orgId）；API 侧同样校验（跨组织池 422 90037）。
- **ready/metrics 口径不变**：默认池心跳（S8 契约，perf/ready 不回归）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-006-multi-resource-pool/）

- 画板一（池管理页扩展）：既有卡片列表升级——每池卡片（名称/类型 tag NODE·K8S/默认徽标/应用组织（全部或 N 个组织）/状态 启用·禁用/最大并发/节点列表 ONLINE·OFFLINE·版本不匹配）；「新建资源池」按钮社区版 disabled+锁（现状）→ 企业版可点；新建/编辑弹窗（名称+类型单选+最大并发 2-64+应用组织 多选含「全部」）；禁用/启用/删除操作（默认池删除禁用置灰）。
- 画板二（执行选池）：场景执行弹窗新增「资源池」下拉（默认池标「默认」徽标；DISABLED 池不可选；按当前项目组织过滤）；计划执行弹窗同构。
- 空态/二态：社区版（新建 disabled——现状回归）；企业版无第二池（仅默认池+引导文案）；新池无节点（「等待执行引擎绑定（POOL_ID）」提示+绑定命令文案可复制）。

## 4. 技术架构

- 数据模型：`resource_pools` 增 `orgScope Json @default("\"ALL\"") @map("org_scope")`（门禁 3 例外登记 test-domain-model §6；与 Plugin.orgScope 同型）；迁移一次。
- 契约（packages/shared/src/entp/schemas.ts）：`poolCreateSchema`/`poolUpdateSchema`/`poolItemSchema`（serializePool 扩展 type/orgScope）；`heartbeatSchema` 加 `poolId uuid 可选`；`execQueueNameFor` 落 shared（web+engine 同源，防漂移）。
- 端点：
  - `POST /api/v1/system/pools`（ENTP_POOL:CREATE，门控）
  - `PATCH /api/v1/system/pools/{poolId}`（ENTP_POOL:UPDATE，门控；扩展 name/orgScope/status；maxConcurrency 既有）
  - `DELETE /api/v1/system/pools/{poolId}`（ENTP_POOL:DELETE，门控）
  - `GET /api/v1/system/pools`（既有 SYSTEM_POOL:READ 扩展返回 orgScope/type）
  - `POST /api/v1/internal/pools/register`（内部：按 body.poolId 定位）
- 服务/engine 改造：pool.service.ts（CRUD+保护规则+orgScope 序列化）；exec.service.ts 五处 enqueue 接 `execQueueNameFor`+池校验；plan-exec.service.ts 同；engine worker.ts（POOL_ID env→队列名+心跳 poolId）；register route（poolId 定位+DISABLED 拒绝）。
- 错误码：`POOL_DEFAULT_UNDELETABLE 90030`（409）、`POOL_DEFAULT_UNDISABLEABLE 90031`（422）、`POOL_DISABLED 90032`（422 执行侧）、`POOL_NOT_FOUND 沿用 50404`（EXEC-002 既有，404）、`POOL_NAME_EXISTS 90035`（409）、`POOL_HAS_TASKS 90036`（409）、`POOL_ORG_NOT_ALLOWED 90037`（422）。90001/90005 门控。
- 权限点：`ENTP_POOL:CREATE|UPDATE|DELETE`（SYSTEM_ADMIN；rbac §6 预登记 CREATE|UPDATE 兑现+补 DELETE）。
- 前端：pools/page.tsx 扩展（表单/操作/绑定提示）；场景执行与计划执行弹窗加池下拉（`select-exec-pool`）；api-client s9。
- 部署文档：deploy/ 登记「多池=多 engine 进程，`POOL_ID=<池id> pnpm --filter engine start`」。

## 5. 测试用例

- ENTP-006-T1（jmx 四类）：池 CRUD 主链（建→列含 orgScope→改并发/启停→删）；401/403（无点/无 License 90001）；422（name 空/并发越界 2-64/orgScope 坏形态）；列表分页信封（单页全量）。
- ENTP-006-T2（spec 多池执行主链路）：建池「企业池」→ spec 内 spawn engine2（env POOL_ID）→ 池卡片节点 ONLINE → 场景执行选「企业池」→ 任务 SUCCESS+报告池=企业池 → engine2 停止后该池任务仍入队但 PENDING（不阻塞默认池任务并行成功）（UI+Console+接口）。
- ENTP-006-T3（spec 二态）：社区版新建 disabled+403；默认池删/禁 409/422；DISABLED 池不出现在执行下拉且直接 API 选池 422 90032。
- ENTP-006-T4（jmx 保护规则）：默认池 DELETE→90030；有任务池 DELETE→90036；跨组织 orgScope 选池→90037。
- 单测（shared `__tests__/s9-pool-queue.test.ts` + engine `__tests__/pool-route.test.ts` + web pool service 测试）：execQueueNameFor 矩阵（default/uuid/null）；心跳 poolId 定位与缺省回落；CRUD 保护规则；orgScope 过滤。

## 6. 竞品深度对标

基线 12.6/§十核对：多池 CRUD✓ 切换执行✓ 启停/删除✓ 应用组织✓ 默认池保护✓ License 门控按钮✓ 并发编辑/热调✓。差异：①Controller 独立服务→web 内置调度（微服务拆分对单机部署无增益，架构决策）；②K8S 型仅类型位（部署链后续迭代登记）；③节点批量添加→心跳自动注册（既有机制复用）；④队列隔离=按池队列名（基线实现细节未公开，自主设计）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：pools 三新端点+heartbeat poolId+execQueueNameFor。联调点：engine2 绑定场景（T2 为本迭代最重联调）。验收=§5 全绿+概览主线「资源池」段+EXEC-002 既有用例零回归。

## 8. 勘误登记

无。
