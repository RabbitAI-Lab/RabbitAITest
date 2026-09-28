# Jenkins CI 集成（APIKEY 认证 · 开放执行 API）

| 元信息项     | 内容                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | INTG-003                                                                                                                |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                                   |
| 优先级       | P2（迭代内）                                                                                                            |
| 所属模块     | 个人中心（personal）+ 认证（auth）+ 执行（exec 域）                                                                     |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿、CI 六作业全绿；高保真走查随验收）                       |
| 最后更新日期 | 2026-09-27                                                                                                              |
| 上游依赖     | S2 执行链路（api-case 执行）、S3 场景执行（scenario）、EXEC-002 资源池                                                  |
| 下游消费     | S4 PLAN-003（计划执行触发——Jenkins 触发测试计划届时接线）、S5 SYS-007（个人中心 UI 复用 APIKEY 页）                     |
| 上游依据     | 需求文档 §二「CI 集成」；功能清单 §9.3 APIKEY（第三方 API 调用、Jenkins 插件）、§十一 Jenkins 插件（流水线触发）        |
| 对标基线     | 功能清单 §9.3：APIKEY Access Key/Secret Key（最多 5 条）用于 Jenkins 插件；§十一：Jenkins 插件=流水线触发测试（社区版） |
| 关联架构文档 | api-conventions.md §4（认证三通道 Session+Token+APIKEY——需求文档 §八安全行）；rbac-permission-model.md                  |
| 高保真确认   | 待确认（原型 docs/design/INTG-003-jenkins-ci/）                                                                         |
| 工作量估算   | 后端 4 人日 / 前端 2 人日                                                                                               |

## 1. 概述

### 1.1 功能定位

