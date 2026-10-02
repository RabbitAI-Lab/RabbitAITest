# 数据库驱动五家 + SQL 处理器解禁（PLUG-004 · 驱动插件）

| 元信息项     | 内容                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PLUG-004                                                                                                                                                                                |
| 所属迭代     | Sprint future — 远期 P4                                                                                                                                                                 |
| 优先级       | P4（PROJ-003/API-006 既定归口「驱动插件化后」承接项）                                                                                                                                   |
| 所属模块     | PLUG 插件体系（driver kind）/ PROJ 项目环境（数据源）/ API 接口测试（SQL 前后置处理器）/ EXEC 引擎（驱动注册表）                                                                        |
| 文档状态     | Implemented（2026-09-30 交付：单测全绿 + jmx 15 采样 0 失败 + e2e 三用例；走查随验收）                                                                                                  |
| 最后更新日期 | 2026-09-30                                                                                                                                                                              |
| 上游依赖     | PLUG-001（插件上传/启停/管理页）、PLUG-002（引擎热加载模式）、plugin-architecture（DriverPlugin SPI 冻结面）、PROJ-003（环境数据源区）、API-004/006（SQL 处理器冻结方案与错误码 50031） |
| 下游消费     | PROJ-003（数据源 driver 枚举扩展）、API-004/API-006（SQL 前后置解禁，勘误清偿）、后续驱动（按本规格模式复制）                                                                           |
| 上游依据     | 需求文档 §插件「数据库驱动插件化」；清单 §11「数据库驱动：MySQL、Oracle、SQL Server、PostgreSQL、达梦 DM（社区版）」；§9.1「数据库驱动上传」                                            |
| 对标基线     | MeterSphere 功能清单 §11（驱动=厂商 JDBC jar 上传，应用商店分发）；apps.fit2cloud.com/metersphere 数据库驱动类 5 条（2026-09-30 核实：全部为厂商官方 JDBC jar 原样再分发）              |
| 关联架构文档 | plugin-architecture.md（§1 三类插件、§2 隔离模型——本规格勘误 3 修订驱动条目）                                                                                                           |
| 高保真确认   | 待确认（原型：docs/design/PLUG-004-database-drivers/；确认人/日期后补——目标授权下人工确认可后置，原型产出先于编码）                                                                     |
| 工作量估算   | 插件 5×0.5 人日（骨架同构）+ 引擎/接线 1.5 人日 + UI 1 人日 + 校验/测试 3 人日                                                                                                          |

## 0. 目标授权与驱动来源铁律（2026-09-30 用户指令）

1. **交付 5 家数据库驱动**：MySQL、PostgreSQL、Oracle、Microsoft SQL Server、达梦 DM——对齐清单 §11 社区版五库口径。
2. **驱动包一律取自数据库厂商官方渠道；禁止使用飞致云应用商店（apps.fit2cloud.com / apps-assets.fit2cloud.com）下载的再分发包。**
3. 技术栈映射决策（本项目纯 TypeScript、无 JVM，JDBC jar 无法在本仓任何运行时装载执行）：「厂商官方 JDBC 驱动」在本项目的**等价实现 = 厂商官方 Node.js 驱动包**，全部自 npm registry 官方来源安装（pnpm-lock 锁定版本与完整性哈希），构建期内联进驱动插件 tarball（单文件自包含，供应链零飞致云工件）。JDBC 坐标列于 §0 表仅作来源对照留档；若未来引入 JVM 边界组件再评估直接装载 jar（登记，不在本规格范围）。

### 驱动来源对照表（本规格单一来源，plugins/README.md 同步引用）

| 数据库     | 厂商官方 JDBC 坐标（对照，本项目不装载）          | 本项目运行时（厂商官方 Node 驱动）         | 许可                         | 发布方核实（2026-09-30）                                                             |
| ---------- | ------------------------------------------------- | ------------------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------ |
| PostgreSQL | org.postgresql:postgresql（pgjdbc）               | `pg` 8.x                                   | MIT                          | node-postgres（PostgreSQL 官网驱动列表收录，生态事实标准）                           |
| MySQL      | com.mysql:mysql-connector-j                       | `mysql2` 3.x                               | MIT                          | 社区事实标准（**登记**：Oracle 官方仅发行 JDBC/Connector 生态，无官方 Node 驱动）    |
| Oracle     | com.oracle.database.jdbc:ojdbc11                  | `oracledb` 7.x（thin 模式，纯 JS）         | Apache-2.0 OR UPL-1.0        | Oracle 官方（oracle/node-oracledb）                                                  |
| SQL Server | com.microsoft.sqlserver:mssql-jdbc                | `mssql` 12.x（tedious TDS，纯 JS）         | MIT                          | Microsoft 官方文档指定的 Node 驱动                                                   |
| 达梦 DM    | 达梦官方发行 DmJdbcDriver18.jar（eco.dameng.com） | `dmdb` 1.0.52xxx（纯 JS，无 .node 二进制） | 达梦软件许可（包内 LICENSE） | 达梦官方（npm maintainers=dameng_database \<ztn@dameng.com\>；API 与 oracledb 同构） |

