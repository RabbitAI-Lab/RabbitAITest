# Git 仓库文件（存储库对接 · 按分支+路径拉取 · 文件回收站）

| 字段           | 内容                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| 文档编号       | FILE-001                                                                                                     |
| 所属迭代       | Sprint 5 — 协作通知                                                                                          |
| 优先级         | P2（迭代内 P1）                                                                                              |
| 所属模块       | project 域（file 服务扩展：repo 管理+REST adapter+拉取落存储）                                                |
| 文档状态       | Implemented（2026-09-28 交付：代码+单测 18（adapter 矩阵）+ JMeter 1 + Playwright 3 全绿；走查随验收） |                                                                                       |
| 最后更新日期   | 2026-09-28                                                                                                   |
| 上游依赖       | PROJ-004（文件管理/模块树/JAR 启用制/软删、登记「Git 存储库 ❌S5」与「回收站 UI 随 S3 统一——未兑现」）、S6 出站守卫与 AES-GCM 加密先例 |
| 下游消费       | S8 QA-001/002（覆盖率核对「存储库对接」行、SSRF 收口）                                                       |
| 上游依据       | 需求文档 §三 M2（文件管理：Git 存储库 Gitea/GitHub/GitLab/Gitee 按分支+路径拉取）；功能清单 §8.3              |
| 对标基线       | 功能清单 §8.3：存储库对接（Gitea、GitHub、GitLab、Gitee——Token 连接、按分支+路径拉取文件）、文件下载/删除/移动（既有） |
| 关联架构文档   | test-domain-model.md §2（file_repos/file_items）与 §6（本规格补列例外登记）；api-conventions §4（回收站横切）；rules/security.md（SSRF/token 加密不回显） |
| 高保真确认     | 待确认（原型 docs/design/FILE-001-git-repository-files/，人工确认待 Sprint 验收走查）                         |
| 工作量估算     | 后端 2.5 人日 / 前端 1.5 人日 / 联调 1 人日                                                                   |

## 1. 概述

### 1.1 功能定位

文件管理对接 Git 托管平台：项目配置存储库（平台+地址+Token），经平台 REST API 按分支+路径拉取文件入库（与本地文件同列表、带仓库标识），复用既有下载/删除/移动；顺带兑现 PROJ-004 登记未做的**文件回收站 UI**（恢复+彻底删除）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                  | P1 ✅ | 后续                                                  |
| ----------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------- |
| 仓库 CRUD：platform(gitea\|github\|gitlab\|gitee)/url(https 仓库地址)/token(可空，AES-256-GCM 加密落库，回显掩码 hasToken)；上限 10/项目 | ✅     | —                                                      |
| token 加密：复用 S6 RABBIT_INTEGRATION_SECRET 派生密钥体系；PATCH 空 token=不更新；接口永不回显明文    | ✅     | 独立密钥域 Backlog                                     |
| 连接测试：`POST {id}/test` → 平台 repo 元信息探活（2xx=成功，401/403=凭据失效提示）                     | ✅     | —                                                      |
| SSRF 出站守卫：url 命中私网/环回/元数据/CGNAT/ULA 拒 + DNS 复检；测试栈 OUTBOUND_ALLOW_PRIVATE=1 先例   | ✅     | —                                                      |
| 按分支+路径拉取：`POST {id}/pull {branch, path}`（path=文件或目录；目录递归深度≤3、文件数≤50、单文件≤SYS-005 file.maxSizeMB）→storage 存储→FileItem（branch/repoPath 溯源）；同名同路径重复拉取=覆盖更新（size/storageKey 刷新） | ✅     | 仓库整树同步/定时同步 Backlog；子模块/PR 集成 Backlog |
| 仓库文件标识：文件列表来源徽标（平台 tag）+branch/repoPath 列展示；单文件「重新拉取」行操作              | ✅     | 版本对比/diff Backlog                                  |
| 文件回收站（PROJ-004 兑现）：`?recycled=true` 过滤+单条恢复+彻底删除（物理删+storage 对象清理）          | ✅     | 批量恢复 Backlog                                       |
| 模块树移动/下载/JAR 启用（既有 PROJ-004 能力对仓库文件同样适用）                                        | ✅     | —                                                      |
| 卡片视图                                                                                               | ❌     | 沿用 PROJ-004 简化登记                                 |
| SSH 认证/密码认证                                                                                      | ❌     | Backlog（Token-only，基线口径）                        |

### 1.3 前置依赖

