# 协议插件 SPI（SamplerPlugin · engine 进程内加载）

| 元信息项     | 内容                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLUG-002                                                                                                                                |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                                   |
| 优先级       | P2（迭代内）                                                                                                                            |
| 所属模块     | 执行引擎（apps/engine）+ 接口测试（api_test 域）                                                                                        |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿、CI 六作业全绿；高保真走查随验收） |
| 最后更新日期 | 2026-09-27                                                                                                                              |
| 上游依赖     | PLUG-001（插件框架/上传链路）、EXEC-001/002（采样器管线）、API-002（接口定义 protocol 字段）                                              |
| 下游消费     | P4 协议扩展（WebSocket/MQTT/gRPC 等，企业版对标但本项目按 P4 节奏）；PROJ-003 数据源插件化（driver SPI 同模式复用）                       |
| 上游依据     | 需求文档 §六「接口调试：HTTP 起步（协议插件扩展）」；功能清单 §6.2 多协议切换、§十一 协议插件                                            |
| 对标基线     | 功能清单 §6.2：「内置 HTTP，其余协议经系统插件上传后启用」；§十一 协议插件（基线多为企业版，本项目协议本体全列 P4）                        |
| 关联架构文档 | plugin-architecture.md §1/§3（SamplerPlugin SPI、engine 进程内加载不经过 runner）；engine-execution-architecture.md                       |
| 高保真确认   | 以「接口契约评审」替代（纯后端/引擎类规格，适用门禁 2 豁免条款；SPI+帧契约见 §4，评审通过=本规格 Approved）                              |
| 工作量估算   | 引擎 3 人日 / shared 契约 1 人日                                                                                                        |

## 1. 概述

### 1.1 功能定位

把「采样能力」从 HTTP 单协议升级为可扩展：定义 `SamplerPlugin` SPI，协议插件包上传后由 **engine 进程内加载**（采样是热路径，不跨进程 RPC——plugin-architecture §2 既定），注册进采样器工厂；接口定义 `protocol` 字段联动（非 http 协议时请求编辑器渲染该协议的配置表单）。S6 交付 SPI 框架 + 1 个示例协议插件（tcp 连通性采样），协议本体扩展（WebSocket 等）按规划 P4。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                  | P1 ✅ | 后续                                                  |
| -------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| SamplerPlugin SPI 冻结：`protocol` 标识 / `configSchema`（zod→JSON Schema）/ `buildSampler(config)` 返回标准采样器接口 | ✅     | —                                                     |
| engine 侧协议注册表：启动加载内置 http；运行时接受 web 通知（插件启用/停用）热更新        | ✅     | 引擎主动轮询 MinIO 版本（登记：当前推送驱动）         |
| 协议插件加载路径：MinIO 拉取 tarball → 本地缓存目录解包 → dynamic import（engine 进程内） | ✅     | —                                                     |
| 采样结果标准化：任意协议采样器输出统一 `SamplerResult`（响应体/耗时/成功标志/原始日志）  | ✅     | —                                                     |
| 示例协议插件 `tcp-conn`：配置 host/port/timeout，connect 采样返回连通性+握手延迟          | ✅     | TCP 全语义（发包/断言）登记 P4                        |
| ApiDefinition.protocol 扩展：`http`（S2 既有）+ 动态协议列表（运行时插件并集）；非 http 的执行走插件采样器 | ✅     | —                                                     |
| 请求编辑器联动：protocol 下拉=内置+已启用协议插件；选中后按 configSchema 渲染动态表单     | ✅     | 协议级断言器（当前沿用 HTTP 断言子集）                 |

### 1.3 前置依赖

PLUG-001 上传/启停/orgScope 链路；engine v0.3 采样管线（S3）；ApiDefinition.protocol 列已建（S0）。

### 1.4 对标基线核对

复刻形态：协议经插件上传启用、定义页多协议切换。差异：①基线协议插件多标企业版，本项目 SPI 框架在标准版、协议本体 P4（plan §九 P4 行既定）；②S6 示例仅 tcp-conn（连通性），非全语义 TCP（登记）；③断言体系沿用 HTTP 六类子集（bodyContains/status/耗时对任意协议可判，header 类 http 专属）。

## 2. 业务逻辑

