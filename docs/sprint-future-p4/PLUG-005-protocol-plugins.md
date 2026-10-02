# SSH/Redis/MongoDB/gRPC/AMQP 协议插件（PLUG-005 · 多协议扩展第二批）

| 元信息项     | 内容                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLUG-005                                                                                                                                                               |
| 所属迭代     | Sprint future — 远期 P4                                                                                                                                                |
| 优先级       | P4（远期增强级；MeterSphere 企业版协议插件对标清偿的第二批）                                                                                                           |
| 所属模块     | PLUG 插件体系（协议插件）/ API 接口测试（协议选择器）/ EXEC 引擎（采样器，零改动消费）                                                                                 |
| 文档状态     | Implemented（2026-09-30 交付：单测 105 家族全绿 + jmx/e2e 随 CI；configSchema 契约评审替代高保真——门禁 2 纯后端/引擎类条款）                                           |
| 最后更新日期 | 2026-09-30                                                                                                                                                             |
| 上游依赖     | PLUG-001（上传/启停管线）、PLUG-002（SamplerPlugin SPI）、PLUG-003（单 run 探活语义/协议选择器数据驱动/40511）、PLUG-004（CJS 打包/类型/来源铁律/冒烟方法先例）        |
| 下游消费     | API-002（协议字段消费方）、后续协议插件（按本规格模式复制）                                                                                                            |
| 上游依据     | 需求文档 P4「其余协议经系统插件上传后启用」；MeterSphere 商店协议扩展六条（TCP/SSH/Redis/MongoDB/gRPC/AMQP **全部企业版闭源**——TCP 已有 tcp-conn，本规格清偿其余五家） |
| 对标基线     | 清单 §11 协议插件；apps.fit2cloud.com/metersphere 协议扩展类目（2026-09-30 核实：6 插件全企业版、GitHub 组织无源码仓库）                                               |
| 关联架构文档 | plugin-architecture.md（SPI 冻结面）、engine-execution-architecture.md（协议插件热加载）                                                                               |
| 高保真确认   | 豁免（纯后端/引擎类：五家 configSchema JSON 契约评审替代——门禁 2 条款；UI 零改动，协议选择器/JSON 编辑区为 PLUG-003 交付物）                                           |
| 工作量估算   | 插件 5×1 人日 + 内嵌测试目标 2 人日 + jmx/e2e 2 人日                                                                                                                   |

## 0. 目标授权与关键决策（2026-09-30）

1. **五个插件一个规格一批交付**（不分批——五家骨架同构，day0 spike 已消掉最大不确定性）。
2. **AMQP 给 e2e 栈加 RabbitMQ service container**（CI 变更：e2e job 加一个 rabbitmq:3-alpine service；拿到 AMQP 真连覆盖，不豁免）。决策点已按此执行，无用户追问。
3. **凭据约束**：源码/示例/测试零可用凭据字面量——五家配置的 username/password/privateKey 一律由测试人员在 protocolConfig 录入（产品功能语义）；测试用例仅用不可达地址、测试内自生成密钥（RSA 2048 临时生成）与栈内 service 容器默认凭据（rabbitmq/rabbitmq = 容器初始凭据，与本仓 embedded PG postgres/postgres 同口径）。
4. **来源铁律延续 PLUG-004 §0**：五家依赖一律 npm 官方生态标准包（ioredis/mongodb 官方/amqplib/ssh2（Microsoft VS Code Remote 同款）/grpc-js+proto-loader（Google 官方）），pnpm-lock 锁定，禁止飞致云商店包。
5. **day0 spike 结论（实测，消勘误于编码前）**：
   - 五个依赖 esbuild CJS bundle 全部可打包，体积 0.27MB（amqplib）~1.58MB（mongodb），远低于 32MB 上限。
   - **ssh2 的可选原生依赖 cpu-features 会阻断 esbuild**（require .node 文件）——构建表统一 `alias: { "cpu-features": <空桩> }`（纯 JS 回退实现为 ssh2 内建行为，性能影响可忽略）。
   - ssh2 同进程 Server/Client 往返、gRPC 同进程 echo server 往返均已验证（protobufjs 经 proto-loader `loadSync(临时文件)` 加载——0.8 版无 fromString API）。
   - mongodb 驱动的 optional require（kerberos/aws-sdk/snappy）为 try-catch 形态，bundle 后缺失自动跳过，无阻断。

