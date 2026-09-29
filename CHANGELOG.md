# Changelog

本项目的所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [Unreleased]

### 新增

- **指标面 v2：Prometheus 企业级监控对接（INFRA-007，S10）**：`GET /api/v1/system/metrics` 在 v1 最小集（队列/槽位/任务时延/HTTP 计数）上新增 6 组指标——HTTP 时延分位（按路由组，512 样本滑动窗口）、DB 慢查询计数（Prisma query 事件 ≥200ms，`RABBIT_SLOW_QUERY_MS` 可调，0 关闭）、24h 任务分布/失败率、失败分类计数（FailureKind 四类+UNCLASSIFIED）、误报命中数/命中率；队列与引擎槽位指标按池展开（label=BullMQ 队列名，覆盖 S9 多池）；新增 APIKEY 直连抓取通道（`Authorization: Bearer ak.sk`/Basic，权限仍收敛 SYSTEM_METRICS:READ，30 次/分限流），Prometheus 无需会话 Cookie 即可抓取；随仓库交付监控部署资产 `docs/deployment/`（抓取配置示例 prometheus.yml、Grafana 总览看板 JSON、告警建议与安全注意）；指标段独立降级，任一数据源故障端点仍 200
- **数据库驱动五家 + SQL 前后置处理器解禁（PLUG-004）**：五家驱动插件包（postgresql=pg / mysql=mysql2 / oracle=oracledb thin / sqlserver=mssql / dm=dmdb）——**驱动一律取自数据库厂商官方渠道（npm registry，pnpm-lock 锁定），零飞致云工件**（纯 TS 无 JVM，JDBC jar 不装载；官方 Node 驱动=等价实现）；`DriverPlugin` SPI 扩展参数绑定通道（`query(config, {sqlText, params, readOnly})`）；引擎驱动注册表（30s 轮询 internal/plugins/drivers，与协议注册表同模式）；**SQL 前后置处理器解禁**（S2/S3 两轮诚实延后清偿：单条 SELECT/WITH 词法白名单 `assertReadOnlySelect` + 各驱动 READ ONLY 事务 + 连接即关 + 变量值仅经绑定参数传入（仓库零 SQL 拼接）+ varMapping 首行提取；`SQL_NOT_SELECT 50031` 首次兑现、新增 `DRIVER_PLUGIN_MISSING 50032`）；环境数据源 driver 自仅 PostgreSQL 扩展为五家（URL 按驱动 scheme 校验 + 占位跟随）；连接测试泛化（PG 内置直连保留、其余四家走已启用驱动插件）；RequestEditor SQL 处理器表单启用（数据源选择/绑定参数 变量↔字面值/变量提取）

### 修复

- 修复插件管理页 UI 上传按钮恒失败（S6 潜伏两连缺陷，S-future 验收演示录制首次暴露）：① api-client `post()` 会 JSON.stringify FormData 并强设 application/json → 服务端落 JSON 分支 422「缺少 file 字段」，`pluginApi.upload` 改直连 `request()` 保留浏览器 multipart 边界；② orgScope 以带引号 JSON（`JSON.stringify("ALL")`）发出时 `parseScope` 落单 orgId 分支裸抛 ZodError 500 → 剥引号解析 + 非法值统一 422（70002）；补 UI 直传回归用例 PLUG-001-T5（此前 e2e/jmx 皆走 base64 形态，浏览器 multipart 出口零覆盖）

## [v0.9.0] - 2026-09-28 — Sprint 9 企业版核心（M10 里程碑）

### 新增（全量交付：三层测试 + CI 全绿）

- **License 体系（ENTP-007）**：三段式签名 License（`RABBIT-ENT1.<payload>.<hmac>`，HMAC-SHA256 验签 + 三重校验 90002-90004）；`assertEntpEnabled(feature)` 六特性统一门控（MULTI_ORG/SSO/MULTI_POOL/THEME/MSG_TEMPLATE/USER_SCALE → 403 90001/90005）；授权管理页 `/system/license`（社区版⇄企业版状态卡、功能矩阵、到期 ≤30 天黄条/过期红条）；公开 `GET /public/license-status`（无鉴权，前端按钮解锁驱动，no-store）；`scripts/gen-license.mjs` 签发工具（--expires/--features/--max-users）；License 表 S0 已建零 DDL
- **多组织管理（ENTP-001）**：组织 CRUD（建=名称+管理员既有用户+描述 → 组织+成员+预设事务；编辑/结束 ACTIVE↔ENDED 不入切换列表；删除 needConfirm 二次确认级联项目域数据，默认组织保护 90022）；顶栏组织切换器（>1 ACTIVE 组织显示，zustand 持久化）；`GET /personal/orgs` + `GET /personal/projects?orgId=` 按组织过滤；ProjectSwitcher 组织感知取数
- **SSO 单点认证（ENTP-002）**：AuthSource 认证源（8 类型枚举，LDAP/CAS/OIDC/OAuth2 四协议实现，SAML 占位 90015）；OIDC/OAuth2/CAS 授权码全链（state Redis 5 分钟防 CSRF 90012、属性映射 username/name/email、find-or-create LOCAL 绑定/异源 409 90016）；LDAP 账密直登（注入式 adapter，bind+search+二次 bind，失败同码防枚举）；登录页「更多登录方式」+ LDAP Tab；mock IdP（`/sso/{provider}/{authId}/*` + `_test` 控面）
- **扫码登录（ENTP-003）**：企微/钉钉/飞书三平台（apiBase/authorizeBase 可注入 mock——测试栈免真实企业账号）；回调换身份（各平台 API 形态）→ 合成 `@sso.scan` 幂等账号；SSO 特性门控
- **自定义主题品牌（ENTP-004）**：SystemParam `theme` 组（主题色/背景跟随/登录页五项/平台三项；图片 dataUrl ≤200KB 90060）；界面设置 Tab 左表单右实时预览；`GET /public/theme` 驱动 antd token（Providers 动态 colorPrimary）+ `--rabbit-primary` CSS 变量（登录背景/导航选中态）+ 登录页/顶栏品牌 + 根 layout metadata 站点名
- **自定义消息模板（ENTP-005）**：`message_templates` 表（项目×事件唯一，11 事件全覆盖）；变量目录 `TEMPLATE_VARS`（公共三变量+对象变量，`${var}` 渲染未知保留原样）；dispatch 渲染挂钩（模板存在且 License 有效→渲染；否则回退挂点 defaults——S5 固定文案零回归）；实时预览（服务端示例数据渲染，静态路由 preview/ 规避动态段 405）；模板 Tab（变量 chip 插入/预览/恢复默认）
- **多资源池（ENTP-006）**：池 CRUD（NODE/K8S 类型位、应用组织 orgScope ALL|指定、启停、默认池删/禁保护 90030/90031、有任务池拒删 90036）；按池队列路由 `exec-pool-{poolId}`（BullMQ 禁冒号——设计稿 `exec:{poolId}` 勘误改连字符；默认池恒 `exec` 单引擎零回归）；engine `POOL_ID` 环境变量绑定（队列订阅+心跳携带 poolId 按池下发并发）；执行入口池校验（禁用 90032/orgScope 越界 90037）；场景/计划执行弹窗选池下拉（API-008 预留通道接通）
- **用户扩容与部门（ENTP-008）**：`effectiveUserLimit()`（License USER_SCALE 放开 30 上限，maxUsers 可封顶；注册与管理员创建两入口共用）；组织级部门树（parentId 自引用+环检测 90042+同层重名 90041+有子拒删 90043）+ 成员多对多挂载（越组织 90044）；`/org/departments` 左树右表页；用户管理页容量进度条（社区版逼近上限提示扩容/企业版不限额口径）
- **权限与错误码**：新增 18 权限点（SYSTEM_LICENSE:R/U、ENTP_ORG×4、ENTP_SSO×4、ENTP_POOL:C/U/D、ORG_DEPARTMENT×4；rbac §6 预登记兑现）；90xxx 企业版段 34 枚（api-conventions §3 预留兑现；POOL_NOT_FOUND 沿用 50404 不复用）；guard toResponse 90xxx HTTP 映射
- **数据模型**：ENTP 域 4 新表（auth_sources/departments/department_members/message_templates）+ resource_pools.org_scope 列（门禁 3 例外登记 test-domain-model §6——基座表 id 为 TEXT 口径对齐）；licenses 表 S0 已建零 DDL
- **测试**：Vitest 新增 48（shared 15：特性/队列名/License payload/theme/模板变量渲染/扫码 URL；web 33：License 校验管线+状态机+门控矩阵+上限四态、dispatch 模板渲染矩阵+回退零回归、SSO state/OIDC/CAS/fid-or-create 三分支/LDAP fake 矩阵）；gen-jmx-s9 生成 8 份计划（License 三态码生成期预计算；四类×四断言）；Playwright ENTP 10 用例（单文件串行防全局态互踩：授权二态/组织切换器/OIDC+钉钉 mock 全链/engine2 绑池执行/部门树/主题应用/模板渲染事件链）+ EXEC-002 门控断言并行安全化（读态↔按钮态重试环）；mock IdP s9-sso-mocks（多段平台路径路由）

