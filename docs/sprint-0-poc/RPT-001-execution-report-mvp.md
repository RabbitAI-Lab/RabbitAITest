# 最小执行报告（事件流渲染 + SSE 实时）

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | RPT-001 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0 |
| 文档状态 | Approved（P0 起步授权） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | EXEC-001（事件流契约）、INFRA-003（Report/ExecStepResult） |
| 下游消费 | RPT-002/003（Sprint 2/3 完整报告）、报告分享（P0 不做） |
| 上游依据 | 架构 engine §3 事件流、api-conventions §5 SSE |
| 对标基线 | 功能清单 §六.8 报告（P0 子集：单请求报告、响应+断言明细；分享/导出 Sprint 2/3） |
| 高保真确认 | 待确认（docs/design/RPT-001-execution-report-mvp/） |

## 1. 概述

### 范围边界
✅：报告页 `/reports/{taskId}`（项目内权限）：状态徽标（RUNNING/SUCCESS/FAILED 色点）、总耗时、请求卡片（方法/URL/头/体）、响应卡片（状态码/响应头摘要/响应体 pretty+截断标记）、断言列表逐条（表达式/期望/实际/通过✓失败✗红绿）、日志区（事件流渲染，SSE 实时追加）；`GET /api/v1/projects/{pid}/reports/{taskId}`（聚合快照）。
❌：分享链接/导出 PDF（PLAN-005/RPT-003）、多步骤树渲染（RPT-003）、报告保留策略（PROJ-001 应用设置）。

## 2. 业务逻辑

报告=事件视图：详情接口聚合 ExecTask + ExecStepResult（持久化于回调侧落库）+ 实时态优先读 Redis Stream 残余帧；SSE `/api/v1/stream/exec/{taskId}` 从 Last-Event-ID 续传，终态帧后服务端关闭流。RUNNING 态页面轮询兜底（SSE 断开时 3s 轮询详情）。

## 3. UI/UX 设计（高保真 docs/design/RPT-001-execution-report-mvp/index.html）

上状态条（状态徽标/任务号/耗时/重跑按钮占位）→ 两栏：左请求/响应卡片（响应体等宽字体+复制按钮），右断言列表与日志时间线；FAILED 时断言失败行红底置顶；截断体显示「已截断至 256KB」提示条。

## 4. 技术架构

- 端点：`GET /api/v1/projects/{pid}/reports/{taskId}`；SSE Route Handler（Node runtime，ReadableStream 包装 Redis XREAD 阻塞读，lastId 游标）
- web 回调侧落库：callback handler 写 ExecTask 终态 + ExecStepResult（事件帧列表持久化，供非实时查看）
- 前端：`useReportStream(taskId)`（api-client.stream 封装，自动重连）；报告组件按 frame type reducer 累积状态

## 5. 测试用例
- RPT-001-T1（jmx）：报告详情 200+`$.data.status`；他人项目报告 404；不存在 taskId 404
- RPT-001-T2（spec）：成功任务报告三卡齐备+断言全绿（UI+接口断言 reports 响应体字段；console 零错误）；失败任务断言红行+状态 FAILED（验收 5）；SSE 收到≥3 帧后渲染（接口断言 stream 事件 content-type=text/event-stream）

## 6. 竞品深度对标
基线「点击步骤查看该步骤实际请求的响应内容」→ P0 单步骤即报告主体，步骤钻取 P0 不涉及；实时日志=基线「控制台信息」视图的流式化（超出基线：SSE 实时）。

## 7. 里程碑与验收
验收标准 4/5 的呈现侧；与 EXEC-001-T3 共同支撑验收 6。
