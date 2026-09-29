# Sprint future — 远期 P4 · 迭代概览

| 元信息项   | 内容                                                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 迭代编号   | Sprint future（worktree `../RabbitAITest-future-p4`，分支 `sprint-future-p4`，基线 main 2865e08 / PR #3 S8 合并后）                            |
| 迭代名称   | 远期 P4：协议插件扩展 · 外部工具契约 · 报告高级分析 · K8S 池型 · 企业版占位（LOAD/UIT）                                                        |
| 周期       | 规划 W28+（需求文档 §里程碑「远期」行）                                                                                                        |
| 覆盖优先级 | **P4 远期增强级**（需求文档 §优先级表）                                                                                                        |
| 文档数     | 9 份（1 概览 + 8 规格）                                                                                                                        |
| 文档状态   | Implemented（2026-09-28 交付：8 规格全量+原型+三层测试+CI；走查随验收）                                                                        |
| 上游依据   | [需求文档](../需求文档.md) §优先级 P4 行、「明确不做（P4 远期）」边界行；[MeterSphere功能清单](../MeterSphere功能清单.md) §6.2/§9.1/§11/§12.10 |
| 前置迭代   | S0-S8 全量（main 2865e08，M9 标准版 GA）；关键输入：S6 插件 SPI（PLUG-001/002）、INTG-003 APIKEY open 面、EXEC-002 池契约                      |
| 阻塞下游   | 无（最终远期迭代；企业版深化属 ENTP 后续，LOAD-002/UIT 占位为其挂点）                                                                          |

---

## 1. 迭代目标

**把需求文档 P4 行的五个远期方向一次收口**：协议插件（真交付）、外部工具契约（服务端真交付+插件本体外仓）、报告高级分析（超出基线自主设计真交付）、K8S 池型（配置面真交付、调度面零变化）、性能/UI 测试（与 MeterSphere v3 社区版同口径：**企业版方向占位**，不实现模块——红线）。

五条成功判定：

| 维度           | 目标                                                                                                | 判定方式                                             |
| -------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 协议插件全链路 | websocket/mqtt 插件上传→启用→定义选协议→调试执行→报告全通；保存校验 40511 兑现                      | 单测（内嵌 ws echo/mini broker）+ jmx + e2e 三类断言 |
| 外部工具契约   | open/api-sync（upsert 幂等）与 open/api-capture（脱敏+跳过）经 APIKEY 可用，OpenAPI 快照收录        | jmx 四类×四断言 + 幂等/脱敏单测 + 快照 --check       |
| 报告高级分析   | /reports/stats 7/14/30 天趋势+分布+失败 TOP5，零图表库自绘 SVG                                      | 聚合单测 + jmx + e2e                                 |
| K8S 池型       | 默认池 NODE↔K8S 切换+四项配置+掩码回显+试连（SSRF 守卫例外口径）；调度面零变化                      | zod/服务单测 + jmx + e2e 四态走查                    |
| 企业版占位复刻 | modules.load/uit 开关+保留权限点+占位页+池 DTO loadTest/uiTest 字段（清单 §12.10 占位证据逐条对齐） | 权限单测 + jmx + e2e 三态                            |

**本迭代不追求**：压测内核/UI 测试执行器（红线）、多资源池（ENTP-006）、License 门控（ENTP-007，S9 范围）、IDEA/浏览器插件本体（JVM/MV3 外仓交付）、Thrift/gRPC 等更多协议、协议配置表单化。

## 2. 交付范围（8 规格）