### 修复与加固

- 修复 ENTP-005 preview POST 被兄弟动态段 `[event]` 405 吞并（迁静态路由 preview/）；修复 ENTP-008 createDepartment 环检测误传 parentId 作 departmentId 致所有子部门创建 90042 自环假报；修复 CAS XML 属性 `cas:` 前缀未剥离致映射落空；修复 SSO redirect_uri 用 base.siteUrl 默认 :3000 与实际端口不符（改取发起请求 origin，部署免配置）；修复 EXEC-002 与 ENTP 并行持证竞态（license-status 读态与按钮态一致重试环）

### 测试与收口

- Vitest 324（新增 48）；JMeter 63 计划（新增 8：ENTP-001~008）；Playwright 178（新增 10：ENTP-s9-enterprise 单文件串行 8 用例 + EXEC-002 改造）；OpenAPI 279→292 paths（`gen-openapi --check` 过）；权限点 91→109；错误码 118→152（90xxx 34 枚）
- 8 规格 Draft→Approved→Implemented；8 组高保真原型（docs/design/ENTP-*/，人工确认随验收走查）；sprint-overview 交付自查回填

## [v0.8.0] - 2026-09-28 — Sprint future 远期 P4（协议插件 · 外部工具契约 · 报告分析 · K8S 池 · 企业版占位）

### 新增（全量交付：三层测试 + CI 全绿）

- **WebSocket/MQTT 协议插件（PLUG-003）**：`plugins/websocket`（undici WebSocket 内联 CJS bundle，单 run 探活：连接→发送→收首条→close，超时 504/拒绝 502）与 `plugins/mqtt`（自研最小 MQTT 3.1.1 客户端——node:net 手工编解码 CONNECT/CONNACK/SUBSCRIBE/PUBLISH(QoS0)/DISCONNECT + 剩余长度 varint + `+/#` 通配匹配，零新增 npm 依赖）；插件名=协议标识（规避 tcp-conn 勘误坑）+具名 `createPlugin` 导出；双侧加载器（plugin-runner/引擎 registry）双层解包（CJS import() 命名空间适配）；请求编辑器协议选择器（内置/插件分组，非 http 协议 HTTP 面折叠+protocolConfig JSON 编辑区，调试页顶行经共用 `ProtocolSelect` 呈现）；定义/用例保存协议可用性校验 40511（PLUG-002 预留码首次兑现）；新增会话级 `GET /api/v1/plugins/protocols`（协议选项数据源，普通成员可见）；mock `/ws/echo` RFC6455 回显端点（e2e 采样目标）
- **外部工具契约（TOOL-001/TOOL-002）**：`POST /api/v1/open/api-sync`（IDEA 插件批量 upsert，幂等键 method+path，软删复活，批内重复/超限 422·10023/10024）+ `GET /api/v1/open/api-definitions`（回读分页信封）+ `POST /api/v1/open/api-capture`（浏览器抓包导入：URL query 逐键拆解、敏感头五枚脱敏、skip-if-exists 不 bump version、ftp 等拒绝 10025）；APIKEY Basic(base64)/Bearer 双形态；插件本体=外部仓库交付（JVM/MV3，技术栈红线）
- **报告高级分析（RPT-004，超出基线自主设计）**：`GET /reports/stats?days=7|14|30`（连续补零趋势/类型分布/失败 TOP5，内存聚合，非法 422·60422）+ 统计页 `/reports/stats`（报告页签导航、自绘 SVG 双序列趋势图零图表库、空态引导）
- **K8S 型资源池（EXEC-004）**：默认池 type NODE↔K8S 切换 + `ResourcePool.config` JSONB 四项配置（apiServer 强制 https/namespace RFC1123/token 只写不读掩码/image 默认值；门禁 3 例外登记）+ `PUT ?test=true` apiServer /version 试连不落库（safe-fetch 新 `allowPrivateKeepLoopback` 口径：私网/ULA/CGNAT 放行、环回/链路本地/非路由拒；`POOL_K8S_ALLOW_LOOPBACK` 测试栈豁免）+ 池管理页 K8S 表单/试连三态/休眠往返 + task-runner Deployment 清单模板（附录 A）+ 池 DTO `loadTest/uiTest` 占位字段
- **企业版占位（LOAD-001/UIT-001，清单 §12.10 同口径）**：模块开关 `load`/`uit`（缺省即关，存量零迁移）+ 保留权限点 `PROJECT_LOAD/UIT:READ`（SYSTEM_ADMIN/ORG_ADMIN/PROJECT_ADMIN 映射）+ 占位导航组与 `/load` `/ui-test` 企业版方向空态页；LOAD-002 分布式压测架构稿（拓扑/契约冻结，红线重申不自研压测内核，测试豁免登记）
- **基础设施**：错误码 10023-10025/50422/50423/60422（guard 中央映射同步）；`moduleFlagsSchema` 扩 load/uit；jm 栈/e2e 栈 plugin-runner 端口隔离（PLUGIN_RUNNER_PORT 4030/4031，客户端默认跟随——多 worktree :4010 互抢第三案收口）；`gen-jmx-p4.mjs` 生成器（multipart 上传采样器/HeaderManager/JSR223 props 桥/多变量提取）

### 修复与加固

- **S6 潜伏缺陷三处（引擎协议链路首次真执行暴露）**：registry `webBaseUrl` 恒回退 :3000（不回退 WEB_URL→注册表恒空）；轮询鉴权头 Bearer vs `x-internal-token` 恒 401；step.ts 协议分派前 resolveUrl 把插件协议占位 url 误判「相对路径未选环境」——修复后引擎装载/执行链路（上传→启用→30s 轮询→CJS 装载→采样→报告）首次全通
- **S1 潜伏**：`PUT /projects/{id}` zod `.parse` 失败曾 500（rules §4.5 无效参数禁 500）→ safeParse 422
- plugin-runner bootstrap 与引擎 registry 工厂解析双层解包（CJS bundle 适配）；INTG-003 原型 `<uuid>` 未转义致 oxfmt 解析失败（顺手修复）；`pluginApi.list` 签名加可选 kind（plugins 页 queryFn 包箭头）
- 规格勘误登记 15 则（description 裁撤/审计动作统一 open.exec/droppedBodies 裁撤/来源以变更历史承载/url 占位/协议选项数据源/CJS 双层解包/k8s 摘要恒回显/PoolUpdateInput=z.input/试连环回豁免/safe-fetch 选项化/reportStats 拆文件等，见各规格 §8）；Mimosa FP 台账 #4（RFC 6455 强制 SHA-1）

### 测试与收口

- 单测 348 全绿（新增 116：引擎插件两套件 19 含内嵌 ws echo/mini broker；web 39 含池守卫矩阵 9/试连三态/open-sync 幂等/统计聚合/SVG 路径；shared 13 权限点与错误码矩阵）
- JMeter 新增 7 计划全绿（LOAD-002 豁免登记；四类×四断言，含 multipart 上传/409 版本递增/props 桥 Basic/收尾状态恢复防栈内泄漏）
- Playwright 新增 5 spec 8 用例全绿（三类断言；含 ws 真执行对 mock echo 回显、引擎 30s 轮询重试容错、K8S 休眠往返、占位三态；TOOL 两规格无 UI 面豁免登记）
- OpenAPI 快照 277→284 paths（--check 过）；typecheck 13/13；format 全绿

## [v0.7.2] - 2026-09-28 — AI 智能助手 UI v2（Ant Design X 重构）

### 变更

- **AI 智能助手面板重构（AI-004 §9，用户验收反馈驱动）**：表现层全面换用 **@ant-design/x 1.6.1**（选 1.x 线 peer antd ^5.20.3；2.x 需 antd 6 属架构级升级不采用）——`Conversations` 会话栏（active 高亮 + hover ⋯ 菜单重命名/删除，替代双击重命名）、`Bubble.List` 气泡流（助手渐变头像/用户主题色渐变气泡/流式光标/错误态红边气泡）、`Sender` 圆角输入容器（动作条内联模型下拉 + 圆形发送钮，loading 态自动切换停止钮）、`Welcome + Prompts` 空态（三条能力建议卡点击即填入，竖排）；面板 560→720px
- 后端 SSE 契约（delta/done/error 帧）、`streamAiChat`、会话服务**零改动**（jmx/单测不受影响）；全部 data-testid 保留，AI-004-01 会话定位器随 Conversations DOM 调整为文本定位（规格 §9 登记）
- **SYS-007 本地执行页回填竞态修复（勘误 2）**：初始查询迟到时渲染期回填覆盖用户已输入地址（慢网可现：输入被抹→检测钮永久禁用）；新增依赖改变 chunk 时序后在 CI 确定性暴露——dirty 守卫（用户编辑后迟到回填不覆盖）
- 规格 §3/§9 与 v2 高保真原型（docs/design/AI-004-ai-assistant/v2-antd-x/，先于编码产出）同步更新；视觉走查两轮（建议卡横排溢出→竖排修复、placeholder 折行修复）

