# WebSocket/MQTT 协议插件（PLUG-003 · 多协议扩展）

| 元信息项     | 内容                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLUG-003                                                                                                                                  |
| 所属迭代     | Sprint future — 远期 P4                                                                                                                   |
| 优先级       | P4（远期增强级；本迭代唯一完整交付的协议域能力）                                                                                          |
| 所属模块     | PLUG 插件体系（协议插件）/ API 接口测试（协议选择器）/ EXEC 引擎（采样器，零改动消费）                                                    |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                                                             |
| 最后更新日期 | 2026-09-28                                                                                                                                |
| 上游依赖     | PLUG-001（插件上传/启用管线）、PLUG-002（协议插件 SPI：SamplerPlugin/configSchema/buildSampler/SamplerResult）、api-conventions（错误码） |
| 下游消费     | API-002（接口定义协议字段消费方）、API-005（mock ws echo 端点）、后续协议插件（TCP/SSH 等，按本规格模式复制）                             |
| 上游依据     | 需求文档 §优先级 P4「WebSocket/MQTT 等协议插件」；清单 §6.2「内置 HTTP，其余协议经系统插件上传后启用」                                    |
| 对标基线     | MeterSphere功能清单 §11（协议插件 WebSocket、MQTT…定价页列为企业版独有，社区版列为「−」）                                                 |
| 关联架构文档 | plugin-architecture.md（SPI 冻结面）、engine-execution-architecture.md（协议插件热加载 §）                                                |
| 高保真确认   | 待确认（原型：docs/design/PLUG-003-websocket-mqtt/；确认人/日期后补）                                                                     |
| 工作量估算   | 插件 3 人日（mqtt 自研客户端最重）+ UI 1.5 人日 + 校验/测试 2 人日                                                                        |

## 1. 概述

### 1.1 功能定位

在 S6 冻结的协议插件 SPI 上交付**两个内置协议插件包**（websocket/mqtt），打通「上传→启用→定义选协议→调试/执行→报告」全链路；同时补齐 PLUG-002 预留未消费的两处缺口：① 定义保存时协议可用性校验（错误码 40511 已声明未抛出）② 请求编辑器协议选择器（S6 仅交付了 API 面与引擎热加载，UI 无协议入口）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                              | P1 ✅ | 后续                                                     |
| --------------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| `websocket` 协议插件（连接→发送→收首条消息→关闭，undici WebSocket）               | ✅    | 长连接会话复用/多消息往返（登记：SPI 单 run 语义内不做） |
| `mqtt` 协议插件（CONNECT→SUBSCRIBE→PUBLISH→收投递→DISCONNECT，QoS0）              | ✅    | QoS1/2、TLS(mqtts)、保留消息/遗嘱（登记）                |
| mqtt 最小客户端自研（MQTT 3.1.1 固定头/变长剩余长度/UTF-8 主题编解码）            | ✅    | —                                                        |
| 请求编辑器协议选择器（http/https 内置 + 已启用协议插件下拉 + 协议配置 JSON 编辑） | ✅    | 协议配置表单化（按插件 configSchema 动态渲染，登记后续） |
| 定义/用例保存时协议可用性校验（未启用插件 → 40511）                               | ✅    | —                                                        |
| mock 服务 `/ws/echo` WebSocket 回显端点（测试确定性目标）                         | ✅    | mock 侧 MQTT broker 不提供（登记：单测内嵌 mini broker） |
| Thrift/gRPC/TCP/SSH 等其余协议                                                    | ❌    | 后续迭代（tcp-conn 既有示例已在）                        |
| 插件市场/签名校验                                                                 | ❌    | 企业版方向                                               |

### 1.3 前置依赖

PLUG-001 上传管线（tar 白名单 {package.json, index.js}、32MB 上限、版本递增检查）；PLUG-002 引擎热加载（30s 轮询 internal/plugins/protocols）；requestSpecSchema 已有 `protocol`/`protocolConfig` 字段（S2 建齐，本规格零 schema 变更）。

### 1.4 对标基线核对

