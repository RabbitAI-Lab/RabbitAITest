# INFRA-006 RLS 租户纵深防御（row-level security tenant defense-in-depth）

## 0. 元信息

| 项       | 值                                                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | Draft → Implemented（分支 `INFRA-006-rls-tenant-isolation`，基线 main 837eebd，2026-09-29）                                                                             |
| 模块     | INFRA（数据层安全加固，无产品面/无 UI 变更）                                                                                                                            |
| 评审方式 | 纯后端规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——方案于 2026-09-29 会话调研产出、经用户目标式授权「按照建议做吧」后实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/database.md §7（RLS 纪律，本规格新增）· rules/security.md（越权防御）· AGENTS.md 门禁 3/5                                                                         |

## 1. 问题（为什么必须做）

租户抽象（调研结论 2026-09-29）：**Organization = 租户**，维持 Pool 模式（共享库 + 共享 Schema + `org_id`/`project_id` 列隔离）不引入新 Tenant 层——对标 MeterSphere 12.1 口径（组织即最高业务边界）且零业务表 DDL。

现状短板：**隔离 100% 依赖应用层单防线**。

- 284 个路由文件经 `withProjectScope`(211)/`withOrgScope`(24)/`withSystemPerm`(28) 包装做成员校验与权限集注入，子资源查询依赖服务层自觉带 `where: { id, projectId }` 复合条件（如 case.service.ts:103）；
- 任何一处漏写 `projectId` 条件、或未来新端点忘套 guard，即跨租户数据泄漏，**数据库层零兜底**；
- PostgreSQL 行级安全（RLS）从未启用（全仓 grep 无 `ROW LEVEL SECURITY`）。

本规格在应用层防线之下补第二道数据库层防线（defense-in-depth）：**漏过滤的查询在数据库层返回零行、越租户写入被 `WITH CHECK` 拒绝**，单防线缺陷不再直接等于数据泄漏。

## 2. 方案

### 2.1 隔离粒度与断路语义

- **租户 = 组织（org）**，非项目：同组织跨项目访问（计划组跨项目、脑图跨项目引用等）是合法行为，RLS 不拦；仅跨组织拦截。
- 双客户端双角色：
  - `admin` 客户端 = 现状 `DATABASE_URL` 连接（表 owner/超级用户，PostgreSQL 对 owner 不应用 RLS）——系统级/个人/分享/引擎回调/任务/job/seed 全部走它，**行为与今天完全一致**；
  - `tenant` 客户端 = 新建非 owner 登录角色 `rabbit_tenant`——仅组织/项目作用域请求路径使用，事务内 `SELECT set_config('app.tenant_id', orgId, true)`（事务级）后，策略按组织过滤。
- **断路语义（tripwire）**：`rabbit_tenant` 角色上，策略谓词以 `app_tenant_id()`（`NULLIF(current_setting('app.tenant_id', true), '')::uuid`）为锚——**未设置租户上下文的查询返回零行、写入被拒**（宁可漏读不可串读）。
- 不使用 `FORCE ROW LEVEL SECURITY`：owner（admin 通道）豁免是设计的一部分，而非缺陷。

### 2.2 策略覆盖面（三类谓词）

迁移 `20260929120000_s10_rls_tenant_isolation`（零业务表 DDL，仅函数 + ENABLE + POLICY，共 **51 表**；策略 `TO PUBLIC` 默认拒绝——owner/admin 豁免，且规避迁移期角色存在性依赖）：

1. **直连 org_id 表**（`org_id = app_tenant_id()`）：`organizations`（特例 `id = app_tenant_id()`）、`org_members`、`projects`、`departments`、`platform_integrations`；
2. **直连 project_id 表**（`EXISTS (SELECT 1 FROM projects p WHERE p.id = <t>.project_id AND p.org_id = app_tenant_id())`）：`project_members`、`module_nodes`、`environments`、`env_groups`、`global_params`、`file_items`、`file_repos`、`public_scripts`、`false_alarm_rules`、`app_settings`、`user_preferences`、`functional_cases`、`case_reviews`、`test_plans`、`bugs`、`attachments`、`platform_sync_configs`、`api_definitions`、`api_cases`、`scenarios`、`exec_tasks`、`reports`、`ai_prompt_templates`、`ai_gen_records`、`robots`；
3. **组织/项目双键表**（`org_id = T OR 项目 ∈ T`）：`groups`（含系统组豁免：`org_id IS NULL AND project_id IS NULL`——`permissionSetFor` 权限解析依赖系统预置组）、`templates`、`field_defs`、`message_templates`；
4. **父链表**（单/双跳 EXISTS，谓词与父表一致）：
   - `group_members`→groups、`department_members`→departments、`workflow_states`/`workflow_transitions`→templates；
   - `review_cases`→case_reviews、`case_dependencies`→前后置两用例、`case_demand_refs`/`case_api_refs`→用例、`bug_case_refs`→缺陷；
   - `test_points`/`plan_case_refs`→test_plans、`api_mocks`→api_definitions、`scenario_steps`→scenarios；
   - `exec_items`→exec_tasks、`exec_step_results`→exec_items→exec_tasks（双跳）、`report_shares`→reports、`false_alarm_hits`→reports。