### 测试

- **补齐 chat SSE 帧序列单测**（`chat-sse.test.ts`：delta*→done 顺序/done 载荷（messageId/conversationId/title 截 20）/半截 delta+error 帧兜底且助手不落库）——此前帧 wire 格式仅 e2e 断言，而 event-stream body 读取是 Playwright 弱支撑（AI 域并跑实测 flake：body 缓冲被驱逐即 protocol error）；e2e AI-004-01 改为容错读（读到则断言）并补请求负载断言
- AI 域全量 e2e 回归（AI-001~005，并行 4 workers）绿；SYS-007 全 spec 绿；typecheck/oxlint 绿；jmx 无涉及（纯表现层+测试加固）

## [v0.7.1] - 2026-09-28 — Mimosa 门禁误报根治（静态分析友好重构）

### 变更（行为等价，rules/security.md §8.6 制度化）

- **safeFetch 薄包装移除 → outboundDispatcher 工厂**（台账 #4 根治）：`safe-fetch.ts` 不再导出「直接以自身参数调 fetch」的包装（该形态被判 SSRF 入口，守卫语义无法被静态分析建模）；三调用方（AI 上游 chat-client / 通知 webhook robot-sender / Swagger 同步）改为模块级一次性构造 dispatcher 实例直连 `fetch(url, { dispatcher })`——连接期 IP 校验语义不变（同一 agentFor），env 豁免开关移至模块初始化消化（fetch 调用表达式零 env 读取）
- **同名碰撞消链**（台账 #5 根治）：mock 单测局部 `post()` → `postCompletions`（曾与 Playwright `request.post` 误并 35 条跨文件污点）；e2e `s2-helpers.ts` 局部 `walk` → `flattenModules`（曾与 api/import.service 路径遍历 sink 误并 1 条）
- **制度沉淀**：rules/security.md 新增 §8.6「根治优先」——三类已验证形态（dispatcher 工厂/env 出调用表达式/测试 helper 命名避撞）+ 验证口径（audit crossFile 归零 + 测试绿 + commit 实过门禁）；台账 #3/#4/#5 状态升级「已根治」

### 测试

- web 单测 118 全绿（safe-fetch 守卫矩阵不涉及）、mock 单测 12 全绿、typecheck/oxlint 绿；`mimosa audit --deep` crossFile **39→0**；S5 演示视频归档 commit 与本分支 commit 均实过 git-gate 无拦截

## [v0.7.0] - 2026-09-28 — Sprint 8 稳定化（M9 标准版 GA 里程碑）

### 新增（全量交付：三层测试 + CI 全绿）

- **性能基线（QA-001）**：`scripts/perf-seed.mjs`（幂等万级种子：专用项目+10 模块+10k/1k 用例分批直插）；`scripts/perf-baseline.mjs` 三场景基准（万级列表+keyword/level 筛选 P95、报告详情 P95、100 并发 api_debug 任务全成功断言+吞吐统计；JSON+markdown 报告，超阈非零退出）；mock `/perf/echo` 回显端点（基准采样目标，排除外网抖动）；独立 `perf.yml` CI（PR=quick 1k/20、main+手动=full 10k/100）；`pnpm perf:seed/perf:baseline` 入口。本地 full 实测：列表 P95 11ms（阈值 1000）、报告 6ms（阈值 2000）、100/100 并发 772ms 全成功
- **安全加固（QA-002）**：`safe-fetch`（undici Agent connect.lookup 连接期 IP 黑名单校验——校验与建连同一次解析，消 DNS rebinding TOCTOU；S7 登记残余收口）三处出站统一（AI chat/Swagger 同步/通知 webhook）；CSRF Origin 校验（非幂等+会话 cookie；Origin/Referer 不同源 403 10013；缺失放行——SameSite=Lax 第一层+非浏览器客户端兼容，规格登记决策）；安全响应头五枚（nosniff/DENY/Referrer-Policy/Permissions-Policy/HSTS）；登录暴力破解限流（IP 维度 5 次/10 分钟 429 10014，成功清零，XFF 首跳取 IP，审计留痕）；密码策略统一（≥8 位且含字母与数字，注册/创建/改密四处）；`pnpm audit --prod --audit-level high` 进 quality job（依赖升级收口：nodemailer 6→9、pnpm overrides postcss≥8.5.18/deepmerge-ts≥8——6 high 清零）
- **可观测（INFRA-004）**：`@rabbit/shared/logger` 统一 pino logger（redact 脱敏矩阵含嵌套/数组、module 子 logger、ALS 请求上下文 reqId/userId/orgId/projectId 自动附带、TTY 单行美化自实现流；子路径导出防客户端 bundle 拉入 node:stream）；reqId 链路（middleware 生成/透传+x-request-id 注入+X-Request-Id 响应头）；访问日志（guard 五包装器统一：method/path/status/ms；open API 面同口径）；`GET /system/metrics` Prometheus 文本最小指标集（队列 depth/active/dead、引擎槽 used/cap、任务时长 P50/P95、HTTP 计数——权限 SYSTEM_METRICS:READ）；ready 增强（存储写探针+默认池 3 拍心跳，NO_ENGINE=1 跳过不阻塞）；全栈 console.* 清零（web/engine 服务路径；CLI 脚本例外）
- **失败任务排障包（INFRA-004）**：`POST /reports/{taskId}/troubleshoot-pack`（任务定义快照+items 摘要+事件流末 50 帧+日志检索说明 → 单 JSON 直下；非 FAILED 422 70060 防直发；报告页「排障包」按钮仅失败任务渲染，三态原型走查）
- **备份恢复（INFRA-004）**：`scripts/backup.mjs`（SQL 逻辑导出：全表行+附件/文件目录+manifest → tar.gz；勘误：embedded-postgres 发行包无 pg_dump 二进制，物理 dump 口径登记部署文档）；`scripts/restore.mjs`（manifest 校验+PG 大版本比对+TRUNCATE+外键拓扑序回放+jsonb 列类型处理+附件回放）；roundtrip 本地验证（seed→backup→restore→数据全量对齐）

### 修复与加固

- 登录路由未限流（暴力破解面）；出站 fetch 三处各自为政（解析期守卫可被 rebinding 绕过）；middleware 无安全头；jmeter 栈 JM_MOCK_PORT 未导出（RUN_SCRIPT 场景 mock 端口拼错）
- 规格勘误登记：排障包 tar.gz→单 JSON（免新依赖+中文文件名风险）；排障包 LOG_FILE 日志片段裁撤（env 路径读取=路径穿越面，Mimosa 拦截成立；进程日志口径=stdout 按 execTaskId 检索）；排障包 URL 段对齐 reports/[taskId]（与报告详情同口径）

### 测试与收口

- 单测新增 43（shared 27：logger redact/ALS/logFor+密码策略矩阵；web 16：safe-fetch IP 矩阵+连接期 rebinding/CSRF 判定矩阵/限流窗口语义/HTTP 计数器），shared 114+web 118 全绿
- JMeter 新增 3 计划（QA-001 mock echo 四类、QA-002 安全头/CSRF/限流/弱密码四类、INFRA-004 metrics/ready/排障包四类——HeaderAssertion 换 ResponseAssertion 响应头字段，5.6.3 无该类），全量 55 计划全绿
- Playwright 新增 2 spec 4 用例（登录限流三态 XFF 隔离+route 注入、排障包按钮三态+直发 422），全量全新口径全绿
- OpenAPI 快照 277→279 paths（--check 通过）；依赖审计 prod high=0

## [v0.6.0] - 2026-09-28 — Sprint 5 协作通知（M6 里程碑）

### 新增（全量交付：三层测试 + CI 全绿）