| 基线行为（清单 §11/§6.2）                         | 本项目实现                                                | 口径                    |
| ------------------------------------------------- | --------------------------------------------------------- | ----------------------- |
| WebSocket/MQTT 协议插件=企业版独有（社区版「−」） | 标准版随内置示例插件源码交付，上传启用后可用              | 差异化决策（见 §6）     |
| 内置 HTTP，其余协议经系统插件上传后启用           | 同构：websocket/mqtt 以插件包形态上传启用（非硬编码内置） | 完全复刻                |
| pf4j 三套 SPI                                     | 本项目单一 SamplerPlugin SPI（S6 冻结）                   | 简化实现（S6 已定口径） |

## 2. 业务逻辑

### 2.1 websocket 插件（单 run 语义）

`run()` 一次调用=完整探活：建立连接（握手超时→504 语义）→ 发送 `sendText`（或 sendBinaryBase64 解码后二进制帧，二选一，都缺省不发）→ 等待**首条**服务端消息（文本帧取 text，二进制帧转 UTF-8 lossy；超时→504）→ 主动 close(1000) → 返回 SamplerResult。ok 判定=连接+收包均成功；bodyText=收到的首条消息（≤4KB 截断，SPI 约束）；responseTimeMs=连接建立到首包的完整墙钟。

### 2.2 mqtt 插件（单 run 语义）

`run()`：net.connect → 发 CONNECT（clientId 默认 `rabbit-{ts}-{rand}`，可带 username/password，clean session）→ 等 CONNACK（returnCode≠0 → 502）→ SUBSCRIBE（topic, QoS0）等 SUBACK → （若配 `publish` 则 PUBLISH 到 `publishTopic ?? topic`）→ 等待订阅主题上的**首条** PUBLISH（超时→504）→ DISCONNECT → 返回。ok 判定=CONNACK+SUBACK+收到投递；bodyText=投递 payload（UTF-8）。

### 2.3 边界与异常

| 场景                               | websocket                                                                | mqtt                  |
| ---------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| 连接失败/握手失败                  | ok=false code=502                                                        | ok=false code=502     |
| 等待消息超时（默认 5s，可配 ≤10s） | ok=false code=504                                                        | ok=false code=504     |
| 服务端异常关闭/CONNACK 拒绝        | ok=false code=502                                                        | ok=false code=502     |
| url 非 ws/wss、host 非法           | configSchema 422（插件侧 safeParse 失败 → 引擎 CONFIG_ERROR 40510 链路） | 同左                  |
| 二进制消息                         | lossy UTF-8 展示 + headers 标记 binary                                   | payload 按 UTF-8 展示 |

### 2.4 保存校验规则

接口定义/接口用例保存（POST/PUT）时：`request.protocol ∉ {http, https}` → 校验 `plugins` 表存在 `kind="protocol" AND name=protocol AND enabled=true` → 不满足抛 40511 `PROTOCOL_PLUGIN_LOAD_FAILED`（HTTP 422）。场景步骤经引用 api 用例间接覆盖（引用校验既有链路复跑本规则）。调试执行不落库，直接由引擎走 40510（PLUG-002 既有语义，不重复校验）。

## 3. UI/UX 设计

- 原型：`docs/design/PLUG-003-websocket-mqtt/index.html`（覆盖：协议选择器态（内置/插件协议分组下拉）、协议配置编辑态（JSON 文本域+格式化按钮+校验错误行）、未启用协议禁用态、保存 422 toast 态）。
- 交互：RequestEditor 方法选择器左侧新增「协议」选择器——`HTTP`/`HTTPS`（内置分组）+ 已启用协议插件（插件分组，来自 `GET /api/v1/system/plugins?kind=protocol` 前端滤 enabled）。选非 http 协议时：URL/参数/请求体等 HTTP 面折叠隐藏，展示「协议配置」JSON 编辑区（protocolConfig）；执行按钮链路不变。
- 空态与权限态：无已启用协议插件时下拉仅内置两项；无 SYSTEM_PLUGIN:READ 权限用户下拉仅内置（不请求插件列表，登记走查）。

## 4. 技术架构

