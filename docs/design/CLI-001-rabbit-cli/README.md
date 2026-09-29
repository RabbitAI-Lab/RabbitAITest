# CLI-001 rabbit CLI — 命令体验契约评审物（门禁 2「接口契约评审」变体）

> CLI 非图形界面，高保真以**帮助文本 + 示例会话 + SKILL.md** 为评审物；交互变更须更新本文件并重新确认。
> 完整命令帮助快照见 `help/`（随实现冻结，CLI-001-T2 契约测试对照）。

## 1. 认证与环境（示例会话）

```
$ rabbit auth login --server http://localhost:3000 --scope read,exec
打开浏览器或访问:  http://localhost:3000/oauth/device?code=K7MP-Q4T2
等待授权中…（每 5s 轮询，10 分钟超时；Ctrl-C 后 rabbit auth login --device-code <code> 可续）
✔ 已登录  alice@example.com  scope: read,exec  access 2h / refresh 30d

$ rabbit auth status
server:   http://localhost:3000
user:     alice@example.com
scope:    read, exec
access:   1h58m 剩余（09-30 16:31 过期，届时自动刷新）

$ rabbit auth logout
✔ 已吊销服务端授权会话并清除本地令牌
```

## 2. 上下文与资源

```
$ rabbit project ls                       # 表格：id/name/num/role
$ rabbit project use 6f1c…                # 写 config 键 project（--project 可临时覆盖）
$ rabbit case ls --page-all               # 分页信封自动翻页 {total,items}
$ rabbit case create --file case.json --format json
$ rabbit api-case run <id> --env <envId>  # → data {taskId}
$ rabbit task wait <taskId> --timeout 300 # 轮询至终态，退出码 4=超时
$ rabbit report get <taskId>
```

## 3. Shortcuts（`+` 前缀）

```
$ rabbit +run api-case <id>      # 默认环境→执行→wait→终态摘要（成功/失败数+失败首因）
$ rabbit +report <taskId>        # 报告摘要 Markdown 表
$ rabbit +case-from swagger.json # api 定义导入→case 草稿清单
```

## 4. 输出契约（AI 使用要点）

- 成功：stdout `{"ok":true,"data":…,"meta":…}`，exit 0；**判断成功看 `ok==true`**（`data` 为平台信封原样，内含 `code/message/data`）。
- 失败：stderr `{"ok":false,"error":{"type":"api|config|usage|network|internal","code":<HTTP>,"message":"<平台 message>","hint":…}}`，exit 非 0（usage=2）。
- `--format json|pretty|table|ndjson|csv`；`--dry-run`；`rabbit schema [group]` 机器可读自省。

## 5. SKILL.md（内置技能要点，随二进制 embed）

用途/触发/命令清单/分页用法/错误处理模式（ok==true 判定、401→auth login、429 退避）/最佳实践（--json 解析、project use 先行、read,exec 最小 scope）。