四个协议插件（TCP/SSH/Redis/MongoDB/gRPC/AMQP）不在本规格范围（P4 后续）。

## 1. 概述

### 1.1 功能定位

在 S6 冻结的 `DriverPlugin` SPI（接口已定义、运行时未启用）上交付**五个官方驱动插件包**，打通两条消费链路：① 环境数据源多驱动化（PROJ-003 数据源区从仅 PostgreSQL 扩展到 5 家，连接测试泛化）；② **SQL 前后置处理器解禁**（API-004 勘误 1 / API-006 勘误 1 两轮诚实延后的清偿——本会话安全约束给出可满足条件：外部输入全部参数绑定 + 仓库代码零 SQL 拼接，与 S3 冻结的「单条 SELECT 词法白名单 + READ ONLY 事务」方案叠加落地）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                         | P1 ✅ | 后续                                                             |
| -------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------- |
| SPI 扩展：`DriverPlugin.query(config, req)` 参数绑定通道（sqlText+params+readOnly）          | ✅    | —（spiVersion 维持 1.0，见 §2.1）                                |
| 5 个驱动插件包（testConnection/query/只读事务/占位符归一化/行归一化/错误友好化）             | ✅    | 连接池化（登记：v1 连接即关，SQL 前后置频次下可接受）            |
| 词法白名单 `assertReadOnlySelect`（单条语句/SELECT·WITH 起始/禁 INTO·FOR UPDATE·注释藏分号） | ✅    | —（API-006 §2 冻结方案落地 + WITH 扩展，见 §2.3）                |
| 引擎驱动注册表（30s 轮询 internal/plugins/drivers，与协议注册表同模式）                      | ✅    | —                                                                |
| SQL 前后置解禁：datasourceId 解析→白名单→参数绑定执行→varMapping 首行提取                    | ✅    | SQL 断言/多行提取（登记）                                        |
| 处理器 params 通道（{var\|value} → 绑定参数值）                                              | ✅    | —（**不提供**变量→SQL 文本的插值能力，安全设计 §3）              |
| 环境数据源 driver 枚举 5 家 + 每驱动 URL 约定与校验                                          | ✅    | 数据源凭据加密存储（PROJ-003 既有登记口径不变）                  |
| 连接测试泛化：PG 内置直连保留 + 其余 4 家走已启用驱动插件（runner call）                     | ✅    | PG 直连也切插件（登记：双路径收敛待后续）                        |
| RequestEditor SQL 表单启用（数据源选择/SQL/参数绑定/varMapping）                             | ✅    | —                                                                |
| 插件管理 UI                                                                                  | 既有  | kind=驱动徽标 PLUG-001 已交付，零改动                            |
| JDBC jar 直接装载 / 驱动上传按 jar 形态                                                      | ❌    | 永不（纯 TS 技术栈，plugin-architecture「不兼容 jar 生态」既定） |

### 1.3 前置依赖

PLUG-001 上传管线（tar 白名单 {package.json, index.js}、版本递增、启停）；PLUG-002 引擎轮询热加载模式；`envDatasourceSchema`（S2 建齐 database 区，driver 字段当时锁 literal("postgresql")——本规格放开为枚举，无新增列）；processorSchema sql 分支（S2 建齐，本规格增 params）；错误码 `SQL_NOT_SELECT 50031`（API-006 已声明，本规格首次消费）。

### 1.4 对标基线核对

