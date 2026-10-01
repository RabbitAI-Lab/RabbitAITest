# 项目代码仓库（多平台 OAuth 授权 + URL 直填 + Token/账密凭据 + 连通性验证）

| 字段         | 内容                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | SCM-001                                                                                                                                                                       |
| 所属迭代     | Sprint 13 — 代码仓库                                                                                                                                                          |
| 优先级       | P1                                                                                                                                                                            |
| 所属模块     | project 域（scm 子域：OAuth 应用配置/授权账号/仓库绑定）+ system 域（params 扩展）                                                                                            |
| 文档状态     | Implemented（2026-10-01 交付：三表+OAuth 双层配置+项目设置 tab+三件套测试全绿——Vitest 47 / JMeter 30 采样器 / Playwright 5；走查随验收） |
| 最后更新日期 | 2026-10-01                                                                                                                                                                    |
| 上游依赖     | INTG-001（组织级服务集成与凭据加密先例）、FILE-001（git-adapters 四平台 REST 适配器与 SSRF/加密先例）、SYS-005（SystemParam 分组存储）、ENTP-002（浏览器 OAuth 授权码流先例） |
| 下游消费     | Backlog：webhook 推送触发、代码克隆/文件浏览、AI 代码分析联动、GHE/Gitea OAuth                                                                                                |
| 上游依据     | 用户需求（2026-10-01）：每个项目可配置自己的代码仓库，支持 GitHub 授权后直接选择、Gitee（码云）/GitLab，支持 https/ssh 地址与账密/token 认证                                  |
| 对标基线     | **超出 MeterSphere 基线**（社区版无项目级代码仓库配置原生功能；§8.3 存储库对接=FILE-001 已复刻，本规格为自有增强）                                                            |
| 关联架构文档 | test-domain-model.md §2/§6（scm_* 三表）、api-conventions.md（信封/分页/错误码）、rules/security.md（凭据加密不回显/SSRF 边界）、rules/testing.md（三类断言/四类场景）        |
| 高保真确认   | 待确认（原型 `docs/design/SCM-001-project-repositories/`；人工确认按 S0 §8.1 目标授权先例后置至交付走查，原型产出先于编码）                                                   |
| 工作量估算   | 后端 3 人日 / 前端 2.5 人日 / 测试联调 2 人日                                                                                                                                 |

## 1. 概述

### 1.1 功能定位

每个项目可绑定自己的代码仓库（多仓库，上限 10，含一个默认仓库），三种连接途径：

1. **平台 OAuth 授权选择**：组织成员对 GitHub / Gitee（码云，同一平台）/ GitLab（含自建实例）发起 OAuth 授权，授权账号在组织内共享；绑定时浏览/搜索该账号可见的仓库列表直接选中。
2. **URL 直填**：填 https 或 ssh 仓库地址（`https://host/owner/repo[.git]`、`git@host:owner/repo.git`、`ssh://git@host[:port]/owner/repo.git`），平台按 host 自动识别（github/gitee/gitlab/gitea，识别不出=custom 仅保存）。
3. **凭据形态**：无凭据（公开仓库）/ OAuth（随授权账号）/ Token（PAT，四平台全支持）/ 账号密码（gitea、gitee API 支持 Basic 可验证；github/gitlab API 不支持——可保存，验证时明确提示改用 Token）。

绑定后可**连通性验证**并展示**仓库元信息**（默认分支/可见性/最近提交）。与 FILE-001 的关系：FILE-001 是文件管理模块的「存储库对接」（按分支+路径拉取测试资源文件），本规格是项目级代码仓库身份配置，两者独立并存、文档互链（FILE-001 §1.2 已登记 SSH/密码认证 Backlog，由本规格在 scm 域兑现，file_repos 不改）。

### 1.2 能力行（P1 全覆盖 → §5 用例映射）

