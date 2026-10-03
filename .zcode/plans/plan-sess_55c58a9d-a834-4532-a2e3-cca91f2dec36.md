# SCM-001 项目代码仓库绑定 — 实施方案

## 已确认的决策（你拍板）

1. **独立新模块 SCM-001**：FILE-001「Git 存储库」（文件管理用，资源文件拉取）保持不动，两处文档互相登记引用
2. **OAuth 应用双层配置**：系统级配置为底座，组织级可覆盖（覆盖后用组织自己的 App）；组织未配置时自动继承系统级；组织级只能增删自己的覆盖，不能改系统级配置（权限天然隔离：`SYSTEM_PARAM:UPDATE` vs `ORG_INTEGRATION:UPDATE`）
3. **多仓库**：每项目上限 10 个（对齐 FILE_REPO_LIMIT），标记一个默认仓库
4. **v1 边界 = 配置 + 连通性验证 + 仓库元信息**（默认分支/可见性/最近提交）；webhook 触发、代码克隆/浏览、AI 代码联动登记 backlog
5. 说明：Gitee 与码云是同一平台；GitLab 支持自建实例（填实例地址）；同时把 FILE-001 已支持的 gitea 纳入 URL 直填范围（适配器现成）

## 一、文档与流程（按仓库门禁顺序）

1. 新建 `docs/sprint-13-scm/SCM-001-project-repositories.md`（Draft）+ `sprint-overview.md`。章节用 SYS-010 新式骨架（§0 元信息含高保真确认字段 / §1.2 能力行 / §5 用例表 / §6 非目标 / §7 验收）；「对标基线」登记 **超出 MeterSphere 基线**（社区版无此原生功能，§8.3 存储库对接=FILE-001）；关联登记 FILE-001、INTG-001。**你评审通过后翻 Approved**
2. 高保真原型 `docs/design/SCM-001-project-repositories/`（静态 HTML+Tailwind）→ **你确认后翻 Prototyped，编码才开始**（门禁 2 铁律）
3. 因主仓当前在 INFRA-011 分支，开发走 **worktree + 分支 `feat/SCM-001-project-repositories`**（S10 多会话教训）

## 二、数据模型（prisma schema 一次建齐；String+应用层 zod 枚举惯例）

- **`scm_org_apps`**（组织级 OAuth App 覆盖）：orgId、provider(github|gitee|gitlab)、baseUrl(自建 GitLab)、clientId、clientSecret(AES-GCM 密文)、enabled，`@@unique([orgId, provider])`。系统级配置存 `SystemParam` group=`scm`（沿用 param.service 的 secret 加密先例）
- **`scm_accounts`**（成员 OAuth 授权，org 内共享）：orgId、userId(授权人)、provider、baseUrl、login/name/avatarUrl、tokenEnc(AES-GCM)、expiresAt、scopes、status(ACTIVE|EXPIRED|REVOKED)、软删
- **`scm_repositories`**（项目仓库绑定，核心表）：projectId、name、provider(github|gitee|gitlab|gitea|custom)、repoUrl(https 或 ssh 原始地址)、sshUrl、host/owner/repo/apiBase(解析缓存)、authType(none|oauth|token|password)、accountId(OAuth 时)、username(账密时)、secretEnc(token/密码密文)、defaultBranch/visibility(未启用元信息列，一次建齐)、isDefault、verifyStatus(UNVERIFIED|OK|FAILED|INVALID_CRED)、verifyMessage、lastVerifiedAt、createdById、软删。webhook 类列不预建，规格中登记理由（v1 边界明确排除）

## 三、API 面（REST /api/v1，zod 进 packages/shared，信封/错误码分段对齐 api-conventions）

- 系统级：`GET/PUT /api/v1/system/scm-apps`（`SYSTEM_PARAM:*`；clientSecret 只回 hasSecret）
- 组织级：`GET /orgs/[orgId]/scm-apps`（返回解析结果 source=org|system|none）、`PUT/DELETE /orgs/[orgId]/scm-apps/[provider]`（`ORG_INTEGRATION:*`）
- OAuth 流（仿 sso-flow.service）：`GET /scm/oauth/[provider]/start?orgId=`（Redis state 5min 一次性，302 平台）→ `GET /scm/oauth/[provider]/callback`（换 token → 拉用户信息 → upsert scm_accounts → 302 回前端）；`GET /orgs/[orgId]/scm-accounts` + `DELETE /scm/accounts/[id]`（撤销：授权人本人或 org 管理员）
- OAuth 选仓：`GET /scm/accounts/[id]/repos?keyword=&page=`（用授权 token 拉平台仓库列表，分页信封）
- 项目绑定（`withProjectScope` + 新权限点 `PROJECT_REPO:READ/CREATE/UPDATE/DELETE`，同步 PRESET_GROUP_PERMISSIONS）：`GET/POST /projects/[projectId]/scm-repos`（POST 两种来源：oauth{accountId,owner,repo} 或 url{provider,repoUrl,authType,凭据}）、`PATCH/DELETE .../[repoId]`、`POST .../[repoId]/verify`（验证+刷新元信息）
- 新错误码 4047x 段（NOT_FOUND/APP_NOT_CONFIGURED/OAUTH_STATE_INVALID/VERIFY_FAILED/URL_BLOCKED/超上限）
- 新增 route 后跑 `node scripts/gen-openapi.mjs` 重生成快照；api-client 手写新增 `s13.ts`

