# plugins/ — 插件包源码与分发

| 插件            | kind     | SPI            | 说明                                                                    |
| --------------- | -------- | -------------- | ----------------------------------------------------------------------- |
| jira-platform   | platform | PlatformPlugin | Jira REST v2（Basic/Bearer；INTG-001）                                  |
| zentao-platform | platform | PlatformPlugin | 禅道 REST v1（token 会话；INTG-002）                                    |
| tapd-platform   | platform | PlatformPlugin | TAPD v1（Basic Auth；INTG-002）                                         |
| tcp-conn        | protocol | SamplerPlugin  | TCP 连通性采样（engine 进程内加载；PLUG-002）                           |
| websocket       | protocol | SamplerPlugin  | WS 单 run 探活（undici 内联，format=cjs；PLUG-003；name=协议标识）      |
| mqtt            | protocol | SamplerPlugin  | MQTT 3.1.1 最小客户端（node:net 自研编解码，QoS0；PLUG-003）            |

> 协议插件约定：**插件 name 必须等于协议标识**（引擎以 request.protocol 字面量查表）；默认导出工厂之外请同时导出具名 `createPlugin`（CJS bundle 经 import() 的命名空间适配，双侧加载器双层解包）。

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
