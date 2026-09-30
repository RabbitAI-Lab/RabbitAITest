# rabbit CLI — Vendored scaffold record

## 上游基线

- **仓库**：`RabbitAI-Lab/RabbitCLI-Bootstrap`
- **基线 commit**：`a351e121f0e8db1982bd5e4106f52627b9635b47`（main，2026-09-30 收编）
- **收编方式**：clone-as-base（脚手架设计用法）——`cmd/`、`internal/`、`go.mod`、`Makefile`、`build.sh` 收编入 `apps/cli/`；`verifier/`、`README.md`、`说明书.md`、`开发文档.md`（脚手架自开发产物）未收编
- **上游 remote**：`git@github.com:RabbitAI-Lab/RabbitCLI-Bootstrap.git`（六处扩展回馈后跟随上游演进）

## 本仓扩展（CLI-001 §1.2 六处，全部平台无关、可回馈上游）

| # | 扩展                                                                                       | 改动点                     |
| - | ------------------------------------------------------------------------------------------ | -------------------------- |
| 1 | `auth login --scope`（device code 请求带 scope；status 回显；缺省 read）                    | `cmd_auth.go`              |
| 2 | refresh_token 旋转（token 响应存储；`Request()` 401 自动 `grant_type=refresh_token` 刷新一次并重试） | `cmd_auth.go` / `httpapi.go` |
| 3 | 登出吊销（可选 `authRevokeUrl`——logout 先 best-effort POST 服务端吊销再清本地）              | `cmd_auth.go`              |
| 4 | 平台信封错误解包（`{code,message}`——message 提升为错误消息，业务码进 hint）                 | `httpapi.go`               |
| 5 | 页码分页协议（`--page-all` 增加 `page/size`+`total` 分支——items<页长或累计≥total 即停）     | `httpapi.go`               |
| 6 | 尊重 device 响应 `interval`/`expires_in`（原写死 5s/10min）                                 | `cmd_auth.go`              |

其他差异：`args.go` 增补 `wait` 为 bool 旗标；`output.go` 导出 `NewUsageError`；`build.sh` NAME 缺省改 `rabbit`（macOS shasum 兼容）；`dotenv_test.go` 补 env 卸载（测试隔离）；`internal/services/demo.go` 移除，`internal/services/rabbit.go`（平台 P1 命令面）与 `internal/services/apidef/`（`scripts/gen-cli-services.mjs` 生成，门禁 4 Go 侧）为平台新增。

## 同步节奏

上游合并：扩展回馈前按需 cherry-pick；回馈后跟随 main 周期合并（冲突面集中在 cmd_auth.go/httpapi.go 两处）。