| #   | 能力                  | 交互口径                                                                                                                                                                                                              |
| --- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 系统级 OAuth App 配置 | 系统设置新页「代码平台」：GitHub/Gitee/GitLab 三卡片（clientId、clientSecret 加密落库回显掩码、GitLab 实例地址默认 gitlab.com、启用开关）；复用 SystemParam group=`scm` 与 `PUT /system/params/[group]`               |
| 2   | 组织级覆盖与继承      | 组织「服务集成」页新「代码平台」区块：每平台状态三态（组织自定义/继承系统级/未配置）；组织可增删**自己的覆盖**，不可改系统级配置（权限隔离：SYSTEM_PARAM:UPDATE vs ORG_INTEGRATION:UPDATE）；撤销覆盖回落继承         |
| 3   | OAuth 授权流          | 项目设置或组织页发起 → `start` 302 平台授权页 → 平台回跳 `callback` → 换 token + 拉取平台账号信息 → 授权账号入库 → 302 回前端带结果标记；state 存 Redis 5min 一次性消费（防 CSRF）                                    |
| 4   | 授权账号管理          | 组织内共享（成员授权的账号，本组织项目绑定均可用，UI 展示授权人）；列表/撤销（授权人本人或 ORG_INTEGRATION:UPDATE）                                                                                                   |
| 5   | OAuth 选仓            | 绑定抽屉「平台授权」tab：选已授权账号（无则引导授权）→ 该账号可见仓库列表（搜索 + 平台侧分页聚合，信封 `{total,items}`）→ 单选绑定                                                                                    |
| 6   | URL 直填              | 绑定抽屉「仓库地址」tab：地址输入按 host 自动识别平台（github/gitee/gitlab/gitea，不识别=custom 仅保存）；https/ssh 两种形态均解析 owner/repo                                                                         |
| 7   | 认证方式              | authType = none \| oauth \| token \| password；password 平台能力矩阵：gitea ✓ / gitee ✓（API Basic）、github ✗ gitlab ✗（可保存，验证回「平台不支持账密验证，建议 Token」）                                           |
| 8   | 凭据安全              | clientSecret/OAuth token/PAT/密码全部 AES-256-GCM 加密落库（credential-crypto，命名空间 `scm-app:`/`scm-account:`/`scm-repo:` + provider）；接口只回 hasSecret 布尔，永不回显明文                                     |
| 9   | 连通性验证与元信息    | `POST {repoId}/verify`：平台 API 探活+刷新元信息（defaultBranch/visibility/最近提交 sha+message+时间）；状态机 UNVERIFIED→OK / INVALID_CRED（401/403）/ FAILED（网络或平台错）；ssh 地址验证走平台 REST（不出站 ssh） |
| 10  | 多仓库与默认          | 上限 10/项目（软删不计）；一个默认仓库（唯一，切换互斥，事务）；首个绑定自动默认；编辑（改名/换凭据，凭据留空=不更新）/软删/恢复列表默认过滤                                                                          |
| 11  | 权限与审计            | 新权限点 `PROJECT_REPO:READ/CREATE/UPDATE/DELETE`（预置组：PROJECT_ADMIN 全量、PROJECT_MEMBER READ+CREATE、ORG_ADMIN READ）；无 READ 权限时设置菜单项隐藏；全部写操作 recordAudit                                     |

### 1.3 前置依赖

- `packages/db/prisma/schema.prisma` 新增三表（门禁 3 一次建齐，见 §4.1），无既有表补列。
- `RABBIT_INTEGRATION_SECRET` 已有（INTG-001 起）；未配置时保存任何凭据 → 422 INTEGRATION_SECRET_MISSING（70015 复用）。
- Redis（OAuth state）与 `outbound-guard`/`outboundDispatcher`（SSRF 双层守卫）既有。

### 1.4 对标基线核对

超出基线（自有增强）：MeterSphere 社区版无项目级代码仓库配置；其 §8.3「存储库对接」即 FILE-001。安全底线（凭据加密/SSRF 守卫/state 防伪）为基线未明示的本项目惯例增强。

## 2. 业务逻辑

