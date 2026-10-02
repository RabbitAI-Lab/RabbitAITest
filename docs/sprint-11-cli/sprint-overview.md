# Sprint 11 — AI CLI 与 Token 通道 · 迭代概览

| 元信息项   | 内容                                                                                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint 11（worktree `../RabbitAITest-s11`，分支 `SYS-009-oauth-token-channel` → `CLI-001-rabbit-cli` 栈式，基线 main 837eebd）                                                     |
| 迭代名称   | AI CLI 与 Token 通道（OAuth Device Flow · `rabbit` CLI）——AI Agent 原生操作平台                                                                                                    |
| 周期       | 规划第 28-30 周                                                                                                                                                                    |
| 覆盖优先级 | 平台自有增强（超出 MeterSphere 功能清单基线——基线 CI 集成仅有 OpenAPI+APIKEY；本迭代补齐 Token 通道 + CLI，登记 §1.4）                                                             |
| 文档数     | 3 份（1 概览 + 2 规格）                                                                                                                                                            |
| 文档状态   | Implemented（2026-09-30 交付：2 规格全量+原型+三层测试全绿（Vitest 351/JMeter 27/e2e 4）+CLI go test 全绿+冒烟；远端 CI 随 PR 验证；高保真确认与走查随验收——S0 §8.1 目标授权先例） |
| 上游依据   | [需求文档](../需求文档.md) §八安全行「认证（Session+**Token**+APIKEY）」三通道预留（Token 通道自本迭代落地）；§二 CI 集成                                                          |
| 前置迭代   | S6 INTG-003（APIKEY 通道与 open/* CI 端点先例）、S1 SYS-002/004（守卫与 RBAC）、S10 INFRA-006（RLS 租户隔离）                                                                      |
| 阻塞下游   | P4+ AI 深度集成（Agent 技能分发）、第三方 OAuth 客户端（登记不交付）                                                                                                               |

---

## 1. 迭代目标

**让 AI Agent（与人）能以原生 CLI 形态管理、执行用例**：OAuth Device Flow 落地第三认证通道（Token），`rabbit` CLI（基于 RabbitCLI-Bootstrap）消费同一套 `/api/v1` 统一 OpenAPI，权限模型四层叠加（Token 生命周期 × scope 收窄 × RBAC 权限点 × RLS 租户隔离），与 web 会话零分叉。

成功判定：

| 维度              | 目标                                                                                        | 判定方式                             |
| ----------------- | ------------------------------------------------------------------------------------------- | ------------------------------------ |
| Token 认证通道    | Device Flow 全链（发码→浏览器批准→轮换取 token→refresh 旋转）；Bearer 走全部既有守卫        | Vitest + jmx 四类 + e2e 全链         |
| scope 收窄        | read/write/exec 三类 deny-by-default；read token 写操作 403；exec token 可执行不可改        | 单测映射矩阵 + jmx 403 类 + e2e 越权 |
| 授权会话管理      | 个人中心授权会话列表/吊销；吊销即 401；改密吊销全部                                         | e2e 吊销二态                         |
| rabbit CLI        | 基于脚手架定制：services/shortcuts/raw 三层命令 + `--json` 契约 + schema 自省 + skills 分发 | go test + CI Go 作业 + 冒烟套件      |
| 契约纪律（Go 侧） | OpenAPI 快照 → 生成 apidef 路径常量，服务命令禁止手写路径；CI diff 校验                     | gen-cli-services --check             |
| 审计              | oauth.* 全动作审计 + Token 通道写操作带 grant 归因                                          | 单测 + jmx 审计断言                  |

**本迭代不追求**：第三方 OAuth 客户端注册表（first-party `rabbit-cli` 写死）、HMAC 请求签名（同 APIKEY 登记后置）、CLI 插件/mock/系统管理面命令（P2）、CLI 的 macOS pkg/麒麟 deb 安装包（单二进制 + Releases 自更新先行）、scope 细粒度到权限点（三类粗粒度，登记）。

## 2. 交付范围（2 规格）

| #   | 交付项                     | 内容                                                                                                                                                                      | 文档      |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | OAuth Token 通道（服务端） | Device Flow 四端点（RFC 8628 原生 JSON，信封例外登记）、OAuthGrant/OAuthDeviceCode 两表、`getAuthIdentity` 认证协商升级、scope×RBAC×RLS、授权确认页+授权会话页、审计/限流 | `SYS-009` |
| 2   | rabbit CLI                 | 脚手架 vendor 定制（NAME=rabbit）、六处扩展（scope/refresh 旋转/登出吊销/错误解包/页码分页/interval）、P1 services+shortcuts、apidef 代码生成、CI Go 作业+Release 资产    | `CLI-001` |

## 3. 迭代风险与对策

| 风险                                    | 对策                                                                                           |
| --------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 技术栈新增 Go（AGENTS §2「纯 TS」变更） | 同 PR 更新 `docs/architecture/tech-stack.md` 登记 CLI 子项（先例：tests/ JMeter 非 TS 工具链） |
| 与 S10 RLS 未合入改动碰撞（guard/db）   | 本迭代基于 main 837eebd；oauth 两表为用户级全局表不进 RLS 策略；合并顺序 S10 先行              |
| 脚手架 upstream 演进分叉                | 六处扩展均为通用增强，同步回馈上游；apps/cli 保留 upstream remote 与 vendor 基线记录           |
| Token 泄露面（AI 环境明文配置）         | access 2h 短 TTL + refresh 旋转重放吊销 + 授权会话一键吊销 + 审计归因；文件 0600（脚手架既有） |

## 4. 环境与槽位

worktree `../RabbitAITest-s11` → 槽位 11（INFRA-005：目录名推导，端口/Redis 键空间自动隔离）；CLI Go 构建无端口依赖；e2e 复用槽位持久库口径（rules/testing）。