| 基线行为（清单 §11/§9.1）                                     | 本项目实现                                                                   | 口径                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- |
| 数据库驱动=厂商 JDBC jar 上传（MySQL 内置，可上传 Oracle 等） | 5 家官方 Node 驱动内联进 TS tarball，上传启用（无「内置 MySQL」特权）        | 简化实现（见 §6）    |
| 应用商店分发驱动                                              | 驱动 tarball=仓库 release 附件（build-plugins 构建，来源=npm 官方 registry） | 完全复刻（渠道自建） |
| SQL 步骤选环境数据库配置执行                                  | 同构：环境数据源 + SQL 前后置处理器（datasourceId 引用）                     | 完全复刻             |
| SQL 步骤可执行任意语句（含写）                                | **收紧**：单条 SELECT/WITH 白名单 + READ ONLY 事务 + 参数绑定                | 差异化决策（见 §3）  |

## 2. 业务逻辑

### 2.1 SPI 扩展（packages/shared/src/plugins/spi.ts）

```ts
export interface DriverQueryParam {
  // 绑定参数值（引擎完成 var→值解析后传入）
  value?: string | number | boolean | null;
}
export interface DriverQueryRequest {
  sqlText: string; // 测试人员编写的语句原文（白名单校验后透传，仓库代码不做任何拼装）
  params: DriverQueryParam[]; // 与占位符 ? 一一对应，仅经驱动绑定通道传入
  readOnly?: boolean; // 处理器路径恒 true
  timeoutMs?: number; // 默认 10_000
}
export interface DriverQueryResult {
  rows: Array<Record<string, string | number | boolean | null>>;
  rowCount: number;
  ms: number;
}
export interface DriverPlugin {
  driver: string; // "postgresql" | "mysql" | "oracle" | "sqlserver" | "dm"（name 必须等于 driver，PLUG-002 勘误口径）
  testConnection(config: { url: string }): Promise<void>;
  query(config: { url: string }, req: DriverQueryRequest): Promise<DriverQueryResult>;
}
```

spiVersion 维持 `"1.0"`：driver kind 此前零存量实现、零上传包，接口扩展不破坏任何既有契约（登记；协议/平台 SPI 不受影响）。

### 2.2 驱动统一约定

- **URL 形态**（DRIVER_META 单一来源，web 校验/UI 占位/插件解析共用）：

| driver     | URL 形态                                              | 默认端口 | 占位符（书写统一 `?`）         |
| ---------- | ----------------------------------------------------- | -------- | ------------------------------ |
| postgresql | `postgresql://user:pass@host:5432/db`                 | 5432     | `$1`（插件归一化）             |
| mysql      | `mysql://user:pass@host:3306/db`                      | 3306     | `?`（原生）                    |
| oracle     | `oracle://user:pass@host:1521/service`（path=服务名） | 1521     | `:1`（插件归一化）             |
| sqlserver  | `sqlserver://user:pass@host:1433/db?encrypt=…`        | 1433     | `@p0`（插件归一化）            |
| dm         | `dm://user:pass@host:5236`                            | 5236     | `?`（**原生**，d.ts 示例实证） |

- **占位符归一化**：处理器/调用方书写统一用 `?`（MySQL 风格，与基线习惯一致）；各插件在执行前将 `?` 逐个替换为原生绑定 token（`$1`/`:1`/`@p0`）——替换器跳过字符串字面量与注释、只消费 `?` 字符、产物不含任何外部值（§3）。
- **只读三层防线**：①`assertReadOnlySelect` 词法白名单（引擎执行前、独立于插件）；②READ ONLY 事务（PG `BEGIN READ ONLY`、MySQL `START TRANSACTION READ ONLY`、Oracle/DM `SET TRANSACTION READ ONLY`；SQL Server 无只读事务形态——词法白名单+连接即关兜底，登记）；③连接即关（不池化、不留会话）。
- **行归一化**：各驱动结果统一为 `Record<列名, string|number|boolean|null>[]`（oracledb/dm 的数组行+metaData 映射为对象；Date→ISO 串；其余非原始类型 JSON 序列化为字符串）；行数上限 100（超限截断，rowCount 返回真实数）。
- **错误友好化**：ECONNREFUSED/ETIMEDOUT/ENOTFOUND/认证失败 → 中文可读消息（带 host:port），其余透传驱动 message；testConnection 超时 3s、query 超时 10s（Promise.race，超时后销毁连接）。

### 2.3 词法白名单（packages/shared/src/plugins/sql-guard.ts）

输入：测试人员 SQL 原文。规则（按序）：

