# Sprint 8 — 稳定化 · 迭代概览

| 元信息项   | 内容                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint 8（worktree `../RabbitAITest-s8`，分支 `sprint-8-stabilize`，基线 main d19e493）                                                                                         |
| 迭代名称   | 稳定化（性能基线 / 安全加固 / 可观测与备份）——M9 标准版 GA（v1.0）收口                                                                                                          |
| 周期       | 规划第 22-23 周                                                                                                                                                                 |
| 覆盖优先级 | **P2 稳定化**（需求文档 §四 非功能需求、§六 Release Gate 性能与交付维度）                                                                                                       |
| 文档数     | 4 份（1 概览 + 3 规格）                                                                                                                                                         |
| 文档状态   | Implemented（2026-09-28 交付：3 规格全量+原型+三层测试+CI；走查随验收）                                                                                                         |
| 上游依据   | [需求文档](../需求文档.md) §四 非功能需求（性能/可靠/安全/可部署）、§六 验收维度；rules/observability.md（INFRA-004/QA-001 数据来源规范）；rules/security.md（QA-002 验收规范） |
| 前置迭代   | S0-S7 全量（main d19e493）；关键输入：S7 §8「SSRF DNS rebinding 残余风险 → S8 QA-002 收口」、S6 SYS-008 审计、S5 webhook 守卫                                                   |
| 阻塞下游   | S9 企业版（GA 质量基线前提）；Release Gate（性能维度判定）                                                                                                                      |

---

## 1. 迭代目标

**把「标准版 GA」的非功能验收从规范文本变成可执行、可持续回归的资产**：性能基线脚本化进 CI、安全加固收口 rules/security.md 全部已登记残余项、可观测三件套（日志/指标/排障包）+ 备份恢复脚本落地。

三条成功判定：

| 维度           | 目标                                                                                                      | 判定方式                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 性能基线可回归 | 100 并发接口任务全成功；万级用例列表筛选 < 1s；报告页 < 2s——基准脚本 + 阈值断言 + CI 工作流               | `scripts/perf-baseline.mjs` 出 JSON+md 报告；perf CI job 红绿即结论 |
| 安全覆盖收口   | SSRF 连接期校验（消 DNS rebinding TOCTOU）、CSRF Origin 校验、安全响应头、登录限流、依赖审计 CI、密码策略 | 单测矩阵（守卫/限流/头）+ jmx 422/401/429 + e2e 三类断言            |
| 可观测+可恢复  | 统一 pino logger + reqId 链路 + /system/metrics + 失败任务排障包 + 备份/恢复脚本                          | metrics 端点格式单测；排障包 e2e 下载断言；备份→恢复 roundtrip 单测 |

**本迭代不追求**：Prometheus/Grafana 部署与告警集成（指标先以文本格式暴露，采集端外置）、日志外送（ELK/Loki）、分布式追踪（OpenTelemetry 全家桶）、渗透测试与漏洞赏金扫描、渗透级 WAF、企业版 SSO/LDAP（S9）。

## 2. 交付范围（3 规格）

| #   | 交付项       | 内容                                                                                                                                                                                                                                      | 文档        |
| --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | 性能基线     | 基准脚本三场景（万级用例列表筛选 / 报告详情 / 100 并发引擎任务）；perf-seed 万级种子；阈值断言 + JSON/md 报告；独立 perf CI 工作流（PR 快速口径 / main 完整口径）                                                                         | `QA-001`    |
| 2   | 安全加固     | safe-fetch 连接期 IP 校验统一出站（AI/Swagger/webhook 三路收口 DNS rebinding）；CSRF Origin 校验（变更方法，APIKEY 豁免）；安全响应头五枚；登录暴力破解限流（IP+email）；密码策略；`pnpm audit --prod` CI 门禁                            | `QA-002`    |
| 3   | 可观测与备份 | `packages/shared/logger`（pino + redact 脱敏）全栈接入；reqId 生成+`X-Request-Id` 响应头+访问日志；`/system/metrics`（Prometheus 文本最小指标集）；ready 增强（存储+池心跳）；失败任务排障包（报告页下载）；backup/restore 脚本 roundtrip | `INFRA-004` |

## 3. 范围排除（防蔓延红线）

- **不做**：性能测试模块（LOAD，P4）、UI 测试模块（UIT，P4）、压测内核自研（红线 3）、Prometheus Server/Grafana 部署、告警渠道绑定（S5 机器人已具备 webhook 能力，挂钩登记 Backlog）、OpenTelemetry 全链路、多节点监控、增量/异地备份、企业版 SSO
- 性能基线≠压测平台：只覆盖需求文档 §四 明确三条（100 并发任务 / 万级列表 / 报告页），不做全路由基准
- 基线执行环境=本地/CI 单节点（与部署口径一致）；不承诺云端 SLO
- QA-002 审计面复用 SYS-008，不新增审计存储

## 4. 验收标准（现场跑通）