## 1. 概述

### 1.1 功能定位

在 S6 冻结的 `SamplerPlugin` SPI 上交付**五个协议插件包**（ssh/redis/mongodb/grpc/amqp），打通「上传→启用→协议选择→执行→报告」全链路；web 与引擎**零改动**（PLUG-003 交付的协议选择器为数据驱动——enabled 插件自动出现在下拉、protocolConfig JSON 编辑与 40511 保存校验链路全部复用）。本规格纯增量：`plugins/*` 五个新目录 + protocol-kit 共享层 + 构建表/依赖/测试。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                           | P1 ✅ | 后续                                                           |
| ------------------------------------------------------------------------------ | ----- | -------------------------------------------------------------- |
| `ssh` 插件（connect→exec 单命令→收 stdout/stderr→close）                       | ✅    | 交互式会话/多命令/SFTP（登记：单 run 语义内不做）              |
| `redis` 插件（connect→单命令→quit；危险命令黑名单）                            | ✅    | 集群/sentinel/EVAL 脚本（登记）                                |
| `mongodb` 插件（connect→ping/count/find(只读,limit≤100)→close）                | ✅    | 写操作/聚合管线（登记）                                        |
| `grpc` 插件（proto 动态加载→unary 调用→响应）                                  | ✅    | 流式四类（client/server/bidi streaming）、TLS 凭据上传（登记） |
| `amqp` 插件（connect→临时队列→publish→consume 首条自收→ack→close）             | ✅    | 交换机拓扑断言/批量消费（登记）                                |
| protocol-kit 共享层（raceTimeout/truncateBody/parseHostPort/friendlyNetError） | ✅    | —                                                              |
| cpu-features 空桩（esbuild alias，ssh2 纯 JS 回退）                            | ✅    | —                                                              |
| 协议配置表单化（按 configSchema 动态渲染）                                     | ❌    | 后续迭代（PLUG-003 已登记，JSON 编辑区 v1 不变）               |
| 协议断言/提取器（响应匹配）                                                    | ❌    | 后续迭代（SamplerResult 扩展前不做）                           |

### 1.3 前置依赖

PLUG-001 上传管线（tar 白名单/版本递增/启停/runner 热加载）；PLUG-002 引擎注册表 30s 轮询 internal/plugins/protocols；PLUG-003 协议选择器（数据驱动）/protocolConfig JSON 编辑/40511 保存校验——**本规格零 UI 改动**；requestSpecSchema `protocol`/`protocolConfig` 字段既有。

### 1.4 对标基线核对

| 基线行为（商店协议扩展六条）               | 本项目实现                                                    | 口径                    |
| ------------------------------------------ | ------------------------------------------------------------- | ----------------------- |
| SSH/Redis/MongoDB/gRPC/AMQP 全部企业版闭源 | 标准版随插件源码交付（官方 npm 生态驱动，CJS 内联 tarball）   | 差异化决策（见 §6）     |
| 插件表单（各插件自定义 UI）                | JSON 编辑区（configSchema 校验+注释提示）                     | 简化实现（登记）        |
| AMQP=「基于 RabbitMQ 实现 AMQP 协议」      | amqplib 客户端（RabbitMQ 兼容），e2e 加 rabbitmq service 真连 | 完全复刻                |
| 下载渠道=应用商店 jar                      | 仓库 release 附件 tgz（来源=npm 官方 registry+lockfile）      | 渠道自建（PLUG-003 同） |

## 2. 业务逻辑

### 2.1 共性骨架（五家统一）

- **单 run 语义**：连接 → 单动作 → 收结果 → 关闭（无会话复用/无流式——PLUG-003 勘误口径延续，登记后续）。
- **SamplerResult code 五档**（跨协议统一映射；协议侧细化见各节）：
  - `0` 成功；`1` 超时（connect/ready/操作等待——引擎映射 504）；`2` 连接失败（ECONNREFUSED/ENOTFOUND/网络——映射 502）；`3` 认证失败（username/password/凭据被拒）；`4` 操作失败（命令非零/协议错误/查询异常）。
  - `ok = code === 0`；`bodyText` ≤4KB（protocol-kit truncateBody 截断，含原始长度标记）。
