# 模型网关（三供应商接入 · 加密 · SSRF 守卫）

| 元信息项     | 内容                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | AI-001                                                                                                                                  |
| 所属迭代     | Sprint 7 — AI 能力                                                                                                                      |
| 优先级       | P2（S7 基座：AI-002/003/004 的唯一模型出口）                                                                                            |
| 所属模块     | ai 域（web 内服务，非 engine——LLM 调用读 DB 配置，engine 无 DB 红线不破）                                                               |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿；高保真走查随验收）                                                      |
| 最后更新日期 | 2026-09-27                                                                                                                              |
| 上游依赖     | SYS-005（系统参数宿主与系统管理导航）、SYS-002（认证守卫）、rbac（SYSTEM_AI 权限点）                                                    |
| 下游消费     | AI-002/AI-003（生成调用）、AI-004（助手对话调用）                                                                                       |
| 上游依据     | 需求文档 §六；功能清单 §十「模型接入」、§8「模型设置（AI）」                                                                            |
| 对标基线     | 功能清单 §十：系统级（系统参数-模型设置）入口；DeepSeek/OpenAI/智谱三类供应商；模型的添加/编辑/删除                                     |
| 关联架构文档 | test-domain-model.md §2.8（AiModel）；security.md（密钥、SSRF）；api-conventions.md §3（70xxx 错误段——60xxx 已被报告域占用，AI 段顺延） |
| 高保真确认   | 待确认（原型 docs/design/AI-001-model-gateway/）                                                                                        |
| 工作量估算   | 后端 3 人日 / 前端 1.5 人日                                                                                                             |

## 1. 概述

### 1.1 功能定位

系统级大模型接入基座：管理员配置模型（供应商三选一/baseUrl/model 名/apiKey），统一走 **OpenAI 兼容 chat/completions 协议**（三供应商实测同构）；apiKey AES-256-GCM 加密落库且任何响应不回显；baseUrl 经 SSRF 守卫（禁内网/环回/链路本地/元数据段）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                    | P1 ✅ | 后续                                             |
| ----------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------ |
| 模型 CRUD：name/provider(deepseek\|openai\|zhipu)/baseUrl/model/apiKey/enabled/isDefault；上限 10                       | ✅    | 代理模型/模型分组（企业版口径，ENTP 红线外）     |
| apiKey 加密：AES-256-GCM（密钥=scrypt(SESSION_SECRET) 派生，不落库不进日志）                                            | ✅    | 独立 KMS/密钥服务（Backlog）                     |
| 响应脱敏：列表/详情只回 `sk-****{尾4位}` 掩码；编辑不回填原文（留空=不改）                                              | ✅    | —                                                |
| 连接测试：发 1 条 `ping` 消息（max_tokens 小额），成功返回耗时与模型回声                                                | ✅    | 模型能力探测（function call 支持检测，Backlog）  |
| 设默认：同表唯一 isDefault；AI-002/003/004 默认消费默认模型                                                             | ✅    | 按场景路由不同模型（Backlog）                    |
| SSRF 守卫：baseUrl host 解析后全 IP 过检（私网/环回/链路本地/元数据/通配全拒）；`AI_ALLOW_PRIVATE_BASEURL=1` 测试栈开关 | ✅    | 连接期固定 IP 防 DNS rebinding（S8 QA-002 收口） |
| 统一 ChatClient：`callChat(model, messages, {stream})`；流式=SSE delta 增量                                             | ✅    | Anthropic 原生协议/多模态（Backlog）             |
| 启用模型下拉（登录可见，供 AI-004）：id/name/provider/model，无 key                                                     | ✅    | —                                                |

### 1.3 前置依赖

AiModel 表（S7 随本规格建，test-domain-model §6 例外登记）；SYSTEM_AI 权限点入库；apps/mock 增加 OpenAI 兼容端点（测试供应商）。

### 1.4 对标基线核对

完全复刻：三供应商（DeepSeek/OpenAI/智谱）、系统级模型设置入口、添加/编辑/删除。简化实现：协议统一 OpenAI 兼容（基线后端按供应商分 ChatClient 实现，本项目三供应商同协议单实现+provider 差异仅默认 baseUrl 提示）；个人级模型设置延后（宿主个人中心 SYS-007 在 S5）。

## 2. 业务逻辑

- **加密**：`encryptSecret/decryptSecret`（AES-256-GCM，key=scryptSync(SESSION_SECRET,"rabbit-ai-key",32)）；密文 `v1:base64(iv):base64(tag):base64(ct)`；单测 roundtrip+不同密文（随机 iv）。
- **守卫**：`assertAiBaseUrl(url)`——URL 解析失败 422；hostname 先字面 IP 检（私网段/环回/链路本地/169.254.169.254/0.0.0.0/IPv6 限定与 ULA），再 DNS resolve 全 IP 复检；环境变量 `AI_ALLOW_PRIVATE_BASEURL=1` 放行（仅测试栈注入，生产不设）。
- **ChatClient**：`callChat(aiModel, messages, opts)`→fetch `${baseUrl}/chat/completions`，Bearer apiKey，60s 超时；非流式返回首 choice content；流式返回 AsyncGenerator<string>（SSE `data:` 行解析，[DONE] 终止）。上游非 2xx → `AI_PROVIDER_ERROR`（502，携带上游状态码，不泄 key）。
- **默认模型语义**：设默认=事务内清旧默认+置新；消费端解析顺序：显式 modelId > 默认模型；无可用（全禁用/零配置）→ `AI_NO_MODEL_AVAILABLE`。
- **删除保护**：默认模型删除时若为最后一台可用模型照删（消费端报 70444）；AiGenRecord.modelId 为裸列留痕不级联。