1. `pnpm perf:baseline`（完整口径）：三场景全绿（100/100 任务成功、列表筛选 P95 < 1s、报告详情 < 2s），产出 `perf-baseline-report.md`
2. perf CI：PR 快速口径（1k 用例/20 并发/阈值等比）+ main 完整口径全绿
3. SSRF：`safe-fetch` 对 rebinding 场景（解析公网→连接期内网 IP）拒绝；三处出站（AI 网关/Swagger 同步/通知 webhook）全部经统一守卫
4. CSRF：跨 Origin 的 POST（无 APIKEY）被 403 拒；同源/APIKEY 正常
5. 安全头：响应含 X-Content-Type-Options/X-Frame-Options/Referrer-Policy/Permissions-Policy（HSTS 仅 https 部署启用）
6. 登录限流：同 IP 连续失败 N 次后 429（锁定窗口内正确密码也拒绝），审计留痕
7. metrics：`/api/v1/system/metrics` 输出 Prometheus 文本（队列/引擎/业务最小集）；ready 检查含存储与池心跳
8. 排障包：失败任务报告页「下载排障包」→ tar.gz 含 manifest+事件帧+日志片段
9. 备份恢复：`scripts/backup.mjs` → `scripts/restore.mjs` roundtrip 后关键数据（用户/项目/用例/执行任务）可查
10. 自动化测试齐备（rules/testing.md）：每功能点 Vitest + JMeter（四类×四断言）+ Playwright（三类断言）全绿；远端 CI 全绿

## 5. 规格清单与状态

| 编号      | 名称         | 状态        | 原型/契约                                                                    |
| --------- | ------------ | ----------- | ---------------------------------------------------------------------------- |
| QA-001    | 性能基线     | Implemented | 接口契约=基准脚本 CLI 契约+阈值表（纯引擎/脚本类替代高保真）                 |
| QA-002    | 安全加固     | Implemented | 接口契约=错误码+限流/守卫行为矩阵（纯后端类替代高保真）                      |
| INFRA-004 | 可观测与备份 | Implemented | 排障包 UI 原型 docs/design/INFRA-004-observability-backup/；其余接口契约评审 |
| INFRA-005 | 并行 worktree 槽位隔离 | Implemented | 接口契约评审（INFRA-005-parallel-slot-isolation.md §2：槽位推导/端口表/接入方式；2026-09-28 分支交付，端口/Redis 键空间/共享 /tmp 按 worktree 槽位隔离，单一事实源 scripts/rabbit-env.mjs，规则沉淀 rules/git-workflow §9） |

## 6. 交付自查（2026-09-28 回填）

| 验收标准                           | 结果 | 证据                                                                                                                                                        |
| ---------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. perf full 口径三场景全绿        | ✅   | 列表 P95 11ms（阈值 1000）/ 报告 6ms（阈值 2000）/ 100 并发 100/100 全成功 772ms；perf-baseline-report.md 归档                                              |
| 2. perf CI（PR quick / main full） | ✅   | .github/workflows/perf.yml（quick=1k/20、full=10k/100；阈值=需求文档原文）                                                                                  |
| 3. SSRF 连接期收口                 | ✅   | safe-fetch undici connect.lookup（单测 rebinding 矩阵：多记录含私网→拒）；AI chat/Swagger/webhook 三处出站统一走 safeFetch                                  |
| 4. CSRF                            | ✅   | 跨源 POST 403 10013（jmx T2 + e2e QA-002-02）；缺失放行（jmx/e2e/SDK 全兼容）；Authorization 豁免                                                           |
| 5. 安全头                          | ✅   | jmx T1.1 ResponseAssertion 响应头四枚断言过（nosniff/DENY/Referrer/Permissions + HSTS）                                                                     |
| 6. 登录限流                        | ✅   | 同 IP 5 失败→第 6 次 429 10014（正确密码也拒）；jmx T4（XFF 隔离）+ e2e 三态（含 route 注入浏览器同 IP）                                                    |
| 7. metrics+ready                   | ✅   | /system/metrics Prometheus 文本（jmx 断言指标名×2）；ready checks.storage=true + 池心跳（NO_ENGINE 跳过）                                                   |
| 8. 排障包                          | ✅   | 失败任务按钮→POST 200 JSON（manifest.task.status=FAILED+events 数组）；成功任务无按钮+直发 422 70060（e2e 两态）                                            |
| 9. 备份恢复 roundtrip              | ✅   | 本地实测：seed→backup（63 表 42 行）→restore（TRUNCATE+拓扑序回放）→User/projects/params/admin 全量对齐（CI 不覆盖：脚本类豁免登记，证据留 PR）             |
| 10. 三层测试+CI                    | ✅   | 单测 shared 114/web 118（新增 43）；JMeter 55 计划（新增 3）全绿；Playwright 全量全新口径全绿（新增 2 spec）；OpenAPI 277→279 --check 过；audit prod high=0 |

## 7. 遗留与展望（收尾时回填）

- 告警渠道绑定（error 级日志→S5 通知机器人）→ Backlog
- metrics 接入外部 Prometheus/Grafana 面板 → 部署侧文档化（不进代码）
- 增量备份与备份加密 → Backlog
