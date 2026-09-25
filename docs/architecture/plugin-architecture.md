# 插件体系架构（协议 / 平台 / 驱动）

| 元信息项 | 内容 |
| --- | --- |
| 文档层级 | 架构文档（全局约束） |
| 状态 | 已确认（Approved） |
| 对标基线 | MeterSphere 功能清单 §十一（pf4j 三套 SPI：plugin-sdk / platform-sdk / api-sdk；插件上传/启停/组织范围） |
| 下游消费 | PLUG-001/002、INTG-001/002、PROJ-003（数据源）、SYS-005（插件管理页） |

---

## 1. 三类插件

| 类别 | SPI 接口 | 载体 | 用途 |
| --- | --- | --- | --- |
| 协议插件 | `SamplerPlugin`：构建采样器（解析协议配置 → 发包 → 标准化响应） | TS 插件包（tarball） | TCP/SSH/Redis/MongoDB/WebSocket 等协议扩展（P4 起步） |
| 平台插件 | `PlatformPlugin`：缺陷/需求 CRUD、状态映射、附件、连接测试 | TS 插件包（tarball） | Jira / 禅道 / TAPD 对接 |
| 数据库驱动 | `DriverPlugin`：连接池 + query/execute | TS 插件包（tarball）+ 二进制驱动 | Oracle/SQLServer/达梦 等非内置数据源（内置 PostgreSQL/MySQL） |

**明确决策：不兼容 pf4j/jar 生态**；插件只以本项目 SPI 分发（应用市场 = 仓库 release 附件）。

## 2. 隔离模型（与 pf4j 最大差异）

```
apps/api（编排）──RPC(gRPC)──→ apps/plugin-runner（插件宿主进程池）
                                   ├─ 每类插件独立子进程，崩溃自动重启
                                   ├─ CPU/内存限额；驱动连接池归 runner 管
                                   └─ 平台同步任务在 runner 内执行（三方网络故障不拖垮 api）
```

- 上传：管理页上传插件包（tarball）→ MinIO 存储 → Plugin 表登记 → runner 热加载（不重启主服务）
- 启用范围：全部组织 / 指定组织（对齐基线「使用组织范围」）；禁用=runner 卸载进程，配置数据保留
- 引擎侧协议插件：由 engine 进程内加载（同 TS 插件包，经 dynamic import + 同一 SPI），不经过 runner——采样是热路径，不能跨进程 RPC 发包

## 3. SPI 形态（TypeScript 接口，定义于 packages/shared）

```ts
export interface SamplerPlugin {
  protocol: string                                  // "tcp" / "websocket" / ...
  buildSampler(config: SamplerConfig): Sampler
}

export interface PlatformPlugin {
  platform: string                                  // "jira" / "zentao" / "tapd"
  testConnection(cfg: PlatformConfig): Promise<void>
  createIssue(payload: IssuePayload): Promise<PlatformRef>
  syncBugs(since?: Date): Promise<PlatformBug[]>    // 增量/全量由编排层决定
  fieldMapping(): PlatformField[]                   // 模板自动生成（dynamic-template-fields §3）
}
```

版本纪律：SPI 以语义化版本管理；插件声明兼容 SPI 范围，不兼容拒绝加载并在管理页提示。

## 4. 安全

- 上传仅 `SYSTEM_PLUGIN:UPDATE` 权限；插件包需附签名（官方市场公钥校验，自建可跳过但有醒目告警）
- runner 进程默认无网络出口白名单限制，但平台插件的目标域名记录于审计日志
- 驱动插件连接串中的密码以 Secret 存储（不回显明文，对齐基线行为）