- **通知机器人（MSG-001）**：机器人 CRUD（5 渠道 inapp/email/wecom/dingtalk/feishu，上限 10/项目，webhook 保存期+发送期双重 SSRF 守卫）；事件配置（AppSetting `message.events`，事件目录 11 键五大类：缺陷 5+评审评论+用例评论+计划执行完成+场景执行完成+定时任务启停）；分发服务 `notify.dispatch`（接收人∪@提及∪关注者−操作人同人去重；站内信同步落库/邮件尽力投递/三方机器人有界等待，全程不抛错）；事件接线五处（缺陷域/评论横切/exec 回调含定时 notify 标志/schedule 启停）；站内信中心（顶栏铃铛未读数 30s 轮询+下拉+近 90 天列表页+单条/全部已读）；mock 三平台 webhook 接收端点（收包断言控面）
- **缺陷协作与回收站（BUG-002）**：回收站视图（?recycled=true）+批量恢复/批量彻底删除（ids≤100，级联集同单条）；评论 @提及（mentions 落库+成员校验+被提及人站内信，缺陷/评审/用例三处横切）；关注变更通知（缺陷更新/流转→关注者，操作人剔除）；「本地删除不推平台」口径文档化
- **公共脚本（PROJ-005）**：脚本 CRUD（javascript/参数定义 name+默认值+必填/标签，上限 100）；状态二态 DRAFT↔ENABLED（仅发布可引用）；在线调试（web 侧 quickjs 沙箱，API 面与 engine processors 对齐，5s 超时强杀+log 200 行截断；`serverExternalPackages` 解决 Next 打包 wasm）；前后置引用（processor `scriptRef` additive——构建期展开为内联脚本+参数注入 vars `param.{name}`，api 用例/场景步骤/环境全局三链路，engine 无感知）；删除引用保护（409 附清单，?force 强删）
- **环境组与全局参数（PROJ-006）**：全局参数项目级单例 KV（PUT 全量替换，`buildEnvSnapshot` 既有合并逻辑的入口交付——作用域链=临时>环境变量>全局参数）；环境组 CRUD（有序 environmentIds≤10，物理删）；组展开过滤软删环境+ENV_GROUP_EMPTY 422；按组执行（scenarios/execute 与 plans/{id}/execute 增 envGroupId 与 envId 互斥——按组内顺序逐环境各建一个任务）
- **Git 仓库文件（FILE-001）**：存储库 CRUD（gitea/github/gitlab/gitee 四平台 adapter 归一化——contents 族+gitlab tree/raw；token AES-256-GCM 复用 S6 密钥体系，hasToken 掩码不回显）；连接测试（repo 元信息探活）；按分支+路径拉取（目录递归≤3/文件≤50/单文件≤SYS-005 上限；重复拉取=覆盖刷新）；`file_items` 补 branch/repo_path 溯源列（门禁 3 例外登记 test-domain-model §6）+来源徽标+单文件重新拉取；文件回收站（PROJ-004 登记兑现：recycled 过滤+恢复+purge 清对象存储）；mock 四平台标准 API 前缀端点
- **个人中心（SYS-007）**：容器 `/personal`（五子页侧栏，APIKEY 收编复用 INTG-003）；个人信息查看/编辑（邮箱=登录名不可改；头像=首字母色块简化登记）；修改密码（argon2 旧密码校验 10020，无状态会话口径勘误 1）；本地执行配置（环回白名单校验 10021+3s 连通检测+优先本地开关，UserPreference 承载）；个人默认模型（S7 AI-001 挂点兑现：`resolveRuntimeForUser` 个人启用>系统默认，助手/生成四调用点接入）
- **基础设施**：权限点 PROJECT_MESSAGE 四动作+PROJECT_SCRIPT 扩四动作（预置组同步）；错误码 10020-10022/20440-20446/20450-20454/20460-20461/40460-40463；guard toResponse 白名单同步；api-client patch 原语+s5.ts 域客户端；jmeter 栈注入 OUTBOUND_ALLOW_PRIVATE+RABBIT_INTEGRATION_SECRET；e2e s5-helpers（mock 基址/收包控面/跨用户通知读取）

### 测试与收口

- 单测新增 33（dispatch 分发矩阵 9：开关×渠道×并集去重/提及必收/投递失败不抛；adapter URL 解析+contents/gitlab 归一化 fetch 注入 18；quickjs 沙箱 6：log/vars/超时/截断；环回校验矩阵 8），web 85/85
- JMeter 新增 6 计划（gen-jmx-s5.mjs 声明式生成，四类×四断言），全量 52 计划全绿；Playwright 新增 6 spec 17 用例（三类断言；含 mock 收包断言与跨用户通知断言），全量 150/150（workers=4）
- OpenAPI 快照 251→277 paths（--check 通过）；实现侧缺陷修复 5 项+预防 1 项、生成器/栈脚本缺陷 5 项（见 sprint-overview §7.2：webhook 协议漏冒号/parseRepoUrl 丢端口/mock 契约缺元信息端点/quickjs 打包/表单回填/no-store 预防/UDV 驼峰名/UDV 自引用/假 uuid 版本位/MOCK_PORT 未透传/组重名唯一域）
- 白名单登记 2 处：/bugs、/files 页 project store 水合前 `projects/null` 404 首帧竞态（S1 既有面）

## [v0.5.0] - 2026-09-27 — Sprint 6 集成与插件（M7 里程碑）

### 新增（全量交付：三层测试 + CI 全绿）

- **插件框架（PLUG-001）**：plugin-runner 宿主（HTTP loopback 命令面 + worker_threads 每插件一线程 + 崩溃退避重启 1/4/16s + 内置 platform-echo）；tarball 上传流水线（清单/SPI 版本校验 + 成员白名单防路径穿越 + MinIO 存储 + 版本递增 409）；启停/组织范围/删除依赖校验；管理页 `/system/plugins`
- **协议插件 SPI（PLUG-002）**：SamplerPlugin SPI 冻结（configSchema/buildSampler/SamplerResult 标准化）；engine 进程内注册表（30s 轮询 internal 清单 + dynamic import 缓存去重）；请求协议字段 additive（protocol/protocolConfig）；tcp-conn 示例插件；执行分支 CONFIG_ERROR 40510
- **Jira 对接（INTG-001）**：组织服务集成（凭据 AES-256-GCM 加密 + HKDF 平台派生 + 掩码不回显）；测试连接经 runner 平台插件；项目关联（projectKey/缺陷类型映射/状态映射覆盖/增量定时）；推送创建/更新 + 拉取状态回写 + syncState 状态机 + ChangeLog 留痕；同步历史（AppSetting 截 20）
- **禅道/TAPD 对接（INTG-002）**：同 SPI 双适配器（禅道 token 会话 + 失效重登一次；TAPD Basic）；PLATFORM_META 平台元数据单一来源；复用 INTG-001 全部编排
- **Jenkins CI（INTG-003）**：个人 APIKEY（ak/sk 生成、sha256 常量时间比对、5 条上限、一次性展示、吊销）；第三认证通道（Basic/Bearer）+ Redis 固定窗口限流 10 QPS；开放 API（open/exec api-case/scenario/轮询/报告摘要 白名单字段）；审计 open.exec
- **Swagger 定时同步（API-011）**：任务 CRUD（上限 10 · cron 词法校验复用 S3）；URL 拉取出站守卫（DNS 解析后 IP 黑名单，OUTBOUND_ALLOW_PRIVATE=1 测试放开）；内容嗅探 json/yaml + openapi:3 标识校验；复用 S2 导入管线判重报告；手动/定时同路径
- **审计日志（SYS-008）**：withAudit 声明式包装 + BullMQ 异步批量落库（降级直写）+ 三级查询（system/org/project 高级筛选）+ 保留时长清理（每日 03:00 分批 1000）+ audit.purge 汇总留痕
- **基础设施**：PlatformIntegration 表 + ApiKey prefix 索引（迁移 s6）；权限点 7 枚（SYSTEM_PLUGIN/ORG_INTEGRATION/SYSTEM_AUDIT/ORG_AUDIT/PROJECT_AUDIT 读写）；错误码 70xxx 段 17 枚 + 10xxx 3 枚 + 40xxx 7 枚；mock 三平台子集 + 状态注入控制面；esbuild 插件打包链（pnpm build:plugins）
- **勘误**：PLUG-001 勘误 1（gRPC→HTTP loopback）/勘误 2（runner dev 内嵌启动，生产独立部署口径保留）；INTG-003 勘误 1（错误码 10005-10007 与既有占用冲突 → 10010-10012）

### 测试与收口（本段随 v0.5.0 一并交付）

- JMeter 5 份（四类×四断言三轮稳定全绿）；Playwright 15 条 + MAINFLOW-s6（三类断言）；全量 e2e 131/131（S6+S7 共存口径）；OpenAPI 快照 225 paths；变基 S7 main 后合并修复（guard 三元链/LeftNav 拆分/run-api-tests 融合）；CI e2e job 补 build:plugins
- 调试挖出的深层缺陷：instrumentation.ts 自 S3 起未导入 node 版（schedule/audit 消费者死代码）；插件并发上传竞态（name+kind 唯一索引）；SPI since ISO 契约；bugs 列表平台徽标漏交付；插件页信封消费崩溃等

## [v0.5.1] - 2026-09-27 — Sprint 4 计划完整与脑图（M5 里程碑）

#### 新增

