# Swagger URL 定时同步（OpenAPI 3 定时导入任务）

| 元信息项     | 内容                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-011                                                                                                                      |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                        |
| 优先级       | P2（迭代内）                                                                                                                 |
| 所属模块     | 接口测试（api_test 域）+ 定时基建                                                                                            |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿、CI 六作业全绿；高保真走查随验收）                            |
| 最后更新日期 | 2026-09-27                                                                                                                   |
| 上游依赖     | API-002（OpenAPI3 导入服务/覆盖不覆盖判重）、S3 schedule 基建（AppSetting 权威源+BullMQ repeatable+cron 词法校验）           |
| 下游消费     | S7 AI-003（批量接口用例生成消费同步后的定义面）                                                                              |
| 上游依据     | 需求文档 §二「接口定义：Swagger 定时同步」；功能清单 §6.2「Swagger URL 定时同步（定时导入任务）」、40 行「Swagger 定时同步」 |
| 对标基线     | 功能清单 §6.2：Swagger（URL/文件，仅 3.0）手动导入（S2 已交付）+ **URL 定时同步**（本规格）                                  |
| 关联架构文档 | api-conventions.md §4（长任务/定时）；API-002 规格（导入判重与校验报告契约）                                                 |
| 高保真确认   | 待确认（原型 docs/design/API-011-swagger-sync-openapi/）                                                                     |
| 工作量估算   | 后端 3 人日 / 前端 2 人日                                                                                                    |

## 1. 概述

### 1.1 功能定位

接口定义的「定时导入任务」：项目配置 Swagger/OpenAPI 3 文档 URL + 同步策略（覆盖/不覆盖+目标模块+cron）→ 定时拉取解析 → 复用 S2 导入管线（判重/校验报告）→ 同步历史可查。手动「立即同步」同路径。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                      | P1 ✅ | 后续                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------- |
| 同步任务 CRUD：名称/文档 URL（http(s)）/覆盖开关/目标模块/cron/启用开关；项目级上限 10 条                                                                 | ✅    | —                                     |
| URL 拉取：SSRF 守卫复用 S2（禁内网段/元数据地址；重定向同 host 校验）                                                                                     | ✅    | 私网白名单（登记）                    |
| 手动触发「立即同步」：拉取→解析（json/yaml 自动识别）→导入管线（复用 API-002：覆盖=更新+version+1，不覆盖=跳过）→ 校验报告（新增/覆盖/跳过/失败行级明细） | ✅    | —                                     |
| 定时执行：cron repeatable（最短 5 分钟，词法校验复用 S3）；执行经任务中心留任务记录                                                                       | ✅    | —                                     |
| 同步历史：最近 20 次/任务（时间/触发源（手动·定时）/结果计数/失败明细/耗时）                                                                              | ✅    | diff 视图（变更对比，登记 S7 前评审） |
| 任务停用/删除：停用移除 job 不动历史；删除清历史                                                                                                          | ✅    | —                                     |

### 1.3 前置依赖

API-002 导入服务（`api-import.service` 内部函数可复用）；S3 `schedule.service` 模式（AppSetting 存储+cron 校验+repeatable 注册——直接复用其工具函数）。

### 1.4 对标基线核对

完全复刻基线 §6.2「Swagger URL 定时同步（定时导入任务）」。限定：①仅 OpenAPI/Swagger 3.0（S2 既有口径）；②yaml/json 双格式（基线同）；③无 diff 视图（登记）；④URL 目标私网白名单登记（当前守卫同 S2 全禁内网）。

## 2. 业务逻辑