- **平台元数据单一事实源**（`packages/shared/src/scm/meta.ts`，仿 PLATFORM_META）：label/默认 webBase（authorize+token 域）/apiBase（API 域）/authorizePath/tokenPath/scopes（github `read:user repo`、gitee `user_info projects`、gitlab `read_user read_api`）/supportsPassword/支持 OAuth 标志。**测试栈 env 覆盖**：`SCM_GITHUB_BASE_URL`/`SCM_GITEE_BASE_URL`/`SCM_GITLAB_BASE_URL` 同时替换 webBase+apiBase 指向 mock（e2e/jmeter 注入；出站仍过 SSRF 守卫+dispatcher）。
- **App 配置解析**（双层继承）：`resolveScmApp(orgId, provider)` → 组织 `scm_org_apps` 命中且 enabled → 用组织配置；否则 system params group `scm`；均无 → 40471 SCM_APP_NOT_CONFIGURED。GitLab 的实例地址（baseUrl）取自 App 配置（组织级优先）。
- **OAuth 授权**：`start`（org 成员即可发起，无权限点——个人身份授权共享给组织）→ Redis `scm:oauth:state:{state}` = `{orgId,userId,provider,origin}` TTL 300s，一次性 `DEL` → 平台 authorize（response_type=code + client_id + redirect_uri=`{origin}/api/v1/orgs/{orgId}/scm/oauth/{provider}/callback` + state + scope）→ `callback` 换 token（失败 40479 SCM_PROVIDER_ERROR）→ 平台 `/user` 拉登录名/昵称/头像 → upsert `scm_accounts`（`@@unique([orgId,userId,provider])`，重复授权覆盖 token）→ 302 `{origin}/settings/code-repos?oauth={provider}&result=ok|fail`。
- **GitLab token 刷新**：gitlab access_token 2h + refresh_token；verify/选仓遇 401 且有 refresh → 刷新一次（rotate 落库）再试；github/gitee token 长期不过期。
- **选仓列表**：`GET /scm/accounts/{id}/repos`（org 成员）→ 平台 `user/repos|projects?membership` 分页拉取（per_page≤100，聚合 ≤5 页=500 条封顶登记）→ keyword 本地过滤 → `{total, items:[{owner,repo,defaultBranch,visibility,httpsUrl,sshUrl}]}`。
- **URL 解析**（扩展 git-adapters，新增 `parseScmRepoUrl`）：https 同 FILE-001 `parseRepoUrl`；ssh 两种形态 `git@{host}:{owner}/{repo}.git`、`ssh://git@{host}[:{port}]/{owner}/{repo}.git` → 归一 `{provider,host,owner,repo,apiBase}`（host 匹配官方域→对应平台，否则按平台选择推导：用户在 UI 选定平台，host 任意=该平台自建实例；custom=仅保存）。ssh 地址**绝不出站**，验证走同 owner/repo 的平台 REST。
- **验证状态机**：新建=UNVERIFIED；verify 成功→OK+元信息刷新；401/403→INVALID_CRED；网络/平台错/404 仓库不存在→FAILED（verifyMessage 存摘要，≤512）。verify 前置 `assertSafeOutboundUrl(apiBase)`，拦截→40477 SCM_REPO_URL_BLOCKED。
- **默认仓库**：`isDefault` 项目内唯一；设默认事务内先清后立；删除默认仓库后剩余首个自动补默认（无剩余则空）。
- **审计**：`scm_app.update`（system params 既有 param.update 复用）、`scm_org_app.upsert/delete`、`scm_account.authorize/revoke`、`scm_repo.create/update/delete/verify/set_default`（detail 不含凭据明文）。

## 3. UI/UX 设计（高保真 `docs/design/SCM-001-project-repositories/`）

- **项目设置新 tab「代码仓库」** `/settings/code-repos`（nav pset 组，perm=PROJECT_REPO:READ，testid `nav-settings-code-repos`）：
  - 头部：说明文案 + 右侧「授权账号」「添加仓库」按钮；
  - 仓库卡片列表：平台徽标（GitHub/Gitee/GitLab/Gitea/自建）、别名+`owner/repo`、地址截断 tooltip、认证方式 tag（OAuth·login / Token / 账密·username / 公开）、验证状态徽标（已连接绿 · 凭据失效红 · 验证失败红 · 未验证灰）+最近验证时间、默认 badge；行操作：验证/设为默认/编辑/删除（二次确认）；
  - 「添加仓库」抽屉（双 tab）：**平台授权**——账号下拉（显示 login+授权人；空态引导「去授权 GitHub/Gitee/GitLab」）→ 仓库搜索列表（owner/repo、公开/私有 tag、默认分支列，单选）；**仓库地址**——地址输入（自动识别平台按钮+结果 tag）、平台 Select（含 custom）、认证方式 Radio（无凭据/Token/账号密码）+ 动态字段（Token 密码框 / username+password）、编辑时凭据留空=不更新；
  - 「授权账号」弹窗：组织内账号表（平台/login/昵称/授权人/授权时间/状态）+ 行操作撤销（红）+「授权新账号」（平台三选一 → 跳 start）；
  - OAuth 回跳：URL 带 `oauth={provider}&result=ok` → toast 成功并刷新账号下拉；
  - 空态：插画+引导文案+两个入口按钮；无 PROJECT_REPO:READ：菜单项隐藏（二态）。
