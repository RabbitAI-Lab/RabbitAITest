# 引擎内核 v0（BullMQ + undici + 事件流 + 本地 CLI）

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | EXEC-001 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0（全项目最大技术风险点，B 线起点） |
| 文档状态 | Implemented（Sprint 0 交付，验收自查见 sprint-overview §7） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | INFRA-001；架构 engine-execution-architecture、rules/engine |
| 下游消费 | API-001（调试执行）、RPT-001（事件流消费）、EXEC-002（Sprint 2 资源池化） |
| 上游依据 | 架构 engine-execution-architecture §1-§5/§7 |
| 对标基线 | 功能清单 §六：MeterSphere 服务端执行=task-runner 资源池执行；本项目自研 Node 内核（差异化决策 tech-stack §2） |
| 高保真确认 | 不适用（契约=packages/shared/execution schema + 本文件 §4） |

## 1. 概述

### 范围边界
✅：BullMQ worker 消费 `exec` 队列；kernel 纯函数（变量渲染 P0 仅字面量+`{{var}}` 占位不做、断言求值：status_code eq / body_jsonpath eq|contains）；HttpSampler（undici，超时 60s，跟随重定向）；事件帧 `task-start/step-start/step-result/task-final` 写 Redis Stream；终态 HTTP 回调 web（指数退避×5）；节点注册+心跳（10s，web /internal 端点）；`--local` CLI（单任务直跑+回环上报，磁盘缓冲不作为 P0，简化为失败退出码）。
❌：循环/条件控制器、提取、前后置、变量作用域链、Python 脚本、资源池多节点调度（Sprint 2/3）；Mock 进程（占位）。

## 2. 业务逻辑

状态机：pending→dispatched→running→success|failed（engine 侧维护 web 侧 ExecTask.status 经回调流转；终态幂等：重复回调 web 按 status 非终态才更新）。
事件 seq 单调；`step-result` 含 requestSnapshot（method/url/headers/body 摘要）、responseSummary（status/headers 摘要/bodyText 截断 256KB→MinIO 引用 P0 直接截断标记）、asserts 逐条结果。
失败分类：NETWORK_ERROR / ASSERT_FAILED / CONFIG_ERROR（rules/engine §5.2）。

## 3. UI/UX 设计
不适用（进程）。

## 4. 技术架构

- 契约（packages/shared/execution/）：`ExecCommand{taskId, type:'api_debug', request, asserts[]}`；`EventFrame{type, seq, ts, payload}` 各型 zod；`Heartbeat{poolId, nodeId, version, slots, ts}`
- runner：BullMQ Worker concurrency=4（p-limit 语义）；AbortSignal 支持取消（P0 保留接口）
- samplers/http.ts：undici request；重定向 manual→记录 hops
- kernel/asserts.ts：JSONPath 用 `jsonpath-plus`；求值纯函数（单测重点）
- 回调：`POST {WEB_URL}/api/v1/internal/exec/{taskId}/callback`（头 X-Internal-Token=INTERNAL_TOKEN env）
- 注册/心跳：`POST /api/v1/internal/pools/register`、`/heartbeat`；ResourcePool 表 upsert 默认池
- CLI：`pnpm --filter engine local -- --url ... --expect-status 200 --server http://localhost:3000 --api-key ...`

## 5. 测试用例
- EXEC-001-T1（单测）：asserts 求值表驱动（eq/contains/JSONPath 未命中/非 JSON 体）；事件 seq 生成器；失败分类映射
- EXEC-001-T2（集成）：假 HTTP 服务（测试内起）执行全链路：命令→事件流帧序完整→回调终态 success；断言失败→ASSERT_FAILED 且 asserts 明细
- EXEC-001-T3（验收 6）：`engine --local` 对同一请求执行，web 生成同一结构报告

## 6. 竞品深度对标
MeterSphere task-runner（JVM/JMeter）→ Node 内核：契约同源（日志=报告事件流）、失败分类三态对齐其报告语义；心跳/注册机制与其资源池发现机制同构（单节点 P0）。

## 7. 里程碑与验收
验收标准 4/5/6 的引擎侧支撑；事件流 schema 一经冻结即为 RPT-001 契约。