| #   | 交付项           | 内容                                                                                                    | 文档       |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | 性能测试占位     | modules.load 开关+PROJECT_LOAD:READ+占位页+池 DTO loadTest 字段（企业版方向，清单 §12.10 口径）         | `LOAD-001` |
| 2   | 分布式压测架构稿 | 企业版方向拓扑/契约冻结（纯规格，无代码——红线重申）                                                     | `LOAD-002` |
| 3   | UI 测试占位      | modules.uit 开关+PROJECT_UIT:READ+占位页+池 DTO uiTest 字段                                             | `UIT-001`  |
| 4   | WebSocket/MQTT   | 两协议插件包（零新增依赖）+RequestEditor 协议选择器+保存校验 40511+mock /ws/echo                        | `PLUG-003` |
| 5   | IDEA 插件契约    | open/api-sync 批量 upsert（幂等键 method+path）+open/api-definitions 回读                               | `TOOL-001` |
| 6   | 浏览器插件契约   | open/api-capture 抓包导入（敏感头脱敏+重复跳过）                                                        | `TOOL-002` |
| 7   | 报告高级分析     | reports/stats 趋势/分布/TOP5 聚合端点+统计页（SVG 自绘）                                                | `RPT-004`  |
| 8   | K8S 型资源池     | 池 type 切换+k8s 四项配置+token 掩码+试连+task-runner 清单模板（ResourcePool.config 新列，门禁 3 登记） | `EXEC-004` |
| 9   | 数据库驱动五家   | 五家厂商官方 Node 驱动插件包+引擎驱动注册表+SQL 前后置处理器解禁（白名单+READ ONLY+参数绑定）+环境数据源 driver 泛化+连接测试泛化 | `PLUG-004` |
| 10  | 协议插件第二批   | ssh/redis/mongodb/grpc/amqp 五协议插件包+protocol-kit+cpu-features 空桩+内嵌测试目标（ssh2 server/mini RESP/gRPC echo）+e2e redis 真执行 | `PLUG-005` |

## 3. 范围排除（防蔓延红线）

- **不做**：性能测试模块与压测内核（AGENTS 门禁 6 红线+需求文档「明确不做」）、UI 测试执行器（同）、多池/License（ENTP-006/007）、插件市场与签名、IDEA/MV3 插件本体、mqtt TLS/QoS1+、WebSocket 会话复用、报告对比 diff、组织级统计
- 协议插件版本归属差异（基线=企业版独有）已在 PLUG-003 §6 显式登记为差异化决策（需求文档 P4 行明确列入本项目范围）
- K8S 调度面（pod 级并发/队列路由）不做——两型池调度同构（规格冻结），多池路由留 ENTP-006

## 4. 验收标准（现场跑通）

1. 插件链路：上传 websocket 插件→启用→调试页选协议→对 mock `/ws/echo` 执行→响应回显；未启用协议保存定义 422·40511
2. mqtt 插件：上传启用+定义保存 200（执行正确性以内嵌 mini broker 单测判定，e2e 不依赖外部 broker）
3. open 契约：APIKEY curl 同步 3 条接口→列表可见→重放 created=0/updated=3；capture 提交含 authorization 头→库内脱敏
4. 统计页：执行一轮场景后 /reports/stats 当日增量可见，7/14/30 切换正确，空态呈现
5. K8S 池：切 K8S 填配置保存→回显掩码 tokenSet→test=true 对 mock apiServer 返回 k8sVersion→切回 NODE 配置休眠保留
6. 占位：设置开启 load/uit→导航组与占位页出现（无权限用户不可见）→关闭即隐；池 DTO 含 loadTest/uiTest=false
7. 自动化测试齐备：每功能点 Vitest + JMeter（四类×四断言）+ Playwright（三类断言；TOOL 两规格豁免登记）全绿
8. 远端 CI 全绿（含 OpenAPI 快照 --check 与 audit 门禁）

## 5. 规格清单与状态

| 编号     | 名称                | 状态                                    | 原型/契约                                               |
| -------- | ------------------- | --------------------------------------- | ------------------------------------------------------- |
| LOAD-001 | 性能测试模块占位    | Implemented（2026-09-28）               | 原型 docs/design/LOAD-001-load-placeholder/（三态）     |
| LOAD-002 | 分布式压测架构稿    | Implemented（架构稿交付；无代码面豁免） | 纯架构规格（拓扑+契约冻结，评审替代原型）               |
| UIT-001  | UI 测试模块占位     | Implemented（2026-09-28）               | 原型 docs/design/UIT-001-uit-placeholder/（三态）       |
| PLUG-003 | WebSocket/MQTT 协议 | Implemented（2026-09-28）               | 原型 docs/design/PLUG-003-websocket-mqtt/（选择器四态） |
| TOOL-001 | IDEA 插件同步契约   | Implemented（2026-09-28）               | 接口契约评审（纯后端类替代高保真）                      |
| TOOL-002 | 浏览器插件采集契约  | Implemented（2026-09-28）               | 接口契约评审（纯后端类替代高保真）                      |
| RPT-004  | 报告高级分析        | Implemented（2026-09-28）               | 原型 docs/design/RPT-004-report-analytics/（三态）      |
| EXEC-004 | K8S 型资源池        | Implemented（2026-09-28）               | 原型 docs/design/EXEC-004-k8s-resource-pool/（四态）    |
| PLUG-004 | 数据库驱动五家+SQL 解禁 | Implemented（2026-09-30）           | 原型 docs/design/PLUG-004-database-drivers/（三画板）   |
| PLUG-005 | 协议插件第二批（五家）   | Implemented（2026-09-30）           | 豁免（纯后端：configSchema 契约评审替代高保真）         |