- **系统设置新页「代码平台」** `/system/scm-apps`（SYSTEM_PARAM:READ/UPDATE；nav sset 组）：三平台卡片（label+图标、clientId 输入、clientSecret 密码框 `******`=未修改、GitLab 实例地址、启用开关、保存）；顶部说明「系统级为默认配置，组织可在 服务集成 中用自己的应用覆盖」。
- **组织服务集成页**（`/settings/integrations`）新增「代码平台（OAuth 应用）」区块：三平台行——继承状态 tag（组织自定义/继承系统级/未配置）+ clientId 摘要 + 操作（配置覆盖/编辑/撤销覆盖→回落继承）；覆盖弹窗（clientId/clientSecret/实例地址[gitlab]）。
- **文案口径**：Gitee 一律写「Gitee（码云）」；custom 平台 tag「自建/其他」。

## 4. 技术架构

### 4.1 数据模型（schema.prisma 一次建齐；String+应用层 zod 枚举惯例）

```prisma
/// 组织级代码平台 OAuth App 覆盖（SCM-001；未配置时继承 SystemParam group=scm）
model ScmOrgApp { id/orgId→Organization/provider(github|gitee|gitlab)/baseUrl?/clientId/clientSecret(AES-GCM 密文)/enabled @default(true)/createdAt/updatedAt；@@unique([orgId, provider])；@@map("scm_org_apps") }
/// 组织内成员 OAuth 授权账号（凭据在账号上，绑定时引用）
model ScmAccount { id/orgId→Organization/userId→User(授权人)/provider/baseUrl?/login/name/avatarUrl/tokenEnc/refreshTokenEnc?/expiresAt?/scopes/status(ACTIVE|EXPIRED|REVOKED)/createdAt/updatedAt/deletedAt；@@unique([orgId, userId, provider])；@@map("scm_accounts") }
/// 项目代码仓库绑定（核心表；未启用列 defaultBranch/visibility/sshUrl 一次建齐）
model ScmRepository { id/projectId→Project/name?/provider(github|gitee|gitlab|gitea|custom)/repoUrl/sshUrl?/host/owner/repo/apiBase?/authType(none|oauth|token|password)/accountId?→ScmAccount/username?/secretEnc?/defaultBranch?/visibility?/isDefault @default(false)/verifyStatus @default("UNVERIFIED")/verifyMessage?/lastVerifiedAt?/createdById→User/createdAt/updatedAt/deletedAt；@@index([projectId, deletedAt])；@@map("scm_repositories") }
```

Project 增反向关联 `scmRepositories ScmRepository[]`；webhook/克隆类列不预建（v1 边界明确排除，后续规格按门禁 3 豁免评审）。

### 4.2 契约（packages/shared/src/scm/：meta.ts + schemas.ts，index 汇出）

- `SCM_PROVIDERS`/`SCM_OAUTH_PROVIDERS`/`SCM_AUTH_TYPES`/`SCM_VERIFY_STATUSES` 枚举与 `SCM_PROVIDER_META`（§2）；
- `scmAppValueSchema`（system params group=scm 值形状：三平台 `{clientId, clientSecret?, baseUrl?, enabled}`，`******`=保留原值）；扩展 `paramGroupSchema` group 枚举 +`"scm"`；
- `scmOrgAppUpsertSchema`、`scmAccountViewSchema`、`scmRepoCreateSchema`（discriminated union：`source:"oauth"` {accountId,owner,repo,name?} | `source:"url"` {provider,repoUrl,authType,token?/username?+password?,name?}）、`scmRepoUpdateSchema`（name/凭据留空不更新/isDefault）、`scmRepoViewSchema`（脱敏视图：hasSecret、accountLogin）。

