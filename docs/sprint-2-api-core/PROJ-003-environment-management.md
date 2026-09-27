# 环境管理

| 元信息项     | 内容                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PROJ-003                                                                                                                          |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                           |
| 优先级       | P1（依赖链最长上游：环境→定义→场景→计划）                                                                                         |
| 所属模块     | 项目管理（project 域）                                                                                                            |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                        |
| 上游依赖     | PROJ-001（项目域基线）、SYS-004（按钮级权限）                                                                                     |
| 下游消费     | API-002/003/004（变量/域名/HOST/数据源/全局前后置断言）、S3 场景执行、S4 PLAN-003、S5 PROJ-006（环境组/项目级全局参数）           |
| 上游依据     | 需求文档 M2（环境管理）；功能清单 §8.6                                                                                            |
| 对标基线     | 功能清单 §8.6：环境复制/导入导出（同名覆盖）/编辑/删除、环境变量、HTTP 多域名条件匹配、数据库、HOST、全局前后置/断言、TCP（插件） |
| 关联架构文档 | test-domain-model.md §2.2（Environment 一文档 JSONB）；engine-execution-architecture.md §3（变量作用域链）                        |
| 高保真确认   | 待确认（原型 docs/design/PROJ-003-environment-management/，人工确认待 Sprint 验收走查——不可由 AI 代签）                          |
| 工作量估算   | 后端 3 人日 / 前端 4 人日 / 联调 1 人日                                                                                           |

## 1. 概述

### 1.1 功能定位

接口测试的「运行时配置」：变量、域名、HOST、数据源与全局前后置的唯一载体。环境在任务下发时由 web 解析为**快照**注入执行命令（engine 无 DB、不吃环境定义变更）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                     | P1 ✅ | 后续                                            |
| ------------------------------------------------------------------------ | ----- | ----------------------------------------------- |
| 环境 CRUD：名称/描述 + config 五区（变量/HTTP 域名/HOST/数据源/全局前后置与断言） | ✅     | —                                               |
| 环境变量：KV（启用勾选）、`${var}` 渲染消费；提取写回（API-004）         | ✅     | 值加密存储（敏感变量 S6 QA-002 评估）           |
| HTTP 域名：多条 `{名称,协议,主机,端口,路径前缀,条件(模块/路径前缀)}`；匹配优先级 路径>模块>默认 | ✅     | 域名健康检查（基线无，超出不做）               |
| HOST 映射：host→address 列表，执行时连接地址重定向                        | ✅     | —                                               |
| 数据源：PostgreSQL（名称+连接串）；SQL 前后置消费（API-004）；连接测试按钮 | ✅     | MySQL/Oracle/SQLServer（驱动插件化 PLUG-002 后）|
| 全局前置/后置（脚本/SQL/等待）与全局断言：追加到该环境下每次请求          | ✅     | 场景级前后置（S3 API-006）                      |
| 复制环境（副本「xxx_copy」）                                              | ✅     | —                                               |
| 导出（JSON 下载）/导入（同名覆盖开关，校验报告）                          | ✅     | —                                               |
| TCP 配置/SSL 证书/环境组/项目级全局参数                                   | ❌     | TCP=协议插件（基线【企业版】）；组=S5 PROJ-006  |

### 1.3 前置依赖

无外部阻塞（project 域先行）。config zod schema 是 API-004 契约组成部分（envSnapshot），第 3 天前冻结。

### 1.4 对标基线核对

完全复刻：环境五区主体/复制/导入导出同名覆盖/多域名条件匹配优先级。简化实现：数据源仅 PostgreSQL；全局前后置为「环境级」（基线场景级+请求级两层，请求级在 API-004 处理器、场景级 S3）；TCP/证书按基线口径归插件/后续。超出基线：连接测试按钮仅 PG（自主设计，方便排障）。

## 2. 业务逻辑

- 删除：软删（deletedAt）；被删除/不选环境执行=请求 URL 必须绝对地址，否则 422（code 20422 提示选环境）。
- 导入：文件或粘贴 JSON→逐环境校验（config 结构 zod）→同名环境按开关覆盖（version 重置 1）或跳过并计入校验报告；导入不产生「部分成功」（全合法才落库）。
- 变量作用域链（消费侧口径在此登记）：临时(API-004 提取 temp) > 环境变量 > 项目全局参数(GlobalParam，S5 前无入口、web 侧合并逻辑预留)。
- 引用保护：环境删除不级联历史任务（任务载荷为快照，自包含）。

