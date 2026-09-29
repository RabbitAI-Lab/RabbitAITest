# 请求参数体系（执行契约 v2）

| 元信息项     | 内容                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-004                                                                                                                             |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                             |
| 优先级       | P1（全系统最重规格，先行——plan §五第三阶段）                                                                                        |
| 所属模块     | 接口测试（api_test 域）+ 执行引擎（exec 域）                                                                                        |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                          |
| 上游依赖     | EXEC-001（内核 v0 与事件流契约）、PROJ-003（环境变量/域名/数据源快照）、PROJ-004（form-data/binary 文件引用）                       |
| 下游消费     | API-002（定义请求编辑）、API-003（用例差量请求）、API-005（Mock 响应编辑）、RPT-002（断言/提取结果展示）、S3 场景步骤管线           |
| 上游依据     | 需求文档 M6（请求参数体系/执行引擎）；功能清单 §6.6                                                                                 |
| 对标基线     | 功能清单 §6.6：请求体 7 种、前置（脚本/SQL/等待/全局开关/代码片段）、后置（脚本/SQL/提取）、断言 6 种、认证、超时与重定向           |
| 关联架构文档 | engine-execution-architecture.md §3（kernel 管线/变量作用域链）§4（脚本沙箱）；test-domain-model.md §2.6                            |
| 高保真确认   | 待确认（原型 docs/design/API-004-request-params-system/：请求编辑器七区；人工确认待 Sprint 验收走查——不可由 AI 代签）               |
| 工作量估算   | 后端/引擎 6 人日 / 前端 6 人日 / 联调 2 人日                                                                                        |

## 1. 概述

### 1.1 功能定位

接口测试的「语言层」：定义一次请求可声明哪些参数、执行时如何渲染与加工、结果如何判定与提取。本规格冻结 **执行契约 v2**（`packages/shared/execution`，web↔engine 双方不得私改），并交付统一请求编辑器组件（调试页/定义 API 页签/用例编辑共用）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                    | P1 ✅ | 后续                                                                    |
| ------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------- |
| 变量渲染：`${var}` 于 url/路径/headers/query/body 文本；作用域链 临时>任务参数>环境>全局参数            | ✅    | 函数语法 `${__func()}`（S3 内置函数库 EXEC-003）                        |
| 请求体 7 类：none/form-data（文件引用 PROJ-004）/x-www-form-urlencoded/raw_json/raw_xml/raw_text/binary | ✅    | —                                                                       |
| 认证：NoAuth/Basic/Digest（401 挑战自动重试一次）                                                       | ✅    | 脚本取 Token（登记 Backlog，S3 随函数库）                               |
| 前置：脚本（quickjs JS：log/getVar/setVar/envGet/randomInt/now）/等待 ms                                | ✅    | SQL 处理器（勘误 1 延后 S3）、Python（P2 起）、公共脚本引用（S5）       |
| 后置：脚本/提取（正则/JSONPath × 首个/随机/第N个 × 临时/环境变量）                                      | ✅    | SQL（勘误 1）、XPath（XML 解析依赖重，豁免登记：S2 用户面以 JSON 为主） |
| 断言 6 种：状态码/响应头/响应体 JSONPath/响应体正则/响应时间(ms)/变量                                   | ✅    | XPath/脚本断言（豁免同上；脚本失败经 SCRIPT_ERROR 语义兜底）            |
| 代码片段：内置 JS 模板下拉插入（等待/时间戳/随机数/打印变量）                                           | ✅    | 用户自定义片段（S5 个人中心）                                           |
| 全局开关：跳过全部前置/后置（环境配置 + 执行时覆写）                                                    | ✅    | —                                                                       |
| 超时（统一 timeoutMs 1s-120s）与重定向（跟随开关，≤5 次，307/308 保方法）                               | ✅    | 连接/响应分离超时（undici headers/body 两段已映射，UI 单值口径）        |
| 环境 HOST 映射：请求主机按 hosts 表重定向连接地址                                                       | ✅    | —                                                                       |

### 1.3 前置依赖

PROJ-003 环境 config schema 冻结（vars/http/hosts/database）；PROJ-004 internal 文件读取端点（form-data/binary 文件字节经 web internal 端点拉取，engine 无 DB）。

### 1.4 对标基线核对

