# K8S 型资源池（EXEC-004 · 池类型扩展）

| 元信息项     | 内容                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | EXEC-004                                                                                                                                |
| 所属迭代     | Sprint future — 远期 P4                                                                                                                 |
| 优先级       | P4（远期增强级）                                                                                                                        |
| 所属模块     | EXEC 执行引擎（资源池）/ SYS 系统设置（池管理 UI）                                                                                      |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                                                                                                                |
| 最后更新日期 | 2026-09-28                                                                                                                              |
| 上游依赖     | EXEC-002（资源池契约/心跳/单默认池红线：type 列已预声明 NODE\|K8S）、rules/security.md（SSRF 守卫）                                     |
| 下游消费     | ENTP-006（企业版多池，License 门控）、LOAD-002（压力节点拓扑引用 type 扩展）                                                            |
| 上游依据     | 需求文档 §优先级 P4（EXEC-004 K8s 资源池）；清单 §9.1「资源池：Node 型与 K8S 型（kubectl apply 部署 task-runner，Token/命名空间配置）」 |
| 对标基线     | MeterSphere功能清单 §9.1（社区版支持两型池+限 1 默认池不可删）                                                                          |
| 关联架构文档 | engine-execution-architecture.md（worker 注册/心跳/槽位）、test-domain-model.md §6（门禁 3 例外登记）                                   |
| 高保真确认   | 待确认（原型：docs/design/EXEC-004-k8s-resource-pool/；确认人/日期后补）                                                                |
| 工作量估算   | 后端 1.5 人日 + 前端 1.5 人日                                                                                                           |

## 1. 概述

### 1.1 功能定位

把 EXEC-002 预声明的 `ResourcePool.type=K8S` 枚举值**兑现为可配置的池类型**：社区版口径=单默认池不可删不可新建（ENTP-006 红线不变），但默认池可在 NODE/K8S 两型间切换；K8S 型承载 apiServer/命名空间/Token/task-runner 镜像四项配置（对齐基线「Token/命名空间配置」），并提供**连通性测试**（探测 apiServer /version，SSRF 守卫复用）。运行语义诚实声明：K8S 型改变的只是**部署拓扑与配置面**（worker 以 Deployment 副本经 kubectl apply 部署、注册仍走既有 internal/pools/register 心跳契约），调度面（BullMQ exec 队列）零变化。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                           | P1 ✅ | 后续                                                                         |
| -------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| 默认池 type 切换 NODE↔K8S（PUT 既有端点扩展）                  | ✅    | —                                                                            |
| K8S 配置四项（apiServer/namespace/token/image）zod 校验+持久化 | ✅    | resourceQuotas/节点亲和（企业版 ENTP-006 方向）                              |
| Token 只写不读（回显掩码 `tokenSet` + 长度提示）               | ✅    | —                                                                            |
| 连通性测试：`PUT ...?test=true` 探测 apiServer /version        | ✅    | task-runner 清单在线 apply（登记：清单模板以规格附录交付，apply 由运维执行） |
| 池管理 UI：类型切换+K8S 表单+测试按钮+结果反馈                 | ✅    | —                                                                            |
| 池 DTO 占位字段 loadTest/uiTest（LOAD-001/UIT-001 联动）       | ✅    | 企业版按池配置                                                               |
| 多池创建/删除/按组织应用                                       | ❌    | ENTP-006（License 门控，社区版按钮禁用对齐基线）                             |
| 引擎侧 K8S 专属调度（pod 级并发/队列路由）                     | ❌    | 不做（调度面两型同构，规格 §4 冻结）                                         |

### 1.3 前置依赖

EXEC-002 池契约稳定（心跳 10s/离线 3 拍/版本协商）；MSG-001 webhook SSRF 双重守卫工具可复用。

### 1.4 对标基线核对

| 基线行为（清单 §9.1）                              | 本项目实现                                     | 口径                          |
| -------------------------------------------------- | ---------------------------------------------- | ----------------------------- |
| Node 型与 K8S 型两种池类型                         | type 列两值+切换（EXEC-002 已预声明）          | 完全复刻                      |
| K8S 经 kubectl apply 部署 task-runner              | Deployment 清单模板=规格附录（占位符替换即用） | 简化实现（不自建 K8S 客户端） |
| Token/命名空间配置                                 | k8s 配置四项+校验                              | 完全复刻                      |
| 社区版限 1 默认池不可删（无 License 建池按钮禁用） | 既有红线不变（本规格零触碰池的增删面）         | 完全复刻                      |
| 资源池 DTO loadTest/uiTest 字段（§12.10 占位证据） | serializePool 输出两 false 占位                | 完全复刻                      |