## 6. 迭代主线（浏览器可演示端到端）

登录 admin → ① 项目设置开启「性能测试/UI 测试」占位开关→导航出现占位页 → ② 系统设置·资源池切 K8S 型保存配置并试连 → ③ 系统设置·插件上传并启用 websocket 插件 → ④ 接口调试选 WebSocket 协议→对 mock `/ws/echo` 执行成功 → ⑤ 报告统计页查看 14 天趋势增量 → ⑥ APIKEY curl 调 open/api-sync 同步 3 条接口→列表可见。

## 7. 交付自查（2026-09-28 回填）

| 验收标准                                              | 结果 | 证据                                                                                                                                                                                                            |
| ----------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 插件链路（上传→启用→选协议→执行→报告；40511 兑现） | ✅   | e2e PLUG-003-T9：ws 对 mock /ws/echo 执行 SUCCESS 且响应回显 hello-ws-rabbit；T10 未启用 mqtt 保存 422·40511；jmx PLUG-003 四类（含 409 版本递增）全绿                                                          |
| 2. mqtt 插件与 open 契约                              | ✅   | 单测内嵌 mini broker 19 用例（探活/通配/CONNACK 拒/超时/编解码矩阵）；TOOL 两 jmx：sync created=3→重放 updated=3、capture 脱敏+skipped、Basic/Bearer、101 条 10024                                              |
| 3. 统计页                                             | ✅   | RPT-004-T6 调试执行后 Σtotal≥1 + 7 天切换 days=7 负载断言；T6b 空态引导；jmx days=13/abc 422·60422                                                                                                              |
| 4. K8S 池                                             | ✅   | e2e T8 切换→保存→掩码→休眠往返（apiServer/namespace 回填）；jmx T3-0 缺 token 50422/T3-2 非 https 20422/收尾恢复 NODE；单测守卫矩阵 9 例+试连三态                                                               |
| 5. 占位复刻                                           | ✅   | e2e 开关→导航显隐→占位页能力清单口径；池 DTO loadTest/uiTest=false（jmx contains 断言）；权限单测（预置组映射）                                                                                                 |
| 6. mqtt 执行正确性口径                                | ✅   | 单测内嵌 broker 判定（jmx/e2e 不依赖外部 broker，规格登记）；websocket 真执行在 e2e                                                                                                                             |
| 7. 三层测试齐备                                       | ✅   | 单测 348（新增 116：engine 19+shared 13+web 84）；JMeter 新增 7 计划（LOAD-002 豁免登记）四类×四断言；Playwright 新增 5 spec 8 用例三类断言（TOOL 两规格 UI 豁免登记）                                          |
| 8. 快照与审计                                         | ✅   | OpenAPI 277→284 paths（+stats/+api-sync/+api-definitions/+api-capture/+plugins/protocols/+pools PUT 扩展…）--check 过；typecheck 13/13；format 全绿（顺手修 S6 原型 INTG-003 `<uuid>` 未转义致 oxfmt 解析失败） |

- **验收演示视频（2026-09-29 回填）**：`demo/fp-acceptance-demo.webm`（2:40 · 1280×720 · 7.8MB）——演示主线六段：①模块开关占位（/load · /ui-test 企业版 License 门控页）→ ②K8S 池型（表单保存/掩码回显/NODE 往返）→ ③插件上传启用（websocket/mqtt tarball · 弹窗直传）→ ④WS 协议调试执行（ws://mock /ws/echo 回显 `hello-rabbit-fp-demo`，重试后 SUCCESS · 断言 2/2）→ ⑤报告统计（Σtotal 1 · passRate 100% · 14 天趋势 SVG）→ ⑥APIKEY 开放接口同步（Basic 鉴权 /api-sync → /apis 3 条）；录制脚本 `tests/demo/fp-demo-record.mjs`（可复跑，步骤浮层标注）；抽帧 7 处验证画面（8s/35s/100s/112s/120s/128s/150s，六段全覆盖）。录制过程暴露 S6 潜伏缺陷两处（§7.2-10）已修复并补 UI 直传回归用例（PLUG-001-T5）。

