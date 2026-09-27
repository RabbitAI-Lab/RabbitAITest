# Sprint 6 — 集成与插件 · 迭代概览

| 元信息项   | 内容                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint 6                                                                                                   |
| 迭代名称   | 集成与插件（M7 里程碑）                                                                                    |
| 周期       | 第 17-19 周（15 个工作日）                                                                                 |
| 覆盖优先级 | **P2/P3 集成与插件**（需求文档 §二：三方同步/CI 集成/插件体系/Swagger 定时同步/三级操作日志；§七 M7 W19） |
| 文档数     | 7 份（2 PLUG + 3 INTG + 1 API + 1 SYS）                                                                    |
| 文档状态   | Implemented（2026-09-27 全量交付：三层测试+CI 全绿；走查随验收）                                                      |
| 上游依据   | [需求文档](../需求文档.md) §二/§七 M7；功能清单 §8.4/§9.1/§9.2/§9.3/§十一                                  |
| 前置迭代   | [Sprint 3](../sprint-3-scenario-automation/sprint-overview.md)（场景执行/定时基建/MinIO 链路）——S4/S5 与本迭代无硬依赖（plan §四依赖图），经评审换位先行（登记：主链 S4 计划顺延，INTG-003 计划触发能力留 S4 接线点） |
| 阻塞下游   | Sprint 7 AI-003（批量生成消费定义面）；P4 协议扩展（PLUG-002 SPI）                                          |

---

## 1. 迭代目标

**把测试工作台接入外部世界：插件化运行时（协议/平台/驱动三类 SPI 宿主）+ 三方缺陷平台双向同步 + CI 开放 API + Swagger 定时同步 + 三级审计日志。**

端到端可演示路径（浏览器操作主线）：

```
系统管理员上传插件包（tarball→MinIO→Plugin 登记→runner 热加载）
→ 组织管理员配置服务集成（Jira 地址+凭据加密→测试连接）
→ 项目关联三方平台（projectKey/字段映射/增量+定时）
→ 本地缺陷「同步」→平台创建（platformKey 回写）→ 拉取状态回写本地
→ 个人生成 APIKEY → Jenkinsfile curl 触发场景执行 → 轮询报告摘要（CI 门禁）
→ 接口定义建 Swagger 定时同步任务 → 定时导入（覆盖判重报告）
→ 全程操作留痕 → 三级日志页高级查询
```

四条成功判定：

| 维度           | 目标                                                                                       | 判定方式                                                       |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 插件框架可用   | tarball 上传/启停/组织范围/runner worker_threads 隔离+崩溃重启；示例插件跑通                 | PLUG-001 T2/T3 E2E（生命周期+范围两态）                         |
| 三方同步闭环   | Jira/禅道/TAPD 推送+拉取+定时增量；凭据密文不回显；断链不损本地                              | INTG-001/002 T2-T4（推送/拉取/断链三态 × mock 平台）            |
| CI 可脚本接入  | APIKEY 5 条/一次性 sk；open API 触发执行+轮询+限流；越权拒绝                                 | INTG-003 T2/T3（CI 全流程+越权限流）                            |
| 审计与定时同步 | 写操作全留痕（三级面查询+保留清理）；Swagger URL 定时导入复用 S2 判重                         | SYS-008 T2/T3；API-011 T2/T3                                    |

**本迭代不追求**：WebSocket/MQTT 协议本体（P4）、字段映射可视化编辑（固定映射先行）、Jenkins 端原生插件（脚本接入文档）、APIKEY HMAC 签名、审计导出、需求同步（禅道/TAPD）。

## 2. 交付范围（7 项 / 7 规格）

| #   | 交付项           | 内容                                                                                                        | 文档       |
| --- | ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | 插件框架         | tarball 上传（清单/SPI 版本校验）→MinIO→Plugin 登记；启停/组织范围/删除依赖校验；plugin-runner 宿主（HTTP loopback 命令面+worker_threads 隔离+崩溃重启）；管理页；内置 platform-echo | `PLUG-001` |
| 2   | 协议插件 SPI     | SamplerPlugin SPI 冻结；engine 进程内注册表（30s 同步）；SamplerResult 标准化；tcp-conn 示例插件；定义页协议联动+动态表单 | `PLUG-002` |
| 3   | Jira 对接        | 组织服务集成（凭据 AES-GCM/测试连接）；项目关联（projectKey/映射/增量定时）；推送创建更新+拉取状态回写+syncState 状态机；同步历史 | `INTG-001` |
| 4   | 禅道/TAPD 对接   | 同 SPI 两适配器（禅道 token 会话/TAPD Basic）；平台元数据表；复用 INTG-001 全部编排                          | `INTG-002` |
| 5   | Jenkins CI       | APIKEY（5 条/一次性 sk/吊销）+认证中间件（第三通道）；open 执行 API（触发 api-case/scenario+轮询+报告摘要）+限流；接入文档 | `INTG-003` |
| 6   | Swagger 定时同步 | 同步任务 CRUD（URL 守卫/覆盖/模块/cron）；手动+定时导入（复用 S2 管线）；同步历史 20 条                       | `API-011`  |
| 7   | 审计日志         | withAudit() 声明式审计（BullMQ 异步批量+降级直写）；S6 全接+S1-S5 回补清单；三级查询+高级筛选；保留时长清理     | `SYS-008`  |

