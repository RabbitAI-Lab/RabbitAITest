# CLI 快速上手（rabbit）

`rabbit` 是 RabbitAITest 的**命令行终端**：一个零依赖的静态单二进制（Go），为 AI Agent 与人类工程师提供原生终端操作能力——管理用例、触发执行、轮询报告，全程无需浏览器。

?> 对 AI Agent 友好是它的第一设计目标：结构化 JSON 输出、机器可读的 `schema` 自检、随二进制分发的 Agent 技能（`skills install`）。判断命令成功与否看 `ok == true`，不要看内层 `code`。

## 什么是 rabbit CLI

- **三层命令体系**：Shortcuts（`+` 前缀高频组合，一条命令走完「执行→等待→终态摘要」）→ 资源命令（与平台端点 1:1）→ Raw API（`rabbit api <METHOD> <PATH>` 兜底调用任意端点）。
- **OAuth Device Flow 登录**：终端发起、浏览器批准，无需在终端粘贴密码；access token 2 小时自动旋转续期，授权会话可随时在平台个人中心吊销。
- **scope 最小权限**：登录时声明 `--scope read,exec` 即「可看可跑不可改」，越权操作会被平台以 403 明确拒绝。
- **契约纪律**：命令引用的接口路径全部由 OpenAPI 快照生成（`apidef`），与平台契约永不漂移。

## 安装

### 前置条件

- 平台侧：已部署的 RabbitAITest 服务（见[安装部署](quickstart/installation.md)），CLI 通过 HTTP 访问其 `/api/v1`。
- 构建侧（源码构建时）：Go 1.24+。运行时**零依赖**——产物为静态单二进制（CGO 关闭），支持 linux / macOS（amd64 · arm64）与麒麟 loong64。

### 从源码构建（当前主路径）

```bash
git clone https://github.com/RabbitAI-Lab/RabbitAITest.git
cd RabbitAITest/apps/cli

bash build.sh                # 本机构建 → bin/rabbit
bash build.sh --install      # 构建并安装到 /usr/local/bin/rabbit
bash build.sh --release      # 全平台交叉编译 → dist/（含麒麟 loong64）
```

验证安装：

```bash
rabbit -v
# rabbit 0.6.0
```

### 版本发布资产

平台 Releases 附带各平台预编译二进制（`rabbit-v{ver}-{os}-{arch}` 与 SHA256 校验文件）；发布后 `rabbit update` 支持在线自升级。当前阶段以源码构建为准。

## 首次配置与登录

### 1. 配置平台地址

把 `<平台地址>` 替换为你的 RabbitAITest 服务地址（本地开发通常是 `http://localhost:3000`）：

```bash
rabbit config set baseUrl       http://<平台地址>
rabbit config set authDeviceUrl http://<平台地址>/api/v1/oauth/device/code
rabbit config set authTokenUrl  http://<平台地址>/api/v1/oauth/token
rabbit config set authClientId  rabbit-cli
rabbit config set authRevokeUrl http://<平台地址>/api/v1/oauth/revoke   # 可选：登出时服务端吊销
```

也可用 `rabbit config init` 交互式引导，或用环境变量 / `.env.local` 覆盖（`RABBIT_TOKEN`、`RABBIT_BASE_URL`——CI 场景注入静态 token 的通道）。

### 2. Device Flow 登录

```bash
rabbit auth login --scope read,exec
```

CLI 会打印一个授权链接与 8 位设备码：

```
打开 http://<平台地址>/oauth/device?code=K7MP-Q4T2 并输入代码 K7MP-Q4T2
等待授权中…（每 5s 轮询，10 分钟超时）
✔ 已登录  scope: read,exec  access 2h / refresh 30d
```

在**任意浏览器**打开链接（链接里的 `?code=` 已自动预填），用平台账号登录后确认授权页显示的 scope，点击「批准授权」——CLI 随即取得令牌。

<img src="_media/shots/oauth-device.png" alt="终端授权确认页">

登录态说明：

- **access token 2 小时**：过期后 CLI 自动用 refresh token 旋转续期（30 天有效、一次性使用；旧值被重放会触发整会话吊销）。
- **随时吊销**：平台「个人中心 → 授权会话」一键吊销，终端立即 401；`rabbit auth logout` 也会服务端吊销（`server_revoked: true`）。
- **scope 三类**：`read`（只读）/ `write`（改）/ `exec`（执行触发）；缺省为最小权限 `read`。实际权限 = 你的平台角色 ∩ scope。

```bash
rabbit auth status    # 令牌来源 / scope / 过期时间
rabbit auth logout    # 服务端吊销 + 清除本地令牌
```

## 第一次使用

### 1. 选择项目上下文

```bash
rabbit project ls                # 列出可见项目
rabbit project use <projectId>   # 设为默认项目（也可每条命令 --project <id> 覆盖）
```

### 2. 发现资源

```bash
rabbit case ls                   # 功能用例（--page-all 自动翻页拉全量）
rabbit api ls                    # 接口定义
rabbit api cases <apiId>         # 某接口下的用例
rabbit environments ls           # 环境列表（拿 envId）
```