- **测试规划与测试点（PLAN-002）**：测试点树 CRUD/同级重排/挂载移动（TestPoint 预建模型零迁移）；配置继承链 `resolvePointConfig`（点显式 > 祖先链最近显式 > 计划默认；环防御+深度上限 20，shared 纯函数）；三类用例（功能/接口/场景）挂点关联与未分组平铺兼容（PLAN-001 老数据 pointId=null 不迁移）；点内清单计数分色徽标；执行本点（限定点范围引擎任务）。
- **计划执行（PLAN-003）**：**执行契约 v4**（EXEC_CONTRACT_VERSION=4，全 additive）：plan 命令（items=api_case/scenario 子命令复用既有构造器，点级 env 覆盖，串行/并行 p-limit/失败停止 SKIPPED 余项）+ 控制器命名帧（log kind=node-name——S3 遗留「报告树 loop 节点 fallback 名」修复）；引擎 plan 内核（kernel/plan.ts 分派 runStep/runScenarioItem，env 优先级 item>task）；回调回写 PlanCaseRef（SUCCESS→PASS/FAILED·FAKE_ERROR→FAIL/SKIPPED→SKIPPED）+ 自动更新状态激活（PASS 方向：CASE-006 关联功能用例 NOT_RUN→自动 PASS，execHistory source=auto）+ 计划状态推进；执行历史（ExecTask type=plan 分页）；单条引擎执行（行内 ▶ 构造单项 plan 任务）；执行配置四项从 PLAN-001 占位全激活；脑图执行 Tab（S/E/B/K 快捷标记+右侧详情面板+步骤对位）。
- **计划分组与归档增强（PLAN-004）**：计划组 CRUD（type=GROUP，手册口径社区版无 License 门控——对标差异显式登记）；成员移入移出（单计划至多一组）；列表组视图（组行聚合进度/通过率/阈值达标 N/M+成员嵌套+未分组平铺）；组聚合报告（reportType=plan_group 懒创建+组总结编辑保存）；组归档级联成员（恢复=整组）；批量归档/恢复（计划与组混选）。
- **计划报告导出（PLAN-005）**：报告完整视图（概览六卡含误报单列+阈值横幅+测试点维度折叠明细+接口/场景行执行报告钻取链接）；一键总结草稿（服务端统计模板：达标口径/失败阻塞误报/最薄弱点/最近执行——不落库，确认后保存）；分享链接（token 复用 ReportShare 四档有效期+吊销+免登录只读页 /share/plan/{token}）；导出 PDF（打印友好页 /plans/{id}/report/print 与分享打印页，自动 window.print）；导出 CSV（UTF-8 BOM Excel 兼容，attachment 下载）。
- **脑图模式（CASE-007）**：自研通用脑图组件（MindmapTree 受控组件+layout 纯函数布局+useMindmapKeyboard 快捷键状态机，零三方依赖）；用例列表/脑图双模式双向同步（URL ?view=mindmap 持久化）；层级 模块→用例→步骤（desc/expect 行内）；快捷键体系（Enter 同级/Tab 子级/Ctrl+Enter 进入/M 模块/C 用例/Backspace 删除/F2 重命名/方向键导航/输入框内全屏蔽）；批量保存（模块批+用例批一事务，tmpId→idMap 回传，版本冲突软收集）；多选批量移动/删除；无 UPDATE 权限只读。
- **用例依赖与历史增强（CASE-008）**：循环依赖检测（新增边 BFS 后置闭包，直接/间接成环 422/30484，深度上限 100）；自依赖专码 30485；执行联动（计划内标记时前置 FAIL→blockedBy 提示默认 BLOCKED，软提示可强制改标，result.blockedBy 留痕）；变更历史分区摘要（diff.partitions：字段级 from→to+步骤增删改计数；旧记录兼容）。
- **待办跟进创建（DASH-002）**：我关注的七维度筛选（case/plan/review/api_case/scenario/bug，服务端 kind 过滤+项目维度）；我创建的修正为 createdBy=me 口径（原实现项目全量——缺陷修正）+ 扩展接口用例/场景两维度；我的待办-我的执行纳入接口/场景 refs（类型徽标）；Follow 通用横切（follow.service 白名单+幂等+目标存在性 404/30504）四域入口补齐（计划列表行+详情/场景详情 S3 去向兑现/接口用例详情/评审详情）。
- **基础设施**：S4 错误码分段（30xxx 测试管理族 12 枚+50012）；guard `zodParse` 统一出口（ZodError→20422）；api-client s4.ts（pointApi/planCaseApi/planExecApi/planGroupApi/planReportApi/planShareApi/mindmapApi/followApi）；OpenAPI 快照 188→214 paths；JMeter 生成器 gen-jmx-s4.mjs（多提取器 supports extracts[]）。

#### 修复

- zod 裸 .parse 在路由层抛 ZodError 落 500（guard 新增 zodParse 统一转 20422，16 个 S4 路由接入）。
- S4 新错误码未入 guard 404/422 分段表（POINT/GROUP/DEPENDENCY/MINDMAP/FOLLOW 族误落 400）。
- scenarios API 路由 slug 命名冲突（新 follow 路由 [scenarioId] 与既有 [id] 并存致 Next 构建「different slug names」报错）。
- createPlanTask 对空场景集仍调 buildScenarioCommands（纯接口用例计划执行抛 40474 场景不存在）。
- exec-tasks 列表 type 枚举缺 plan（过滤 422「Invalid enum value」）。
- addPlanCases added 计数仅统计功能用例（改三类 before/after 计数）且 api_case/scenario 行漏落 execUserId（我的待办-我的执行看不到接口用例）。
- listPlanGroups 成员查询 where 误排未分组计划（`groupId: {not: null}` 致计划列表恒空）。
- CaseMindmapView 拉取 pageSize=500 超列表契约上限 100（脑图「数据加载失败」）。
- 计划关联 Toast 文案随 added 口径升级翻倍（「已关联 4 条（功能 2·接口 2）」→按提交数呈现）。
- pool EXPECTED_ENGINE_VERSION 滞留 0.3.0（契约 v4 引擎 0.4.0 节点被标 UNMATCHED 不显示在线）。
- dashApi.followed 客户端缺 kind 参数（工作台七维度改服务端过滤）。

#### 测试

- Vitest 108（shared 76：resolvePointChain 继承矩阵/组聚合/总结草稿/CSV 转义/脑图契约/执行契约 v4 plan 命令与旧分支兼容；engine 32：plan 内核分派/env 优先级/STOPPED 透传）。
- JMeter 36 计划全绿（新增 7：PLAN-002~005、CASE-007/008、DASH-002；四类场景×四项断言）。
- Playwright 119 用例全绿（新增 12 含 MAINFLOW-s4 主链路：建计划→建点→挂载接口用例→执行→报告点分组→CSV→工作台关注；三类断言 UI+Console+接口）。
- 既有口径随 S4 语义同步更新：CASE-003 T1-3 自依赖断言 20422→30485；CASE-006-02「执行(S4) 禁用」断言更新为行内单条执行按钮激活；DASH-001 行 testid 兼容包裹 dash-item。

## [v0.5.0] - 2026-09-27 — Sprint 7 AI 能力（并行启动：worktree 分支 sprint-7-ai）

#### 新增