CI 集成的本侧能力：个人 APIKEY 管理（生成/吊销，认证通道第三态）+ **开放执行 API**（APIKEY 认证触发接口用例/场景执行与结果轮询），使任意 CI 系统（Jenkins/GitLab CI/GitHub Actions）可脚本化接入。基线的 Jenkins 端插件（装在 Jenkins 里）不在本项目交付面——以「curl/Jenkinsfile 示例」文档替代（登记）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                | P1 ✅ | 后续                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------- |
| APIKEY 生成：`access_key`（前缀展示）+`secret_key`（仅创建时一次返回明文；库存 sha256）                                                             | ✅    | —                                                   |
| APIKEY 列表/吊销（revoke 软删，lastUsedAt 回显）；上限 5 条/人（基线）                                                                              | ✅    | —                                                   |
| APIKEY 认证中间件：`Authorization: Basic base64(ak:sk)` 或 `Bearer ak.sk`；校验=prefix 索引+哈希比对+revoked 拒绝                                   | ✅    | HMAC 签名请求（时间戳防重放，登记）                 |
| 开放 API（/api/v1/open/*，APIKEY 通道，绕过 session/权限点——本人身份）：触发执行（api-case/scenario：目标+环境+资源池可选）、任务状态轮询、报告摘要 | ✅    | 回调通知（CI 完成回调 webhook，登记 S5 消息基建后） |
| 触发语义：同步返回 `{taskId}`（长任务约定 api-conventions §4）；open 端点限流（每 key 10 QPS，Redis 令牌桶）                                        | ✅    | 批量触发（多场景一次）                              |
| Jenkins 接入文档：README CI 章节（curl 示例+Jenkinsfile stage 片段：sh curl 触发→sleep 轮询→结果门禁）                                              | ✅    | Jenkins 端原生插件（基线插件形态，登记不交付）      |
| Jenkins 触发测试计划                                                                                                                                | ❌    | S4 PLAN-003 后接线（本规格 §7 里程碑登记）          |

### 1.3 前置依赖

ApiKey 模型已建（S0）；S2/S3 执行创建链路（exec.service）；Redis 限流基建（S2 资源池/Mock 令牌桶先例）。

### 1.4 对标基线核对

复刻：APIKEY 5 条上限、sk 一次性展示、第三方调用用途；CI 触发测试链路形态（触发→轮询→结果）。差异：①Jenkins 端插件本体不交付（开源 Jenkins 插件开发超出仓库范围，以脚本接入文档替代——基线该插件也是 MeterSphere 侧单独仓库分发）；②触发目标=接口用例/场景（计划 S4 后）；③无 HMAC 签名（Basic 通道先 行，HTTPS 部署口径下风险可控，登记）。

## 2. 业务逻辑

- **生成**：`ak = "rak" + 20 位随机 base62`（prefix 6 位进列索引）；`sk = 40 位随机`；返回体一次展示；`keyHash=sha256(ak+":"+sk)`。
- **认证**：中间件解析 Basic（优先）/Bearer → prefix 前缀查 ApiKey（未吊销）→ 常量时间比对哈希 → lastUsedAt 异步回写 → `req.userId` 注入（与 session 通道同形，下游 open handler 按本人鉴权数据范围）。失败=401 `code 10005`。
- **开放 API 数据范围**：APIKEY=本人身份，可触发目标=本人可见项目内的 api-case/scenario（越权 403 10003 同口径）。
- **轮询契约**：`GET /open/exec/{taskId}` → `{status, summary:{total,success,failed}, finishedAt}`；`GET /open/exec/{taskId}/report` → 报告摘要（RPT-002 摘要视图子集，不含敏感环境变量）。
- **限流**：Redis `INCR+EXPIRE` 固定窗口（每 ak 10 次/秒），超限 429 `code 10007`。
- **审计**：APIKEY 生成/吊销、每次 open 调用（action=open.exec，记 ak 前缀）——SYS-008。

## 3. UI/UX 设计（高保真 docs/design/INTG-003-jenkins-ci/）

- 个人下拉「APIKEY」页 `/personal/api-keys`（S5 个人中心前先行入口）：表格（名称/Access Key 前缀展示（复制按钮）/最近使用/创建时间/操作：吊销）+「新建 APIKEY」按钮（5 条上限置灰+提示）。
- 创建成功 Modal：双击复制区块——**sk 全文仅此一次展示**+警示文案「关闭后不可再查看」。
- 接入文档区（页面底部折叠面板）：curl 示例+Jenkinsfile 片段+轮询说明（占位代码块）。

## 4. 技术架构

- **模型**：ApiKey 表已建（prefix/keyHash/lastUsedAt/revokedAt），无新增列（门禁 3 通过）。
- **中间件**：`withApiKey()`（与 withPermission 并列的第三认证通道；`auth.ts` 统一出口：session→token→apikey 顺序协商）。prefix 列加索引（迁移 `s6_api_key_prefix_idx`）。
- **端点**：`personal/api-keys`（GET/POST/`[id]/revoke` PUT）；开放面 `open/exec/api-case`（POST）、`open/exec/scenario`（POST）、`open/exec/[taskId]`（GET）、`open/exec/[taskId]/report`（GET）。
- **执行复用**：open handler 直调 exec.service.createApiCaseTask/createScenarioTask（S2/S3 现成，附加 resourcePoolId 可选参数）。
- **权限点**：APIKEY 个人资源无需权限点（登录态本人校验）；open 面=APIKEY 通道（不进 withPermission）。
- **错误码**：`APIKEY_INVALID 10010`、`APIKEY_LIMIT_EXCEEDED 10011`、`OPEN_RATE_LIMITED 10012`（10xxx 认证段）；目标不存在复用 404 段。（勘误 1：规格初稿 10005-10007 与既有占用冲突，顺延为 10010-10012——「错误码一经发布不改语义，新增不复用」纪律）
- **限流**：`rate-limit.ts`（Redis 固定窗口，通用工具，open 面专用实例）。

## 5. 测试用例

- INTG-003-T1（jmx 四类）：api-keys CRUD/信封；401（未登录）/404；吊销后再用该 key 调 open 401 10005；第 6 条 422 10006；open 触发合法→taskId 信封。
- INTG-003-T2（spec 端到端 CI 流）：建 APIKEY→curl（脚本内 fetch 模拟）触发 api-case 执行（mock 环境）→轮询至 finished→报告摘要断言 success 数（UI 建key+执行两侧断言）。
- INTG-003-T3（spec 越权与限流）：A 的 key 触发 B 私有项目目标→403；>10 QPS→429 10007。
- 单测：ak/sk 生成熵与格式、哈希常量时间比对（不因长度泄漏）、Bearer 解析、限流窗口边界、revoked 拒绝。

## 6. 竞品深度对标

基线 §9.3 APIKEY 形态复刻（5 条/一次性展示/用途口径）。差异：①Jenkins 端插件→脚本接入文档（登记，理由 §1.4）；②计划触发 S4 接线；③无 HMAC 签名（登记）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。**S4 接线登记**：PLAN-003 交付后 open 面增 `open/exec/plan`（触发计划执行）——届时本规格 §1.2 末行能力转 ✅ 并回填此处。联调点：认证三通道协商顺序不破坏既有 session 用例（S1 回归）。

## 8. 勘误登记

- 勘误 1（2026-09-27，契约落库时）：错误码 10005-10007 → 10010-10012（与 PROJECT_ENDED/WORKFLOW_DENIED/REVIEW_ENDED 既有占用冲突，按「新增不复用」顺延）。
