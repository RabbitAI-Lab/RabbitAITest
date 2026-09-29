# 自动化场景

自动化场景把多个接口请求组织成一条有业务含义的流程（如「登录 → 下单 → 查询订单 → 取消」），支持引用接口定义 / 接口用例 / 其他场景，配合循环、条件、CSV 参数化与定时执行，实现接口自动化回归。

> 所需权限：PROJECT_SCENARIO:READ（查看）/ PROJECT_SCENARIO:CREATE（新建、导入）/ PROJECT_SCENARIO:UPDATE（编辑、执行）/ PROJECT_SCENARIO:DELETE（删除）。

<img src="_media/shots/scenario-editor.png" alt="场景编辑器">

## 概念

### 步骤类型（6 类）

| 步骤 | 用途 |
| ---- | ---- |
| request | 引用接口定义 / 接口用例 / 其他场景，或展开为自定义请求 |
| loop | 循环容器，三种模式见下表 |
| condition | 条件分支：条件表达式为真才执行子步骤 |
| once | 仅执行一次（重复执行场景时跳过，如初始化登录） |
| script | quickjs 沙箱脚本（同前后置 script 规则） |
| wait | 固定等待 1-30000ms |

### 循环模式（loopConfig）

| 模式 | 说明 |
| ---- | ---- |
| count | 固定次数循环，1-10000 次 |
| while | 条件表达式循环（同沙箱表达式，最多 10000 次防失控） |
| foreach | 按 CSV 列迭代（数据驱动，见[参数化与内置函数](manual/api/functions.md)） |

### 步骤状态

| 状态 | 含义 |
| ---- | ---- |
| SUCCESS | 执行成功 |
| FAILED | 执行失败 |
| SKIPPED | 被跳过，附跳过原因 skipReason：disabled（步骤被禁用）/ condition（条件不满足）/ once（仅一次已执行）/ abort（失败停止中断） |

### 执行形态

- **单场景执行**：编辑器内直接执行当前场景。
- **批量执行**：列表勾选 1-50 个场景，配置执行参数后统一提交。
- **定时执行**：以 cron 表达式创建 repeatable 定时任务，到点自动执行。

## 操作流程

### 1. 创建与编排

1. 进入「自动化场景」，在目标模块下「新建场景」。
2. 在场景编辑器的**步骤树**中添加步骤：选择步骤类型 → 引用接口 / 配置循环或条件 → 拖拽排序。
3. 每个引用步骤可单独覆盖环境、超时与请求参数；步骤级「禁用」开关临时停用某步骤。

### 2. 批量执行

列表勾选场景（1-50 个）后点击「批量执行」，配置：

| 配置 | 说明 |
| ---- | ---- |
| 环境 | 本次执行使用的项目环境 |
| 资源池 | 执行引擎资源池（默认池 exec） |
| 失败停止 | stopOnFail：失败后停止余下场景 |
| 串行 / 并行 | serial 逐个执行；parallel 并发执行（并发上限取池配置） |

?> 失败停止的语义：串行模式下当前场景之后的场景记 SKIPPED；并行模式下未开始的场景记 SKIPPED。

### 3. 定时任务

列表页「定时任务」入口创建 cron 定时执行（BullMQ repeatable job 实现），适合每日回归。任务调度情况可在[任务中心](manual/project/task-center.md)跟踪。

### 4. 误报规则

入口位于场景页「误报规则」（`/scenarios/false-alarm`）：按规则把满足特征的失败报告标记为 **FAKE_ERROR（误报）**，误报数在报告中单列，避免干扰真实失败的分析。

### 5. 导入与导出

| 方向 | 说明 |
| ---- | ---- |
| 导出 | 勾选场景导出 JSON：**保留引用关系**（引用的接口定义仍在原项目）或**展开为自定义请求**（脱离引用、可跨项目迁移） |
| 导入 | 支持 Rabbit JSON（保留引用关系）、MeterSphere JSON，以及 **JMeter jmx**（映射子集，见下） |

jmx 导入映射子集（仅导入格式，执行引擎不使用 JMeter）：

| JMeter 节点 | 映射为 |
| ----------- | ------ |
| HTTPSamplerProxy | 自定义请求步骤 |
| LoopController | loop（count 模式） |
| CSVDataSet | 场景 CSV + foreach |
| JSR223（javascript） | script 步骤 |
| ConstantTimer | wait 步骤 |

?> 不支持的 jmx 节点会被跳过并记录 warning，导入结果报告会列出全部警告；XML 解析禁用 DTD 与外部实体。

### 6. 回收站

删除的场景进入回收站页签，可恢复或彻底删除。

## 边界与注意事项

!> 批量执行一次最多勾选 50 个场景；更多场景请分批或使用测试计划组织。

!> 「保留引用关系」导出的场景必须在存在对应接口定义的项目中导入，否则引用失效；跨项目迁移请使用「展开为自定义请求」。

!> while 循环有最大循环次数保护（10000 次），防止条件恒真导致任务无法结束。

## 相关链接

- [接口测试概述](manual/api/overview.md)
- [接口定义](manual/api/definition.md)
- [参数化与内置函数](manual/api/functions.md)
- [报告与统计](manual/api/report.md)