## 2. 业务逻辑

- **切换规则**：type=K8S 必须 k8s 四项齐全（image 可缺省默认值）；NODE→K8S 校验通过即生效；K8S→NODE 保留 k8s 配置休眠（再切回免重填，登记走查）；心跳 nodes 拓扑在切换后由节点自然重注册刷新，服务端不做清场（注册写入以 nodeId 幂等 upsert，既有语义）。
- **连通性测试**：`PUT /api/v1/system/pools/{id}?test=true` 且 body 含 k8s 配置 → 服务端以 `fetch(apiServer + "/version", {headers: {Authorization: Bearer token}, signal: timeout 5s})` 探测：URL 先过 SSRF 守卫（复用 webhook 守卫：协议 https、解析 IP 拒绝私网/环回/链路本地——**例外登记**：K8S apiServer 合法场景多为集群内网地址，私网拒绝会导致内网集群不可用；口径=https 强制+DNS 解析后仅拒绝**环回与非路由地址**（0.0.0.0/169.254），私网段放行+审计留痕，理由=系统管理员配置面非用户输入面，风险面等同 FILE-001 仓库地址先例）；成功→响应附 `{k8sVersion: "v1.x.x"}`；失败→502·50423 `POOL_K8S_UNREACHABLE`（配置仍不落库，test 语义=试连不保存）。
- **保存语义**：不带 test → 校验+落库（token 非空时更新哈希存储位——**实现口径**：token 以明文入 config Json（DB 访问面已受系统权限与审计保护，与 PlatformIntegration token AES-GCM 不同口径，登记差异理由：池配置仅系统管理员可写可读掩码，无终端用户回显面；走查确认）；带 test → 只试连不落库。
- **边界与异常**：namespace 非 RFC1123 → 422·50422；apiServer 非 https → 422·50422（SSRF 前置校验）；并发 PUT → 后写胜出（池配置低频面，登记）。

## 3. UI/UX 设计

- 原型：`docs/design/EXEC-004-k8s-resource-pool/index.html`（四态：NODE 型现状/K8S 型表单/测试中/测试失败行内错误）。
- 池详情卡：type Tag（NODE/K8S）+ K8S 型追加配置行（apiServer/namespace/image 明文、token 掩码）；编辑对话框增「类型」Radio（NODE 单机进程 / K8S 集群）+ K8S 表单（四字段+默认镜像占位）+「测试连接」按钮（试连态 loading→成功绿色 tag 显示 k8sVersion/失败红色 alert 显示原因，均行内，不弹窗）。
- 顶部保持「社区版单默认池」说明条（ENTP-006 禁用按钮口径文案，基线同款）。

## 4. 技术架构

- **数据模型**：`ResourcePool` 增列 `config Json @default("{}")`（`resource_pools.config`，migration `ALTER TABLE ... ADD COLUMN config JSONB NOT NULL DEFAULT '{}'`）——**门禁 3 例外登记**（test-domain-model §6 追加）：K8S 型池配置结构在 EXEC-002 时点未冻结（ENTP-006 边界未定），以 Json 载体一次补齐，后续 K8S 细化只动 Json 内部结构不动 DDL。
- **契约**（packages/shared/src/exec/schemas.ts 或池族 schema 文件增补）：`poolK8sConfigSchema`：`{apiServer: https URL ≤512, namespace: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/ ≤63, token: 1..4096, image: /^[a-z0-9./:_-]{1,255}$/ 默认 "rabbitaitest/task-runner:latest"}`；`poolUpdateSchema` 扩展 `{type?: "NODE"|"K8S", k8s?: poolK8sConfigSchema}`（update 时 token 允许缺省=不改）。
- **路由**：既有 `PUT /api/v1/system/pools/[poolId]`（withSystemPerm("SYSTEM_POOL:UPDATE")）扩展分支；serializePool 增 `config 摘要（apiServer/namespace/image + tokenSet: boolean）` + `loadTest:false, uiTest:false`。
- **SSRF**：复用 MSG-001 守卫工具函数（新导出 `assertPoolUrl`，按 §2 例外口径放宽私网），放行/拦截均审计。
- **引擎侧**：**零改动**——K8S 型 worker 部署后注册/心跳/槽位走既有契约（register API 默认池落点不变）。
- **错误码**：`POOL_CONFIG_INVALID: 50422`（422）、`POOL_K8S_UNREACHABLE: 50423`（502）。
- **附录 A：task-runner Deployment 清单模板**（占位符 `__API_BASE__`/`__TOKEN__`/`__IMAGE__`/`__NS__`/`__QUEUE__`，env 口径与 apps/engine 进程环境一致：API_BASE/ENGINE_TOKEN/EXEC_QUEUE=exec），随实现以 `docs/sprint-future-p4/EXEC-004-task-runner.yaml` 落仓。