### 4.3 端点（REST /api/v1，OpenAPI 快照随 gen-openapi 重生成）

| 端点                                                                                     | 守卫/权限                                        | 说明                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- |
| `GET/PUT /api/v1/system/params`、`PUT /api/v1/system/params/scm`                         | withSystemPerm SYSTEM_PARAM:READ/UPDATE          | 既有端点扩展 group=scm（复用）                                    |
| `GET /api/v1/orgs/{orgId}/scm-apps`                                                      | withOrgScope + ORG_INTEGRATION:READ              | 解析结果（source=org\|system\|none，clientSecret 只回 hasSecret） |
| `PUT/DELETE /api/v1/orgs/{orgId}/scm-apps/{provider}`                                    | withOrgScope + ORG_INTEGRATION:UPDATE            | 组织覆盖/撤销覆盖                                                 |
| `GET /api/v1/orgs/{orgId}/scm/oauth/{provider}/start`                                    | withOrgScope（成员即可）                         | 302 平台 authorize                                                |
| `GET /api/v1/orgs/{orgId}/scm/oauth/{provider}/callback`                                 | 无登录态要求（state 一次性校验）                 | 换 token→账号入库→302 回前端                                      |
| `GET /api/v1/orgs/{orgId}/scm-accounts`；`DELETE /api/v1/orgs/{orgId}/scm-accounts/{id}` | withOrgScope；撤销=本人或 ORG_INTEGRATION:UPDATE | 授权账号列表/撤销                                                 |
| `GET /api/v1/orgs/{orgId}/scm-accounts/{id}/repos?keyword=&page=&pageSize=`              | withOrgScope（成员）                             | 平台仓库列表（聚合分页信封）                                      |
| `GET/POST /api/v1/projects/{projectId}/scm-repos`                                        | withProjectScope PROJECT_REPO:READ/CREATE        | 列表/绑定（两种来源）                                             |
| `PATCH/DELETE /api/v1/projects/{projectId}/scm-repos/{repoId}`                           | PROJECT_REPO:UPDATE/DELETE                       | 编辑/软删                                                         |
| `POST /api/v1/projects/{projectId}/scm-repos/{repoId}/verify`                            | PROJECT_REPO:UPDATE                              | 验证+元信息刷新                                                   |

- 错误码（40xxx file 族顺延空档）：`SCM_REPO_NOT_FOUND 40470`(404)、`SCM_APP_NOT_CONFIGURED 40471`(422)、`SCM_OAUTH_STATE_INVALID 40472`(422)、`SCM_VERIFY_FAILED 40473`(422)、`SCM_REPO_LIMIT_EXCEEDED 40475`(422)、`SCM_REPO_URL_BLOCKED 40477`(422)、`SCM_ACCOUNT_NOT_FOUND 40478`(404)、`SCM_PROVIDER_ERROR 40479`(502)；toResponse 分段映射同步登记。
- 服务层：`domains/scm/scm-app.service.ts`（双层解析/系统组读写加密）、`scm-oauth.service.ts`（state/authorize URL/换 token/刷新/upsert 账号/选仓列表）、`scm-repo.service.ts`（绑定 CRUD/默认互斥/verify）；`git-adapters.ts` 扩展 `parseScmRepoUrl`（含 ssh）+ `getRepoDetail`（元信息：github `repos/{o}/{r}`+`commits?per_page=1`、gitee 同形、gitlab `projects/{o/r}`+`repository/commits`、gitea `repos/{o}/{r}`+`commits?limit=1`），FetchLike 注入可测。
- 出站：模块级 `SCM_DISPATCHER = outboundDispatcher({ allowPrivate: process.env.OUTBOUND_ALLOW_PRIVATE === "1" })` + `assertSafeOutboundUrl`（解析期），fetch 表达式零 env 读取（§8.6 形态）；仅 http/https。
- 前端：`settings/code-repos/page.tsx`、`system/scm-apps/page.tsx`、integrations 页区块、nav-config 两处注册；api-client `s13.ts`（scmAppApi/scmAccountApi/scmRepoApi）。