- `file_repos`（projectId/platform/url/token）与 `file_items.repoId` 外键已建齐（S0）。
- **补列例外（门禁 3）**：`file_items` 增 `branch`(VarChar 128)/`repo_path`(VarChar 512) 两可空列——分支/路径属仓库文件行级溯源属性，依赖 FILE-001 规格定型（S0 无该规格输入），与 S7 ai 域例外同类（「依赖未来规格的表结构」）；已在 test-domain-model §6 登记例外（S5 条目）。
- storage（MinIO putObject/signDownloadToken）与 `internal/files/{id}` 字节流契约（engine 消费）不变——拉取文件落 storage 后天然兼容。

### 1.4 对标基线核对

完全复刻：4 平台枚举、Token 连接、按分支+路径拉取、拉取文件与本地文件同管理（下载/删除/移动）。简化实现：拉取经平台 REST contents/tree API 而非 git 协议 clone（免 smart-HTTP 服务端依赖；对 github/gitea/gitee 用 contents 族、gitlab 用 tree+raw——**平台 API 形态差异归一化在 adapter 层**）；目录拉取加深度/数量护栏；Token 加密与 SSRF 守卫为基线未明示的本项目安全底线（超出基线的安全增强）。超出基线：连接测试按钮、单文件重新拉取、文件回收站（基线 §二通用能力，PROJ-004 登记兑现）。

## 2. 业务逻辑

- **URL 解析**：`https://{host}/{owner}/{repo}(.git)` → adapter 生成 API 端点（gitea `{scheme}://{host}/api/v1/repos/{owner}/{repo}`、github 默认 `https://api.github.com/repos/{o}/{r}`（自建 host 时 `{scheme}://{host}/api/v3/...` 登记简化：仅官方 github.com 支持）、gitlab `{scheme}://{host}/api/v4/projects/{urlEncoded o/r}`、gitee `{scheme}://{host}/api/v5/repos/{o}/{r}`）。
- **认证**：gitea/github/gitee=Basic `{user}:{token}`（github user 任意非空，惯例 `x-oauth-basic` 口径 user="token"）；gitlab=Bearer。token 为空=匿名（公开仓库可用）。
- **拉取**：path 为文件→单文件；为目录→列目录递归（深度≤3，累计文件≤50，超限 422 FILE_REPO_PULL_FAILED 附已达数量）；每文件 GET raw/base64 → 大小校验 → putObject（storageKey=`repo:{repoId}:{sha1(branch+path)}`）→ upsert FileItem（repoId/branch/repoPath，模块=未规划根）。
- **重复拉取**：同 repo+branch+repoPath 已存在（含回收站内）→ 覆盖内容并恢复 deletedAt=null，返回 `{pulled, refreshed, skipped}`。
- **回收站**：文件软删（既有）→ `recycled=true` 列表 → restore 清 deletedAt → `purge=true` 物理删 FileItem+storage 对象删除（best-effort）。
- **审计**：repos CRUD/test/pull 走 recordAudit（token 参数脱敏）。
- **删除仓库**：物理删 file_repos；其下 FileItem 保留（溯源列保留，徽标变「已删仓库」灰态——软依赖）。

## 3. UI/UX 设计（高保真 docs/design/FILE-001-git-repository-files/）

- 入口：文件管理页 `/files` 顶部工具栏「存储库」按钮 → 存储库管理弹窗（列表：平台 logo tag/地址截断/token 掩码（已配置●/未配置○）/操作 测试·拉取·编辑·删除；新建表单：平台四选一 radio/仓库 URL/Token 密码框（编辑时留空=不更新））。
- 「拉取」弹窗：分支输入（默认 main）+路径输入（如 `testdata/` 或 `testdata/users.csv`）+结果反馈（拉取 N/刷新 M/跳过 K，失败红条含平台错误摘要）。
- 文件列表：来源列（本地/平台 tag 徽标：Gitea/GitHub/GitLab/Gitee/已删仓库灰）；仓库文件行 hover 展示 branch+repoPath tooltip；行操作对仓库文件多「重新拉取」。
- 回收站 Tab：`tab-file-recycle`（名称/来源/大小/删除时间/操作 恢复·彻底删除（红色二次确认））。
- 空态：无仓库引导连接；拉取结果零文件提示路径不存在。

## 4. 技术架构

