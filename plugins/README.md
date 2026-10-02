# plugins/ — 插件包源码与分发

| 插件            | kind     | SPI            | 说明                                                                        |
| --------------- | -------- | -------------- | --------------------------------------------------------------------------- |
| jira-platform   | platform | PlatformPlugin | Jira REST v2（Basic/Bearer；INTG-001）                                      |
| zentao-platform | platform | PlatformPlugin | 禅道 REST v1（token 会话；INTG-002）                                        |
| tapd-platform   | platform | PlatformPlugin | TAPD v1（Basic Auth；INTG-002）                                             |
| tcp-conn        | protocol | SamplerPlugin  | TCP 连通性采样（engine 进程内加载；PLUG-002）                               |
| websocket       | protocol | SamplerPlugin  | WS 单 run 探活（undici 内联，format=cjs；PLUG-003；name=协议标识）          |
| mqtt            | protocol | SamplerPlugin  | MQTT 3.1.1 最小客户端（node:net 自研编解码，QoS0；PLUG-003）                |
| postgresql      | driver   | DriverPlugin   | pg 8（node-postgres，MIT；$1 绑定 + BEGIN READ ONLY；PLUG-004）             |
| mysql           | driver   | DriverPlugin   | mysql2（MIT；原生 `?` 绑定 + START TRANSACTION READ ONLY；PLUG-004）        |
| oracle          | driver   | DriverPlugin   | oracledb 7 thin（Oracle 官方；`:n` 绑定 + SET TRANSACTION READ ONLY）       |
| sqlserver       | driver   | DriverPlugin   | mssql 12（Microsoft 指定；@pn 绑定；无 READ ONLY 事务→白名单兜底）          |
| dm              | driver   | DriverPlugin   | dmdb（达梦官方，纯 JS；原生 `?` 绑定 + SET TRANSACTION READ ONLY）          |
| ssh             | protocol | SamplerPlugin  | ssh2（MIT；exec 单命令往返，exit-status 先行判定；PLUG-005）                |
| redis           | protocol | SamplerPlugin  | ioredis（MIT；单命令+危险命令黑名单 FLUSHALL/EVAL 等；PLUG-005）            |
| mongodb         | protocol | SamplerPlugin  | mongodb 官方驱动（Apache-2.0；ping/count/find 只读三操作；PLUG-005）        |
| grpc            | protocol | SamplerPlugin  | grpc-js+proto-loader（Google 官方；unary 单调用，proto 动态加载；PLUG-005） |
| amqp            | protocol | SamplerPlugin  | amqplib（MIT；临时队列自发自收往返；PLUG-005）                              |

> 协议插件约定：**插件 name 必须等于协议标识**（引擎以 request.protocol 字面量查表）；默认导出工厂之外请同时导出具名 `createPlugin`（CJS bundle 经 import() 的命名空间适配，双侧加载器双层解包）。驱动插件同理：**name 必须等于 driver 标识**（engine 驱动注册表/环境数据源按 driver 字面量查表）。

## 驱动来源铁律（PLUG-004 §0）

五家驱动一律取自**数据库厂商官方渠道**（npm registry 官方来源，pnpm-lock 锁定），**禁止使用飞致云应用商店（apps.fit2cloud.com / apps-assets.fit2cloud.com）下载的再分发包**。纯 TS 技术栈无 JVM，JDBC jar 无法装载——「官方 JDBC 驱动」在本项目的等价实现 = 厂商官方 Node 驱动（Oracle=oracledb 官方、mssql=Microsoft 指定、pg=PostgreSQL 生态标准、dmdb=达梦官方、mysql2=社区事实标准（Oracle 无官方 Node 驱动，登记）），构建期内联进 tarball。

## 构建

```bash
pnpm build:plugins   # esbuild bundle → plugins/dist/{name}-{version}.tgz
```

## 安装（管理页上传或脚本）

系统设置 → 插件管理 → 上传插件 → 选择 `plugins/dist/*.tgz`（清单自动解析预览）。
上传链路：tarball → 解包校验（rabbitPlugin 清单/SPI 版本）→ 存储 → Plugin 登记 → plugin-runner 热加载。

## 新插件开发

1. `plugins/{name}/index.ts` 实现 SPI（结构化匹配 `packages/shared/src/plugins/spi.ts`；type-only import）
2. `default` 导出工厂函数（runner worker 与 engine 加载约定）
3. `scripts/build-plugins.mjs` 清单表加一行（name/kind/version/spiVersion/entry）
4. `pnpm build:plugins` 后经管理页上传分发

插件信任边界：上传权限 = SYSTEM_PLUGIN:UPDATE（签名校验登记 Backlog，见 PLUG-001 §1.2）。
