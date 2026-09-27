# 插件框架（plugin-runner 宿主 · 上传/启停/组织范围）

| 元信息项     | 内容                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLUG-001                                                                                                                              |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                                 |
| 优先级       | P2（迭代内）                                                                                                                          |
| 所属模块     | 系统设置（sys 域）+ 插件运行时（apps/plugin-runner）                                                                                  |
| 文档状态     | Approved                                                                                                                              |
| 最后更新日期 | 2026-09-27                                                                                                                            |
| 上游依赖     | plugin-architecture.md（S0 已冻结）；SYS-005（系统参数页先例）；PROJ-004（MinIO 文件存储链路）                                          |
| 下游消费     | PLUG-002（协议插件 SPI）、INTG-001/002（平台插件加载与执行）                                                                           |
| 上游依据     | 需求文档 §二「插件管理」；功能清单 §9.1 插件管理、§十一 插件生态                                                                       |
| 对标基线     | 功能清单 §9.1：插件上传（5 类）+ 数据库驱动上传 + 启停；§十一：pf4j 三套 SPI → 本项目 TS 插件包 + plugin-runner（架构已定不兼容 pf4j） |
| 关联架构文档 | plugin-architecture.md（隔离模型/SPI 形态/安全）；tech-stack.md（plugin-runner worker_threads）                                        |
| 高保真确认   | 待确认（原型 docs/design/PLUG-001-plugin-framework/）                                                                                 |
| 工作量估算   | 后端 5 人日 / 前端 2 人日 / runner 4 人日                                                                                             |

## 1. 概述

### 1.1 功能定位

插件体系的地基：插件包（tarball）上传 → MinIO 存储 → Plugin 表登记 → plugin-runner 宿主进程加载（worker_threads 每插件一线程隔离，崩溃自动重启）→ 管理页启停/组织范围控制。本规格交付**框架与生命周期管理**，协议插件 SPI 语义在 PLUG-002、平台插件业务在 INTG-001/002。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                     | P1 ✅ | 后续                                                       |
| ---------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------- |
| 插件包上传：tarball（含 package.json `rabbitPlugin` 清单：name/kind/version/spiVersion/entry） | ✅     | 官方市场公钥签名校验（Backlog：无分发渠道先例，权限已控）   |
| 清单校验：kind ∈ protocol/platform/driver；spiVersion 兼容检查（不兼容拒绝登记）          | ✅     | —                                                          |
| 同名同 kind 插件重复上传=新版本登记（version 变更），启用版本切换                          | ✅     | 多版本并存与回滚（Backlog，当前登记最新版）                 |
| 启用/停用：停用=runner 卸载线程，配置数据保留；启用=热加载（不重启主服务）                 | ✅     | —                                                          |
| 组织范围：ALL 或指定组织列表；范围外组织不可见该插件能力                                   | ✅     | 按项目范围（登记）                                          |
| 删除：仅停用状态可删（MinIO 对象与表记录同删）                                             | ✅     | —                                                          |
| plugin-runner 宿主进程：独立 Node 进程，HTTP(127.0.0.1) 命令面，worker_threads 隔离加载    | ✅     | CPU/内存限额（cgroup 级，登记简化：超时熔断先行）           |
| 插件线程崩溃自动重启（指数退避，3 次失败标记 Plugin 状态 error）                           | ✅     | 崩溃告警通知（S5 MSG-001 后）                               |
| 内置示例插件 platform-echo（testConnection 恒通/createIssue 返回确定性 mock 引用）         | ✅     | —                                                          |
| 管理页：列表（名称/kind/版本/SPI 版本/组织范围/状态/更新时间）+ 上传/启停/删除             | ✅     | 插件详情（调用统计）                                        |

### 1.3 前置依赖

Plugin 模型已建（S0）；MinIO 客户端封装已有（PROJ-004）；`apps/plugin-runner` 骨架（S0 目录+tsconfig）。

### 1.4 对标基线核对