- 数据模型：`file_repos` 零改动；`file_items` 增 branch/repoPath 可空列（migration，门禁 3 例外登记 test-domain-model §6）。
- 契约（packages/shared/src/project/schemas.ts 增量）：`fileRepoUpsertSchema`（platform 枚举/https url/token ≤512 可空）、`fileRepoPullSchema`（branch 1-128/path 1-512）、`fileRepoTestResultSchema`；files 列表增 `recycled` query 与响应溯源字段（additive）。
- 端点：
  - `GET/POST /api/v1/projects/{projectId}/file-repos`（PROJECT_FILE:READ/CREATE）
  - `PATCH/DELETE /api/v1/projects/{projectId}/file-repos/{id}`（UPDATE/DELETE）
  - `POST /api/v1/projects/{projectId}/file-repos/{id}/test`（UPDATE）——连接测试
  - `POST /api/v1/projects/{projectId}/file-repos/{id}/pull`（CREATE）——拉取
  - 既有 `files` 列表增 `?recycled=true`；`POST /api/v1/projects/{projectId}/files/{id}/restore`（UPDATE）；`DELETE .../files/{id}?purge=true`（物理删，DELETE 语义扩展）；`POST .../files/{id}/sync`（UPDATE）——仓库文件重新拉取
- 服务：`apps/web/src/server/domains/project/file-repo.service.ts`（CRUD/crypto/test/pull）+ `git-adapters.ts`（四平台归一化：`listRepoMeta`/`fetchPath(branch,path)→[{path,content,size}]` 纯函数+fetch 注入可测）；`file.service.ts` 增 recycle 面与 sync。
- 加密：复用 S6 `domains/integration` 加密工具（HKDF 派生+AES-256-GCM）；`RABBIT_INTEGRATION_SECRET` 缺失→配置 token 时 422 INTEGRATION_SECRET_MISSING（70015 复用，登记）。
- SSRF：复用 `guardOutboundUrl`（SWAGGER_SYNC_URL_BLOCKED 同族→本规格 40463）。
- 权限点：复用 `PROJECT_FILE:*`（无新增）。
- 错误码（40xxx 接口测试段-file 族顺延）：`FILE_REPO_NOT_FOUND 40460`、`FILE_REPO_CONNECT_FAILED 40461`、`FILE_REPO_PULL_FAILED 40462`、`FILE_REPO_URL_BLOCKED 40463`。
- 前端：files 页存储库弹窗+拉取弹窗+回收站 Tab+来源列；api-client s5.ts。
- mock（apps/mock）：`/mock-git/gitea|github|gitee/api/...contents`、`/mock-git/gitlab/api/v4/...` 按 adapter 契约各建最小端点（固定小文件集）；`/_test` 控态沿用。

## 5. 测试用例

- FILE-001-T1（jmx 四类）：repos CRUD+pull 主链（建仓库→test 200→pull→files 列表见仓库文件）；401/403（无 PROJECT_FILE:CREATE）/404（坏 repo id）；422（坏 URL/私网 URL 拦截/非法 platform/超上限第 11 个）；files 分页信封断言。
- FILE-001-T2（spec 主链路）：连接 mock-git 仓库（gitea）→测试连接成功 →拉取 `data/` 目录 → 文件列表出现带 Gitea 徽标与 branch/repoPath → 下载内容与 mock 源一致 → 单文件重新拉取（mock 侧改内容后 size/内容刷新）（UI+Console+接口）。
- FILE-001-T3（spec 回收站）：删除文件→回收站 Tab 可见→恢复回归→彻底删除→两处不可见（三类断言）。
- FILE-001-T4（spec 二态）：token 掩码（编辑弹窗不回显、响应体无明文——接口断言响应 JSON 不含 token 字段值）；私网地址 422（SSRF）；gitlab 分支路径拉取（第二平台 adapter 验证）。
- 单测：四 adapter URL 解析与请求形态（fetch mock）；token crypto roundtrip 与空 PATCH 不更新；拉取护栏（深度/数量/大小）；重复拉取 upsert 行为；purge storage 清理调用。

## 6. 竞品深度对标

基线 §8.3：4 平台✓ Token 连接✓ 按分支+路径拉取✓ 与本地文件同管理✓。差异：①REST API 拉取而非 git 协议（免服务端 smart-HTTP 依赖，登记）；②Token 加密与 SSRF 守卫（安全底线增强）；③护栏（深度≤3/≤50 文件）；④超出基线：连接测试/重新拉取/回收站（基线通用能力兑现）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。契约冻结点：file-repos 端点族+files recycle 扩展（additive，OpenAPI 快照 diff）。联调点：mock-git 四平台端点与 T2/T4 断言。验收=§5 用例全绿 + 概览演示主线「Git 仓库/文件回收站」段。

## 8. 勘误登记

无。
