# Changelog

本项目的所有显著变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循语义化版本。

## [Unreleased]

## [v0.3.0] - 2026-09-27 — Sprint 2 接口测试核心（M3 里程碑）

#### 新增

- **请求参数体系与执行契约 v2（API-004）**：请求体 7 类（none/form_data/form_urlencoded/raw_json/raw_xml/raw_text/binary）；前后置处理器（JS 脚本 quickjs 沙箱 5s 强杀、SQL 只读数据源延后 S3 显式 CONFIG_ERROR、等待）；提取（JSONPath/正则）写回变量并在报告回显；断言 6 种（状态码/响应头/响应体 JSONPath/响应体正则/响应时间/变量）；认证 none/basic/digest（RFC7616）；超时与重定向（≤5 次、307/308 保方法）；变量作用域链 base→环境→参数覆盖渲染 `${var}`；契约 zod 冻结于 shared/execution（事件帧只增不破，S0 兼容读）。
- **环境管理（PROJ-003）**：环境 CRUD/复制/导入导出（同名跳过/覆盖二态）；变量与 HTTP 多域名条件匹配（路径条件>模块条件>默认）；HOST 映射；数据源（内置 PostgreSQL）；全局前后置与断言；执行时环境快照注入引擎（engine 无 DB）。
- **文件管理（PROJ-004）**：file 模块树；上传（JAR/CSV/脚本，JAR 默认禁用启用制）、下载、删除、移动；执行引用（form-data/binary 请求体）；危险类型拒收（.exe 422）；大小受系统参数限制。
- **接口定义（API-002）**：api 模块树 + 列表筛选；API/CASE/MOCK 三页签；导入（OpenAPI3/Postman 粘贴与文件、Rabbit 格式、cURL；覆盖/不覆盖二态）；变更历史；引用关系；列表行内执行跳报告。
- **接口用例（API-003）**：用例 CRUD（差量请求 bundle）；单条/批量执行（选环境+默认池+失败停止开关）；执行历史抽屉；API 定义变更后的差异同步（分区 diff + 待同步标记 + 一键同步）；**clientTaskId 幂等提交**（同键连点/重试复用同一任务，与 (project_id, client_task_id) 唯一索引同语义，含 P2002 并发兜底——收尾审计发现规格声明未实现，补齐）。
- **Mock 服务（API-005）**：规则 CRUD（头/Query/REST 路径/体匹配→响应+延迟）；跟随 API；独立 Mock 服务（开发 :4000/e2e :4001）规则热更新（Redis 全量快照+版本号+PUBLISH 失效，懒加载重读）；未命中 404（code 40401）。
- **资源池调度（EXEC-002）**：默认池并发编辑、节点心跳在线状态、任务停止（非运行中 422 code 50003）、失败重跑（副本重建、不可重跑态 422 code 50004）、并发槽动态生效。
- **任务中心（SYS-006）**：项目/全部两级实时任务列表；执行详情跳报告；停止/重跑；状态筛选；定时任务框架空态（数据源 S3+）。
- **接口报告完整版（RPT-002）**：报告列表/删除；用例级+步骤级钻取（渲染后请求快照/响应/断言表/提取值/日志）；分享链接免登只读+有效期过期失效；保留期外定时清理；重跑入口；api_debug 单请求视图兼容保留。
- **用例关联接口（CASE-006）**：功能用例详情「关联」Tab（case 域经 Provider 读 api_test 域，批量校验非法目标 422 code 40464）；测试计划关联接口用例（执行 S4）。
- **引擎内核 v2**：kernel 纯函数化拆分（render/extract/asserts/processors）；BullMQ 持久化 attempts 2 + 心跳超时回收（引擎重启不丢任务）；回调按 item 分组落库。
- **权限与错误码**：新权限点 PROJECT_ENV/PROJECT_FILE 细化 CRUD、PROJECT_API、PROJECT_EXEC_TASK；错误码 40xxx（API/ENV/FILE/MOCK）与 50xxx（停止/重跑/池）、60xxx（报告/分享）分段入册。
- **质量体系**：Vitest 84（新增 engine kernel 18：渲染/提取/断言矩阵、脚本 5s 强杀、Digest；web 10：OpenAPI/Postman 导入解析、分区 diff；mock 7）；JMeter 24 计划（新增 10：四类场景×四项断言）全绿；Playwright 91 用例（新增 29 + 主链路 MAINFLOW-s2：环境→定义→调试→用例→批量执行→任务中心→报告→分享→Mock 命中→关联）；门禁 8 审计回补 6 项规格声明缺口（API-002-05 权限二态/API-003-04 clientTaskId 幂等/CASE-006-03 重复关联 422·10009+已删除灰显/EXEC-002-01 并发槽位生效/RPT-002-01 过期 token 直改库复验/PROJ-004-03 form-data 文件引用执行内容标记命中二态）；OpenAPI 快照 120→164 paths + api-client s2.ts 手写路径反漂移审计；e2e 常驻库用户累积 268>200 撞 USER_TOO_MANY 致 SYS-004-01 400——测试环境 RABBIT_USER_LIMIT 200→1000（注册通道不查上限仅管理端查，产品默认 30 不变）；4 条调试用例写死 mock `:4000` 依赖宿主机残留 dev mock 侥幸通过——统一 MOCK_BASE/E2E_MOCK_URL 口径、默认环境域名端口从 MOCK_BASE 推导；api-diff 单测字面量类型拓宽致 typecheck 红（改经 schema.parse 构造）。两起环境事故已制度化 rules/testing §3.4.2。凭据 env 化收尾加固（Mimosa 门禁 6 处高危清零）：种子管理员密码 `RABBIT_SEED_ADMIN_PASSWORD`、e2e 测试用户密码 `E2E_USER_PASSWORD` 可 env 覆盖，默认值与既有行为不变（seed/fixtures/SYS-004/PROJ-001）。
- **文档**：Sprint 2 十份规格（Approved→Implemented 流转）+ 十组高保真原型（docs/design/，人工确认随验收走查）。