- **注册表**：engine 维护 `Map<protocol, SamplerFactory>`；启动注册 `http`（内置）；收到 web 的插件事件（BullMQ `plugin.events` 流或轮询 `GET internal/plugins/protocol`——取后者，实现最简：engine worker 空闲时每 30s 拉一次启用的协议插件清单+版本，变更才拉包）→ 注册/注销。
- **加载与隔离**：协议插件在 **engine 主进程内** dynamic import（不隔离线程——架构既定：热路径不跨进程；信任边界同 PLUG-001 上传权限）；加载失败记 engine 结构化日志，注册表不变更。
- **执行路径**：ExecItem 引用的 api.protocol ≠ http → factory.buildSampler(config) → run() → `SamplerResult` → 断言求值（六类中适用子集）→ 帧照常（step-result.responseSummary 适配：status=映射码、bodyText=结果摘要）。
- **定义联动**：`GET /projects/{pid}/apis/protocols` 返回 `[{protocol, configSchema, source: builtin|pluginId}]`（orgScope 过滤后）；前端 protocol 下拉数据源；config 存 ApiDefinition.request 的 protocolConfig 字段（JSON，schema 由插件声明）。
- **失败语义**：协议插件未启用/已停用 → 执行 CONFIG_ERROR（契约 v3 既有错误类别）；configSchema 校验失败 → CONFIG_ERROR 带 zod 首错。

## 3. UI/UX 设计

非独立页面（契约评审替代高保真）；涉及 UI 的联动点：①接口定义编辑器 protocol 下拉动态项（选中后动态表单）；②执行报告响应区按协议展示原始日志文本。这两处在 API-002 编辑器与 RPT-002 报告组件上扩展，走查时随 API-011 批次一并核。

## 4. 技术架构

- **SPI**（packages/shared/src/plugins/spi.ts 扩展）：

```ts
export interface SamplerPlugin {
  protocol: string; // "tcp" / "websocket" / ...
  configSchema: ZodType<Record<string, unknown>>; // 定义协议配置结构
  buildSampler(config: unknown): {
    run(): Promise<SamplerResult>;
  };
}
export interface SamplerResult {
  ok: boolean; code: number; // 协议映射码（tcp: 0=连通 1=超时 2=拒绝）
  bodyText: string; // 响应/日志摘要（≤4KB）
  responseTimeMs: number; headers?: Record<string, string>;
}
```

- **engine**：`kernel/samplers/registry.ts`（注册表+30s 轮询同步）、`kernel/samplers/plugin-loader.ts`（MinIO 拉取→缓存目录 `~/.rabbit/plugins/`→import→缓存校验和避免重复加载）、runStep 分支 protocol≠http。
- **web**：`internal/plugins/protocols` 端点（engine 消费，internal 鉴权）；`projects/[pid]/apis/protocols`（前端消费）。
- **示例插件**：仓库 `plugins/tcp-conn/`（tarball 打包脚本 scripts/build-plugin.mjs；清单+index.ts ~100 行）。
- **错误码**：`PROTOCOL_NOT_SUPPORTED 40510`（执行时协议不可用）、`PROTOCOL_PLUGIN_LOAD_FAILED 40511`（定义侧保存时联动校验）。
- **契约版本**：SamplerResult 进 shared 执行契约（additive，EXEC_CONTRACT_VERSION 3→4 仅新增字段不破坏——经评审维持 v3，帧 schema 向后兼容追加可选协议字段）。

## 5. 测试用例

- PLUG-002-T1（jmx）：protocols 端点（内置+插件并集/信封）；401/403/404；protocol 非法 422。
- PLUG-002-T2（spec 端到端）：上传 tcp-conn 插件并启用 → 建定义 protocol=tcp（host/port 表单回显）→ 执行（mock TCP 目标=本机 redis 端口连通 + 封禁端口超时两态）→ 报告 responseSummary 断言（UI+接口）。
- PLUG-002-T3（spec 停用联动）：停用插件 → protocols 列表不含 tcp → 存量定义执行 CONFIG_ERROR 40510。
- 单测：configSchema 校验矩阵、注册表同步幂等（版本不变不重载）、SamplerResult→responseSummary 映射、断言子集适用性（headers 断言对无 headers 协议=跳过不判失败）。

## 6. 竞品深度对标

基线 §6.2 多协议=插件上传启用，形态复刻。差异：①协议本体 P4（基线即时可用 WebSocket/MQTT 等，多为企业版）；②engine 进程内加载不隔离（基线 pf4j 同进程，风险口径一致）；③协议断言器沿用通用子集（基线协议专属断言登记 P4）。

## 7. 里程碑与验收

DoD 前置：接口契约评审（§4 SPI）人工确认——以规格 Approved+评审记录替代高保真（门禁 2 纯后端条款）。联调点：web→engine 协议清单同步时延（≤35s 最终一致）；MinIO 缓存目录并发加载去重。

## 8. 勘误登记

（暂无）
