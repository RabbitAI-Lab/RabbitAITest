# 审计日志（withAudit 高阶函数 · 三级操作日志）

| 元信息项     | 内容                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | SYS-008                                                                                                                          |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                            |
| 优先级       | P2（迭代内）                                                                                                                     |
| 所属模块     | 系统设置（sys 域）+ 横切（全部写端点）                                                                                           |
| 文档状态     | Approved                                                                                                                         |
| 最后更新日期 | 2026-09-27                                                                                                                       |
| 上游依赖     | AUTH（session 用户态）、BullMQ（异步落库）、SYS-005（系统参数/数据清理先例）                                                       |
| 下游消费     | S8 QA-002（安全加固审计面）、排障包（observability.md）                                                                           |
| 上游依据     | 需求文档 §二「三级操作日志」、§八「操作审计」；功能清单 §9.1 系统日志、§8.7 项目日志、§9.2 组织日志、§9.1 数据清理（日志保留时长）   |
| 对标基线     | 功能清单 §9.1：「系统日志：权限范围内全量操作日志+高级查询」；233 行「数据清理（日志保留时长）」                                    |
| 关联架构文档 | api-conventions.md §4（withAudit 预定契约）；observability.md；test-domain-model.md §2（AuditLog 已建模）                          |
| 高保真确认   | 待确认（原型 docs/design/SYS-008-audit-log/）                                                                                     |
| 工作量估算   | 后端 4 人日 / 前端 2 人日                                                                                                        |

## 1. 概述

### 1.1 功能定位

落地 api-conventions §4 预定的 `withAudit()` 高阶函数：写端点声明式审计（操作人/动作/对象/快照摘要/IP），BullMQ 异步批量落库；三级查询面（系统/组织/项目日志页，按权限范围过滤）；日志保留时长系统参数+每日清理。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                             | P1 ✅ | 后续                                              |
| ------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------- |
| withAudit(action, objectType) 包装器：handler 成功后投递审计事件（失败请求记 action+error 摘要）    | ✅     | 请求体全量快照（当前仅摘要字段白名单，登记）       |
| 落库通道：BullMQ `audit` 队列 → 消费者批量 insert（50 条或 1s 落盘）；队列不可用降级直写             | ✅     | —                                                  |
| 覆盖范围：S6 新端点全接（插件/集成/开放 API/同步任务/日志查询外的全部写操作）+ S1-S5 核心写端点回补（用户/组/项目/参数/环境/文件/用例/评审/计划/缺陷/接口/场景/执行触发/导入导出——回补清单 §4） | ✅     | 遗漏端点补挂（走查清单制，持续）                   |
| IP 记录：x-forwarded-for 首跳（无则 socket 地址）；测试环境显式头注入                             | ✅     | —                                                  |
| 三级查询：system/audit-logs（全量）、orgs/{orgId}/audit-logs（组织范围）、projects/{pid}/audit-logs（项目范围） | ✅     | 导出（登记 S5 后）                                 |
| 高级查询 filter：userId/action 前缀/objectType/时间范围/关键字（detail JSON 内 ilike）+ 分页        | ✅     | 聚合视图（按动作统计，登记）                        |
| 保留时长：系统参数 auditRetentionDays（默认 90，0=永久）；BullMQ 每日 03:00 清理（scope 删除索引）  | ✅     | —                                                  |
| 不可篡改口径：无编辑/删除端点（仅保留期清理）；清理也留一条 system 级 action=audit.purge 汇总记录   | ✅     | —                                                  |

### 1.3 前置依赖

AuditLog 模型已建（S0，含双索引）；BullMQ 队列基建（S2）；session 中间件（S0）。

### 1.4 对标基线核对

复刻：三级日志入口（系统/组织/项目）+权限范围+高级查询+保留时长清理。差异：①detail 存摘要白名单（基线快照粒度未标明，本项目保守最小化——含 PII 不进日志）；②无导出（登记）；③更新操作记 before→after 字段级 diff 摘要（字段名+变更标记，不含值——安全口径，基线未标明，登记本项目决策）。

## 2. 业务逻辑

