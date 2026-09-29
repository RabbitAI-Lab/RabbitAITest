# rabbit CLI（RabbitCLI-Bootstrap 定制 · AI Agent 原生终端）

| 元信息项     | 内容                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | CLI-001（新模块前缀 CLI）                                                                                                                          |
| 所属迭代     | Sprint 11 — AI CLI 与 Token 通道                                                                                                                   |
| 优先级       | P1（迭代内）                                                                                                                                       |
| 所属模块     | apps/cli（Go，技术栈新增——AGENTS §2 变更，同 PR 登记 tech-stack.md）                                                                               |
| 文档状态     | Implemented（2026-09-30 交付：六处扩展+services P1+apidef 代码生成+CI Go 作业；go test 全绿（含扩展 5 例）；对生产栈冒烟（login→project use→env ls→登出吊销）全通；接口契约评审物已产出 docs/design/CLI-001-rabbit-cli/，确认后置）|
| 最后更新日期 | 2026-09-30                                                                                                                                         |
| 上游依赖     | SYS-009（Token 通道——auth login/refresh/revoke 对端）；packages/api-client/src/generated/openapi.json（apidef 代码生成输入）                          |
| 下游消费     | AI Agent 会话（skills install 分发 RabbitAITest 技能）；P4 AI 深度集成                                                                               |
| 上游依据     | 脚手架仓库 RabbitAI-Lab/RabbitCLI-Bootstrap（main 分支，vendor 基线记录于 apps/cli/VENDORED.md）；需求文档 §八三通道                                  |
| 对标基线     | 超基线自有增强；形态对标 gh（GitHub CLI）——device flow 登录+资源命令+raw API 兜底                                                                   |
| 关联架构文档 | api-conventions.md（信封/分页——CLI 侧消费）；rbac-permission-model.md（scope 语义）；tech-stack.md（同 PR增补 Go CLI 子项）                          |
| 高保真确认   | 待确认（CLI 非图形界面，按门禁 2「接口契约评审」变体：评审物=命令帮助文本+示例会话+SKILL.md，见 docs/design/CLI-001-rabbit-cli/）                     |
| 工作量估算   | 后端 4 人日（Go）+ CI/发布 1 人日                                                                                                                  |

## 1. 概述

### 1.1 功能定位

基于 RabbitCLI-Bootstrap（Go 静态单二进制通用 CLI 脚手架，零依赖、CGO 关、麒麟 loong64 免费）定制平台专属 CLI `rabbit`：**Shortcuts（`+` 前缀高频组合）→ 服务命令（域资源 1:1）→ Raw API（任意端点）** 三层命令体系，继承脚手架全套 AI 契约（`{ok,data,meta}` 信封、错误 `{type,code,message,hint}`、`--format json/pretty/table/ndjson/csv`、`--dry-run`、schema 自省、skills 分发、多环境切换、自更新）。认证走 SYS-009 Device Flow（`authDeviceUrl`/`authTokenUrl`/`authClientId` 三配置键与脚手架 cmd_auth.go 契约精确对齐）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                             | P1 ✅ | 后续                                                      |
| ------------------------------------------------------------------------------------------------ | ----- | ---------------------------------------------------------- |
| 脚手架 vendor：apps/cli 收编 main 基线，NAME=rabbit（配置目录 ~/.config/rabbit、RABBIT_* 前缀）  | ✅    | upstream 合并节奏（扩展回馈后跟随）                        |
| 扩展①scope：`auth login --scope read,exec` → device code 请求带 scope；status 回显               | ✅    | —                                                          |
| 扩展②refresh 旋转：token 响应存 refresh_token；401 自动 grant_type=refresh_token 刷新一次重试    | ✅    | —                                                          |
| 扩展③登出吊销：可选 authRevokeUrl——logout 先 best-effort POST /oauth/revoke 再清本地             | ✅    | —                                                          |
| 扩展④错误解包：CliError 构造时识别平台信封 {code,message}——message 提升为错误消息               | ✅    | —                                                          |
| 扩展⑤页码分页：--page-all 增加 page/size+total 协议分支（items<页长或累计≥total 即停）           | ✅    | —                                                          |
| 扩展⑥尊重 device 响应 interval/expires_in（原写死 5s/10min）                                     | ✅    | —                                                          |
| 服务命令 P1：case/api-case/api/scenario/plan/env/task/report/project（ls/get/create/update/rm/run）| ✅    | mock/插件/系统管理面（P2 登记）                            |
| Shortcuts P1：`+run <目标>`（默认环境→执行→等待→摘要）、`+report <taskId>`、`+case-from <file>`  | ✅    | `+fail-reason`、`+batch` 等（按使用反馈）                  |
| 上下文：`--project` 全局旗标 + config 键 `project` 缺省 + `project use` 快捷写入                 | ✅    | 多 profile 并行上下文                                      |
| 契约纪律：OpenAPI 快照→gen-cli-services.mjs→internal/services/apidef/paths.go；服务命令禁手写路径 | ✅    | 参数类型级生成（P1 只生成路径常量+方法+权限面）            |
| 测试：go test（分页协议/auth 状态机/httptest）+ CI Go 作业（build+test）+ 冒烟套件               | ✅    | Release 资产 tag 构建（rabbit-v{ver}-{os}-{arch}，随发布流）|
| skills：内置 RabbitAITest SKILL.md（用例编写/工作流/分页）随二进制 embed，`skills install` 分发  | ✅    | 技能市场/多技能包                                          |