每表单条 `CREATE POLICY tenant_isolation ... FOR ALL TO rabbit_tenant USING (...) WITH CHECK (...)`。

### 2.3 显式排除面（v1 边界，Backlog 登记）

| 表                                                                                                                | 原因                                                                                                     | 防线                                                                           |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `comments` / `change_logs` / `follows`                                                                            | 多态 `entity_type + entity_id` 无租户列，策略谓词依赖实体类型枚举完备性（新实体类型即漏），不稳健        | 应用层 entityId 过滤（现状）；Backlog：去规范化 `org_id` 列（门禁 3 例外流程） |
| `notifications` / `ai_conversations` / `ai_messages`                                                              | 个人域（userId 归属），无组织边界语义                                                                    | 个人守卫 + 应用层 userId 过滤                                                  |
| `users` / `auth_sources` / `resource_pools` / `plugins` / `system_params` / `licenses` / `api_keys` / `ai_models` | 全局/系统/个人凭据表，本就跨租户共享或系统级                                                             | 系统级守卫与权限点                                                             |
| `audit_logs`                                                                                                      | `project_id` 可空且无 `org_id` 列——组织级审计行（如 org.create）在租户上下文内写入会被 `WITH CHECK` 拒绝 | 系统守卫（admin 通道）+ 审计服务集中出口                                       |

### 2.4 运行时接线

- `packages/db` 保持全仓唯一出口，导出不变：`prisma` 从裸 PrismaClient 换为**门面（Proxy）**——有租户上下文时把模型委托、`$queryRaw/$executeRaw*`、`$transaction`（平铺并入请求事务，Prisma 不支持嵌套交互事务）路由进 ambient 事务；无上下文时直连 admin 客户端（现有 20 个服务文件的 `$transaction` 与 3 处 raw SQL 零改动）。
- `runWithTenantContext(orgId, fn)`：在 tenant 客户端开**一条交互事务**（timeout 60s）→ `set_config` → ALS 注入 → 执行 fn → 提交。**一次请求 = 一条事务**（原子性增强；`nextNum` advisory xact lock 语义不变）。
- guard 接线：`withProjectScope`/`withOrgScope` 在成员校验与 `permissionSetFor`（均在 admin 上，RLS 不影响权限解析）之后，以 `runWithTenantContext(project.orgId/orgId, () => handler(...))` 包裹 handler。
- **admin 通道（不设租户上下文，行为不变）**：`withAuth`（personal/share/stream SSE）、`withSystemPerm`、`withInternalToken`（engine 回调）、`withApiKey`（开放 API——v1 边界：依赖 `assertProjectVisible` 成员校验，登记 Backlog 接租户上下文）、BullMQ jobs、seed、全部脚本。
- **角色引导 `ensureTenantRole()`**：进程首次进入租户路径时以 admin 连接执行幂等引导——`rabbit_tenant` 角色（embedded/CI：随机口令 `crypto.randomBytes`，不落任何字面量；外部库：`RABBIT_PG_TENANT_PASSWORD` 环境变量）+ `GRANT SELECT/INSERT/UPDATE/DELETE ON ALL TABLES` + 序列 + `ALTER DEFAULT PRIVILEGES`（覆盖未来迁移新建表）。失败（外部托管库无 CREATEROLE 权限等）→ **降级模式**：tenant=admin、RLS 不生效，一次性 warn 日志 + 指标计数，行为回到纯应用层防线（与今天一致），绝不因加固项阻断启动。

### 2.5 非目标（明确不做）

- 不做 schema-per-tenant / db-per-tenant（调研结论：与 embedded-postgres 单机形态、Prisma 单连接模型冲突；强隔离需求走「每租户一套部署」）；
- 不引入 Tenant 实体层（对标口径 + 门禁 3）；
- 不改任何 HTTP 契约、不改任何 UI——对前端与 api-client 零感知；
- 不给排除面表格补列（走 Backlog 门禁 3 例外流程）。