1. 剥离 `--` 行注释与 `/* */` 块注释后不得残留注释起始符（防藏内容）；剥离前先检查分号规则（见 3）作用于**原文**。
2. 原文中 `;` 只允许出现在末尾一处（多条语句/注释内分号一律拒绝）。
3. 剥注释后首 token 必须 ∈ {`SELECT`, `WITH`}（大小写不敏感；WITH=CTE 扩展，登记：只读事务兜底）。
4. 词边界禁用：`INTO`（SELECT…INTO 写表）、`FOR UPDATE`、`FOR SHARE`（锁写）；`WITH` 仅作 CTAS 载体时已被 3/4 联合拦截（CTE 后仍须 SELECT 主句——词法不深析，依赖 READ ONLY 事务兜底，登记）。
5. 空串/纯注释 → 拒绝。失败抛 `SQL_NOT_SELECT(50031)` 语义错误（引擎映射 CONFIG_ERROR）。

### 2.4 SQL 前后置处理器（引擎解禁）

`kernel/sql.ts`（新）：`datasourceId → ctx.env.database 命中（缺失 CONFIG_ERROR「数据源不存在」）→ assertReadOnlySelect → params 解析（{var}→ctx.vars 命中值/缺省空串、{value}→字面值）→ 驱动注册表取插件（缺失 CONFIG_ERROR「驱动插件未启用」50032 语义）→ plugin.query({url},{sqlText,params,readOnly:true}) → varMapping：首行各列命中映射表则写 ctx.vars[目标名]=归一化字符串 → logs 记录（SQL 摘要+行数+耗时，不含参数值——凭据/敏感值不入日志）`。processors.ts 的 sql 分支由显式 throw 改为调用本模块（API-006 勘误 1 的「待豁免后一键启用」以本规格安全设计达成）。

### 2.5 连接测试（管理面）

`testDatasource(driver, url)`：driver=postgresql → 保留 web 内置 pg 直连（PROJ-003 交付语义延续，零上传可用）；其余 4 家 → 查 `plugins` 表 kind=driver 且 name=driver 且 enabled → runner `call(pluginId,"testConnection",[{url}])`（30s 上限，插件内 3s race）→ 未启用/runner 不可用返回 `{ok:false,message:驱动未启用或插件运行器不可用}`（连接失败不是 500，既有信封口径）。

## 3. 安全设计（逐条对标生成前安全约束）

| 约束条款                                                  | 本规格落地                                                                                                                                                                                                                                                              |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 数据库查询所有外部输入必须参数绑定                        | ①处理器 params 通道：变量值只能经绑定参数传入；②仓库**不提供**任何「变量→SQL 文本」插值/替换能力（脚本 API 与 SQL 文本互不注入）；③测试人员编写的语句原文经词法白名单+只读事务后**原文透传**（非本仓代码拼装的产物）——语句文本与值两类输入分别由白名单/绑定通道各自收口 |
| 不得用拼接、format、f-string 组装 SQL                     | 仓库代码送往驱动的文本仅两类：语句原文透传、代码内常量（`SELECT 1`/READ ONLY 事务语句/占位符归一化 token）；`replaceQuestionPlaceholders` 只做 `?`→绑定 token 的字符替换且跳过字面量，**替换产物不含外部输入**；仓内禁止出现 SQL 字符串拼接的 lint 语义由单测矩阵锚定   |
| 凭据只从环境变量/密钥服务读取；源码/示例/测试不写真实凭据 | 数据源 URL 由测试人员在环境配置录入（产品功能语义；加密存储延后=PROJ-003 既有登记口径）；本仓源码/规格示例/测试仅出现本地 e2e 库种子口令与不可达地址（`oracle.invalid.host:1521` 等），零可用真实凭据字面量                                                             |
| 服务端 URL 请求仅 http/https 且拒绝内网地址               | 本规格不新增任何服务端 HTTP fetch；驱动连接为数据库协议 TCP 直连（用户环境配置目标，与引擎采样器目标同口径），非 URL fetch 路径                                                                                                                                         |

## 4. 技术架构