- **插件包**（`plugins/websocket/index.ts`、`plugins/mqtt/index.ts`）：
  - manifest（build-plugins.mjs 生成 package.json）：`{name:"websocket"|"mqtt", kind:"protocol", spiVersion:"1.0", entry:"index.js"}`——**name 必须等于 protocol 标识**（PLUG-002 勘误：tcp-conn name≠protocol 导致请求须写 `tcp-conn`；新插件规避该坑，双端一致用 name）。
  - websocket 实现：`require("undici").WebSocket`（引擎既有依赖 ^7.3.0，Node 20 CI 可用；不用全局 WebSocket——Node 22 才稳定）。**零新增 npm 依赖**（供应链红线）。
  - mqtt 实现：自研最小 MQTT 3.1.1 客户端（node:net + 手工编解码：固定头/变长剩余长度（最大 4 字节）/UTF-8 编码字符串/CONNECT-CONNACK-SUBSCRIBE-SUBACK-PUBLISH(QoS0)-DISCONNECT-PINGREQ），~300 行。**零新增依赖**。
  - 依赖解析说明：插件运行时经引擎 `import(dir/entry)` 动态加载，`undici` 由引擎 node_modules 解析（插件 tar 白名单不含 node_modules，PLUG-001 既有约束不变）。
- **Web 侧**：
  - `api-definition.service` / `api-case.service` 保存路径注入协议校验（新私有函数 `assertProtocolAvailable(protocol)`，查 plugins 表）。
  - RequestEditor 协议选择器 + protocolConfig JSON 编辑（textarea + JSON.parse 校验态展示，失败行内错误，不阻塞输入）。
- **Mock 侧**：`apps/mock/src/index.ts` serve() 返回的 http server 挂 `upgrade` 监听，路径 `/ws/echo` 手工 RFC6455 回显（accept key=SHA1(magic)、解析 masked 客户端帧、回 text 帧）；非 /ws/echo 升级请求 destroy。~120 行，仅测试目标用。
- **引擎侧**：**零改动**（registry 热加载 + step.ts 派发为 PLUG-002 既有链路；40510/40511 语义不变）。
- **错误码**：40511（首次真实消费，S6 已声明）；无新增码。
- **权限**：复用 SYSTEM_PLUGIN:READ（插件管理）与 PROJECT_API:CREATE/UPDATE（定义保存）。

## 5. 测试用例

| 编号         | 类型   | 前置                            | 步骤                                                                    | 预期                                                                                      |
| ------------ | ------ | ------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| PLUG-003-T1  | Vitest | 本地 ws echo 服务器（测试内嵌） | websocket 插件 run：发 text 收回显；超时；连接拒绝                      | 回显 bodyText=text、ok=true；超时 504；拒绝 502                                           |
| PLUG-003-T2  | Vitest | 本地 mini broker（测试内嵌）    | mqtt 插件 run：订阅→发布→收投递；CONNACK 拒；超时                       | 投递 bodyText 匹配、ok=true；拒绝 502；超时 504                                           |
| PLUG-003-T3  | Vitest | mqtt 编解码器                   | 剩余长度 varint 编解码往返（0/127/128/16383/2097152）                   | 全部往返一致                                                                              |
| PLUG-003-T4  | Vitest | 插件源 + manifest 约束          | 断言 name=protocol 标识、spiVersion=1.0、configSchema safeParse 行为    | 契约成立（防 tcp-conn 类 name/protocol 漂移）                                             |
| PLUG-003-T5  | Vitest | 保存服务                        | 定义保存 protocol=websocket 未启用 / 已启用                             | 未启用→422 code=40511；已启用→200                                                         |
| PLUG-003-T6  | jmx    | api-test 栈 + 插件 tar          | 上传 websocket 插件→启用→保存 ws 定义→（启用后）再保存                  | 上传 201/启用 200/未启用保存 422·40511/启用后保存 200                                     |
| PLUG-003-T7  | jmx    | 同上                            | mqtt 插件同链路（上传/启用/保存 mqtt 定义/重复上传版本）                | 四断言齐全（含 409 版本不递增分支）                                                       |
| PLUG-003-T8  | jmx    | admin 会话                      | GET system/plugins?kind=protocol                                        | code=0 且含 websocket/mqtt 条目（分页信封字段断言）                                       |
| PLUG-003-T9  | e2e    | e2e 栈（含 mock ws echo）       | 插件页上传+启用 ws → 调试页选 websocket 协议→配置 url=mock ws echo→执行 | UI：结果显示 ok 响应回显；Console：无 error；接口：保存/执行请求负载含 protocol=websocket |
| PLUG-003-T10 | e2e    | e2e 栈                          | 调试页协议下拉切换 http↔websocket                                       | HTTP 面显隐切换正确；未启用 mqtt 时保存 422 toast 展示                                    |