- **模型网关（AI-001）**：系统级模型 CRUD（DeepSeek/OpenAI/智谱三供应商，协议统一 OpenAI 兼容 chat/completions）；apiKey AES-256-GCM 加密落库（密钥=scrypt(SESSION_SECRET) 派生，任何响应只回 `sk-****` 掩码、编辑留空=不改）；连接测试（探测分支回声）；设默认（事务内清旧置新）；baseUrl SSRF 守卫（私网/环回/链路本地/云元数据/CGNAT/IPv6 ULA 全拒，DNS resolve 后全 IP 复检；`AI_ALLOW_PRIVATE_BASEURL=1` 仅豁免环回供测试栈 mock 供应商）；登录可见启用模型下拉。权限点 SYSTEM_AI:CRUD（仅系统管理员）。
- **功能用例 AI 生成（AI-002）**：用例列表「AI 生成」抽屉——需求输入+目标模块（TreeSelect）+提示词模板+模型选择 → 生成 1-10 条草稿（`extractJsonArray` 容错解析：剥栅栏/括号平衡/字符串转义安全）→ 条目弱校验（坏条剔除 skipped 明细）→ 勾选导入走 CASE-001 创建端点（level 映射 critical→P0…low→P3）；AiGenRecord 留痕（scene/generated/imported/prompt 快照）+ 只读列表。
- **接口用例 AI 生成（AI-003）**：单条模式按 ApiDefinition 摘要（8KB 截断）生成接口用例草稿（请求差量+断言建议，operator 白名单五值，缺 status 断言自动补）；批量模式粘贴 OpenAPI 3.x 文档（复用 S2 解析器，≤20 接口/批）；断言映射纯函数 `aiDraftToAsserts`（AI 草稿→S2 六断言：status_code/body_jsonpath/response_header/response_time，exists 弱化 contains 登记简化）；导入走 API-003 创建端点（绑定目标定义，不自动建定义——与 API-011 边界）。
- **AI 智能助手（AI-004）**：顶栏 ✦ 入口侧滑面板（560px）；个人会话管理（列表/新建/重命名（双击）/软删，30 天窗口）；SSE 流式对话（POST text/event-stream，delta/done/error 帧；打字机+AbortController 停止；错误帧不落库——半截不留）；上下文窗口最近 20 条；模型下拉（按会话记忆）；个人级隔离（service 层 userId 过滤防枚举 404）；平台身份 system prompt（无工具调用——ChatToolEngine 对标登记 Backlog）。
- **提示词自定义（AI-005）**：项目级模板 CRUD（scene=case_gen/api_gen 两类 Tab）；占位符定义域校验（未知占位符 422 70505，合法集 case_gen={requirement,module,design_method}/api_gen={api_spec,design_method}）；`renderTemplate` 渲染（缺失变量回退空串）；设计方法字段（建议 chips）；同 scene 默认唯一（事务清旧置新）；停用模板不可默认且不出现在生成抽屉；内置默认模板常量回退（不可删改）。权限点 PROJECT_AI:CRUD（项目管理员全量/成员 READ）。
- **数据模型**：ai 域 5 表（AiModel/AiConversation/AiMessage/AiPromptTemplate/AiGenRecord；迁移 s7_ai_domain）——S0 基线例外登记（AI 契约依赖规格定型，test-domain-model §6）；裸 FK 列（与 FalseAlarmRule 同款，不动 User/Project 存量模型）。
- **mock 供应商端点**：apps/mock 增 `POST /ai/chat/completions`（OpenAI 兼容非流式+流式 SSE 分片；按真实 system prompt 固定开头分支确定性输出——测试契约，生产代码零测试标记）；测试栈种子（RABBIT_SEED_AI_MOCK_BASE 注入时内置 e2e-mock-模型，dev/生产不设=不种）。
- **web 前端**：/system/ai-models 模型管理页（卡片列表/新建编辑 Modal/连接测试/设默认/启停）+LeftNav 系统设置入口；cases 页「AI 生成」按钮+AiCaseGenerateDrawer；apis 页行操作「AI 生成」+ApiCaseGenerateDrawer（单条/批量双 Tab）；TopBar ✦ 入口+AiAssistantDrawer；/settings/ai-prompts 提示词管理页+LeftNav 项目设置入口；OpenAPI 快照 188→203 paths。
- **错误码 70xxx AI 段**：70404/70414/70422/70424/70444/70501-70505（HTTP 映射 404/422/502——供应商上游失败 502 透出状态不泄 key）。
- **质量体系**：Vitest 163（新增 66：shared ai 27——extractJsonArray 栅栏/噪声/嵌套括号矩阵、renderTemplate/scanPlaceholders、断言映射、schema refine；web gateway 31——加密 roundtrip/GCM 篡改检测、SSRF 守卫 15 地址矩阵（DNS mock 离线确定）、ChatClient 流式聚合/上游错误；mock ai-mock 8——三分支+流式聚合）；JMeter 34 计划（新增 5：AI-001~005 四类场景×四项断言，含 SSE 采样器 content-type+rawContains 断言与 SSRF 422 真实拦截）；Playwright 114（新增 7：五规格三类断言 + 掩码脱敏/权限 403 + 会话隔离 404 防枚举）。
- **文档**：test-domain-model §2.8 ai 域 + §6 例外登记；Sprint 7 概览 + 五份规格（Approved→Implemented）+ 五组高保真原型（docs/design/AI-001~005/，人工确认随验收走查）。

#### 并行交付说明

- Sprint 7 经依赖评估后**提前并行启动**（worktree `../RabbitAITest-s7` + 分支 `sprint-7-ai`，基线 main 77b74ca）：AI 域硬上游=SYS/CASE/API（S0-S2 已交付），S6 插件 SPI 对 AI 网关为前置无关项（dependency-graph §3）；范围收窄=AI 生成限定功能/接口用例（场景用例生成 Backlog）、个人级模型设置延后 SYS-007、AI-003 批量不做接口定义同步（API-011 S6 口径）。

## [v0.4.0] - 2026-09-27 — Sprint 3 场景自动化（M4 里程碑）

#### 新增

- **场景编排（API-006）**：场景 CRUD（等级 P0-P3/状态/标签/模块树 scene=scenario/回收站软删恢复彻底删/复制/批量移动复制删除/变更历史）；步骤树（9 类步骤：引用接口/用例/场景·复制或引用、自定义请求、循环×3（次数/While/ForEach·CSV 列表源）、条件 quickjs、仅一次、脚本、等待）；步骤操作（启停/复制/加子级/上下移/删除）；单步执行（以该步骤为根的临时场景）；步骤级覆盖（失败规则/追加断言/步骤参数）；五配置区（参数/前置后置/断言/设置：Cookie 策略·思考时间·失败规则）；执行契约 v3（EXEC_CONTRACT_VERSION=3，帧 additive：stepPath/iteration/step-op/step-skip/vars-final/FAKE_ERROR）。
- **场景参数化（API-007）**：常量/列表/CSV 三类参数（CSV inline 或关联文件管理）；foreach 数据源=列表名或 CSV 列名（任务下发时服务端预展开迭代序列，row 保留字注入整行）；变量视图（四级来源合并展示：步骤提取>步骤参数>场景参数>环境变量）；渲染优先级链统一。
- **批量执行与定时（API-008）**：列表勾选批量执行（环境/资源池/串行并行/失败停止，并行=池级 p-limit 并发）；定时任务（cron 词法校验最短 5 分钟、AppSetting 权威源+BullMQ repeatable 双轨、启停/立即执行/场景全删自动停用）；任务中心「定时任务」Tab 从空态兑现为数据源（场景定时）。
- **导入导出（API-009）**：导出 Rabbit JSON（保留引用关系 ref / 展开为自定义请求 flatten 两模式）；导入 Rabbit JSON / JMeter jmx（HTTP 采样/循环/CSVDataSet/JSR223/等待映射）/ MeterSphere v3 JSON；导入预览（格式探测/场景步骤数/首步骤/警告）。
- **内置函数库（EXEC-003）**：`${__func()}` 引擎函数 10 个（计数/随机/UUID/时间/时间偏移/摘要/Base64/URL 编码/变量判定/场景名）+ `@mock` 数据函数 12 个（字符串/整数/浮点/姓名/邮箱/手机号/日期/日期时间/省市/身份证/正则/列表取一）+ 管道叠加 8 种（md5/sha256/base64/substr/大小写/trim/default）；渲染管线统一（renderString 单点）；FUNCTION_CATALOG 抽纯数据模块（客户端提示与引擎实现同源，node:crypto 隔离）。
- **误报规则（API-010）**：项目级规则 CRUD（匹配器状态码/响应体包含/响应头包含/耗时上限，多条件 AND 至少一项；上限 50）；执行终态对 FAILED item 匹配 → 改判 FAKE_ERROR + FalseAlarmHit 留痕（规则名+stepPath）；summary 误报单列；FAKE_ERROR 不计任务失败；停用/删除后新执行不再标记（不回溯）。
- **场景报告（RPT-003）**：reportType=scenario 渲染——统计五卡（执行项/通过/失败/误报/总耗时）；场景 item 表（误报徽标+命中规则 tooltip）；步骤树视图（stepPath 树聚合+循环迭代分组+跳过原因）；步骤级钻取（渲染后请求快照/响应/断言/耗时）；变量终值 Tab（vars-final）；场景执行历史；分享链路复用 RPT-002（免登只读五卡+误报徽标同口径）。
- **引擎内核 v0.3.0**：runScenarioItem 递归执行器（loop×3/condition/once/script/wait/失败规则/思考时间/CookieJar 变量作用域链/场景变量断言/vars-final 帧）；runStep 抽出 runner/step.ts（帧元数据/cookie/函数渲染）；serial 顺序 + parallel p-limit(poolConcurrency)；quickjs 条件求值 evalCondition；报告树聚合纯函数 buildScenarioTree（shared，剥无帧包装层）。
- **权限与错误码**：新权限点 PROJECT_SCENARIO CRUD 入预置组（项目管理员全量/组织管理员只读集）；错误码 40474/40476/40484/40494/50005-50011 入册并接入 HTTP 分段映射（404/422）。
- **web 前端**：/scenarios 列表页（模块树+场景/回收站页签+批量执行弹窗+导入导出+定时/误报入口）/scenarios/[id] 编辑页（步骤树面板+五配置区 Tab+变量视图+变更历史）/scenarios/false-alarm 规则页；任务中心定时 Tab（SchedulePanel）；报告页与免登分享页 scenario 分支；FunctionHintPopover（函数目录浮层）；OpenAPI 快照 164→188 paths。
- **质量体系**：Vitest 97（shared 62：新增 s3-execution 20——函数库矩阵/CSV/误报 AND/树聚合/jmx 映射；engine 28：新增 scenario 执行器 10——控制器语义/foreach 注入/失败规则二态/变量断言/vars-final）；JMeter 29 计划（新增 5：API-006~010 四类场景×四项断言，含误报改判全链路与导入导出 multipart）全绿；Playwright 107（新增 16：五规格 UI+权限二态+误报改判对照+RPT-003 分享只读+MAINFLOW-s3 主链路：建场景→编排 7 类步骤→CSV→执行→报告树迭代→误报→导出）。
- **文档**：Sprint 3 七份规格（Approved→Implemented 流转）+ 六组高保真原型（docs/design/，人工确认随验收走查）+ EXEC-003 接口契约评审替代。