### 3. 执行一条接口用例（Shortcut 一步到位）

```bash
rabbit +run api-case <apiId> <caseId> --env <envId>
```

`+run` 的智能缺省 = 触发执行 → 轮询至终态 → 输出摘要（成功/失败数与失败首因）。拆开写等价于：

```bash
rabbit api-case run <apiId> <caseId> --env <envId>   # → {taskId}
rabbit task wait <taskId> --timeout 300              # 轮询至终态
rabbit report get <taskId>                           # 报告详情
```

## 常用命令速查

| 命令 | 说明 |
| --- | --- |
| `rabbit auth login / status / logout` | Device Flow 登录 / 状态 / 登出吊销 |
| `rabbit project ls / use <id>` | 项目列表 / 设默认项目 |
| `rabbit case ls / get / create --file / update / rm` | 功能用例 CRUD |
| `rabbit api ls / cases <apiId>` | 接口定义 / 接口用例 |
| `rabbit api-case run <apiId> <caseId> --env <envId>` | 触发接口用例执行 |
| `rabbit scenario ls / run <id> --env <envId>` | 场景列表 / 执行 |
| `rabbit plan ls / get / run <id>` | 测试计划 |
| `rabbit environments ls` | 环境列表（envId 发现） |
| `rabbit task get / wait / stop <taskId>` | 任务状态 / 等待终态 / 停止 |
| `rabbit report get <taskId>` | 报告详情 |
| `rabbit +run api-case / scenario / plan …` | 快捷方式：执行→等待→摘要 |
| `rabbit +report <taskId>` | 快捷方式：报告摘要 |
| `rabbit api <METHOD> <PATH>` | Raw 兜底：调用任意 `/api/v1` 端点 |
| `rabbit schema [group]` | 机器可读的命令结构自省 |
| `rabbit skills install` | 向 AI Agent 分发内置使用技能 |
| `rabbit env list / add / use` | 多环境切换（dev/staging/prod 各持独立 baseUrl+token） |
| `rabbit update` | 在线自升级（ Releases 资产发布后可用） |

## 输出契约（AI Agent 必读）

成功输出到 stdout、退出码 0；失败输出到 stderr、退出码非 0（用法错误 = 2）。

```json
// 成功——判断看 ok == true；data 为平台信封原样（内层 code/message/data 是平台语义）
{ "ok": true, "data": { "code": 0, "message": "ok", "data": { "total": 2, "items": [ … ] } }, "meta": {} }

// 失败——type 区分 api/config/usage/network/internal；message 已解包平台业务消息
{ "ok": false, "error": { "type": "api", "code": 403, "message": "token scope 缺少 write（当前：read）", "hint": "…" } }
```

常用旗标：`--format json|pretty|table|ndjson|csv`（列表缺省 table，脚本建议 json）、`--page-all`（分页自动翻页拉全量）、`--dry-run`（只打印将发出的请求）、`--project <id>`（临时项目上下文）。

## 数据存储在哪里

- 配置与令牌：`~/.config/rabbit/config.json`（权限 0600；令牌脱敏展示）。`--config-dir` 或 `RABBIT_CONFIG_DIR` 可重定向。
- 请求日志：`~/.config/rabbit/logs/`（JSON Lines，按日滚动，自动脱敏令牌）。
- 授权会话的**服务端**记录在平台「个人中心 → 授权会话」可查可吊销。

## 升级与卸载

```bash
# 升级（当前阶段）：拉取仓库重新构建
cd RabbitAITest && git pull && cd apps/cli && bash build.sh --install

# Releases 发布后
rabbit update          # 在线自升级

# 卸载
rm /usr/local/bin/rabbit && rm -rf ~/.config/rabbit
```

## 常见问题

**Q：命令返回 `token scope 缺少 write`？**
你的登录 scope 不含 `write`。只读+执行是 AI 场景的推荐最小权限；确需修改资源时重新 `rabbit auth login --scope read,write,exec`。

**Q：`auth login` 一直 `authorization_pending`？**
批准尚未完成：打开 CLI 打印的链接（或访问 `/oauth/device` 输入 8 位码）批准；设备码 10 分钟有效，过期重新发起。`--no-wait` 可先退出、稍后 `rabbit auth login --device-code <code>` 续接。

**Q：`rabbit api` 之外为什么禁止手写路径？**
资源命令的路径全部由平台 OpenAPI 快照生成（`apidef` 常量），保证与平台契约一致；未封装的端点用 `rabbit api` 兜底即可。

**Q：想给 AI Agent（如 Claude Code / ZCode）装上使用技能？**
`rabbit skills install` 会把内置 SKILL.md（命令清单 / 分页用法 / 错误处理模式）分发到 Agent 技能目录。

## 下一步

- [接口测试手册](manual/api/overview.md)——CLI 执行的对象（定义/用例/场景/报告）全貌
- [环境管理](manual/project/environment.md)——`--env <envId>` 指向的环境是什么
- [架构概览](developer/architecture.md)——OAuth Token 通道与 CLI 的设计（SYS-009 / CLI-001 规格）