## 3. UI/UX 设计（高保真 docs/design/PROJ-003-environment-management/）

- 入口：项目设置「环境管理」（左导航 settings 组，perm PROJECT_ENV:READ）。
- 列表页：表格（环境名/变量数/域名数/更新时间/操作：编辑·复制·导出·删除）+「新建环境」。
- 编辑页/抽屉：左环境信息（名称/描述）+ 右五区 Tab（变量 KV 行/域名卡片列表/HOST 表/数据源卡片+连接测试/全局前后置与断言——处理器编辑器复用 API-004 组件）。
- 空态：五区各自「+ 添加」引导；列表空态引导新建。

## 4. 技术架构

- 数据模型（已建齐）：Environment(projectId/name/config JSONB/deletedAt)。
- config schema（`packages/shared/src/project/schemas.ts`，与 envSnapshot 同源）：`{vars:[{key,value,enabled}], http:[{id,name,protocol,hostname,port,pathPrefix,conditions:{moduleId?,pathPrefix?}}], hosts:[{host,address}], database:[{id,name,driver:'postgresql',url}], pre:processor[], post:processor[], asserts:assertSpec[]}`（processor/assertSpec 引用 execution 契约 v2 类型）。
- 端点：`GET/POST /api/v1/projects/{pid}/environments`、`GET/PUT/DELETE .../environments/{id}`、`POST .../environments/{id}/copy`、`GET .../environments/{id}/export`、`POST .../environments/import`（body {overwrite, payload[]}）、`POST .../environments/test-datasource`（url 连接测试）。
- zod：environmentUpsertSchema（vars 唯一 key、http hostname 合法、database url 白名单 scheme postgresql://）；导入 payload 数组≤50。
- 权限点：**新增入库 `PROJECT_ENV:CREATE|DELETE`**（rbac §3 随首份消费规格入库；预置组同步：PROJECT_ADMIN 全量、PROJECT_MEMBER 增 READ|CREATE、ORG_ADMIN 增 READ）。
- 错误码：`ENV_NOT_FOUND 40444`。
- 前端：`/settings/environments`（server 页）+ `EnvironmentForm`（client，五区 Tab）；调试/执行处环境选择器 `useEnvironments`。

## 5. 测试用例

- PROJ-003-T1（jmx 四类）：环境 CRUD/复制/导入导出 roundtrip（同名覆盖两态）；401/403/404；config 非法 422（重复变量名/坏 URL）；列表分页信封。
- PROJ-003-T2（spec 主链路）：新建环境（2 变量+2 域名含路径条件+1 HOST+1 数据源连接测试）→ 编辑回显 → 复制副本 → 导出下载（接口断言 content-type/内容）→ 导入到另一名（UI+Console+接口）。
- PROJ-003-T3（spec 二态）：同名导入覆盖=true/false 两态结果（覆盖后变量数变化/跳过计数）；删除后列表消失且执行处选择器不再出现。
- 单测：config schema 校验矩阵、快照构建（vars 合并全局参数次序）、导入校验报告聚合。

## 6. 竞品深度对标

基线 §8.6 主体全覆盖；差异：①数据库四驱动→仅 PostgreSQL（驱动插件化口径）；②环境变量加密存储延后（登记）；③环境组/项目级全局参数=S5 PROJ-006（plan 目录树既定拆分）；④执行时快照注入（基线引擎直读环境表——本项目 engine 无 DB 架构决策，engine-execution-architecture §1）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。config schema 冻结（第 3 天）是 API-004 契约前置；验收对应 sprint-overview 验收 1。

## 8. 勘误登记

- 勘误 1（2026-09-27）：环境「描述」字段未随 INFRA-003 建列（environments 表无 description），按门禁 3 不加列，S2 以名称承载辨识度；config schema 实际落位 `packages/shared/src/api/schemas.ts`（与 envSnapshot 同源，barrel 统一导出）。