## 3. 范围排除（防蔓延红线）

- 不做：协议本体（WebSocket/MQTT/gRPC/SSH——P4）、数据库驱动插件运行时（DriverPlugin SPI 接口冻结但驱动加载 P4，PROJ-003 内置 PostgreSQL 维持）、字段映射可视化编辑器、Jira 删除/评论同步、禅道 PATH_INFO 型、需求同步、APIKEY HMAC、审计导出与聚合、Jenkins 原生插件开发
- ENTP 红线：License 授权管理页不做（License 表 S0 建齐不启用）；基线「JIRA 企业版」口径经 plan 评审纳入标准版（INTG-001 §1.4 登记）
- 兼容承诺限定（plan §六）：不承诺 pf4j jar 兼容（TS tarball 自有生态）

## 4. 依赖与顺序（迭内）

```
PLUG-001（框架+runner）─┬→ PLUG-002（Sampler SPI，engine 侧）
                        └→ INTG-001（Jira：编排+加密+状态机）→ INTG-002（禅道/TAPD 适配器）
INTG-003（APIKEY+open API，独立）   API-011（S2/S3 复用，独立）   SYS-008（横切，最后全量回补挂载）
```

关键路径：PLUG-001 → INTG-001 → INTG-002；INTG-003/API-011/SYS-008 可并行。

## 5. 测试与验收总口径

- 每规格 §5 用例表 ↔ tests/ 一一对应（jmx 四类×四断言 + spec 三类断言）；新增 JMeter ≥7、Playwright ≥15（T2/T3 级）、Vitest 单测覆盖加密/注册表/限流/withAudit/状态机核心分支
- e2e 栈扩展：apps/mock 增 mock-jira/mock-zentao/mock-tapd/mock-swagger-doc 四面；plugin-runner 以 instrumentation 拉起
- Release Gate：全量 tests/ 绿 + 远端 CI 绿 + MAINFLOW-s6 主链路（上传插件→配置集成→同步缺陷→APIKEY 触发→日志留痕）

## 6. 风险与对策

| 风险                                             | 对策                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| runner 进程管理在 CI 环境不稳定                  | e2e global-setup 健康检查+超时拉起；instrumentation 复用 S2 mock 模式 |
| 凭据加密密钥在 CI 缺失                           | CI secret 注入 RABBIT_INTEGRATION_SECRET；缺失时集成功能优雅降级（70015 只拦保存） |
| withAudit 回补面大（S1-S5 存量路由）             | 回补清单制+走查逐路由 grep 核对；查询类路由不记（规模控制）           |
| open API 安全面（限流/越权）                     | 限流+本人数据范围+审计三件套；SEC 复核点登记 rules/security          |
| S3 基线上 shared/db 变更合并（与 S4/S5 并行期）   | 本迭代自 main（含 S3）切分支；契约 additive；合并冲突面=api/schemas 追加+seed |

## 7. 交付自查表（收尾回填；2026-09-27 首批进度）

| # | 项                                                     | 状态 |
| - | ------------------------------------------------------ | ---- |
| 1 | 7 规格 Approved + 原型 5 组产出（PLUG-002 契约评审替代；人工确认随走查） | ✅ 首批 |
| 2 | 契约（SPI 三接口/S6 schemas）+ 权限点 7 枚 + OpenAPI 快照（225 paths）+ api-client s6.ts | ✅ |
| 3 | 代码实现（runner/engine/web 前后端 + 4 插件包 + mock 三平台）            | ✅ 首批（编译/单测全绿） |
| 4 | Vitest 单测全绿（shared 62 + web 24 + engine 28 + runner 4 = 118）     | ✅ 首批 |
| 5 | JMeter 新增 5 份全绿（四类×四断言；本地三轮稳定+CI 门禁）             | ✅ |
| 6 | Playwright 新增 15 条全绿（三类断言；三轮调试修 8 项产品缺陷）        | ✅ |
| 7 | MAINFLOW-s6 主链路（插件→集成→推拉→APIKEY→审计）                     | ✅ |
| 8 | lint + 全量 tests 本地绿（typecheck 13 任务 0 错 / lint 0 errors / 单测 118） | ✅ 首批 |
| 9 | 合 main（8e560b3+）+ 远端 CI 全绿                                   | ✅ |
| 10 | CHANGELOG v0.5.0 + 概览回填 + 规格全部转 Implemented                | ✅ |

## 8. 里程碑

M7（W19）：插件框架+三平台对接+CI 接入+定时同步+审计日志全量可用——标准版「集成」面收口，剩余 S7（AI）+ S8（稳定化）即 v1.0。