- **插件包**（`plugins/{postgresql,mysql,oracle,sqlserver,dm}/index.ts` + 共享 `packages/shared/src/plugins/driver-kit.ts`（构建期内联））：
  - 根 package.json 新增 dependencies：`pg`（已有）、`mysql2`、`oracledb`、`mssql`、`dmdb`（版本=§0 表；pnpm-lock 锁定）。
  - manifest：`{name=driver 标识, kind:"driver", spiVersion:"1.0"}`；esbuild bundle 内联驱动（全部纯 JS 已核实：dmdb tarball 0 个 .node；oracledb thin 模式；mssql=tedious）——**五家全部 format=cjs**（勘误 1）。
  - driver-kit（shared，插件与单测共用）：parseDriverUrl（scheme 白名单→user/pass/host/port/path/query）、replaceQuestionPlaceholders（跳过 `'…'`/`"…"`/`--`/`/* */`）、normalizeRows/normalizeValue、friendlyDbError、withTimeout(race+销毁)。
- **引擎**：`kernel/drivers/registry.ts`（镜像 samplers/registry：30s 轮询 `internal/plugins/drivers`，driver 标识=插件名；双层解包加载）；`kernel/sql.ts`（§2.4）；processors.ts 分支改造。
- **Web**：`api/v1/internal/plugins/drivers/route.ts`（镜像 protocols 端点：enabled 的 kind=driver 插件，回 driver/name/version/dir/entry）；environment.service.testDatasource 泛化（§2.5）；环境页数据源卡片 driver 下拉（DRIVER_META）；RequestEditor SQL 处理器启用（数据源下拉来自当前所选环境数据源、SQL 文本域、参数绑定行 {var|value}、varMapping 行）。
- **错误码**：`SQL_NOT_SELECT 50031`（既有声明首次消费）；`DRIVER_PLUGIN_MISSING 50032`（新，CONFIG_ERROR 语义——白名单过但注册表无该驱动插件）；数据源不存在沿用 CONFIG_ERROR 40510 家族文案不新增码；test-datasource 校验失败 20422（既有）。
- **权限**：复用 SYSTEM_PLUGIN:READ/UPDATE（插件管理）+ PROJECT_ENV:UPDATE（连接测试/环境编辑）+ PROJECT_API:UPDATE（处理器编辑）；internal 面 x-internal-token（既有）。

## 5. 测试用例

| 编号         | 类型   | 前置                                | 步骤                                                                                                | 预期                                                                                           |
| ------------ | ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| PLUG-004-T1  | Vitest | sql-guard                           | 白名单矩阵：SELECT/WITH/大小写/注释/多语句/INTO/FOR UPDATE/纯注释/空                                | 合法过；全部非法样本抛 SQL_NOT_SELECT 语义                                                     |
| PLUG-004-T2  | Vitest | driver-kit                          | URL 解析五家、占位符替换（字面量内 `?` 不替换/注释内不替换/越界占位符）、行归一化、错误友好化       | 各分支断言（含 oracledb 数组行→对象、Date→ISO）                                                |
| PLUG-004-T3  | Vitest | 引擎 kernel/sql（伪驱动注入注册表） | 成功+varMapping 提取；数据源缺失；非白名单；驱动缺失 50032；params {var}/{value} 解析；驱动抛错映射 | 全分支 CONFIG_ERROR 语义正确；成功路径 ctx.vars 写入正确                                       |
| PLUG-004-T4  | Vitest | datasourceTestSchema/DRIVER_META    | driver×url 合法/非法 scheme 组合                                                                    | superRefine 拒非法 scheme；枚举外 driver 422                                                   |
| PLUG-004-T5  | jmx    | api-test 栈 + plugins/dist tar      | 上传 postgresql 驱动 tarball（multipart）→ 409 幂等 → 启用 → 列表 kind=driver 过滤+分页信封         | 四断言（201/409/200/code=0/信封字段/耗时）                                                     |
| PLUG-004-T6  | jmx    | 同上                                | test-datasource：PG 直连本地栈库成功；mysql/oracle/sqlserver/dm 非法 URL 422；不可达 ok:false       | 四断言×4 家（HTTP 200/422、code、$.data.ok、耗时）                                             |
| PLUG-004-T7  | jmx    | 无会话/低权限成员                   | 401/403/404（错误项目）                                                                             | 三类权限场景四断言                                                                             |
| PLUG-004-T8  | e2e    | e2e 栈                              | 插件管理 UI 直传 dm tarball（multipart 浏览器出口）→ 驱动徽标 → 启用 → 列表状态                     | UI 断言（行文本/徽标/状态 tag）+ Console 无 error + 网络断言（POST 201/负载 multipart）        |
| PLUG-004-T9  | e2e    | 同上 + 已上传启用 postgresql 驱动   | 环境数据源：driver 下拉 5 项 → PG 连接测试成功 → dm 不可达失败提示                                  | UI（成功/失败 message 展示、非假成功）+ Console + 接口（POST test-datasource 负载 driver/url） |
| PLUG-004-T10 | e2e    | 同上 + 场景执行链路                 | 场景 SQL 前置（PG、`SELECT ? AS v`、params={var}、varMapping）→ 执行 → 变量断言；非 SELECT → 失败项 | UI（报告成功/失败项 message 含 50031 语义）+ Console + 接口（执行请求负载含 processor.params） |

