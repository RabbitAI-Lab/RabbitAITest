# rules/database.md — 数据库与 SQL 规范（PostgreSQL 16 + Prisma + embedded-postgres）

> 由 AGENTS.md §2 引用。实体清单与「一次建齐」原则见 `docs/architecture/test-domain-model.md`（实体从哪来）；本文件回答**怎么写**（schema 怎么建、SQL 怎么写、迁移怎么做）。

## 1. 总则

1. **schema 唯一来源**：`packages/db/prisma/schema.prisma`。禁止绕过 Prisma 手改数据库结构；一切 DDL 走 `prisma migrate`。
2. **数据访问唯一出口**：只有 `apps/web/src/server` 可用 PrismaClient；engine / mock / plugin-runner 禁止直连数据库（AGENTS.md 门禁 5）。
3. 跨域引用经 Provider 接口，不做跨域 FK（test-domain-model §3）；多态引用列 `(ref_type, ref_id)` 是唯一例外形态。

## 2. 命名规范

| 对象 | 规则 | 示例 |
| --- | --- | --- |
| 表（Prisma `@@map`） | snake_case 复数 | `functional_cases`、`exec_step_results` |
| 列（`@map`） | snake_case；布尔 `is_/has_`；时间 `_at`；日期 `_date` | `deleted_at`、`plan_end_date` |
| 主键 | `id UUID`，应用侧生成（便于测试造数与跨服务传递）；项目内展示编号另设 `num` | — |
| 索引 | `idx_{表}_{列…}`；唯一 `uq_{表}_{列…}`；外键索引同 IDX 命名 | `idx_cases_project_deleted` |
| 枚举值 | 存 `varchar`，取值 SCREAMING_SNAKE，登记于 packages/shared zod；**不用 PG ENUM**（迁移改名/删值痛苦）；稳定且高频的状态列可加 CHECK 约束 | `status = 'IN_REVIEW'` |

## 3. 类型规范

1. 时间一律 `timestamptz(3)` 存 UTC，前端本地化展示；禁止 `timestamp without time zone`。
2. JSONB 边界：**动态/配置型数据**（模板字段值 `fields`、用例步骤 `steps`、请求体 `request`、环境 `config`、事件 `payload`）用 `Json`；**会被 WHERE/JOIN/排序的字段必须是独立列**（如 `status`、`level`、`module_id` 不得埋进 JSONB）。
3. 禁止 float 存金额/计数（用 `Decimal`/`BigInt`）；varchar 必须显式长度（名称类 512、URL 类 2048）。
4. 外键必须显式声明（`onDelete` 行为必须写明：业务主体默认 `Restrict` + 软删；横切表（评论/关注/引用）用 `Cascade`）。
5. 软删除：业务主体带 `deleted_at`，查询经统一过滤器默认排除；「彻底删除」单独端点物理删除。

## 4. 索引规范

1. 每个外键列必须有索引；高频列表查询建复合索引且遵循最左前缀：`(project_id, deleted_at, {常用筛选列}, created_at)`。
2. JSONB 动态字段的筛选列才建 GIN；某动态字段成为高频筛选时，先评估提冗余列（在规格文档中登记决策），不为低频筛选建 GIN。
3. 唯一约束显式声明（如 `(project_id, num)` 唯一、模块下场景名唯一）；唯一约束即业务规则，写进规格 §2。**唯一约束必须考虑重提交幂等**：并发/重复提交撞唯一键时按「差分写/条件更新（先查差集或 ON CONFLICT）」处理，禁止无条件全量重写（历史教训：重叠重提交曾撞无条件唯一键报错）。
4. **schema 变更必须同步全部裸 SQL/种子/脚本**：任何加列（尤其 NOT NULL）后，种子数据、清场脚本、流程脚本中的裸 SQL 必须同 PR 更新——历史教训：加列后脚本裸 SQL 未同步，每夜回归全红。
5. 索引随 migration 一次建齐（一次建齐原则）；新增索引须评估写入放大（写多读少表慎用）。

## 5. 查询与写入规范