- **包装器语义**：`withAudit("bug.create", "bug")(handler)` —— handler 正常返回 2xx 后投递 `{userId, scope, projectId?, action, objectType, objectId?, detail?}`；scope 判定：路径含 /projects/{pid}→project、/orgs/{orgId}→org、否则 system。detail 构造器按 action 白名单（如 `{title: "..."截断128, fieldsChanged: ["status","tags"]}`）。
- **open API 面**：action 前缀 `open.`，userId=APIKEY 本人，detail 记 `{akPrefix}`（不记 sk）。
- **降级**：队列 add 抛错 → 直接 prisma.create（慢路径保不丢）；双写防护：同 reqId 幂等键。
- **查询范围裁剪**：org 级=AuditLog.scope=org 且 projectId 所属该 org ∪ scope=project 且项目属该 org；project 级=scope=project 匹配（实现：org 级先查项目 id 集（≤100）再 IN 查询，登记查询形态）。
- **清理**：`DELETE FROM audit_logs WHERE created_at < now()-retention`（分批 1000/事务，防长事务锁——database.md 纪律）；汇总记录 `{purged: N, before: date}`。

## 3. UI/UX 设计（高保真 docs/design/SYS-008-audit-log/）

- 三入口同组件 `AuditLogPage scope=system|org|project`：筛选条（时间范围 RangePicker/操作人选择（用户下拉+搜索）/动作前缀输入/对象类型下拉/关键字）+ 表格（时间/操作人（头像+姓名）/动作（等宽字体 tag）/对象（类型+短 id tooltip 全 id）/摘要（detail 摘要列，超长截断展开）/IP）。
- 系统设置侧「系统日志」菜单；组织设置「组织日志」；项目设置「项目日志」。
- 分页器+总数；空态「暂无操作记录」。
- 保留时长配置入口：系统参数页（SYS-005 既有页面新增「审计保留天数」项，0=永久提示）。

## 4. 技术架构

- **模型**：AuditLog 已建，无新增列（门禁 3 通过；detail Json 白名单构造）。
- **中间件**：`withAudit()`（packages 层不可放——依赖 web 的 req 上下文，落 `apps/web/src/server/http/audit.ts`）+ `audit.producer/consumer`（instrumentation 注册）。
- **回补清单**（S1-S5 存量核心写端点，随本 PR 全挂）：users 创建/更新/状态/重置密码、groups CRUD+成员、orgs/projects CRUD、params 更新、pools 更新、environments CRUD、files 上传删除、cases CRUD/导入导出/评审操作、plans CRUD/执行、bugs CRUD/批量、apis CRUD/导入导出、scenarios CRUD/执行、exec 触发、share 创建删除。**规模控制**：仅 POST/PUT/DELETE 且改持久状态的路由（查询类不记）。
- **端点**：`system/audit-logs`、`orgs/{orgId}/audit-logs`、`projects/{pid}/audit-logs`（GET+filter 分页）；`system/params` 组 audit 增 retention 项。
- **权限点**：`SYSTEM_AUDIT:READ`、`ORG_AUDIT:READ`、`PROJECT_AUDIT:READ`（新增三枚；系统管理员/组织管理员/项目管理员组各自授予——种子更新）。
- **错误码**：`AUDIT_QUERY_INVALID 70030`（filter 非法/时间范围超限）。
- **性能**：列表查询走既有索引（[projectId,createdAt]/[userId,createdAt]）；scope=org 无专用索引（前述 IN 形态+时间下限裁剪，登记容量口径：单组织 ≤100 项目假设）。

## 5. 测试用例

- SYS-008-T1（jmx 四类）：三端点列表/信封；401/403（项目管理员查 system 面 403；组织成员查组织面 403）；filter 非法 422 70030；分页。
- SYS-008-T2（spec 落库链路）：执行一次缺陷创建→1s 内项目日志页可见（action=bug.create/操作人/摘要）（UI+接口断言）；APIKEY 调 open 执行→system 日志 action=open.exec+akPrefix。
- SYS-008-T3（spec 范围与清理）：org 面看不到他组织项目动作；retention=0 与 N 两态（e2e 以参数读取断言+清理 job 单元级验证：预置过期数据跑 job→删除+汇总记录）。
- 单测：withAudit 成功/失败两路、scope 判定矩阵（三种路径形态）、detail 白名单构造（PII 字段不落）、降级直写、清理分批边界、查询范围裁剪 SQL 形态。

## 6. 竞品深度对标

基线三级日志+高级查询+保留清理复刻。差异：①detail 白名单摘要（PII 最小化，登记）；②无导出（登记）；③值级 diff 不落（仅字段名级，登记）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：回补清单全量核对（走查时逐路由 grep 确认无漏挂）；清理 job 与 embedded-postgres 本地时区（UTC 口径，observability 纪律）。

## 8. 勘误登记

（暂无）