完全复刻：请求体 7 类/断言主体面/前后置三件套/认证 NoAuth-Basic-Digest/超时重定向。简化实现：提取与断言无 XPath（登记豁免）；SQL 数据源仅 PostgreSQL（驱动插件化口径 PLUG-002 后）；「全局前置/后置」以环境 config 承载（基线为场景级+请求级，场景级 S3）；「内置函数库」仅脚本 API 内置 5 函数（完整 50+ Mock 函数与 JMeter 兼容子集=EXEC-003 S3）。

## 2. 业务逻辑

- **渲染管线（kernel 每步）**：变量渲染 → 前置序列 → 采样（认证/域名/HOST/重定向）→ 提取 → 断言 → 后置序列；环境全局前置插最前、全局断言追加最后（PROJ-003 config 承载）。
- **域名解析**：请求 url 为相对路径时，按环境 http[] 条件匹配（路径前缀>模块>默认）拼绝对 URL；绝对 URL 直用。
- **变量写回**：提取 scope=temp → 任务内后续步骤可见；scope=env → 随回调 varUpdates 由 web 写回 Environment.config.vars（并发 last-write-wins，报告留痕）。
- **失败语义**：断言不过=ASSERT_FAILED；脚本异常/超时=SCRIPT_ERROR；SQL 失败=CONFIG_ERROR；网络失败=NETWORK_ERROR（S0 枚举仅新增 SCRIPT_ERROR）。
- **脚本沙箱**：quickjs 同步执行 ≤5s（超时强杀→SCRIPT_ERROR）；API：`log`/`getVar|setVar`（临时变量）/`envGet`（快照只读）/`randomInt(a,b)`/`now()`（crypto 强随机）；无 IO（fetch/fs/process 均无）；等待由 wait 处理器承载（脚本内 sleep 会阻塞事件循环，故不提供）。
- **Digest**：401+`WWW-Authenticate: Digest` → RFC7616 MD5（qop=auth）重试一次；仍 401 → 原响应进入断言。

## 3. UI/UX 设计（高保真 docs/design/API-004-request-params-system/）

- 统一组件 `<RequestEditor/>`（apps/web/src/components/api/）：顶部 method 选择（8）+ URL 输入（`${var}` 高亮）+ 环境选择器（调试/执行场景）；Tab 页：**参数**（Query/Headers 两组 KV 行，禁用勾选）/ **认证**（类型单选+凭据）/ **请求体**（7 类单选切换对应编辑器：KV 行/文本域/Binary 文件选择器）/ **前置**（有序处理器列表：脚本编辑器+SQL 表单+等待，上下移+删除+片段下拉）/ **后置**（同前置+**提取器表格**）/ **断言**（断言表格：类型/目标/操作符/期望值）/ **设置**（超时数字+跟随重定向开关+跳过前后置开关）。
- 调试页（/debug）沿用 S0 布局换芯：URL/method/headers/body raw_json/断言行等既有 testid 保持（API-001 用例不回归破坏）。
- 空态：处理器/断言/提取各提供「+ 添加」行内引导。

## 4. 技术架构

- **执行契约 v2（packages/shared/src/execution/schemas.ts，冻结）**：
  - `requestSpecSchema`：`{method, url, headers[], query[], body: {kind: none|form_data|form_urlencoded|raw_json|raw_xml|raw_text|binary, rows?/content?/fileId?}, auth: {kind: none|basic|digest, username?, password?}, timeoutMs, followRedirects, skipPre, skipPost}`（兼容扩展 debugRequestSchema 旧字段——api_debug 载荷升级为 v2，旧帧/旧报告按宽松读兼容）。
  - `processorSchema`：pre/post 共用 `{kind: script|sql|wait, script?/sql?/datasourceId?/varMapping?/ms?}`；`extractorSchema`：`{source: body|headers, kind: regex|jsonpath, expression, match: first|random|n, index?, variable, scope: temp|env}`。
  - `assertSpecSchema v2`：`{kind: status_code|response_header|body_jsonpath|body_regex|response_time|variable, target?, op: eq|contains|lt|le|gt|ge|regex, expected}`（S0 旧断言两 kind 是子集，等价迁移）。
  - `execCommandSchema v2`：discriminatedUnion——`api_debug {taskId,projectId,type,request,asserts,envSnapshot?}` / `api_case {…, envSnapshot?{vars,http[],hosts[],database[],pre?,post?,asserts[]}, stopOnFail?, items:[{itemId,caseId,name,moduleId,request,asserts,pre,post}]}`。
  - 事件帧新增：`item-start/item-final {itemId,name,status,message}`；`step-start/step-result/log` 增可选 `itemId`；`step-result` 增 `extracts:[{variable,value,scope}]`、`requestSnapshot` 为**渲染后**快照；`task-final` 增 `stats?{total,passed,failed}`、outcome 增 `stopped`；`failureKindSchema` 增 `SCRIPT_ERROR`。
  - 回调 `execCallbackSchema` 增 `varUpdates?:{name,value}[]`、`outcome` 增 `stopped`。