四类场景映射（jmx）：正常=T5/T6；权限=T7；校验=T6 非法 URL 422；分页=T5 信封。四家非 PG 驱动的真实连通（需真库）不进 CI——以 driver-kit 单测（协议配置/归一化）+ 不可达错误映射（T6）覆盖，登记豁免；PG 真连路径由 T6/T9/T10 全链路覆盖。

## 6. 竞品深度对标

| 维度         | MeterSphere                      | 本项目                                               | 决策理由                                                                                                    |
| ------------ | -------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 驱动形态     | 厂商 JDBC jar 上传（MySQL 内置） | 厂商官方 Node 驱动内联 TS tarball（五家平权上传）    | 纯 TS 技术栈无 JVM（架构既定不兼容 jar）；MySQL 无官方 Node 驱动故不设「内置特权」，五家统一上传语义        |
| 分发渠道     | 飞致云应用商店再分发             | 仓库 release 附件（来源=npm 官方 registry+lockfile） | 用户指令铁律：不用飞致云包；npm 官方渠道=厂商第一发行渠道或官方收录                                         |
| SQL 步域能力 | 任意 SQL（含 DML/DDL）           | SELECT/WITH 白名单+READ ONLY+参数绑定                | 安全约束（参数绑定/零拼接）+最小权限；写操作场景不属于「查询/提取」用例，登记差异                           |
| 加载机制     | pf4j classloader                 | runner（管理面）/engine in-process（执行面）         | 与协议插件同构；采样与 SQL 执行均在 engine 热路径侧，管理面连接测试经 runner（plugin-architecture §2 修订） |

## 7. 里程碑与验收

- DoD：5 插件包+SPI 扩展+引擎解禁+环境/UI 接线交付；T1-T10 全绿；PLUG-001/002/003、PROJ-003、API-004/006 既有用例回归全绿（SQL 处理器相关断言按勘误 2 更新）。
- 演示：上传启用 postgresql 驱动 → 环境配 PG 数据源 → 场景挂 SQL 前置（参数绑定+变量提取）→ 执行报告查看变量断言通过。
- 来源审计：五驱动 npm 包名/版本/许可/发布方与 §0 表一致（pnpm-lock 哈希锁定），仓内无 apps.fit2cloud.com/apps-assets 引用（grep 锚定）。

## 8. 勘误登记

1. **五家驱动全部 format=cjs（ESM bundle 不可用）**：五家驱动包均为 CJS（pg/mysql2/oracledb/mssql(tedious)/dmdb），ESM bundle 的 dynamic-require 垫片对 `require("events")` 等内建直接抛错（冒烟首跑 postgresql 即复现）——与 PLUG-003 勘误 5（websocket/undici）同 pathology，构建表统一 `format:"cjs"`，双侧加载器双层解包既有约定复用。
2. **dm 占位符为原生 `?`**：规格初稿按 oracledb 同构推断 dm 需 `:n` 归一化；实现时 dmdb `index.d.ts` 示例（`execute("select * from t where id in (?)", [[1,2,3]])`）实证原生支持 `?` 位置绑定——dm 插件零归一化直传。
3. **建连调用的错误友好化旁路（实现期修复）**：mysql/oracle/dm 首版把 `getConnection()` 放在 try 块外，连接类错误（ECONNREFUSED 等）绕过 `friendlyDbError` 直出原始 message——统一改为「先置 null 变量、try 内建连、finally 判空销毁」；`friendlyDbError` 补 mssql/oracledb 的「Could not connect / could not be established」形态。
4. **oracle Easy Connect 单字符服务名怪癖**：`127.0.0.1:1521/x` 被 thin 驱动判 NJS-515 非法、`ORCLPDB1`/`abc` 均合法——oracledb 内部解析怪癖，非本项目 bug，登记（真实服务名长度均 ≥2）。