#### 修复

- PROJECT_ADMIN 预置组仅含 PROJECT_SCENARIO:READ（缺 CREATE/UPDATE/DELETE）——注册用户建场景恒 403；ORG_ADMIN 只读集补 READ（受限成员二态恢复）
- scenarioCreateSchema：config 必填致「仅名称+模块」创建 422；params/prePost/settings 三对象与 csv 子字段缺 default——部分保存（仅 params.lists 等）422
- 列表分页信封返回 `list`（违反 api-conventions `items`，api-client 类型与前端三方不一致）——前端列表恒空
- query 布尔经 z.coerce.boolean 对字符串 "false" 误判 truthy（recycle=false 恒查回收站）——queryBool 显式映射修复（includeChildren 同步）
- saveSteps/import 将前端 uid/文件 uid 直接作 ScenarioStep 全局主键（跨场景同名 uid P2002）——一律服务端生成新 id + parentId 树重建
- api-client s3 exportJson 走信封解析但端点返回 attachment 流（恒抛 50000）——改 downloadRaw；importPreview/import 的 FormData 经 post() 被 JSON.stringify（服务端 formData() 解析失败）——改 request 直传
- guard 错误码 HTTP 分段表未含 S3 新码（40474/50005/50007 等落默认 400）——404/422 分段补齐
- 场景编辑页保存后 invalidate 期间旧缓存先到触发 effect 重置（刚保存的参数被空配置覆盖）——await 缓存刷新后再解锁
- scenario detail 缺 stepCount 字段、changes 端点返回裸数组（api-client 类型声明 {items}）——响应形状对齐
- engine continue 失败规则吞掉失败状态（item 误判 SUCCESS，规格要求 FAILED）——WalkState.failed 补记
- 场景树聚合含 engine 根前缀产生的无帧包装层（报告树多一层「步骤 0」）——纯包装层剥离（迭代组聚合形态保留）
- 批量执行弹窗对无 SYSTEM_POOL:READ 的项目管理员拉系统池列表（页面恒 403 噪声）——按权限拉取回落默认池
- instrumentation.ts 被双 runtime 编译（edge bundle 解析 pg/fs 失败）——S3 逻辑迁 instrumentation-node.ts（nodejs-only，Next 15.3+ 约定）；客户端组件误引 @rabbit/shared/execution 聚合入口（node:crypto 进浏览器 bundle）——csv/function-catalog 细粒度子路径导出

## [v0.3.0] - 2026-09-27 — Sprint 2 接口测试核心（M3 里程碑）

#### 新增

- **请求参数体系与执行契约 v2（API-004）**：请求体 7 类（none/form_data/form_urlencoded/raw_json/raw_xml/raw_text/binary）；前后置处理器（JS 脚本 quickjs 沙箱 5s 强杀、SQL 只读数据源延后 S3 显式 CONFIG_ERROR、等待）；提取（JSONPath/正则）写回变量并在报告回显；断言 6 种（状态码/响应头/响应体 JSONPath/响应体正则/响应时间/变量）；认证 none/basic/digest（RFC7616）；超时与重定向（≤5 次、307/308 保方法）；变量作用域链 base→环境→参数覆盖渲染 `${var}`；契约 zod 冻结于 shared/execution（事件帧只增不破，S0 兼容读）。
- **环境管理（PROJ-003）**：环境 CRUD/复制/导入导出（同名跳过/覆盖二态）；变量与 HTTP 多域名条件匹配（路径条件>模块条件>默认）；HOST 映射；数据源（内置 PostgreSQL）；全局前后置与断言；执行时环境快照注入引擎（engine 无 DB）。
- **文件管理（PROJ-004）**：file 模块树；上传（JAR/CSV/脚本，JAR 默认禁用启用制）、下载、删除、移动；执行引用（form-data/binary 请求体）；危险类型拒收（.exe 422）；大小受系统参数限制。
- **接口定义（API-002）**：api 模块树 + 列表筛选；API/CASE/MOCK 三页签；导入（OpenAPI3/Postman 粘贴与文件、Rabbit 格式、cURL；覆盖/不覆盖二态）；变更历史；引用关系；列表行内执行跳报告。
- **接口用例（API-003）**：用例 CRUD（差量请求 bundle）；单条/批量执行（选环境+默认池+失败停止开关）；执行历史抽屉；API 定义变更后的差异同步（分区 diff + 待同步标记 + 一键同步）；**clientTaskId 幂等提交**（同键连点/重试复用同一任务，与 (project_id, client_task_id) 唯一索引同语义，含 P2002 并发兜底——收尾审计发现规格声明未实现，补齐）。
- **Mock 服务（API-005）**：规则 CRUD（头/Query/REST 路径/体匹配→响应+延迟）；跟随 API；独立 Mock 服务（开发 :4000/e2e :4001）规则热更新（Redis 全量快照+版本号+PUBLISH 失效，懒加载重读）；未命中 404（code 40401）。
- **资源池调度（EXEC-002）**：默认池并发编辑、节点心跳在线状态、任务停止（非运行中 422 code 50003）、失败重跑（副本重建、不可重跑态 422 code 50004）、并发槽动态生效。
- **任务中心（SYS-006）**：项目/全部两级实时任务列表；执行详情跳报告；停止/重跑；状态筛选；定时任务框架空态（数据源 S3+）。
- **接口报告完整版（RPT-002）**：报告列表/删除；用例级+步骤级钻取（渲染后请求快照/响应/断言表/提取值/日志）；分享链接免登只读+有效期过期失效；保留期外定时清理；重跑入口；api_debug 单请求视图兼容保留。
- **用例关联接口（CASE-006）**：功能用例详情「关联」Tab（case 域经 Provider 读 api_test 域，批量校验非法目标 422 code 40464）；测试计划关联接口用例（执行 S4）。
- **引擎内核 v2**：kernel 纯函数化拆分（render/extract/asserts/processors）；BullMQ 持久化 attempts 2 + 心跳超时回收（引擎重启不丢任务）；回调按 item 分组落库。
- **权限与错误码**：新权限点 PROJECT_ENV/PROJECT_FILE 细化 CRUD、PROJECT_API、PROJECT_EXEC_TASK；错误码 40xxx（API/ENV/FILE/MOCK）与 50xxx（停止/重跑/池）、60xxx（报告/分享）分段入册。
- **质量体系**：Vitest 84（新增 engine kernel 18：渲染/提取/断言矩阵、脚本 5s 强杀、Digest；web 10：OpenAPI/Postman 导入解析、分区 diff；mock 7）；JMeter 24 计划（新增 10：四类场景×四项断言）全绿；Playwright 91 用例（新增 29 + 主链路 MAINFLOW-s2：环境→定义→调试→用例→批量执行→任务中心→报告→分享→Mock 命中→关联）；门禁 8 审计回补 6 项规格声明缺口（API-002-05 权限二态/API-003-04 clientTaskId 幂等/CASE-006-03 重复关联 422·10009+已删除灰显/EXEC-002-01 并发槽位生效/RPT-002-01 过期 token 直改库复验/PROJ-004-03 form-data 文件引用执行内容标记命中二态）；OpenAPI 快照 120→164 paths + api-client s2.ts 手写路径反漂移审计；e2e 常驻库用户累积 268>200 撞 USER_TOO_MANY 致 SYS-004-01 400——测试环境 RABBIT_USER_LIMIT 200→1000（注册通道不查上限仅管理端查，产品默认 30 不变）；4 条调试用例写死 mock `:4000` 依赖宿主机残留 dev mock 侥幸通过——统一 MOCK_BASE/E2E_MOCK_URL 口径、默认环境域名端口从 MOCK_BASE 推导；api-diff 单测字面量类型拓宽致 typecheck 红（改经 schema.parse 构造）。两起环境事故已制度化 rules/testing §3.4.2。凭据 env 化收尾加固（Mimosa 门禁 6 处高危清零）：种子管理员密码 `RABBIT_SEED_ADMIN_PASSWORD`、e2e 测试用户密码 `E2E_USER_PASSWORD` 可 env 覆盖，默认值与既有行为不变（seed/fixtures/SYS-004/PROJ-001）。
- **文档**：Sprint 2 十份规格（Approved→Implemented 流转）+ 十组高保真原型（docs/design/，人工确认随验收走查）。

## [v0.2.0] - 2026-09-26 — Sprint 1 测试管理 MVP（M2 里程碑）

#### 新增