## 3. UI/UX 设计（高保真 docs/design/AI-001-model-gateway/）

- 系统管理→「模型设置」页（`/system/ai-models`）：卡片列表（provider 徽标/name/model 名/默认星标/启用开关/baseUrl）+「新建模型」按钮；空态引导（三供应商提示）。
- 新建/编辑 Modal：名称、供应商单选（三选一，选中预填默认 baseUrl 占位）、BaseUrl、模型名（如 glm-4.6/deepseek-chat）、API Key（password 输入，编辑时留空=不改，占位显示掩码）、启用开关。
- 行操作：连接测试（loading→结果 Tag：成功耗时/失败原因）、设为默认、编辑、删除（二次确认）。

## 4. 技术架构

- 数据模型：`AiModel`（test-domain-model §2.8；裸 FK 无，系统级无项目维度）。迁移 `s7_ai_domain`（5 表同批）。
- 契约：`aiModelSaveSchema`（provider enum/baseUrl url/apiKey min1/model min1/name min1）、`aiModelRowSchema`（**无 apiKey 字段**，仅 `apiKeyMasked`）。
- 端点：`GET/POST /api/v1/system/ai-models`、`PUT/DELETE /api/v1/system/ai-models/{id}`、`POST .../test`、`PUT .../default`；`GET /api/v1/ai/models`（withAuth，启用模型下拉）。
- 服务：`apps/web/src/server/domains/ai/model.service.ts`（CRUD/默认/掩码）、`crypto.ts`（加解密）、`chat-client.ts`（callChat 流式/非流式）、`baseurl-guard.ts`（SSRF）。
- 权限点：`SYSTEM_AI:READ/CREATE/UPDATE/DELETE`（入库 permissions.ts；预置组：SYSTEM_ADMIN 全量，其余组不含）。下拉端点 withAuth（登录即可见模型名，无敏感字段）。
- 错误码：`AI_MODEL_NOT_FOUND 70404`、`AI_BASEURL_FORBIDDEN 70422`、`AI_NO_MODEL_AVAILABLE 70444`、`AI_PROVIDER_ERROR 70501`（502）。
- mock 供应商：`apps/mock` 增 `POST /ai/chat/completions`（OpenAI 兼容，非流式+流式 SSE；按 system 消息固定开头分支确定性输出——见 AI-002/004 消费）。

## 5. 测试用例

- AI-001-T1（jmx 四类）：模型 CRUD/设默认/连接测试（baseUrl 指向 mock）；401/403（PROJECT_MEMBER 无 SYSTEM_AI）/404（坏 id）；422（provider 非法/baseUrl 内网段 70422/空 name）；列表信封+掩码断言（无明文 key）。
- AI-001-T2（spec 管理页）：新建→列表可见掩码→测试连接成功 Tag→设默认星标移动→编辑（key 留空不改，断言仍可用）→删除；Console 无错+网络断言。
- AI-001-T3（spec 守卫二态）：baseUrl 填 `http://169.254.169.254/latest/meta-data` 与 `http://127.0.0.1:4001` → 422 70422（UI 错误提示）；（测试栈关 AI_ALLOW_PRIVATE_BASEURL 的用例由单测覆盖矩阵）。
- 单测：加密 roundtrip/随机性、assertAiBaseUrl 矩阵（公网过/私网·环回·元数据·ULA·链路本地拒/域名解析私网拒）、callChat 非流式解析+流式增量聚合+上游 401→70501、默认模型事务语义、模型上限 10。

## 6. 竞品深度对标

基线主体覆盖（三供应商/系统级入口/CRUD/连接可用性）。差异：①个人级模型设置延后（宿主未建）；②无模型代理共享与分组（企业版）；③供应商差异化收敛为默认 baseUrl 提示（协议同构）；④无用量计量。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（目标授权先例，走查随验收）。联调点：mock 供应商与 e2e 栈（AI_ALLOW_PRIVATE_BASEURL=1 注入，生产 CI 走 mock 同栈）。

## 8. 勘误登记

**勘误 1（2026-09-27，掩码口径）**：§1.2/§4 原文「只回 sk-****尾4位」——尾 4 位需冗余存明文摘要列（违反最小暴露面），实现为固定掩码 `sk-****`（`apiKeyConfigured: true` 标识已配置）；规格错误码段 60xxx → 70xxx（60xxx 已被报告域占用，envelope.ts 分段顺延）。

**勘误 2（2026-09-27，守卫开关语义）**：`AI_ALLOW_PRIVATE_BASEURL=1` 原文语义「放行」宽泛——实现收窄为**仅豁免环回**（127/8、::1；测试栈 mock 供应商所在），私网/链路本地/云元数据**恒拦**（守卫用例任何环境可测）。