### 1.3 前置依赖

SYS-009 端点（device/code、token、revoke）；OpenAPI 快照（gen-openapi.mjs 已入库）；Go 工具链（CI setup-go；本地 go ≥1.22）。

### 1.4 对标基线核对

基线无 CLI（MeterSphere CI 集成=OpenAPI+APIKEY；gh 形态为超基线对标）。脚手架选型为用户指定（2026-09-30）：六处扩展均为通用增强，回馈上游避免 fork 漂移；`rabbit-cli` client_id 为平台语义约定。

## 2. 业务逻辑（命令体验契约——门禁 2 评审物）

### 2.1 认证与环境

```
$ rabbit auth login --server http://localhost:3000 --scope read,exec
打开浏览器或访问:  http://localhost:3000/oauth/device?code=K7MP-Q4T2
等待授权中…（每 5s 轮询，10 分钟超时；Ctrl-C 后 rabbit auth login --device-code <code> 可续）
✔ 已登录  alice@example.com  scope: read,exec  access 2h / refresh 30d
$ rabbit auth status      # server/用户/scope/token 过期时间/authRevokeUrl
$ rabbit auth logout      # 吊销服务端授权会话（best-effort）并清本地 token
```

### 2.2 上下文与资源（服务命令，节选）

```
$ rabbit project ls · rabbit project use <id>          # use=config set project
$ rabbit case ls --page-all · rabbit case get <num> · rabbit case create --file case.json
$ rabbit api-case run <id> --env <envId>               # → {taskId}
$ rabbit plan ls · rabbit plan run <planId>
$ rabbit env ls · rabbit task get <taskId> · rabbit task wait <taskId> --timeout 300
$ rabbit report get <taskId> · rabbit report export <reportId>
```

### 2.3 Shortcuts（AI 高频组合）

```
$ rabbit +run api-case <id>       # 默认环境→执行→wait→终态摘要（成功/失败数+失败首因）
$ rabbit +report <taskId>         # 报告摘要（Markdown 表）
$ rabbit +case-from swagger.json  # api 定义导入→生成 case 草稿清单
```

### 2.4 输出契约（继承脚手架，平台适配点）

成功=stdout+exit 0 `{ok:true,data,meta}`；失败=stderr+非零（usage=2）`{ok:false,error:{type:"api|config|usage|network|internal",code,message,hint}}`；**判断成功看 ok==true**（data 为平台信封原样透传，内含 code/message/data）。扩展④后错误 message 直接可读（平台 message），业务码入 hint。分页列表命令缺省 `--format table`，`--format json` 输出平台 `{total,items}`。

## 3. UI/UX 设计