## [v0.2.0] - 2026-09-26 — Sprint 1 测试管理 MVP（M2 里程碑）

#### 新增

- **用户与权限（SYS-004）**：系统用户管理（创建/编辑/重置密码一次性返回/启停即失效会话/软删邮箱保留占用/30 用户硬上限）；系统-组织-项目三级自定义用户组（预置组只读、权限点勾选树、组成员管理、恢复默认）；权限并集−禁用交集检查链（withPermission/requirePerm，403 code 10003）；权限点登录下发与前端菜单/按钮守卫。
- **系统参数（SYS-005）**：站点 URL/SMTP（AES-GCM 密钥加密 + nodemailer 测试连接回显）/附件大小上限（缺陷附件消费）/数据清理保留时长（下限 7 天）+ BullMQ 每日 03:00 清理 job（超期 ChangeLog/AuditLog 分批删除、软删项目超期物理清除）。
- **项目与成员（PROJ-001）**：组织项目管理（新建/编辑/模块开关（菜单隐藏数据保留）/结束只读（写 422 code 10005）/软删 30 天可撤销）；项目成员（组织成员搜索批量添加、移除联动用户组）；项目切换器成员口径。
- **模板与自定义字段（PROJ-002）**：字段引擎（10 类字段、类型不可改、存量引用软停用、buildValidator zod 动态校验单一来源）；组织/项目两级模板（绑定覆写 required/visibleInList、设默认、复制、缺陷模板上限 20）；项目模板不可逆开关（双确认+组织模板拷贝）；缺陷工作流（初始态唯一/结束态可多/流转矩阵全量替换，非法流转 422 code 10006）；动态字段三处一致渲染（表单/列表列/详情只读）。
- **模块树与用例列表（CASE-002）**：case/bug 双场景模块树（增删改拖拽/环检测/子树计数/关键字定位）；全字段筛选（模块含子级/标签/状态/创建人/更新区间/动态字段 JSONB）；自定义视图（上限 10、默认视图、列配置偏好）；行操作（关注/分享链接/复制）与批量（移动/复制/删除/编辑）。
- **用例详情（CASE-003）**：7 Tab 工作台（详情（受限 Markdown 双栏）/依赖关系双向/评审/计划/缺陷关联/评论两级/变更历史时间线 diff）；Ctrl+S 无、乐观锁 409 沿用；Markdown 白名单转义防 XSS。
- **导入导出（CASE-004）**：Excel 导入（模板下载含动态列、MeterSphere 列名别名兼容、覆盖/跳过、全量预检原子落库、失败行号报告、5000 行上限）；Excel 默认/单元格拆分导出与 Xmind v2.x 双向（模块树结构映射、优先级/标签/备注承载）。
- **用例评审（CASE-005）**：评审 CRUD（单人=最后结果/多人=全员通过才通过、Suggest 不否决）；逐条+批量标记（Fail/Suggest 意见必填）、批量改评审人、自动下一条；重新提审（用例白名单字段变更回 pending + 橙色徽标，项目开关控制）；复制重置、结束只读（422 code 10007）；通过率统计。
- **缺陷管理（BUG-001）**：模板创建（动态字段校验/处理人/标签/bug 模块树）；工作流流转按钮组（按矩阵渲染）+ 意见评论化；附件（本地磁盘驱动 + 大小上限/可执行黑名单、HMAC 下载令牌——MinIO 预签名随 Sprint 2 文件管理接入，登记勘误）；列表筛选/回收站/导出；关联用例双向；评论/变更历史。
- **测试计划（PLAN-001）**：计划 CRUD+更多设置（重复关联开关（422 code 10009）/自动更新状态占位/通过阈值）；按模块/筛选/勾选关联用例；列表模式执行（五态+步骤级对位校验+实际结果+执行历史）；失败行新建缺陷带出失败步骤；通过率口径 pass/(pass+fail+blocked) 与阈值徽标；归档只读（422 code 10008）；最小报告+总结。
- **工作台（DASH-001）**：聚合看板四卡（用例总数/新增、评审通过率、计划进度 Top、缺陷待处理/新增；时间筛选 3d/7d）；卡片三态布局偏好持久化；我的待办（待评审/我的执行/我的缺陷）与我关注的/我创建的。
- **工程债清偿**：Prisma 列名 snake_case @map 全量补齐（232 列，expand-contract 迁移，INFRA-003 勘误 1）；OpenAPI 生成管线（路由单一来源 → openapi.json 快照 120 paths + api-client 102 条手写路径反漂移审计 + CI --check，INFRA-001 勘误 1）；PrismaClient globalThis 单例（修复 111 路由生产构建连接池耗尽 P2037）。
- **质量体系**：Vitest 49 条（权限并集/禁用交集矩阵、字段引擎 10 类型×校验矩阵、评审聚合、通过率口径、Markdown 转义）；JMeter 11 计划（四类场景×四项断言）全绿；Playwright 38 用例（含 MAINFLOW-s1 主链路 Release Gate）；路由声明式生成器（scripts/gen-routes.mjs，112 路由）与 jmx 生成器（scripts/gen-jmx.mjs）。
- **文档**：Sprint 1 十一份规格（Approved，AI 会话内评审流转）；十一组高保真原型（docs/design/，人工确认随验收走查）。