- **用户与权限（SYS-004）**：系统用户管理（创建/编辑/重置密码一次性返回/启停即失效会话/软删邮箱保留占用/30 用户硬上限）；系统-组织-项目三级自定义用户组（预置组只读、权限点勾选树、组成员管理、恢复默认）；权限并集−禁用交集检查链（withPermission/requirePerm，403 code 10003）；权限点登录下发与前端菜单/按钮守卫。
- **系统参数（SYS-005）**：站点 URL/SMTP（AES-GCM 密钥加密 + nodemailer 测试连接回显）/附件大小上限（缺陷附件消费）/数据清理保留时长（下限 7 天）+ BullMQ 每日 03:00 清理 job（超期 ChangeLog/AuditLog 分批删除、软删项目超期物理清除）。
- **项目与成员（PROJ-001）**：组织项目管理（新建/编辑/模块开关（菜单隐藏数据保留）/结束只读（写 422 code 10005）/软删 30 天可撤销）；项目成员（组织成员搜索批量添加、移除联动用户组）；项目切换器成员口径。
- **模板与自定义字段（PROJ-002）**：字段引擎（10 类字段、类型不可改、存量引用软停用、buildValidator zod 动态校验单一来源）；组织/项目两级模板（绑定覆写 required/visibleInList、设默认、复制、缺陷模板上限 20）；项目模板不可逆开关（双确认+组织模板拷贝）；缺陷工作流（初始态唯一/结束态可多/流转矩阵全量替换，非法流转 422 code 10006）；动态字段三处一致渲染（表单/列表列/详情只读）。
- **模块树与用例列表（CASE-002）**：case/bug 双场景模块树（增删改拖拽/环检测/子树计数/关键字定位）；全字段筛选（模块含子级/标签/状态/创建人/更新区间/动态字段 JSONB）；自定义视图（上限 10、默认视图、列配置偏好）；行操作（关注/分享链接/复制）与批量（移动/复制/删除/编辑）。
- **用例详情（CASE-003）**：7 Tab 工作台（详情（受限 Markdown 双栏）/依赖关系双向/评审/计划/缺陷关联/评论两级/变更历史时间线 diff）；Ctrl+S 无、乐观锁 409 沿用；Markdown 白名单转义防 XSS。
- **导入导出（CASE-004）**：Excel 导入（模板下载含动态列、MeterSphere 列名别名兼容、覆盖/跳过、全量预检原子落库、失败行号报告、5000 行上限）；Excel 默认/单元格拆分导出与 Xmind v2.x 双向（模块树结构映射、优先级/标签/备注承载）。
- **用例评审（CASE-005）**：评审 CRUD（单人=最后结果/多人=全员通过才通过、Suggest 不否决）；逐条+批量标记（Fail/Suggest 意见必填）、批量改评审人、自动下一条；重新提审（用例白名单字段变更回 pending + 橙色徽标，项目开关控制）；复制重置、结束只读（422 code 10007）；通过率统计。
- **缺陷管理（BUG-001）**：模板创建（动态字段校验/处理人/标签/bug 模块树）；工作流流转按钮组（按矩阵渲染）+ 意见评论化；附件（本地磁盘驱动 + 大小上限/可执行黑名单、HMAC 下载令牌——MinIO 预签名随 Sprint 2 文件管理接入，登记勘误）；列表筛选/回收站/导出；关联用例双向；评论/变更历史。
- **测试计划（PLAN-001）**：计划 CRUD+更多设置（重复关联开关（422 code 10009）/自动更新状态占位/通过阈值）；按模块/筛选/勾选关联用例；列表模式执行（五态+步骤级对位校验+实际结果+执行历史）；失败行新建缺陷带出失败步骤；通过率口径 pass/(pass+fail+blocked) 与阈值徽标；归档只读（422 code 10008）；最小报告+总结。
- **工作台（DASH-001）**：聚合看板四卡（用例总数/新增、评审通过率、计划进度 Top、缺陷待处理/新增；时间筛选 3d/7d）；卡片三态布局偏好持久化；我的待办（待评审/我的执行/我的缺陷）与我关注的/我创建的。
- **工程债清偿**：Prisma 列名 snake_case @map 全量补齐（232 列，expand-contract 迁移，INFRA-003 勘误 1）；OpenAPI 生成管线（路由单一来源 → openapi.json 快照 120 paths + api-client 102 条手写路径反漂移审计 + CI --check，INFRA-001 勘误 1）；PrismaClient globalThis 单例（修复 111 路由生产构建连接池耗尽 P2037）。
- **质量体系**：Vitest 49 条（权限并集/禁用交集矩阵、字段引擎 10 类型×校验矩阵、评审聚合、通过率口径、Markdown 转义）；JMeter 11 计划（四类场景×四项断言）全绿；Playwright 38 用例（含 MAINFLOW-s1 主链路 Release Gate）；路由声明式生成器（scripts/gen-routes.mjs，112 路由）与 jmx 生成器（scripts/gen-jmx.mjs）。
- **文档**：Sprint 1 十一份规格（Approved，AI 会话内评审流转）；十一组高保真原型（docs/design/，人工确认随验收走查）。

#### 修复

- client.ts 对 FormData 强制 JSON Content-Type 导致 multipart 解析失败（导入/附件上传）
- instrumentation.ts edge 打包静态解析 bullmq/nodemailer 致构建失败——改为守卫热路径懒注册（server/boot.ts）
- 软删用例变更历史 seq=0 唯一键冲突（重复删除同实体）
- PlanCaseRef.execHistory 列名 @map 缺失（生产 P2022）

#### 已知限制（登记去向）

- 高保真人工确认与走查登记待用户验收（AGENTS 门禁 2 人工部分，S0 §8.1 先例）
- 附件 MinIO 预签名 → 本地磁盘驱动过渡（INFRA-002 MinIO 镜像源问题，Sprint 2）
- 缺陷高级筛选保存视图待与 CASE-002 组件对齐后补（BUG-001 §1.2 后续）
- 重复邮箱返回 400 code 10101 与 SYS-004 规格文字 422 的口径差异（保持与 SYS-001 既有契约一致，登记勘误）

## [v0.1.0] - 2026-09-26 — Sprint 0 POC（用户验收通过）

#### 新增

- **基础设施**：pnpm + Turborepo 纯 TS Monorepo（apps：web/engine/mock/plugin-runner；packages：db/shared/api-client/ui）；Docker Compose 一键启动全栈（db/redis/minio/migrator/web/engine/mock）；本地零依赖开发（embedded-postgres + Docker Redis，`pnpm dev`）；husky pre-push + commitlint + oxlint/oxfmt。
- **数据模型**：Prisma 一次建齐八域 45 实体（含未启用列）；项目内 advisory lock 取号；软删/变更历史通用横切；幂等种子。
- **认证与组织**：邮箱注册/登录/登出（Argon2id + iron-session）；注册即建默认组织+演示项目+双场景模块树；middleware 路由守卫与 withAuth/withProjectScope 数据隔离（404 防枚举）。
- **测试用例**：功能用例 CRUD（名称/前置/步骤/等级/标签）、乐观锁 409、回收站（恢复/彻底删除二次确认）、变更历史落库。
- **接口测试**：HTTP 调试（8 方法/头/体 raw-json/断言：状态码+JSONPath）→ BullMQ 入队；执行引擎 v0（undici 采样、断言求值纯函数、失败三分类、Redis Stream 事件流、终态回调幂等、节点心跳注册、--local 本地模式）；最小报告页（请求/响应/断言明细/日志，SSE 实时 + Last-Event-ID 续传 + RUNNING 轮询兜底）；调试历史。
- **质量体系**：Playwright E2E 11 条全绿（每条含 UI/Console/接口三类断言，录屏 on-with-retry + trace + 截图，HTML 报告）；JMeter 接口自动化 3 计划（四类场景×四项断言）全绿；Vitest 单测（shared 契约/engine 断言求值）；GitHub Actions CI（lint/typecheck/unit/build/迁移重放/e2e/jmeter/audit）。
- **文档**：Sprint 0 十份功能规格 + 五组高保真原型（待人工确认）。

#### 修复

- **样式完全丢失事故（走查①发现）**：实现使用 Tailwind 工具类但从未安装 Tailwind——所有布局类失效，录屏中页面无样式。已安装 Tailwind v4（postcss + `@import 'tailwindcss'`）并修正 rem 基准（移除 `html{font-size:13px}`，对齐原型 16px 基准）；新增 VISUAL computed-style 断言防回归（rules/react-nextjs §5.5）。

#### 已知限制（登记去向）

- Prisma 列名暂为默认 camelCase（rules/database §2 的 snake_case 目标在 Sprint 1 以 @map 补齐，登记为 INFRA-003 勘误 1）
- api-client 为手工类型化（OpenAPI 自动生成在 Sprint 1 接入，登记为 INFRA-001 范围调整）
- undici 重定向跟随暂未启用（maxRedirections 在 v7 移除，Sprint 2 以 interceptor 接入）