- **protocol-kit**（`packages/shared/src/plugins/protocol-kit.ts`，插件构建期内联、单测直接消费）：
  - `raceTimeout(promise, ms, label)`；`truncateBody(text, max=4096)`；`parseHostPort(host, port, defaultPort)`（host:port 拆分+端口合法性）；`friendlyNetError(err, target)`（ECONNREFUSED/ETIMEDOUT/ENOTFOUND/ECONNRESET/认证类 → 中文可读文案，不含凭据）。
- **configSchema**：各插件自带 zod schema（safeParse 供 40511 保存校验与引擎 40510 链路消费）；host 校验=主机名/IP 合法、端口 1-65535；timeoutMs 默认 10s、上限 30s。

### 2.2 ssh 插件

- **单 run**：`connect({host, port(默认22), username, authType, password|privateKey, readyTimeout})` → `exec(command)`（单命令 ≤2KB）→ 收 stdout+stderr（按 arrival 序合并）→ exit code → end。
- **configSchema**：`{host, port?: int=22, username, authType: "password"|"privateKey", password?, privateKey?（authType 对应字段必填）, command: string≤2048 必填, timeoutMs?: int=10000 ≤30000}`
- **code 细化**：exit≠0 → `4`（ok=false，bodyText=`exit ${code}\n` + stdout/stderr 摘要）；认证失败（ssh2 auth 事件）→ `3`；握手超时 → `1`。
- **安全边界（诚实登记）**：SSH 命令无法词法白名单（与 SQL/Redis 不同——shell 语义过宽，假防护比无防护更糟）——命令属测试人员工具语义，凭据不落库（protocolConfig 随请求体，存取口径与环境数据源 URL 同）；入审计日志（目标 host:port+命令摘要，不含凭据）。
- **测试目标**：**内嵌 ssh2 Server**（单测进程内起 RSA 2048 临时生成 host key 的 echo 服务——回显 `echo:<command>` / exit 非零命令 / 认证拒绝三分支），完全自包含零外部依赖（day0 已验证）。

### 2.3 redis 插件

- **单 run**：`new Redis({host, port, password?, db?})` → `call(command, ...args)`（单命令）→ 收回复 → `quit()`。
- **configSchema**：`{url?: "redis://[:password@]host:port[/db]"（与 host/port 二选一）, host?, port?, password?, db?: int 0-15, command: string 必填, args?: string[] ≤32, timeoutMs?}`
- **危险命令黑名单（首 token 词法拒绝 → code 4，bodyText 带提示）**：`FLUSHALL|FLUSHDB|CONFIG|SHUTDOWN|DEBUG|MONITOR|SLAVEOF|REPLICAOF|FAILOVER|SCRIPT|EVAL|EVALSHA`（EVAL/SCRIPT=沙箱外 Lua，拒绝；KEYS 放行——常用且影响面可控，登记）。
- **天然无注入面**：RESP 协议按参数二进制分帧——args 值不拼进命令文本（与 SQL 的绑定参数同构，登记安全口径）。
- **测试目标**：**内嵌 mini RESP server**（node:net 手工编解码，mqtt mini broker 先例——支持 PING/ECHO/GET/SET/FLUSHALL 五命令+错误回复，可断言黑名单拦截不触达 server）+ e2e 栈真实 redis（6381）真连 PING。

### 2.4 mongodb 插件

- **单 run**：`MongoClient.connect(uri, {serverSelectionTimeoutMS: timeoutMs})` → 按 operation 执行 → `close()`。operation 三态：`ping`（默认，`{ ping: 1 }`）/ `count`（`estimatedDocumentCount()`）/ `find`（`find(filter).limit(min(limit,100))`，**只读**）。
- **configSchema**：`{uri: "mongodb://[user:pass@]host:port[/db]"（必填；db 缺失时 operation≠ping 拒绝）, operation: "ping"|"count"|"find"（默认 ping）, collection?: string（count/find 必填）, filter?: Record<string,unknown>（JSON 对象 ≤2KB，find 用）, limit?: int ≤100 默认 10, timeoutMs?}`
- **bodyText**：ping → `pong`；count → 数字；find → 文档数组 JSON 摘要（≤4KB 截断）。
- **安全边界**：仅读三操作（无写面）；filter 为 BSON 结构化文档（JSON.parse 后对象传入驱动——无文本拼接面）；`$where` 键拒绝（server-side JS——code 4 词法拦截）。
- **测试目标**：CI 无 mongod——**诚实豁免真连**（mongodb-memory-server 需 70MB 二进制下载，供应链/耗时不可接受）；单测覆盖契约/五档错误映射（serverSelectionTimeoutMS 快速失败）/$where 拒绝/uri 缺 db 分支。