## 5. 测试用例

| 用例                                                                                                                                                                                | 文件                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 单测：URL 解析矩阵（https/ssh/custom/端口/GHE）+ getRepoDetail 请求形态（fetch mock）                                                                                               | `apps/web/src/server/domains/scm/__tests__/scm-url.test.ts`             |
| 单测：SSRF 真实守卫链路（169.254/环回 → 40477 映射；jm/e2e 栈开 OUTBOUND_ALLOW_PRIVATE 故栈上不可测） | `apps/web/src/server/domains/scm/__tests__/scm-url-blocked.test.ts` |
| 单测：App 双层继承解析（org 覆盖/继承 system/均无）+ secret 保留语义                                                                                                                | `apps/web/src/server/domains/scm/__tests__/scm-app.test.ts`             |
| 单测：state 一次性消费/过期、token 交换错误映射、gitlab 401 刷新一次                                                                                                                | `apps/web/src/server/domains/scm/__tests__/scm-oauth.test.ts`           |
| 单测：绑定 CRUD/上限 10/默认互斥与删除补位/verify 状态机/凭据加密不回显（含 password 平台矩阵提示）                                                                                 | `apps/web/src/server/domains/scm/__tests__/scm-repo.test.ts`            |
| jmx 四类：绑定 CRUD+verify 主链；401/403（无 PROJECT_REPO:CREATE）/404（越域项目+坏 repoId）；422（非法 URL/私网 URL/超上限/坏 authType）；列表 `{total,items}` 信封 + 授权账号列表 | `tests/api/SCM-001-scm-repos.jmx`                                       |
| e2e SCM-001-01 URL 直填添加 + verify 成功（mock gitea）+ 卡片字段与元信息展示                                                                                                       | `tests/e2e/SCM-001-project-repositories.spec.ts`                        |
| e2e SCM-001-02 OAuth 全流（mock 平台 authorize 同意页 → 回跳 → 账号入库 → 选仓绑定）                                                                                                | 同上                                                                    |
| e2e SCM-001-03 凭据失效二态（mock 401 → INVALID_CRED 红徽标）+ token 掩码（编辑不回显/响应无明文——接口断言）                                                                        | 同上                                                                    |
| e2e SCM-001-04 默认仓库切换互斥 + 删除 + 空态二态                                                                                                                                   | 同上                                                                    |
| e2e SCM-001-05 有权/无权二态（无 PROJECT_REPO:READ 成员不见设置菜单项）+ 系统/组织 App 配置继承三态展示                                                                             | 同上                                                                    |
| mock：三平台 OAuth（authorize 同意页/token/user/repos）+ repos 元信息端点                                                                                                           | `apps/mock/src/scm-mocks.ts`（挂 `/mock-scm/{provider}`，env 覆盖指向） |
| 视觉快照 + 还原度比对                                                                                                                                                               | `pnpm test:visual` / `visual:diff`（GLM_API_KEY）                       |

## 6. 非目标（显式排除）

- webhook 推送触发（push 事件→测试计划）、代码克隆/分支浏览/文件拉取（FILE-001 已覆盖文件拉取）、AI 代码分析联动、镜像/定时同步——Backlog 后续规格；
- GitHub Enterprise / Gitea 的 OAuth 授权（两者 URL 直填+Token 可用；OAuth 仅官方域 github.com/gitee.com/gitlab[.com 或自建]）；
- 跨组织共享授权账号（账号 org 内共享）、按仓库细粒度权限（沿用 PROJECT_REPO 点）；
- ssh 协议直连验证（不引 git 二进制，不出站 ssh——已知平台走 REST，custom 仅保存）。

## 7. 验收标准

§1.2 全部 P1 能力行有对应用例且全绿；`pnpm test` / `test:api` / `test:e2e` 三件套 + 远端 CI 全绿；OpenAPI 快照 diff 过 CI 校验；走查对照原型（布局/交互/状态二态/边界裁剪）通过后翻 Verified。

## 8. 勘误登记

无。