- **存储**：AppSetting `key="swaggerSyncTasks:{projectId}"`（S3 定时任务同模式权威源；值=任务数组含 id/name/url/cover/moduleId/cron/enabled/lastRunAt）。**无新表**（门禁 3：任务属项目应用设置域，S3 先例模式）。
- **同步流水线**：`runSwaggerSync(task)` → fetch（10s 超时+守卫）→ 内容嗅探解析（json 失败试 yaml）→ `importOpenApi(projectId, doc, {cover, moduleId})`（API-002 既有）→ 结果 `{added, updated, skipped, failed[], fetchMs}` → 历史头插（截 20）→ 若 failed>0 任务记录标 PARTIAL_FAILED（不阻塞下次）。
- **定时**：BullMQ repeatable `swagger-sync` 队列（jobId=`swsync:{taskId}` 幂等去重）；instrumentation consumer 复用 S3 注册点；cron 校验/最短间隔/停用清理同 S3 函数。
- **并发**：同任务串行（若上轮未完跳过本轮——repeatable 天然间隔≥5min，执行<10s 超时保护，不另建锁）。
- **模块归属**：目标模块默认根模块；导入的接口挂 moduleId（API-002 既有参数）。

## 3. UI/UX 设计（高保真 docs/design/API-011-swagger-sync-openapi/）

- 接口定义页工具条「定时同步」入口 → 抽屉/页面 `/apis` 侧挂面板：任务列表（名称/URL 截断/覆盖徽标/下次执行时间/启用开关/最近结果 tag（成功 N+M/部分失败/失败）/操作：立即同步·编辑·历史·删除）。
- 任务编辑 Modal：名称/URL/覆盖开关（说明文案：同 method+path 判重）/目标模块树选/cron（CronInput 组件复用 S3）。
- 历史抽屉：时间线列表（触发源 tag/结果计数 chips/耗时/失败明细展开行级：path+原因）。
- 空态：「配置 Swagger 文档 URL，自动保持接口定义与后端同步」。

## 4. 技术架构

- **服务**：`swagger-sync.service.ts`（任务 CRUD/上限/触发编排/历史）；`runSwaggerSync` 纯逻辑与 IO 解耦（fetcher 注入，单测主力）。
- **端点**：`projects/{pid}/swagger-sync`（GET/POST/`[taskId]` PUT/DELETE/`[taskId]/run` POST/`[taskId]/history` GET）。
- **权限点**：复用 `PROJECT_API:UPDATE`（同步动作=定义写入语义；读=PROJECT_API:READ）——避免新权限点（S3 API-010 同裁决先例）。
- **错误码**：`SWAGGER_SYNC_TASK_NOT_FOUND 40520`、`SWAGGER_SYNC_URL_BLOCKED 40521`（SSRF 守卫）、`SWAGGER_FETCH_FAILED 40522`、`SWAGGER_PARSE_FAILED 40523`、`SWAGGER_TASKS_LIMIT_EXCEEDED 40524`。
- **消费者**：instrumentation.ts 注册 `swagger-sync` worker（DISABLE_SCHEDULER=1 同 S3 一并关停）。

## 5. 测试用例

- API-011-T1（jmx 四类）：任务 CRUD/信封；401/403/404；URL 非法 422、内网 URL 422 40521、超 10 条 422 40524、cron 非法 422。
- API-011-T2（spec 手动同步）：mock OpenAPI 文档 URL（apps/mock 提供变化的两版文档）→ 建任务（不覆盖）→ 立即同步→ 报告 N 新增；改文档+切覆盖→再同步→报告「覆盖」计数；历史两轮可见（UI+接口断言）。
- API-011-T3（spec 定时与失败）：短 cron 触发一轮（e2e 时间可控：直接调 run 端点模拟定时路径）→ 任务中心记录；mock 返回 500→历史标失败+40522、下次成功恢复。
- 单测：内容嗅探（json/yaml/皆失败）、覆盖判重复用矩阵（S2 回归面）、历史截断 20、停用清理 job、fetch 超时。

## 6. 竞品深度对标

基线能力行完全复刻（URL 定时同步）。差异：无 diff 视图（登记）；无私网白名单（登记，守卫同 S2）；历史保留 20 条（基线未标明，登记本项目口径）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。联调点：导入管线复用不改 S2 行为（S2 导入用例全量回归）；mock 文档两版切换在 e2e 的数据隔离（S3 教训：服务端状态用例需唯一 URL）。

## 8. 勘误登记

（暂无）
