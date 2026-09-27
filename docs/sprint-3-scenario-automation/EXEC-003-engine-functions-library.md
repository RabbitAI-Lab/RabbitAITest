# 引擎内置函数库（`${__func()}`·`@mock`·管道叠加）

| 元信息项     | 内容                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| 文档编号     | EXEC-003                                                                                                    |
| 所属迭代     | Sprint 3 — 场景自动化                                                                                       |
| 优先级       | P2（迭代内）                                                                                                |
| 所属模块     | 引擎（engine）+ shared 契约                                                                                 |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                                                       |
| 最后更新日期 | 2026-09-27                                                                                                  |
| 上游依赖     | EXEC-002（渲染管线 kernel/render.ts）、API-004（`${var}` 词法基座）                                        |
| 下游消费     | API-006/007（场景参数与步骤渲染）、API-005（Mock 请求模板后续复用）、S6+（导入模板渲染）                    |
| 上游依据     | 需求文档 §五；功能清单 §6.7 内置函数                                                                        |
| 对标基线     | 功能清单 §6.7：Mock 函数 14 类 50+（`@` 语法）+ JMeter 函数 9 类 50 个（`${__函数名}`）+ 叠加处理 13 种      |
| 关联架构文档 | engine-execution-architecture.md §3（渲染管线统一、纯函数可测）                                             |
| 高保真确认   | 接口契约评审替代高保真（纯引擎规格，AGENTS 门禁 2 约定）：本文件 §4 函数目录即契约，人工评审即确认          |
| 工作量估算   | 引擎 4 人日 / 前端 1 人日（编辑器提示）                                                                     |

## 1. 概述

### 1.1 功能定位

渲染管线的函数扩展层：请求任意字符串位（URL/头/Query/body 模板/参数值）除 `${var}` 外支持三类函数语法——引擎函数 `${__func(args)}`（执行语义）、数据函数 `@name(arg)`（随机数据生成）、管道叠加 `${var|md5|substr(0,6)}`（后处理链）。三端（web 预览/engine 执行/mock 后续）共用 shared 实现。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                       | P1 ✅ | 后续                                          |
| -------------------------------------------------------------------------- | ----- | --------------------------------------------- |
| 引擎函数 10 个：`__counter`（任务内自增）、`__random`（区间整数）、`__UUID`、`__time`（格式化）、`__timeShift`（偏移）、`__digest`（md5/sha1/sha256）、`__base64`、`__urlEncode`、`__isVarDefined`、`__threadName`（场景名+item 序） | ✅     | JMeter 全 50 个（剩余属性/脚本/文件类，登记） |
| 数据函数 12 个：`@string(n)`、`@integer(min,max)`、`@float`、`@name`（中文名）、`@email`、`@phone`、`@date(格式)`、`@datetime`、`@address`（省市）、`@idcard`（合规校验位）、`@regexp(表达式)`、`@pick(a,b,c)` | ✅     | Mock 14 类全量（颜色/Web 变量等，登记）       |
| 管道叠加 8 种：`md5`、`sha256`、`base64`、`substr(start,len)`、`toUpperCase`、`toLowerCase`、`trim`、`default(v)`（空值兜底） | ✅     | 13 种全量（urlencode 管道等，登记）           |
| 词法统一：`${name|pipe|pipe}`、`${__func(arg1,arg2)}`、`@func(arg)` 三形态与纯变量混排；未识别函数原样保留并记 log 警告（不失败） | ✅     | —                                             |
| 转义：`\${` 输出字面 `${`；`@@` 输出字面 `@`                              | ✅     | —                                             |
| 编辑器提示：RequestEditor/参数值输入框 hover 提示函数目录（静态文案）      | ✅     | 自动补全（编辑器升级时）                      |

### 1.3 前置依赖

kernel/render.ts `renderString` 词法（S2 `${var}` 段解析）扩展为三形态统一解析器；随机源注入（可测性：seed 参数）。

### 1.4 对标基线核对

基线 6.7 主体覆盖（50+50+13 → 本期 10+12+8 务实子集，全覆盖清单登记于 §6）；语法兼容：`${__func}` 与 JMeter 同形、`@func` 与 MeterSphere Mock 同形、管道叠加与基线叠加处理同形。差异：函数集规模（登记）；`__counter` 作用域=任务内（基线线程内，语义映射）。

## 2. 业务逻辑

- 解析顺序：renderString 扫描 `${...}` 段→内部再解析 `name|pipes` 或 `__func(args)`；独立扫描裸 `@func(args)`（不在 `${}` 内也生效，与 MeterSphere 一致）；`\${`/`@@` 转义优先。
- 取值链执行次序：变量查找（API-007 四级链）→ 管道依次应用 → 输出。函数调用在渲染期即时求值；`__counter` 维护任务级 Map（taskId 作用域，场景 item 间连续）。
- 随机可测：`@func` 接受可选 seed（默认 crypto 随机）；单测用固定 seed 断言确定性输出。
- 安全：`@regexp` 编译失败→原样保留+warning（不抛错）；`__digest` 输入长度上限 1MB；所有函数纯同步、无 IO（沙箱口径一致）。
- 帧证据：step-result.requestSnapshot 为渲染后值（函数求值结果直接可见，报告断言依据）。

## 3. UI/UX 设计（契约评审替代，交互描述）

编辑器输入位（URL/头/值/body raw 模板）旁「f(x) 函数」提示图标 → popover 列函数目录（语法/示例/说明三列静态表）；无独立页面。

## 4. 技术架构（函数目录契约）

- 位置：`packages/shared/src/execution/functions.ts`（纯函数，三端共用）：`renderFunctions(text, ctx: {vars, counter, random})`；kernel/render.ts 调用（`${var}` 与函数统一入口保持 `renderString` 签名兼容）。
- 目录（契约冻结，新增 additive）：引擎 10/数据 12/管道 8 见 §1.2 表；ctx.counter=Map<string,number>；random=`(bytes)=>bytes` 注入。
- zod：无新 schema（函数内嵌字符串）；OpenAPI 不变。
- 错误：函数不存在/参数错→原样保留+log warning（`log` 帧），不 CONFIG_ERROR（与「未识别变量原样保留」S2 语义一致）。
- 前端：`FunctionHintPopover.tsx` 静态目录（数据源 shared 常量 `FUNCTION_CATALOG` 导出，防两处维护）。

## 5. 测试用例

- 单测（主力）：三形态混排矩阵/转义/管道链/default 兜底/counter 连续性/seed 确定性/@regexp 失败容忍/长度上限；与四级取值链集成（params→env→函数→管道顺序）。
- EXEC-003-T1（spec 渲染生效）：场景步骤 URL/体含 `${__UUID()}`、`@integer(1,9)`、`${token|md5}` → 执行后报告 requestSnapshot 断言渲染形态（UUID 正则、数字范围、md5 长度 32）（UI+接口）。
- jmx/T1 类：随 API-006/007 jmx 请求体断言渲染值（不独立建计划）。

## 6. 竞品深度对标

基线语法三形态完全兼容；函数集 30/113（务实子集，逐类登记差集：Mock 颜色/地区全量、JMeter 属性/文件/脚本类、管道 urlencode/replace 等——S5 mock 增强与导入需求驱动补齐）；`__counter` 任务级作用域映射登记。

## 7. 里程碑与验收

接口契约评审（本文件 §1.2/§4）通过=高保真门禁等效通过。风险点：词法统一对既有 `${var}` 渲染回归（全量 e2e 回归覆盖）。

## 8. 勘误登记

（暂无）