### 7.2 实现过程缺陷与教训（首红/返工记录）

1. **S6 潜伏缺陷三处，因引擎执行链路首次被 e2e 覆盖而暴露**（PLUG-003 勘误 4）：引擎协议轮询 URL 恒回退 :3000（不回退 WEB_URL）、鉴权头 Bearer vs x-internal-token 恒 401、step.ts 在协议分派前 resolveUrl 把占位 url 误判「相对路径未选环境」——三处均为 S6 死码路径（tcp-conn 从未真执行），修复后注册表与执行首次打通。教训：**「上传/启用成功」≠「执行链路可用」，门禁 7 的执行深度以 e2e 真执行为准**。
2. **CJS 插件 bundle 的加载器解包**：undici 内联必须 format=cjs（esm 会垫 throw dynamic-require），而 esbuild 单默认导出的 CJS 产物 `module.exports=fn`（无 .default），带具名导出后又变命名空间——双侧加载器统一双层解包 + 插件源导出 createPlugin 具名（勘误 5）。
3. **PUT /projects/{id} 非法载荷 500**（S1 潜伏）：`.parse` 抛 ZodError 未映射——改 safeParse 422（rules §4.5）；被 LOAD-001 jmx T3-1 抓获。
4. **协议选择器数据源权限面**：初版复用管理端点致普通成员无协议选项（产品语义冲突）——新增会话级 `/plugins/protocols`（勘误 3）；RequestEditor 无权限拉列表亦会产生 403 console 噪音（三类断言拦截）。
5. **多 worktree 端口互抢第三案**：本机主仓 dev 栈常驻 :4010（plugin-runner 内嵌），jm/e2e 栈 runnerLoad 打到外来进程（旧加载器+异己 PLUGIN_DIR）——两栈加 PLUGIN_RUNNER_PORT 隔离（4030/4031，沿 JM_MOCK_PORT 先例；客户端默认值跟随 PORT）；另 e2e /tmp/rabbit-e2e-root 陈旧副本再次掩盖新构建（S5 同款，删除收场）。
6. **jmx 生成器三坑**：multipart 属性名大小写（HTTPSampler.Files→HTTPsampler.Files 恒 422 70002）；JMeter 变量线程组隔离（跨组引用 ${PROJECT_ID} 变 URISyntaxException——校验用例并组）；Basic 头需 base64(ak:sk)（Groovy 侧预编入 props 桥）。
7. **k8s 休眠回显**：k8s 摘要若仅 K8S 态输出，NODE 往返后表单清空与「免重填」语义矛盾——摘要恒回显、type 表征激活态（EXEC-004 勘误 3）；e2e 抓获。
8. **e2e 并行互扰两案（全量复跑三轮抓出）**：①EXEC-004 与 EXEC-002 并行共写全局默认池——池页保存载荷恒带表单内并发值，把 EXEC-002 刚下调的 2 覆盖回 4；产品级修正=**仅携带用户真改动的字段**（并发/类型分别 dirty 判定，多管理员并发编辑同理），EXEC-002 载荷断言移至真变更（4→2）处。②池页「测试连接（试连不保存）」按钮文案含「保存」二字，EXEC-002 的保存按钮正则 /保\s*存/ 双命中 strict violation——文案改「测试连接（不落库）」。另：SYS-007-T4 补 toBeEnabled 等待（React 状态滞后竞态）、EXEC-002 槽位断言从 busy=0 放宽为 x÷2（并行下引擎无空闲窗口，意图=验证下发生效）。
9. **本机多会话高载下的轮换型伪红**：全量 4 轮复跑中 AI-004/CASE-003/API-008/MAINFLOW-s4/FILE-001 等轮换挂（load avg 7-8、83 个 node 进程来自并行会话遗留栈）——逐一串行复跑全绿，测试代码无缺陷；与 S9 会话同境（全新口径以远端 CI 专属 runner 为准，AGENTS 门禁 9）。
10. **S6 潜伏缺陷再两处（UI 上传按钮路径零覆盖所致，验收演示录制首次暴露）**：① api-client `post()` 会 JSON.stringify FormData 并强设 application/json，服务端落 JSON 分支 422「缺少 file 字段」——`upload()` 改直连 `request()` 保留浏览器 multipart 边界；② 前端 FormData 以 `JSON.stringify("ALL")`（带引号）发出 orgScope，`parseScope` 落单 orgId 分支 safeParse 失败裸抛 ZodError 500——解析改「带引号 JSON 串先剥引号 + 非法值统一 DomainError 422（70002）」。潜伏根因同型：e2e/jmx 皆走 base64 JSON 形态，浏览器 multipart 出口从未被任何用例走过——补 **PLUG-001-T5**（UI 弹窗直传真实 tarball：multipart content-type 头断言 + 201/409 分支响应体断言 + 409 幂等 console 白名单显式登记 + beforeUpload 状态落定等待）。教训：**「API 形态已覆盖」≠「UI 控件路径已覆盖」，客户端序列化层缺陷只有真实浏览器出口能暴露**。
11. **旧进程占口第三形态（回归验证期假红）**：e2e webServer `reuseExistingServer` 复用了上一会话遗留的 next-server（:3100 含旧构建），rebuild 与重跑恒 422 掩盖修复——与 §7.2-5 /tmp 陈旧副本同型的「活进程」变体，处置=清残留监听（`lsof -ti :3100`）后复跑即绿；另：基线前移（PR #9 合入 main）后本地 worktree 须 `prisma generate` + `pnpm install` 同步，否则 typecheck 假红（department 模型缺类型 / ldapts 模块缺失），与代码缺陷无关。