#### 修复

- client.ts 对 FormData 强制 JSON Content-Type 导致 multipart 解析失败（导入/附件上传）
- instrumentation.ts edge 打包静态解析 bullmq/nodemailer 致构建失败——改为守卫热路径懒注册（server/boot.ts）
- 软删用例变更历史 seq=0 唯一键冲突（重复删除同实体）
- PlanCaseRef.execHistory 列名 @map 缺失（生产 P2022）

#### 已知限制（登记去向）

- 高保真人工确认与走查登记待用户验收（AGENTS 门禁 2 人工部分，S0 §8.1 先例）
- 附件 MinIO 预签名 → 本地磁盘驱动过渡（INFRA-002 MinIO 镜像源问题，Sprint 2）
- 缺陷高级筛选保存视图待与 CASE-002 组件对齐后补（BUG-001 §1.2 后续）
- 重复邮箱返回 400 code 10101 与 SYS-004 规格文字 422 的口径差异（保持与 SYS-001 既有契约一致，登记勘误）

## [v0.1.0] - 2026-09-26 — Sprint 0 POC（用户验收通过）

#### 新增

- **基础设施**：pnpm + Turborepo 纯 TS Monorepo（apps：web/engine/mock/plugin-runner；packages：db/shared/api-client/ui）；Docker Compose 一键启动全栈（db/redis/minio/migrator/web/engine/mock）；本地零依赖开发（embedded-postgres + Docker Redis，`pnpm dev`）；husky pre-push + commitlint + oxlint/oxfmt。
- **数据模型**：Prisma 一次建齐八域 45 实体（含未启用列）；项目内 advisory lock 取号；软删/变更历史通用横切；幂等种子。
- **认证与组织**：邮箱注册/登录/登出（Argon2id + iron-session）；注册即建默认组织+演示项目+双场景模块树；middleware 路由守卫与 withAuth/withProjectScope 数据隔离（404 防枚举）。
- **测试用例**：功能用例 CRUD（名称/前置/步骤/等级/标签）、乐观锁 409、回收站（恢复/彻底删除二次确认）、变更历史落库。
- **接口测试**：HTTP 调试（8 方法/头/体 raw-json/断言：状态码+JSONPath）→ BullMQ 入队；执行引擎 v0（undici 采样、断言求值纯函数、失败三分类、Redis Stream 事件流、终态回调幂等、节点心跳注册、--local 本地模式）；最小报告页（请求/响应/断言明细/日志，SSE 实时 + Last-Event-ID 续传 + RUNNING 轮询兜底）；调试历史。
- **质量体系**：Playwright E2E 11 条全绿（每条含 UI/Console/接口三类断言，录屏 on-with-retry + trace + 截图，HTML 报告）；JMeter 接口自动化 3 计划（四类场景×四项断言）全绿；Vitest 单测（shared 契约/engine 断言求值）；GitHub Actions CI（lint/typecheck/unit/build/迁移重放/e2e/jmeter/audit）。
- **文档**：Sprint 0 十份功能规格 + 五组高保真原型（待人工确认）。

#### 修复

- **样式完全丢失事故（走查①发现）**：实现使用 Tailwind 工具类但从未安装 Tailwind——所有布局类失效，录屏中页面无样式。已安装 Tailwind v4（postcss + `@import 'tailwindcss'`）并修正 rem 基准（移除 `html{font-size:13px}`，对齐原型 16px 基准）；新增 VISUAL computed-style 断言防回归（rules/react-nextjs §5.5）。

#### 已知限制（登记去向）

- Prisma 列名暂为默认 camelCase（rules/database §2 的 snake_case 目标在 Sprint 1 以 @map 补齐，登记为 INFRA-003 勘误 1）
- api-client 为手工类型化（OpenAPI 自动生成在 Sprint 1 接入，登记为 INFRA-001 范围调整）
- undici 重定向跟随暂未启用（maxRedirections 在 v7 移除，Sprint 2 以 interceptor 接入）
