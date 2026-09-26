# RabbitAITest 术语表

| 术语          | 英文/模型                            | 定义                                                                                              |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| 功能用例      | FunctionalCase                       | 手工测试用例，含步骤（前置/步骤/预期）、模板字段、模块归属                                        |
| 模块树        | ModuleNode                           | 项目内按 scene（case/api/scenario/bug/file）组织的资源树，默认根节点「未规划用例」                |
| 用例评审      | CaseReview                           | 单人（最后结果生效）/ 多人（全员通过才通过）两种模式的评审计划；重新提审=评审中用例变更后重置评审 |
| 测试计划      | TestPlan                             | 关联功能/接口/场景三类用例的执行容器；支持计划配置（串并行、失败停止、通过阈值）                  |
| 计划组        | PlanGroup                            | 多计划的父容器（type=group 的计划）；标准版交付（对标口径见功能清单 §五注）                       |
| 测试点        | TestPoint                            | 计划内的测试分层节点，可关联用例并继承/覆写执行配置                                               |
| 接口定义      | ApiDefinition                        | API 元数据（方法/路径/请求响应结构），是 CASE 与 Mock 的母体                                      |
| 接口用例      | ApiCase                              | 基于某 API 的一组参数化请求差异（差量覆盖），可独立执行                                           |
| Mock          | ApiMock                              | 按匹配规则（头/Query/REST/体）返回预置响应；follow_api=回源取定义响应                             |
| 场景          | Scenario                             | 步骤树编排的自动化用例；7 类步骤（引用/复制/自定义请求/循环/条件/仅一次/脚本/等待）               |
| 引用 vs 复制  | ref / copy                           | 引用步骤跟随源变更（完全引用/步骤引用两档）；复制为独立快照                                       |
| 环境          | Environment                          | 项目级执行配置包（变量/多域名/数据库/HOST/全局前后置断言/TCP）                                    |
| 环境组        | EnvGroup                             | 多环境打包供计划/场景按序选用                                                                     |
| 资源池        | ResourcePool                         | engine 节点集合（node/k8s 型）；标准版限 1 默认池                                                 |
| 本地执行      | Local Execution                      | `engine --local` 单机模式，经个人中心配置地址回环上报，与「服务端执行」相对                       |
| 执行任务      | ExecTask / ExecItem / ExecStepResult | 任务 → 用例级条目 → 步骤级事件流三级模型；报告为事件视图                                          |
| 前置/后置     | Pre/Post Processor                   | 请求前后的脚本、SQL、等待、变量提取、全局开关（场景级/请求级）                                    |
| 提取          | Extractor                            | 正则/JSONPath/XPath 三种方式 × 随机/指定/全部匹配，产出环境参数或临时参数                         |
| 断言          | Assertion                            | 状态码/响应头/响应体（正则/JSONPath/XPath）/响应时间/变量/脚本 六类                               |
| 误报规则      | FalseAlarmRule                       | 命中即把失败报告标记为误报的项目级规则，仅对新执行生效                                            |
| 公共脚本      | PublicScript                         | 项目级可复用脚本（含参数定义与在线调试），供前后置引用                                            |
| 内置函数      | Functions                            | `@mock` 系列（faker 系 50+）与 `${__fn}` JMeter 兼容子集                                          |
| 模板          | Template                             | 用例/缺陷的场景表单模板，绑定 FieldDef；组织/项目两级，启用项目级不可逆                           |
| 自定义字段    | FieldDef                             | 10 类动态字段定义，实例值存 JSONB                                                                 |
| 缺陷工作流    | Workflow                             | 缺陷状态集 + 流转矩阵（初始态唯一；结束态不计待处理）                                             |
| 服务集成      | Integration                          | 组织级三方平台（Jira/禅道/TAPD）连接配置，配合平台插件                                            |
| 双向同步      | Bug Sync                             | 本地缺陷 ↔ 三方平台缺陷，增量/全量 × 手动/定时                                                    |
| 任务中心      | Task Center                          | 实时任务（运行中执行、失败重跑）+ 定时任务（执行/Swagger 同步/缺陷同步）三级视图                  |
| 消息机器人    | Robot                                | 站内信/邮件/企业微信/钉钉/飞书 Webhook 五渠道通知配置                                             |
| 分享          | Share                                | 免登录只读链接（报告/接口文档），带过期时间，数据为快照                                           |
| AI 模型网关   | Model Gateway                        | OpenAI 兼容协议统一接入 DeepSeek/智谱/OpenAI，系统级+个人级配置                                   |
| License 门控  | Entp Gate                            | 企业版功能开关（多组织/SSO/多资源池/主题/消息模板/用户扩容）统一经 License 校验                   |
| 回收站        | Recycle Bin                          | 软删除资源的恢复/彻底删除（用例/缺陷/接口/场景）                                                  |
| 变更历史      | ChangeLog                            | 实体白名单字段 diff 流水（变更序号），通用横切机制                                                |
| Provider 接口 | CaseRefProvider                      | 跨域读取用例摘要的解耦接口（计划/缺陷/执行/报告消费）                                             |
| 采样器        | Sampler                              | engine 内协议采样抽象（HttpSampler 起步，协议插件扩展）                                           |
| 对标基线      | Baseline                             | [MeterSphere功能清单.md](./MeterSphere功能清单.md)，全部规格文档的对标依据                        |