- **内核（apps/engine/src/kernel/）**：`render.ts`（变量渲染+域名解析+HOST 映射构建 undici Agent connect lookup）、`processors.ts`（wait/sql(pg)/script(quickjs)）、`extract.ts`、`asserts.ts v2`（6 kind×op 矩阵）、`digest.ts`（RFC7616）；`samplers/http.ts` 重写（7 类 body 组装/认证/重定向循环/内部文件拉取 `GET {WEB_URL}/api/v1/internal/files/{id}`）。
- **依赖新增**：engine + `quickjs-emscripten`、`pg`（技术栈已锁定）；均不进 web。
- **权限点**：无新点（编辑器是组件；写操作随宿主端点取 PROJECT_API:*）。
- **错误码**：无新 web 码（执行失败语义在 failureKind）。

## 5. 测试用例

- API-004-T1（jmx `tests/api/API-004-request-params.jmx` 四类）：提交含变量渲染+提取+断言的 api_debug 任务→轮询报告断言 `extracts[0].value` 与渲染后 URL；401/403/404（他项目）；body kind 非法 422；历史分页信封。
- API-004-T2（spec 调试页变量链路）：环境建 `${base}` 变量→调试页引用→执行→报告请求快照 URL 已渲染；提取 `${token}` 存临时→断言 variable 通过（UI+Console+接口三类断言）。
- API-004-T3（spec 断言二态）：body_regex 断言期望不存在值→任务 FAILED+报告红色断言行；修正后 SUCCESS。
- API-004-T4（spec 前置脚本失败）：前置脚本抛错→任务 FAILED（SCRIPT_ERROR）且日志可见，不静默。
- 单测（engine）：渲染（嵌套/未定义保留原样/作用域链次序）、域名条件优先级、提取 3 匹配模式、断言全矩阵、Digest 计算（RFC 样例）、7 类 body 组装（form-data 文件 mock internal 端点）、SQL varMapping、脚本超时强杀。

## 6. 竞品深度对标

基线 §6.6 主体面全覆盖；差异：①脚本引擎 quickjs（基线 Groovy/BeanShell/JS Nashorn——技术栈替换决策，§6 必引：JMeter 内核→自研 Node 内核）；②SQL 数据源仅 PostgreSQL（基线 4 数据库+驱动上传——驱动插件化 PLUG-002 后补）；③XPath 提取/断言豁免（登记）；④「全局前后置」环境级承载（基线场景级+请求级，场景级 S3 API-006）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。契约 v2 zod 冻结是 A 线第 4 天里程碑（B/C 线全部依赖）；验收对应 sprint-overview 验收 1/2/3。

## 8. 勘误登记

- 勘误 1（2026-09-27）：**SQL 前后置延后 S3**。安全门禁（Mimosa 静态扫描）要求 SQL 语句全参数化执行，与「执行测试人员自写语句」的工具语义根本冲突（三次收紧——单语句守卫/只读白名单/品牌类型 parse-validate-execute——均被拦截，且规范禁止绕过安全钩子）。S3 以「只读账号 + SQL 控制台 + 参数化变量」方案评审后承接；S2 内核遇 sql 处理器显式 CONFIG_ERROR 失败（不静默假实现），环境数据源配置与连接测试照常交付。→ **已清偿（2026-09-30，PLUG-004）**：参数绑定通道 + SELECT/WITH 白名单 + READ ONLY 事务满足安全约束，SQL 处理器解禁（见 API-006 勘误 2 / PLUG-004）。
- 勘误 2（2026-09-27）：脚本 API 的 sleep() 移除（同步沙箱内 sleep 阻塞引擎事件循环，等待语义由 wait 处理器承载）。
- 勘误 3（2026-09-27）：调试页 URL 校验最初拒绝 `${var}` 开头的占位符（E2E 代理发现）；已放行为「待渲染路径」（相对/绝对由渲染结果判定，变量依赖环境选择校验保留）。