四类场景映射（jmx）：正常=T6/T8；权限=插件上传无 SYSTEM_PLUGIN:CREATE 403（T6 前置步骤断言）；校验=T6 未启用 422；分页=T8 信封。执行链路引擎侧断言由 T1/T2 单测承担（jmx 不起真 ws/mqtt 服务，登记豁免：栈内无 broker，执行正确性以单测为准）。

## 6. 竞品深度对标

| 维度     | MeterSphere                     | 本项目                                            | 决策理由                                                                                         |
| -------- | ------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 版本归属 | WebSocket/MQTT 插件=企业版独有  | 标准版交付插件源码+上传启用                       | 需求文档 P4 行明确将协议插件列入本项目远期范围；开源版提供扩展能力，与基线企业版口径差异显式登记 |
| 传输依赖 | 插件自带协议栈（pf4j+netty 等） | websocket=undici（引擎既有）；mqtt=自研最小客户端 | 零新增 npm 依赖（供应链红线）；mqtt 客户端边界=QoS0 收发探活                                     |
| 配置形态 | 协议表单（各插件自定义 UI）     | JSON 编辑区（v1）                                 | 表单化需按 configSchema 动态渲染，登记后续；JSON 面先保证链路完整                                |
| 加载机制 | pf4j 上传即注册                 | 同构（S6 SPI+30s 热加载）                         | 已冻结架构                                                                                       |

## 7. 里程碑与验收

- DoD：两插件+选择器+校验+mock ws echo 交付，T1-T10 全绿，高保真走查（选择器四态）。
- 演示：上传启用 websocket 插件 → 调试页选协议 → 对 mock `/ws/echo` 执行 → 报告查看（sprint-overview 主线一环）。
- 回归：PLUG-001/002 既有插件用例（tcp-conn/平台插件）全量回归；HTTP 调试链路回归（协议选择器默认 http 不改变既有交互）。

## 8. 勘误登记

1. **非 http 协议的 url 占位**：requestSpecSchema 要求 `url` min(1)（HTTP 面约束），而引擎插件路径不消费 url——前端切换协议时以 `{protocol}://config` 占位保存（协议配置在 protocolConfig 单一来源），URL 输入框在非 http 协议下隐藏。
2. **引擎注册表轮询窗口**：插件启用后引擎最长 30s 才装载（registry 轮询既有契约），启用后立刻执行可能 40510——e2e 以整流程重试容错（最多 5 次 × 10s），不改动轮询周期（热路径既有纪律）。
3. **协议选择器数据源改为会话级端点**：规格 §3/§4 初稿复用管理端点 `GET /system/plugins?kind=protocol`——其 SYSTEM_PLUGIN:READ 权限使普通项目成员看不到协议选项（协议插件供全体测试人员使用的产品语义冲突）；新增会话级只读端点 `GET /api/v1/plugins/protocols`（仅回 enabled 协议名/版本，非敏感），管理端点口径不变。
4. **S6 潜伏缺陷三处（本规格 e2e 首次覆盖引擎执行链路时暴露，均为修复而非规格变更）**：①引擎协议同步 `webBaseUrl` 恒回退 :3000（未回退 WEB_URL——e2e/jm 栈 web 在 :3100/:3101，注册表恒空）②同步请求发 `Authorization: Bearer` 而 internal 面只认 `x-internal-token`（恒 401）③`step.ts` 在协议分派**之前**执行 `resolveUrl`（插件协议的占位 url 被当相对路径以「未选环境」误拒）——三处修复后引擎装载与执行链路首次真实打通。
5. **CJS bundle 加载器双层解包**：websocket 插件因内联 undici（含 `require("node:assert")`）必须 format=cjs 打包，而 CJS 经 `import()` 后 `mod.default`=module.exports 命名空间（非工厂函数）——plugin-runner 与 engine 两侧加载器统一双层解包（function → .default → .createPlugin），插件源同时导出具名 `createPlugin`。