1. **禁止字符串拼接 SQL**；`$queryRaw/$executeRaw` 仅限三类场景：advisory lock 编号、批量写（>100 行）、特殊聚合（报告统计），且必须用标签模板参数化（防注入），并附注释说明为何不能用 ORM。
2. **N+1 禁止**：关联读取显式 `include/select`；Code Review 与 CI（query 计数）双查。
3. 分页：
   - 列表接口统一 `findMany + count` 偏移分页（上限 100 页，超出提示收敛筛选）；
   - 引擎拉取任务、导出、事件回放等大遍历必须用 **keyset 分页**（`WHERE (created_at, id) > (lastCreatedAt, lastId) ORDER BY … LIMIT n`）。
4. 事务：`$transaction` 显式短事务；**事务内禁止外部 HTTP/三方调用**（缺陷同步、发消息一律事务提交后）；长事务（>1s）视为缺陷。
5. 批量写：`createMany/updateMany`，单批 ≤ 1000 行分批提交；数据清理任务（日志/变更历史）按保留时长分批删除，禁止一条 DELETE 全表。
6. 乐观锁：编辑型实体（用例/接口/场景/计划/缺陷）带 `version`，更新 `WHERE version = ?`，命中 0 行返回 409（api-conventions §4）。
7. advisory lock 编号生成固定模式：事务内 `SELECT pg_advisory_xact_lock(hashtext('{table}'), {projectId})` 后取 `max(num)+1`（test-domain-model §4）。
8. `SELECT *` 禁止：列表/详情查询显式列（Prisma `select`）；大 JSONB 列（steps/request/payload）列表场景不取，详情按需取。
9. 报告列表统计只在 `ExecItem` 级冗余列上聚合，禁止列表页实时扫 `ExecStepResult` 事件表。

## 6. Migration 纪律

1. 「一次建齐」：核心表在 INFRA-003 建齐全部列（含未启用列）；后续新增列必须在规格文档说明「为何初期无法建齐」并过架构评审（AGENTS.md 门禁 3）。
2. migration 一经合并**不可修改**，只能新增；命名 `{MODULE}-NNN-{slug}`（与规格编号对应，可追溯）。
3. 禁止破坏性变更直上：删列/改类型/加非空默认 → 走 **expand-contract**（先加新列双写 → 迁移数据 → 切读 → 删旧列），每步独立 migration + 评审。
4. migration 与消费代码同 PR；CI 对空库做全量 migration 重放验证 + `prisma migrate diff` 快照一致性检查。
5. 种子数据（`prisma/seed.ts`）幂等，可重复执行；测试数据只用 seed 或测试自建，禁止依赖手工库。

## 7. embedded-postgres 与环境

1. 开发/单机：embedded-postgres 自动初始化（数据目录 `.pgdata`，gitignore）；禁止代码依赖 embedded 特有路径、端口或超级用户能力。
2. 外接模式：`DATABASE_URL` 指向标准 PostgreSQL 16（版本与 embedded 对齐，升级前双环境跑 migration 重放）。
3. 测试隔离：单测/集成测试每 worker 独立库（embedded 起多实例或 TEMPLATE 库克隆）；E2E 用独立 embedded 实例 + seed。
4. 备份恢复：`deploy/backup.sh`（pg_dump）与恢复脚本，属 INFRA-004 验收项；embedded 模式备份同样基于 pg_dump。

## 8. 安全与合规

1. 密钥类（插件密码/SMTP/token）Secret 表存储：加密落库、接口不回显明文、日志脱敏。
2. 审计日志与变更历史**只插入不更新**（应用层禁止 UPDATE/DELETE 审计表）。
3. 敏感导出（报告/用例导出）记录审计事件；分享快照不含 Secret 字段。

## 9. 性能红线（QA-001 基线验收）

| 场景 | 红线 |
| --- | --- |
| 万级数据列表筛选 | P95 < 500ms（EXPLAIN 无 Seq Scan on 大表） |
| 详情页 | P95 < 300ms，大 JSONB 按需取 |
| 报告列表聚合 | P95 < 1s，item 级冗余列聚合 |
| 单查询返回行数 | ≤ 1000（超出走游标/分批） |
