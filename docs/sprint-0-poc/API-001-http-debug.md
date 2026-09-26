# HTTP 接口调试（服务端执行）

| 元信息项     | 内容                                                                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-001                                                                                                                                                                     |
| 所属迭代     | Sprint 0 — POC                                                                                                                                                              |
| 优先级       | P0                                                                                                                                                                          |
| 文档状态     | Verified（用户验收通过 2026-09-26）                                                                                                                                         |
| 最后更新日期 | 2026-09-26                                                                                                                                                                  |
| 上游依赖     | SYS-002、EXEC-001（执行链路）、RPT-001（报告渲染）                                                                                                                          |
| 下游消费     | Sprint 2 API-002~005（定义/CASE/Mock 建立在调试之上）                                                                                                                       |
| 上游依据     | 需求文档 M6；功能清单 §六.1                                                                                                                                                 |
| 对标基线     | 功能清单 §六.1 接口调试：8 方法、请求构造（头/体）、服务端执行、响应四视图。P0 简化：无模块保存树（临时调试记录）、body 仅 raw(json)/none、认证=无（Basic/Digest Sprint 2） |
| 高保真确认   | 待确认（docs/design/API-001-http-debug/）                                                                                                                                   |

## 1. 概述

### 范围边界

✅：新建调试请求（method×8、URL、headers KV、body raw-json/none）；断言编辑（状态码 eq；响应体 JSONPath contains/eq）；提交执行（创建 ExecTask 入队）→ 跳报告页看结果；调试历史（最近 20 条 ExecTask type=api_debug 列表，点击重看报告）。
❌：保存为接口定义/CASE（API-002/003）、cURL 导入（Sprint 2）、环境变量（PROJ-003）、前后置/提取（API-004）、本地执行配置 UI（个人中心 Sprint 5；P0 本地执行走 engine --local CLI 验收）。

## 2. 业务逻辑

提交：zod 校验（URL http/https；method 枚举）→ ExecTask(type=api_debug, status=pending, payload=请求+断言) → BullMQ `exec` 队列 → 返回 `{taskId}`（clientTaskId 幂等）。报告跳转 `/reports/{taskId}`。重复点击执行生成新任务（历史保留）。

## 3. UI/UX 设计（高保真 docs/design/API-001-http-debug/index.html）

- `/debug` 页三段式：左侧调试历史列表（方法徽标+URL+状态点）；上部请求构造卡（方法下拉+URL 输入+执行主按钮；headers 可增删 KV；body 类型切换 raw-json 编辑器带格式化）；断言卡（规则行：类型[状态码/响应体JSONPath]+表达式+比较+期望值，可增删）
- 执行后跳报告页（RPT-001）；失败（如 URL 不通）报告页呈现分类错误
- 空态：无历史时引导文案+示例按钮（一键填 httpbin GET）

## 4. 技术架构

- 端点：`POST /api/v1/projects/{pid}/exec-tasks`（type=api_debug）；`GET /api/v1/projects/{pid}/exec-tasks?type=api_debug&page=`（历史）
- zod：`debugRequestSchema`（method/url/headers[]/body）、`assertSchema`（kind=status_code|body_jsonpath, op=eq|contains, expected）
- 前端：表单状态 zustand 局部；执行按钮防重（pending 态）；跳转 `router.push(/reports/${taskId})`
- 入队：web 侧 exec.service 创建任务→ `execQueue.add('exec', command)`（契约=packages/shared/execution）

## 5. 测试用例

- API-001-T1（jmx）：创建任务 200+code0+`$.data.taskId`；URL 非法 422；未登录 401；历史列表信封
- API-001-T2（spec 成功路径）：填 GET {BASE_HTTPBIN}/get → 执行 → 报告页展示 200 响应体与断言通过（UI 断言响应卡片；接口断言 exec-tasks 响应含 taskId、报告 GET 200；console 零错误）
- API-001-T3（spec 失败路径）：断言故意设错（期望 404 实际 200）→ 报告状态 FAILED+断言明细行红（验收标准 5）

## 6. 竞品深度对标

基线 §六.1：方法集/响应四视图=复刻（控制台视图 P0 合并入日志区）；「保存需模块信息」P0 改为不保存的即时调试（超出基线的简化，登记于 API-002 恢复）。

## 7. 里程碑与验收

验收标准 4/5（成功与断言失败两路径）。