## 四、前端 UI 与原型

- **项目设置新 tab「代码仓库」** `/settings/code-repos`（nav-config pset 组，perm=PROJECT_REPO:READ）：仓库卡片列表（平台徽标/owner/repo/认证方式/验证状态徽标+时间/默认标记）+「添加仓库」抽屉双方式：①平台授权（选已授权账号或发起授权 → 仓库搜索分页列表选择）②URL 直填（https/ssh 自动识别 provider + authType 切换：无凭据/Token/账号密码）；行操作：验证/编辑/设默认/删除；已授权账号管理入口（授权/撤销/展示授权人）
- **系统设置新页「代码平台」**：三平台 clientId/clientSecret 配置（GitLab 带实例地址）
- **组织服务集成页**加「代码平台（OAuth 应用）」区块：显示继承状态（使用系统级/组织自定义/未配置）+ 覆盖/撤销覆盖
- 状态二态：空/有、有权/无权（成员无 PROJECT_REPO:READ 时 tab 隐藏）、验证 OK/凭据失效/未验证

## 五、安全设计（对齐 Mimosa 约束与 rules/security）

- 全部凭据（client_secret、OAuth token、PAT、密码）经 `credential-crypto.ts`（AES-256-GCM，env `RABBIT_INTEGRATION_SECRET`，命名空间 scm-app:/scm-account:/scm-repo: + provider）加密落库，接口只回 hasSecret/掩码/登录名，永不回显明文；源码/示例/测试零可用凭据字面量
- 所有出站请求（OAuth 换 token、仓库列表、验证）过 `assertSafeOutboundUrl`（解析期）+ `outboundDispatcher`（连接期，模块级常量、fetch 表达式零 env 读取——§8.6 形态）；仅 http/https，拒绝环回/私网/元数据地址
- OAuth state Redis 一次性消费防 CSRF；redirect_uri 以发起 origin 构造（仿 SSO）；平台 API 域名单一事实源进 shared（仿 PLATFORM_META），支持 env 覆盖指向 mock（e2e 用）
- ssh URL 仅做解析（git@host:owner/repo.git 与 ssh:// 形态）绝不出站；已知平台解析出 owner/repo 后验证走平台 REST；custom 未知域名 ssh 仅保存（UNVERIFIED）
- 全端点权限包装 + recordAudit（绑定增删改/授权/撤销/App 配置）

## 六、测试计划（门禁 7/8：Vitest + JMeter + Playwright 全交付）

- **Vitest**：URL 解析（https/ssh/自建 GitLab）、加密与脱敏、App 继承解析、state 机、CRUD/上限/默认互斥/verify 状态机（FetchLike 注入式，git-adapters 已是此形态）
- **JMeter** `tests/api/SCM-001-scm-repos.jmx`：四类场景（正常/401·403·404 越域/422/列表信封）× 四项断言；登录走既有 fixtures
- **Playwright** `tests/e2e/SCM-001-project-repositories.spec.ts`：三类断言（UI+Console+expectApi）；apps/mock 扩展 OAuth + 仓库列表 mock（仿 s9-sso-mocks/s5-mocks）；用例覆盖：URL 直填添加+验证成功/失败二态、OAuth 授权全流、凭据脱敏、默认切换、空/有、有权/无权
- 视觉快照 `pnpm test:visual` + `visual:diff`（需 GLM_API_KEY）归档 PR

## 七、实施顺序与交付

1. 规格文档（Draft→你评审→Approved）→ 2. 高保真原型（→你确认→Prototyped）→ 3. worktree+分支 → 4. 编码：prisma migration → shared(schemas/permissions/错误码/平台元数据) → service(scm-app/scm-oauth/scm-repo，扩展 git-adapters) → routes → api-client → UI → gen-openapi → 5. 三件套测试本地全绿 → push、远端 CI 全绿 → 6. PR（链接规格+原型确认+测试证据+截图+migration 说明；超 400 行则按 schema/后端与前端拆双 PR）→ 合并 main → sprint-overview 交付表 + CHANGELOG → 7. 你对照原型走查 → Verified

- 复用清单：git-adapters.ts、credential-crypto.ts、outbound-guard.ts + outboundDispatcher、sso-flow.service.ts(OAuth 流模板)、SystemParam/param.service、PlatformIntegration 先例、mock 栈三套先例