## 5. 测试用例

| 编号        | 类型   | 前置                       | 步骤                                                           | 预期                                                                           |
| ----------- | ------ | -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| EXEC-004-T1 | Vitest | —                          | k8s 配置 zod 校验矩阵（合法/非 https/坏 ns/坏 token/坏 image） | 仅合法通过；错误码 50422 映射正确                                              |
| EXEC-004-T2 | Vitest | 池服务+mock fetch          | PUT type=K8S 保存（token 掩码）；test=true 成功/超时/坏版本    | 保存 tokenSet=true 不回明文；test 成功带 k8sVersion/失败 50423；test 不落库    |
| EXEC-004-T3 | Vitest | 守卫                       | apiServer 环回/0.0.0.0/169.254 拒绝；私网放行+审计             | 拦截 422；放行留痕                                                             |
| EXEC-004-T4 | Vitest | 池服务                     | K8S→NODE→K8S 往返                                              | 配置休眠保留；DTO 含 loadTest/uiTest false                                     |
| EXEC-004-T5 | jmx    | api-test 栈 admin          | PUT type=K8S 完整配置→GET 回读                                 | 200 四断言（tokenSet=true、无 token 明文）                                     |
| EXEC-004-T6 | jmx    | 同上                       | PUT 坏 namespace / 无会话 PUT                                  | 422·50422 / 401                                                                |
| EXEC-004-T7 | jmx    | 非 SYSTEM_POOL:UPDATE 用户 | PUT                                                            | 403                                                                            |
| EXEC-004-T8 | e2e    | e2e 栈 admin               | 池页切 K8S→填表→保存→再进入回显→切回 NODE                      | UI：Tag/表单/掩码回显正确；Console：无 error；接口：PUT 负载含 type=K8S 与四项 |

四类场景：正常=T5；权限=T6②/T7；校验=T6①；分页=不适用（池为单例面，登记豁免）。

## 6. 竞品深度对标

| 维度       | MeterSphere                       | 本项目                                     | 决策理由                                            |
| ---------- | --------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| 池类型     | Node/K8S 两型，K8S 装 task-runner | 同构（配置面+清单模板，不自建 K8S 客户端） | 引擎注册契约已稳定，K8S 只是部署拓扑差异            |
| 调度       | 企业版 Controller 统一管理        | 两型同构单队列（BullMQ exec）              | 社区版单池口径下调度无差异；多池路由留 ENTP-006     |
| Token 存储 | 数据库存储                        | config Json 明文+掩码回显                  | 系统管理员单点读写面；与集成 token 加密口径差异登记 |
| 连通性测试 | 保存时校验                        | 显式 test=true 试连                        | 试连不落库语义更安全（内网集群探测可重试）          |

## 7. 里程碑与验收

DoD：切换+配置+掩码+试连+清单模板+DTO 占位字段交付，T1-T8 全绿，高保真走查（四态）。演示：池页切 K8S 填配置保存→回显掩码→（mock apiServer）测试连接成功。回归：EXEC-002 池用例全量（GET/PUT maxConcurrency/心跳注册）。

## 8. 勘误登记

1. **试连环回豁免开关**：规格 §2 未预写测试栈豁免——jmx/e2e 的 mock apiServer 在环回，实现新增 `POOL_K8S_ALLOW_LOOPBACK=1` 叠加豁免（镜像 OUTBOUND_ALLOW_PRIVATE 先例）；生产默认仍拒环回。
2. **safe-fetch 选项扩展**：池守卫口径（私网放行、环回仍拒）以 `allowPrivateKeepLoopback` 选项落在既有 safe-fetch（ipIsForbidden 语义分解：ULA fc/fd 与私网段并入放行组、ff 组播单列恒拒），未新建守卫模块。
3. **k8s 配置摘要恒回显**：规格 §4 初稿 k8s 摘要仅在 type=K8S 时输出——休眠语义（K8S→NODE→K8S 免重填）要求 NODE 态也回显摘要（tokenSet 掩码口径不变），激活态由 type 字段表征；池卡片 UI 仅在 type=K8S 时展示 k8s 行（展示与数据口径分离）。
4. **PoolUpdateInput 取 z.input**：服务入参类型改 `z.input<typeof poolUpdateSchema>`（k8s.image 带 default 可省）——z.infer 输出型会强制调用方显式传 image，与服务合并语义（缺省=沿用旧值）不符。