## 3. 技术架构

```
请求 ── withProjectScope/withOrgScope ──┬─ 成员/权限校验（admin，RLS 不参与）
                                        └─ runWithTenantContext(orgId)
                                             └─ tenant.$transaction
                                                  ├─ set_config('app.tenant_id', orgId, local)
                                                  └─ handler → services → prisma 门面 → ambient tx（rabbit_tenant 角色，RLS 生效）
系统/个人/分享/内部回调/job/seed ──────── admin PrismaClient（owner，RLS 豁免，现状不变）
```

- 文件：`packages/db/src/tenant.ts`（ALS + 门面 + 双客户端 + 引导）、`packages/db/src/index.ts`（prisma 换门面，导出面不变）、`apps/web/src/server/guard/index.ts`（两守卫各 +1 行包裹）。
- 迁移：`packages/db/prisma/migrations/20260929120000_s10_rls_tenant_isolation/migration.sql`。
- 验证脚本：`scripts/rls-verify.mjs`（连 `DATABASE_URL`，建双租户夹具 → tenant+set_config 断言正/负/断路三类 → admin 旁路断言 → 清场），接入 CI `migrate-replay` job。
- 错误码：无新增（RLS 拒绝对外表现为应用层既有 404/空集语义，这正是防御目的）。

## 4. 契约与兼容性（接口契约评审面）

1. **行为兼容**：全部既有单测（mock prisma，不感知门面）、jmx 70 计划、e2e 131+ 用例必须全绿——RLS 只收紧「本就越权」的路径，合法路径结果不变；
2. **`prisma` 导出面不变**：类型仍为 PrismaClient（门面 Proxy 断言），`nextNum`/`presets`/`Prisma` 导出不动；
3. **事务语义**：项目/组织作用域请求内全部查询并入单条交互事务（原来每条查询独立自动提交）——回滚粒度变粗是**有意的**（请求级原子性）；超时 60s/等待 5s；
4. **连接预算**：tenant 池 `connection_limit=20` + admin 池默认（≈9），embedded PG max_connections=100 内；
5. **降级模式可观测**：`db.rls.degraded` 一次性 warn + `GET /api/v1/health` 不变（健康检查不走 DB）。

## 5. 测试用例

| 编号         | 类型                                              | 内容                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| INFRA-006-T1 | JMeter `tests/api/INFRA-006-tenant-isolation.jmx` | 四类×四断言：正常路径（双组织各自建项目+用例互不可见）；401（未登录）/403（跨组织用户无成员关系→404 防枚举）/404（B 组织成员直查 A 组织项目资源）；422（跨组织 projectId 写入被拒——B 用户对 A 项目无权限点 403 与 RLS 拒绝双层）；分页信封（本组织列表仅本组织数据） |
| INFRA-006-T2 | rls-verify（CI migrate-replay 步骤）              | 策略级断言：双租户夹具下 tenant+T_A 只见 A 行、insert B 项目行被 `42501` 拒、unset 上下文零行、admin 全量可见、排除面表（comments）不受策略影响                                                                                                                      |
| INFRA-006-T3 | Vitest `packages/db/src/__tests__/tenant.test.ts` | 门面路由逻辑（mock 双客户端）：无 ambient→admin 直连；有 ambient→委托路由；`$transaction` 回调平铺/数组顺序执行；事务结束后查询回落 admin+计数                                                                                                                       |
| e2e          | 豁免登记                                          | 纯数据层加固无 UI 能力行，不新增 Playwright 用例；以全量 e2e 回归（131+ 用例双分片）作为行为兼容性证据                                                                                                                                                               |

## 6. 竞品/业界对标

- 三模式谱系（Pool/Bridge/Silo）：AWS SaaS 构建指南与社区共识——Pool 成本最低、隔离最弱，须以 RLS 补数据库层防线；本项目选 Pool + RLS defense-in-depth 是 Prisma + embedded-postgres 栈的标准解（Prisma 无原生 RLS，通行做法即应用层过滤 + PG 层策略双层）。
- MeterSphere：无 SaaS 多租户，组织即租户语义已由 ENTP-001 复刻；本规格不改变该口径，只加固其数据面。

## 7. 里程碑与验收

- DoD：本规格 §5 三项测试交付 + 全量回归绿 + CI 全绿（含 migrate-replay 新增 rls-verify 步骤）。
- 契约冻结点：策略表清单（§2.2/§2.3）与 `app.tenant_id` GUC 名——后续任何表新增必须同步策略（写入 rules/database.md §7 纪律）。

## 8. 勘误登记

无。