## 8. 测试资产映射

| 规格     | 单测（Vitest）                 | JMeter                        | Playwright                   |
| -------- | ------------------------------ | ----------------------------- | ---------------------------- |
| LOAD-001 | 权限点常量                     | LOAD-001-modules.jmx          | LOAD-001-placeholder.spec.ts |
| LOAD-002 | 豁免（无代码面）               | 豁免                          | 豁免                         |
| UIT-001  | 权限点常量                     | UIT-001-modules.jmx           | UIT-001-placeholder.spec.ts  |
| PLUG-003 | ws/mqtt 采样器+编解码+保存校验 | PLUG-003-protocol-plugins.jmx | PLUG-003-protocol-ui.spec.ts |
| TOOL-001 | upsert 幂等/边界               | TOOL-001-open-sync.jmx        | 豁免（登记）                 |
| TOOL-002 | 脱敏/跳过/边界                 | TOOL-002-open-capture.jmx     | 豁免（登记）                 |
| RPT-004  | 聚合+SVG 路径                  | RPT-004-stats.jmx             | RPT-004-stats.spec.ts        |
| EXEC-004 | zod 矩阵+服务+守卫             | EXEC-004-k8s-pool.jmx         | EXEC-004-k8s-pool.spec.ts    |
| PLUG-004 | sql-guard/driver-kit/处理器    | PLUG-004-database-drivers.jmx | PLUG-004-database-drivers.spec.ts |
| PLUG-005 | 内嵌目标/契约/错误映射          | PLUG-005-protocol-plugins.jmx | PLUG-005-protocol-plugins.spec.ts |

## 9. 收尾清单

- [x] 全部规格状态流转 Approved → Implemented
- [x] docs/README.md 迭代表 sprint-future-p4 行更新
- [x] CHANGELOG v0.8.0
- [x] 架构文档同步（engine-execution-architecture EXEC-004 兑现标注；test-domain-model §6 门禁 3 例外登记）
- [x] commit + push 分支 + PR #7 + 远端 CI 全绿（PR run 36461411109 七作业全绿：quality 1m28s/build 2m29s/audit/perf/迁移重放/**e2e 8m47s**/**jmx 18m45s**；PR 已合入 main，main push run 36464377799 六作业全绿 + perf 36464377613 绿，2026-09-28 18:19 合并、main 保持绿）
- [x] 验收演示视频归档（2026-09-29）：`demo/fp-acceptance-demo.webm` + 可复跑录制脚本 `tests/demo/fp-demo-record.mjs`；演示期暴露的 S6 两处上传潜伏缺陷修复 + UI 直传回归 PLUG-001-T5 随同 PR 交付（§7 视频条目 / §7.2-10·11）