复刻：管理页上传/启停/数据库驱动入口形态、组织范围语义（对齐基线「使用组织范围」）。替换实现：pf4j 三套 Java SPI → 单一 TS SPI 分接口（SamplerPlugin/PlatformPlugin/DriverPlugin，定义于 packages/shared，plugin-architecture §3）；插件市场下载 → tarball 上传（应用市场=仓库 release 附件，S6 不建市场页）。简化：签名校验不做（登记）；CPU/内存硬限额不做（超时熔断+崩溃重启先行，登记）。

## 2. 业务逻辑

- **上传流水线**：`POST /system/plugins`（multipart tarball）→ 解包校验（清单必填字段/kind 合法/spiVersion 在宿主支持矩阵内）→ 同名同 kind 存在则要求 version 递增（否则 409）→ MinIO 上传（key=`plugins/{pluginId}/{version}.tgz`）→ Plugin upsert（新版本覆盖 storageKey，version 更新）→ 若 enabled 则通知 runner reload。
- **runner 命令面**（HTTP JSON-RPC over 127.0.0.1，仅绑定 loopback）：`load {pluginId, storageKey}` / `unload {pluginId}` / `call {pluginId, method, args}` / `health` / `list`。web → runner 的调用经 `plugin-runner.client.ts`（web 侧瘦客户端，超时 30s 默认）。
- **worker_threads 隔离**：每插件一个 worker（入口=解包后 entry 文件，TS 包经 tsx 运行，不引入额外 vm 沙箱层）；信任边界=上传权限 SYSTEM_PLUGIN:UPDATE；worker exit 非正常码 → 重启（1s/4s/16s 退避），3 次连续失败 → 通知 web 标记 `status=error`（Plugin.error 字段运行态，不落库——状态列 runtime 查询拼装）。
- **组织范围求值**：INTG 配置/协议启用读取插件时，按 `orgScope` 过滤：`ALL` 或含当前 orgId，否则视为插件不存在（404 语义）。
- **生命周期与启停**：enabled=false → runner unload；配置数据（PlatformIntegration 等）不动。删除前置校验：enabled=false 且无 PlatformSyncConfig 引用该 platform（jira/zentao/tapd 平台插件删依赖校验，70007）。

## 3. UI/UX 设计（高保真 docs/design/PLUG-001-plugin-framework/）

- 系统设置左侧「插件管理」页 `/system/plugins`：工具条（上传插件按钮+kind 筛选+名称搜索）+ 表格（名称/kind 徽标（协议·平台·驱动）/版本/SPI 版本/组织范围（全部组织 或 N 个组织 tooltip 列表）/状态（启用/停用/异常 tag）/更新时间/操作：启用·停用·删除）。
- 上传 Modal：文件选择（.tgz）→ 清单解析预览（名称/kind/版本/SPI 版本/入口）→ 组织范围选择（全部组织/指定组织穿梭框）→ 提交。
- 异常态：状态 error 行展开显示崩溃原因摘要 + 重试按钮。
- 空态：引导「上传第一个插件包（支持协议/平台/驱动三类）」。

## 4. 技术架构

