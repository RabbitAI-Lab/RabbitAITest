# 接口测试概述

接口测试模块提供从单接口调试、接口定义沉淀、接口用例管理，到多步骤场景编排、Mock 服务与执行报告的完整链路，由内置执行引擎真实发压采样，功能面对标 MeterSphere v3.x 社区版。

## 概念

### 功能地图

| 页面 | 定位 |
| ---- | ---- |
| [接口调试](manual/api/debug.md) | 单请求快速验证：改参数、加断言、立即执行看报告 |
| [接口定义](manual/api/definition.md) | 接口资产沉淀：模块树管理定义，派生用例与 Mock 规则 |
| [自动化场景](manual/api/scenario.md) | 多步骤业务流编排：引用接口/用例，循环、条件、CSV 参数化 |
| [参数化与内置函数](manual/api/functions.md) | 变量、提取器、内置函数与 CSV 数据驱动 |
| [Mock 服务](manual/api/mock.md) | 按规则返回模拟响应，保存即热更新 |
| [报告与统计](manual/api/report.md) | 执行结果的事件流报告、分享与趋势统计 |

### 请求模型

| 项 | 取值 |
| -- | ---- |
| 协议 protocol | `http` / `https` 走内置引擎管线；其余为协议插件标识（tcp-conn / websocket / mqtt，插件启用后可选） |
| HTTP 方法 | GET / POST / PUT / DELETE / PATCH / OPTIONS / HEAD / CONNECT（8 种） |
| 请求体 | none / form_data / form_urlencoded / raw_json / raw_xml / raw_text / binary（7 类，form 行可引用文件 fileId） |
| 认证 | basic / digest / none |
| 超时 timeoutMs | 1s-120s，默认 60s |
| 其他开关 | followRedirects（跟随重定向）、skipPre / skipPost（跳过前后置处理器） |

?> 非 http 协议时，HTTP 参数 / 认证 / 请求体等面板不适用，改为「协议配置」JSON 编辑（protocolConfig），采样由协议插件完成。

### 断言体系

断言 **6 种类型 × 7 种操作符**：

| 断言类型 | 说明 |
| -------- | ---- |
| status_code | HTTP 状态码 |
| response_header | 响应头 |
| body_jsonpath | 响应体 JSONPath（如 `$.url`） |
| body_regex | 响应体正则 |
| response_time | 响应时间（ms） |
| variable | 变量值 |

| 操作符 | 含义 |
| ------ | ---- |
| eq | 等于 |
| contains | 包含 |
| lt / le | 小于 / 小于等于 |
| gt / ge | 大于 / 大于等于 |
| regex | 正则匹配 |

任一断言不通过，该项即失败（语义码 ASSERT_FAILED）。

### 前后置处理器

| 类型 | 说明 |
| ---- | ---- |
| script | quickjs 沙箱脚本：64KB 上限；同步执行超 5s 中断强杀；API 白名单 log / getVar / setVar / envGet / randomInt / now，无 IO；可引用公共脚本（scriptRef）；条件表达式同沙箱 |
| sql | SQL 处理器（当前版本未启用，选择会被静态安全门禁拦截并显式报 CONFIG_ERROR，非 Bug） |
| wait | 固定等待 1-30000ms |

### 执行模型

- 任务模型：ExecTask + BullMQ 队列，队列按资源池路由（`exec-pool-{poolId}`，默认池 `exec`）。
- 命令四类：api_debug（单请求调试）/ api_case（接口用例）/ scenario（场景）/ plan（测试计划）。
- scenario / plan 支持 **serial | parallel** 模式与 **stopOnFail** 失败停止：串行失败后余项记 SKIPPED；并行失败后未开始的 item 记 SKIPPED。
- 任务运行中可停止（引擎轮询 Redis 停止键 → STOPPED）；定时任务以 cron repeatable job 实现。
- 报告为事件流（step-start / step-result / step-op / log / step-skip 等帧，seq 单调递增，SSE 断线续传）。

### 执行引擎

独立 Node.js worker（`apps/engine`）：HTTP 采样基于 undici，kernel 为纯函数分层，事件流写入 Redis Stream（TTL 24 小时），终态回调指数退避重试（最多 5 次），资源池并发上限由心跳动态下发（初始 4）。

!> 引擎不依赖数据库；HTTP 压测类性能测试不在社区版范围内（导航中的性能测试为占位入口）。

## 操作流程（典型链路）

1. 在[接口调试](manual/api/debug.md)发起一次请求，验证参数与断言。
2. 点击「保存为接口」，沉淀到[接口定义](manual/api/definition.md)。
3. 在定义详情创建接口用例（可基于定义裁剪参数），或交给 AI 生成用例初稿。
4. 多个接口组成业务流时，在[自动化场景](manual/api/scenario.md)编排步骤。
5. 依赖方未就绪时，用 [Mock 服务](manual/api/mock.md)模拟响应。
6. 执行后在[报告与统计](manual/api/report.md)查看结果、分享报告、分析失败分布。

## 边界与注意事项

!> SQL 前后置处理器当前未启用：选择该类型会被静态安全门禁拦截并返回 CONFIG_ERROR，属预期行为而非缺陷。

!> 协议插件（tcp-conn / websocket / mqtt）需系统管理员在插件管理中启用后才出现在协议选择器中。

!> 变量渲染语法为 `${var}`，URL 支持相对路径（由所选环境域名拼接），详见[参数化与内置函数](manual/api/functions.md)。

## 相关链接

- [接口调试](manual/api/debug.md)
- [接口定义](manual/api/definition.md)
- [自动化场景](manual/api/scenario.md)
- [环境管理](manual/project/environment.md)