### 2.5 grpc 插件

- **单 run**：proto 文本（或 base64）→ 写入临时文件（proto-loader `loadSync`，0.8 版无 fromString——day0 实证）→ `loadPackageDefinition` → new Client(`host:port`, credentials（insecure 或 TLS CA）)→ 调用 `service.method(requestMessage)`（**仅 unary**，流式登记）→ 收响应 → client.close()。
- **configSchema**：`{host, port?: int=443(tls)|80(plain), protoContent?: string ≤64KB | protoBase64?: string ≤128KB（二选一必填）, service: string 必填, method: string 必填, requestMessage?: Record<string,unknown> 默认 {}, metadata?: Record<string,string> ≤16, tls?: bool 默认 false, timeoutMs?}`；service/method 必须在解析后的 proto 内存在（否则 code 4，bodyText 列出可用服务）。
- **code 细化**：gRPC status 映射——DEADLINE_EXCEEDED→1、UNAVAILABLE→2、UNAUTHENTICATED/PERMISSION_DENIED→3、其余非 OK→4、OK→0。
- **bodyText**：响应消息 JSON（proto-loader defaults 形态，≤4KB）。
- **测试目标**：**内嵌 gRPC echo server**（同进程 grpc-js server + 测试 proto——day0 已验证 Say 往返），unary 成功/status 错误/超时三态全覆盖。

### 2.6 amqp 插件

- **单 run**（MQTT 先例的往返语义）：`connect(amqp://user:pass@host:port[/vhost])` → channel → assert 临时排他队列（server 命名）→ `sendToQueue(queue, Buffer.from(message))` → `get(queue)`（首条自收，timeoutMs 内）→ ack → close。ok=连通+往返成功。
- **configSchema**：`{url: "amqp://[user:pass@]host:port[/vhost]"（必填）, routingKey?: string（默认临时队列名=自发自收语义）, exchange?: string（默认 "" direct default）, message: string ≤4096 必填, timeoutMs?: int=10000}`
- **code 细化**：往返成功 → 0；超时 → 1；连接失败 → 2；认证/vhost 失败（403 类）→ 3；协议错误（channel close）→ 4。
- **测试目标**：**e2e job 加 rabbitmq:3-alpine service**（CI 变更；amqp://rabbitmq:rabbitmq@127.0.0.1:5672——容器初始凭据与本仓 embedded PG 同口径）真连往返；单测契约/错误映射/超时（无 broker 不可内嵌——RabbitMQ 无嵌入式形态，诚实登记）。

## 3. UI/UX 设计

**零改动**（协议选择器/protocolConfig JSON 编辑区/40511 保存校验/40510 执行链路全部为 PLUG-003 交付物，数据驱动自动生效）。按门禁 2 纯后端/引擎类条款，以五家 **configSchema JSON 契约评审替代高保真原型**——契约即 §2 各节 zod 定义，e2e 覆盖「下拉出现五项」（数据驱动零改动验证）。

## 4. 技术架构

- **插件包**（`plugins/{ssh,redis,mongodb,grpc,amqp}/index.ts`）：name=protocol 标识（PLUG-002 勘误口径）；**全部 format=cjs**（目标依赖全 CJS——PLUG-004 勘误 1 同 pathology）；构建表加 `alias: { "cpu-features": "scripts/cpu-features-stub.js" }`（空桩——ssh2 内建纯 JS 回退；day0 spike 实证）。
- **根 devDependencies 新增**（版本=实测锁定）：`ssh2 ^1.17.0`（MIT）、`ioredis ^5.8.2`（MIT）、`mongodb ^6.20.0`（Apache-2.0）、`@grpc/grpc-js ^1.14.1` + `@grpc/proto-loader ^0.8.0`（Apache-2.0）、`amqplib ^0.10.9`（MIT）。
- **type-only 导入相对路径**（`../../packages/shared/src/plugins/spi`——PLUG-004 教训：插件源被引擎 typecheck 覆盖，不可 import "@rabbit/shared"）。
- **web/引擎**：零改动（协议注册表 30s 轮询/40510/40511 链路既有）。
- **CI 变更（唯一一处）**：`.github/workflows/ci.yml` e2e job 加 `rabbitmq:3-alpine` service（5672 映射；health check `rabbitmqctl status`）+ global-setup 透传 AMQP_URL（随槽位推导失败则默认 5672，CI=0 槽位一致）。
- **错误码**：无新增（40510/40511 复用；SamplerResult code 档位为插件内部语义）。

