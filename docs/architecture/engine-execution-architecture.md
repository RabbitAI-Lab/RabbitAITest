# 执行引擎与资源池架构

| 元信息项 | 内容                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 文档层级 | 架构文档（全局约束）                                                                                               |
| 状态     | 已确认（Approved）                                                                                                 |
| 对标基线 | MeterSphere 功能清单 §六（接口测试执行：服务端/本地执行、资源池、task-runner）；**引擎实现方式为差异化决策（§7）** |
| 下游消费 | EXEC-001/002/003、API-008、PLAN-003、ENTP-006、EXEC-004                                                            |

---

## 1. 角色与数据流

```
                     ┌──────────────── BullMQ(执行指令) ───────────────┐
apps/api (编排) ─────┤                                               ▼
  ExecTask 创建      │                                    apps/engine（资源池节点）
  状态机/任务中心     │◀──── HTTP 回调(状态/结果) ────────  runner: 消费任务·并发槽·心跳
       │             │                                               │
       │             │◀─── Redis Stream(日志/步骤事件) ────────────────┤ kernel: 步骤树解释器
       ▼             │                                        sampler: HttpSampler(协议插件位)
  report 聚合 ◀── 批量落库(ExecStepResult)                              │
                                                                     ▼
                                                          apps/mock（Mock 匹配服务, ASGI）
```

- **api 不执行任何请求**；engine 无数据库依赖，状态经回调与 Redis 持久化
- 本地执行：`engine --local` 单机 CLI 模式，从「个人中心-本地执行」配置的地址回环上报（对齐基线两种执行方式）

## 2. 任务状态机

```
pending → dispatched → running → success | failed | stopped
   │          │            │
   └── 超时回收/引擎心跳丢失 → 重派(≤2 次) → dead
```

- 幂等提交：`client_task_id` 去重（api-conventions §1）
- **失败重跑**：任务中心一键重跑=复制原 ExecTask 定义重建（不续写旧任务）
- 停止：用户停止 → BullMQ 控制信号 → engine 取消任务协程 → 终态 stopped

## 3. kernel：步骤树解释器

- 输入：场景步骤树 JSON（7 类：ref_api / ref_case / ref_scenario(完全/步骤引用) / custom / loop(次数/while/forEach) / condition / once / script / wait）
- 执行管线（每步）：变量渲染 → 前置(脚本/SQL/等待) → 采样器发请求 → 提取(正则/JSONPath/XPath × 匹配模式 × 环境/临时变量) → 断言(6 种) → 后置
- **变量作用域链**：临时 > 场景参数 > 环境变量/全局参数；同名按链优先（对齐基线优先级）
- 事件输出：`step-start / request-snapshot / assert-result / log / step-final` 全量入 Stream，报告与日志同源

## 4. 脚本沙箱

| 类型            | 执行方式                                                                                                                            |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| JavaScript 脚本 | quickjs-emscripten 嵌入解释器（无 IO，纯数据处理），P0 唯一脚本语言                                                                 |
| Python 脚本     | 子进程执行（运行环境具备 python3 时启用），CPU/内存/超时限额；暴露受控上下文对象（vars/assert/log/prev）——对齐基线多语言承诺，P2 起 |
| 公共脚本        | 项目脚本库引用注入，随用例打包下发 engine                                                                                           |

安全红线：脚本不接触引擎进程内对象；SQL 步骤经 plugin-runner 驱动执行（见 plugin-architecture）。

## 5. 资源池与调度

- ResourcePool(type=node) 注册：engine 启动向 api 注册（pool token），心跳 10s，离线 3 拍标记不可调度
- 调度：任务 → 目标池 → 池内最少负载节点（并发槽占用率）；节点最大并发可配（`max_concurrency`）
- 标准版仅 1 默认池且不可删（License 门控新增池，对齐基线；K8S 型池=P4 EXEC-004）
- 定时执行：BullMQ repeatable job 触发 ExecTask 创建（计划/场景/Swagger 同步共用机制）

## 6. Mock 服务

- `apps/mock` 独立 ASGI：路由 `mock.{domain}/{projectNum}/{apiPath}`（对齐基线「复制 Mock 地址供外部调用」）
- 匹配：method + path + matchers(头/Query/REST/体 包含或相等) → 命中返回配置响应；`follow_api` 回源取定义响应
- 规则来源：api 写入 Redis 的项目规则快照，变更即失效重载；无状态可横向扩容

## 7. 关键差异化决策（每份引擎规格 §6 必须引用）

| 决策        | 内容                                                                                            | 理由                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 不用 JMeter | 自研 Node.js 内核（undici 采样 + p-limit 并发槽）；jmx 仅做**导入格式**（转换成本项目场景 DSL） | 去 JVM 依赖；日志/变量/断言模型原生；MeterSphere 的 JMeter 函数仅兼容常用子集（EXEC-003） |
| 事件流同源  | 执行日志与报告数据同一事件流                                                                    | 免维护两套一致性；WS 实时推送与落库回放同源                                               |
| 报告为视图  | 不物化报告大表                                                                                  | 分享用快照隔离，源数据清理不影响已分享报告                                                |
