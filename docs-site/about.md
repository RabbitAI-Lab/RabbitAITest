# 关于与版本

RabbitAITest 是一个开源的一站式测试工作台（测试管理 + 接口测试 + AI），代码托管于 [GitHub](https://github.com/RabbitAI-Lab/RabbitAITest)，发行协议以仓库主页公示为准。

## 与 MeterSphere 的关系

RabbitAITest 的产品功能面**对标 MeterSphere v3.x 社区版**，以《MeterSphere 功能清单》为唯一对标基线进行裁剪与复刻，同时在工程实现上独立自研（全栈 Next.js + TypeScript Monorepo + 自研执行引擎）。主要差异：

| 维度       | 说明                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 执行引擎   | 自研 Node.js 引擎（undici / quickjs / p-limit），不内嵌 JMeter；`jmx` 仅作为导入格式兼容常用子集           |
| 标准版范围 | 不包含 UI 测试与性能测试（导航占位、默认关闭）                                                             |
| 企业版能力 | 多组织、SSO、多资源池、主题品牌、消息模板、用户扩容六特性由 License 门控，默认关闭                         |
| 数据兼容   | 功能用例导入兼容 MeterSphere 官方 Excel / Xmind 模板；接口定义支持 OpenAPI3 / Postman / jmx 导入，平滑迁入 |

## 版本历史

| 版本       | 迭代                       | 交付要点                                                                          |
| ---------- | -------------------------- | --------------------------------------------------------------------------------- |
| Unreleased | —                          | 插件管理 UI 上传缺陷修复等                                                        |
| v0.9.0     | Sprint 9 · M10 企业版核心  | License 门控、多组织、SSO、扫码登录、主题品牌、消息模板、多资源池、用户扩容与部门 |
| v0.8.0     | Sprint future · 远期 P4    | 协议插件（WebSocket / MQTT）、K8S 池型占位、报告分析增强                          |
| v0.7.2     | —                          | AI 智能助手基于 Ant Design X 重构                                                 |
| v0.7.1     | —                          | 安全扫描门禁误报根治                                                              |
| v0.7.0     | Sprint 8 · M9 标准版 GA    | 性能基线、安全加固、可观测与备份、并行槽位隔离                                    |
| v0.6.0     | Sprint 5 · M6 协作通知     | 通知机器人五渠道、缺陷协作与回收站、公共脚本、环境组与全局参数、Git 仓库文件源    |
| v0.5.x     | Sprint 4 / 6 / 7           | 计划完整与脑图执行（S4）、三方集成与插件体系 / Swagger 同步（S6）、AI 能力（S7）  |
| v0.4.0     | Sprint 3 · M4 场景自动化   | 场景编排、循环 / 条件 / CSV 参数化、批量执行                                      |
| v0.3.0     | Sprint 2 · M3 接口测试核心 | 接口定义 / 调试 / 用例、环境、Mock、执行引擎 v1                                   |
| v0.2.0     | Sprint 1 · M2 测试管理 MVP | 功能用例、评审、计划、缺陷、工作台                                                |
| v0.1.0     | Sprint 0 · M1 POC          | 技术验证（已通过用户验收）                                                        |

?> 里程碑口径：M1 POC → M2 测试管理 → M3 接口核心 → M4 场景自动化 → M5 计划完整 → M6 协作 → M7 集成与插件 → M9 标准版 GA → M10 企业版核心。

## 参与贡献

开发环境、工程门禁与提交规范见[二次开发指南](developer/contributing.md)；架构与执行链路见[架构概览](developer/architecture.md)。欢迎通过 GitHub Issues 反馈问题、Pull Request 贡献代码。

## 相关链接

- [产品介绍](quickstart/introduction.md)
- [快速体验](quickstart/quick-tour.md)
- [常见问题](faq.md)