## 5. 测试用例

| 编号         | 类型   | 前置                             | 步骤                                                                      | 预期                                                                  |
| ------------ | ------ | -------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PLUG-005-T1  | Vitest | 内嵌 ssh2 Server（临时 RSA key） | ssh 插件 run：echo 命令回显；exit≠0 命令；认证拒绝；连接拒绝              | 回显 ok code=0；exit≠0→4；认证拒绝→3；拒绝→2                          |
| PLUG-005-T2  | Vitest | 内嵌 mini RESP server            | redis 插件 run：PING/GET 成功；FLUSHALL 黑名单拦截（不触达 server）；超时 | 成功 code=0；黑名单→4 且 server 未收到；超时→1                        |
| PLUG-005-T3  | Vitest | mongodb 契约/错误映射            | uri 缺 db+count；$where 拦截；契约 safeParse；不可达连接映射              | 各分支 code/错误语义正确                                              |
| PLUG-005-T4  | Vitest | 内嵌 gRPC echo server            | grpc 插件 run：unary Say 往返；服务端错误 status；超时；service 不存在    | 往返 code=0 bodyText 含响应；错误→4；超时→1；不存在→4 含可用列表      |
| PLUG-005-T5  | Vitest | amqp 契约/错误映射               | url 非法/缺 message safeParse；不可达连接映射                             | 契约失败/连接失败→2                                                   |
| PLUG-005-T6  | Vitest | 五插件契约                       | name=protocol 标识 + configSchema.safeParse 合法/非法样本                 | 全部通过（防 tcp-conn 漂移）                                          |
| PLUG-005-T7  | jmx    | api-test 栈 + plugins/dist tar   | 五插件循环：上传 201 → 重复 409·70005 → 启用 → 列表 kind=protocol 含五项  | 四断言（201/409/200/code=0/耗时）                                     |
| PLUG-005-T8  | jmx    | 同上                             | 未启用 grpc 定义保存 422·40511；已启用 redis 定义保存 201；401/403        | 四断言（40511/201/401/403）                                           |
| PLUG-005-T9  | e2e    | e2e 栈（rabbitmq service）       | 调试页协议下拉含五项 → 选 redis → config PING → 对 e2e redis 执行         | UI：成功回显 PONG；Console：无 error；接口：执行负载含 protocol=redis |
| PLUG-005-T10 | e2e    | 同上                             | 选 amqp → 对 rabbitmq service 执行 publish/consume 往返                   | UI：成功回显消息体；Console；接口：负载含 protocol=amqp               |

四类场景映射（jmx）：正常=T7/T8（201 保存）；权限=T8 401/403；校验=T8 40511；分页=T7 信封。mongodb 真连豁免登记（CI 无 mongod）；ssh/redis/grpc 以单测内嵌目标覆盖执行正确性（jmx 不起真服务，PLUG-003 先例）。

## 6. 竞品深度对标

| 维度     | MeterSphere                    | 本项目                                                                 | 决策理由                                                                               |
| -------- | ------------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 版本归属 | 六协议插件全部企业版闭源       | 标准版交付五家插件源码+上传启用                                        | 需求文档 P4 行明确列入本项目远期范围；开源版提供扩展能力，与基线企业版口径差异显式登记 |
| 驱动来源 | 商店再分发 jar                 | npm 官方生态标准（ioredis/mongodb 官方/amqplib/ssh2/grpc-js）+lockfile | PLUG-004 §0 来源铁律延续                                                               |
| gRPC 面  | 插件表单+流式支持（企业版）    | unary 单 run（JSON 编辑区 v1；流式登记后续）                           | 单 run 探活语义冻结（PLUG-003）；表单化登记                                            |
| SSH 边界 | 无防护（任意命令，企业版口径） | 审计日志+凭据不落库；诚实登记不做假白名单                              | shell 语义过宽，假防护比无防护更糟——与 SQL（白名单可行）差异显式化                     |

## 7. 里程碑与验收

