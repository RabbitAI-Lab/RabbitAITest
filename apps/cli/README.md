# RabbitAITest CLI（rabbit）—— AI 原生终端（CLI-001）

Go 静态单二进制（zero-dep、CGO 关、麒麟 loong64 免费）；基于 RabbitAI-Lab/RabbitCLI-Bootstrap 定制（基线与扩展见 [VENDORED.md](./VENDORED.md)）。

## 构建与测试

```bash
cd apps/cli
bash build.sh --version 0.6.0   # → bin/rabbit（本机平台）
go test ./...                   # 单测（auth 状态机/分页协议/错误解包）
bash build.sh --release         # 全平台交叉编译 → dist/（含 linux_loong64）
```

## 平台接入（config init 引导）

```bash
rabbit config set baseUrl       http://<平台地址>
rabbit config set authDeviceUrl http://<平台地址>/api/v1/oauth/device/code
rabbit config set authTokenUrl  http://<平台地址>/api/v1/oauth/token
rabbit config set authClientId  rabbit-cli
rabbit config set authRevokeUrl http://<平台地址>/api/v1/oauth/revoke   # 可选——logout 服务端吊销
rabbit auth login --scope read,exec                                     # Device Flow（浏览器批准）
```

## 命令面（P1）

三层体系：**Shortcuts（`+` 前缀）→ 资源命令 → raw `api` 兜底**。判断成功看 `ok==true`（`data` 为平台信封原样透传，内含 `code/message/data`）。

```
rabbit +run api-case <apiId> <caseId> --env <envId>   # 默认环境→执行→等待→终态摘要
rabbit +report <taskId>                                # 报告摘要（跨项目，open/exec 端点）
rabbit project ls · rabbit project use <id>
rabbit case ls --page-all · rabbit case create --file case.json
rabbit api ls · rabbit api cases <apiId>
rabbit api-case run <apiId> <caseId> --env <envId>    # → {taskId}
rabbit scenario ls · rabbit scenario run <id> --env <envId>
rabbit plan ls · rabbit plan run <planId>
rabbit env ls                                        # envId 发现
rabbit task get|wait <taskId> [--timeout 300] · rabbit task stop <taskId>
rabbit report get <taskId>
```

输出契约：`--format json|pretty|table|ndjson/csv`；`--dry-run`；`rabbit schema [group]` 机器可读自省；`rabbit skills install` 向 Agent 分发内置技能（分页用法/错误处理模式/最佳实践）。

## 契约纪律（门禁 4 Go 侧）

服务命令禁止手写接口路径——一律引用 `internal/services/apidef/paths.go` 常量（由 `node scripts/gen-cli-services.mjs` 从 OpenAPI 快照生成；CI `--check` 校验 diff）。raw 通道 `rabbit api <METHOD> <PATH>` 为逃生门（未封装端点）。