CLI 非图形界面：门禁 2 以**命令帮助文本（每命令 --help 全量输出）+ §2 示例会话脚本 + SKILL.md**作为「接口契约评审」评审物，归档 `docs/design/CLI-001-rabbit-cli/`（sample-session.md + help/*.txt + SKILL.md 镜像）。交互变更须同步更新并重新确认。

## 4. 技术架构

- **落位**：monorepo `apps/cli`（vendor 脚手架 main 基线；`apps/cli/VENDORED.md` 记录 upstream commit 与本仓扩展清单）；`Makefile` 照用，`make build NAME=rabbit test`；turbo 经 package.json scripts 编排（build/test/clean）。工作区不含 Go——pnpm workspace 不管 apps/cli 依赖，仅编排脚本。
- **六处扩展**（§1.2①-⑥；改动点 internal/cli/{cmd_auth,httpapi}.go；全部保持平台无关可回馈）。
- **服务命令**：internal/services/{project,case,apicase,api,scenario,plan,env,task,report}.go——init() `cli.RegisterService` 自注册（脚手架机制）；路径常量引用 `internal/services/apidef/paths.go`（生成物，头部机器生成标注+禁手改注释）。
- **代码生成**：`scripts/gen-cli-services.mjs` 读 openapi.json + CLI_EXPOSED 清单（脚本内维护）→ paths.go（常量+方法+简述）；`--check` 模式供 CI diff 校验（对齐 gen-openapi --check 口径）。
- **认证**：config 三键 authDeviceUrl=http://…/api/v1/oauth/device/code、authTokenUrl=…/oauth/token、authClientId=rabbit-cli（`config init` 引导写入 + README 平台接入章节）；token 存储 0600+脱敏展示（脚手架既有）；.env.local RABBIT_TOKEN 兜底（CI 场景）。
- **CI**：GitHub Actions 新增 go-cli 作业（SHA 固定 actions/setup-go@<pin>，go test ./... + make build + gen-cli-services --check）；tag 流追加资产构建（rabbit-v{ver}-{darwin,linux}-{amd64,arm64}+linux_loong64）挂 Release 供 `rabbit update`。镜像既有六作业拓扑（JMeter 分片不动）。
- **边界**：CLI 仅依赖 web API（不 import 仓库内任何 TS 包，不触 DB/Redis）；`apps/engine` 无涉；Mimosa SSRF 约束不适用（CLI 为客户端，无服务端出站请求）。

## 5. 测试用例

- CLI-001-T0（go test）：分页协议双分支（cursor/page-number 边界：items<页长、累计=total、空页）；auth 状态机（pending/slow_down 退避/access_denied/expired_token/refresh 重放→清 token）；错误解包（平台信封→message 提升）；scope 传递（--scope 解析+非法值报 usage）。
- CLI-001-T1（CI 冒烟，起全套栈）：auth login（脚本代答 approve）→ project use → case create --json → api-case run → task wait → report get，断言各步 exit 0 + ok==true + 关键 JSONPath；read-only token 写操作 exit 非 0 且 error.code=403。
- CLI-001-T2（契约冻结）：`--help` 全量输出与 sample-session.md 快照 diff（防命令面漂移）。
- 服务端 oauth 端点的 jmx/e2e 由 SYS-009 承担（本规格不重复）；门禁 8 对应：§1.2 各行→T0/T1/T2。

## 6. 竞品深度对标

gh（GitHub CLI）：device flow 登录、host 切换、repo/issue/pr 资源命令、扩展机制——本 CLI 同构收敛为三层命令+skills。差异：①无浏览器内嵌（打印 URL，AI 场景无 GUI）；②无 extension 插件机制（脚手架 skills 替代）；③单平台专属（脚手架多产品复用留上游）。MeterSphere：无 CLI（基线外）。

## 7. 里程碑与登记

M11（v0.6.0）：rabbit CLI P1 命令面+Device Flow 登录+CI 冒烟。登记后续：P2 命令面（mock/插件/系统）、Release 资产自动化、scope 细粒度、技能市场、`+fail-reason` 智能摘因。