- DoD：五插件包+protocol-kit 交付；T1-T10 全绿；PLUG-001/002/003 既有协议用例回归全绿；CI 绿。
- 演示：上传启用 redis 插件 → 调试页选 redis → PING 对栈 redis → 报告查看 PONG；选 amqp → 对 rabbitmq service 往返成功。
- 来源审计：六依赖 npm 包名/版本/许可与 §4 表一致（pnpm-lock 锁定），仓内无飞致云商店引用。

## 8. 勘误登记

1. **cpu-features 阻断 esbuild**（day0 spike 消于编码前）：ssh2 的可选原生依赖 require .node 文件，esbuild bundle 无法解析——构建表统一 `alias` 空桩（纯 JS 回退=ssh2 内建行为），插件运行零影响。
2. **proto-loader 0.8 无 fromString**：gRPC 插件的 proto 文本须先写临时文件再 `loadSync(path)`（day0 实证）；临时文件在插件 run 结束时清理，路径用 `os.tmpdir()+uuid` 防并发互踩。
3. **ssh2 Server host key 格式**：ed25519 pkcs8 PEM 不被 ssh2 接受（`Cannot parse privateKey: Unsupported key format`），测试用 RSA 2048 pkcs1（day0 实证）。
4. **ssh2 exit-status 的 flowing 竞态（实现期最深坑）**：stream 挂 `data` 监听（flowing mode）后，exit-status 事件不再单独 emit——exit 监听必须先于 data 挂载，且 exit 事件内延迟一拍 `setImmediate` 再判定（data 帧与 exit-status 同 tick 竞争，先判定会丢 stdout）。曾误判为「tsx/vitest 双 ssh2 模块实例」（实际单实例，根因是事件顺序）——教训：流事件语义先查库源码/做最小对照，勿凭猜测改环境。
5. **插件源被引擎 typecheck 覆盖（PLUG-004 教训复发）**：五插件初期用 zod 定义 configSchema——zod 不在根依赖（只在 packages/shared），plugins/ 目录 esbuild 解析不到；且 `SamplerPlugin.configSchema: z.ZodType` 类型不接受自写守卫对象。双解：①五插件 configSchema 全改自写类型守卫（tcp-conn 先例，零新依赖）②SPI 的 configSchema 类型放宽为结构化 `ConfigValidator`（消费面仅 safeParse().success——zod 与守卫同构）。
6. **ssh2/amqplib 无自带类型**：@types/ssh2 @types/amqplib 入根 devDependencies（插件源被引擎 typecheck 覆盖，TS7016 必须消）；grpc-js/mongodb/ioredis 自带类型无需。
7. **proto-loader 的 esbuild default interop 坑（验收演示录制首次暴露——三层测试全部漏网）**：`import protoLoader from "@grpc/proto-loader"` 在 **bundle 后** default 拿不到命名导出（`protoLoader.loadSync=undefined`，运行时 TypeError）——单测直接跑插件**源码**（解析正常）+ CI e2e 只覆盖 redis 一家的引擎路径，bundle 形态的 grpc 从未经过引擎装载。修复=grpc 插件两包改 namespace 导入（`import * as grpcPkg`）。**制度化教训：插件交付的自动化验收必须至少一家走「bundle→引擎装载→执行」全链路**——补 e2e PLUG-005-T10（grpc 对内嵌 echo server 引擎全链路执行，响应体断言 got:*）。演示录制另暴露本地多栈孤儿引擎抢同队列问题（teardown 只杀 pnpm 包装进程留 tsx 孙进程——栈脚本按 worktree 路径清扫，运维口径登记不入仓）。
8. **验收演示视频（2026-09-30 归档）**：`docs/sprint-future-p4/demo/plug005-acceptance-demo.webm`（121.8s · 1280×720 · 八段主线：登录→五家 tarball 上传→启用运行中→引擎装载等待→redis PING（docker 容器真 redis）→gRPC Say（真实 grpc-js echo server）→AMQP 自发自收（docker RabbitMQ）→MongoDB count=3（docker mongod 预置数据）→SSH exec（完整 SSH 协议服务））；复录三件套入库 `tests/demo/plug005-demo-{record.mjs,stack.sh,targets.mjs,pg.mjs}`（录前清扫孤儿引擎/清数据目录，全五段终态断言非 SUCCESS 即失败）。