- **数据模型**：Plugin 表已建（name/kind/version/storageKey/orgScope/enabled/description），无新增列（门禁 3 通过：S0 建齐）。
- **plugin-runner**（`apps/plugin-runner`）：`src/index.ts` 起 Hono HTTP（端口 env `PLUGIN_RUNNER_PORT` 默认 5100，绑定 127.0.0.1）；`src/host.ts` worker_threads 池管理（加载/卸载/调用路由/重启策略）；`src/worker-bootstrap.ts` worker 入口（消息协议：{id, method, args} → {id, ok, result|error}）。内置插件目录 `builtins/`（platform-echo 随进程直接注册，不经上传）。
- **SPI**（packages/shared/src/plugins/spi.ts）：`RABBIT_PLUGIN_SPI_VERSION="1.0"`；`PlatformPlugin`/`SamplerPlugin`/`DriverPlugin` 接口 + `PluginManifest` zod schema（PLUG-002 扩 Sampler 语义，本规格先落 manifest 与 Platform）。
- **web 侧**：`plugin.service.ts`（上传校验/CRUD/orgScope 求值/删除依赖校验）+ `plugin-runner.client.ts`（HTTP 调用封装+health 缓存 5s）+ 路由 `system/plugins`（POST upload/GET list/`[pluginId]` PUT enable-disable-scope/DELETE）。runner 生命周期：`instrumentation.ts` 检测 `PLUGIN_RUNNER_URL` 未配置时以 child_process 拉起本仓 runner（开发态一体启动；生产可独立部署——与 S2 mock 服务同模式）。
- **权限点**：`SYSTEM_PLUGIN:READ`、`SYSTEM_PLUGIN:UPDATE`（新增；系统管理员组授予）。
- **错误码**（70xxx 段首用）：`PLUGIN_NOT_FOUND 70001`、`PLUGIN_PACKAGE_INVALID 70002`、`PLUGIN_SPI_INCOMPATIBLE 70003`、`PLUGIN_RUNNER_UNAVAILABLE 70004`、`PLUGIN_VERSION_CONFLICT 70005`、`PLUGIN_DELETE_FORBIDDEN 70006`（启用中或被引用）。
- **安全**：上传限 SYSTEM_PLUGIN:UPDATE；tarball 解包大小上限 32MB（系统参数可调）；runner 仅 loopback；插件调用目标域名记审计（SYS-008 关联动作 `plugin.call`）。
- **与架构文档偏差登记（勘误 1）**：plugin-architecture §2 「RPC(gRPC)」 → 实现为 **HTTP+JSON（127.0.0.1）**。理由：技术栈纯 TS 无 proto 工具链先例；隔离边界（独立进程+worker_threads）不受传输层影响；本地回环无暴露面。登记于架构文档勘误区。

## 5. 测试用例

- PLUG-001-T1（jmx 四类）：插件上传（合法 tarball→登记）/列表信封；401/403（非系统管理员）/404（不存在插件启停）；清单缺字段 422 70002、SPI 不兼容 422 70003、同名同版本 409 70005；启用中删除 409 70006。
- PLUG-001-T2（spec 生命周期）：上传 platform-echo 类插件（用内置 echo）→ 启用 → INTG 测试连接走 runner 真调用（mock jira 时 runner 路径打通）→ 停用 → 连接报 70004/70001 → 删除成功（UI+接口断言）。
- PLUG-001-T3（spec 组织范围）：orgScope=指定组织 B → 组织 A 项目引用插件能力 404 语义 → 改 ALL 后可用。
- 单测：manifest 校验矩阵（合法/缺字段/kind 非法/spiVersion 三态）、版本递增规则、worker 重启退避序列（模拟 exit）、orgScope 求值（ALL/含/不含）。

## 6. 竞品深度对标

基线 §9.1/§十一。差异：①pf4j jar 生态 → TS tarball（架构既定「明确不兼容」）；②5 类插件细分类目（DevOps/API 导入/请求/项目管理/协议）→ 三类（protocol/platform/driver），API 导入类不插件化（Swagger 导入为内置能力，API-011）；③签名校验与资源硬限额延后（登记）；④多版本回滚延后（登记，当前登记最新版）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：runner 拉起握手（web instrumentation ↔ runner health）、MinIO 对象生命周期与 Plugin 记录一致性（上传成功但 MinIO 失败回滚）。

## 8. 勘误登记

- 勘误 1（2026-09-27，规格评审时即登记）：架构文档 plugin-architecture.md §2 的 gRPC 传输层实现偏差 → HTTP+JSON loopback（见 §4 偏差登记），架构文档同步更新。
- 勘误 2（2026-09-27，实现时登记）：runner 进程模型——架构原文「独立 Node 进程」→ dev/e2e 默认 **web 进程内嵌启动**（独立 loopback 端口 :4010 + worker_threads 插件隔离不变）。理由：dev 栈进程编排简化（S2 mock 同模式先例）、避免开发态双进程管理；生产独立部署口径保留（配置 `PLUGIN_RUNNER_URL` 指向外部进程即切换）。隔离边界不受影响（插件仍在 worker_threads，三方网络故障不阻塞 web 事件循环——经 HTTP 命令面异步调用）。
