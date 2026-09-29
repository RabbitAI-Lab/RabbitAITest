# 常见问题

## 安装部署

### 启动时提示端口被占用？

单仓开发默认端口：web 3000 / mock 4000 / plugin-runner 4300 / 内嵌 PG 5440 / Redis 6379。占用常见原因：

- 之前的 `pnpm dev` 进程未退出：先停掉旧进程再启动。
- 多个 worktree / 多套环境并行：RabbitAITest 按「槽位」自动隔离端口（单一事实源 `scripts/rabbit-env.mjs`，槽位取自 `RABBIT_SLOT` 环境变量或目录名）。确保不同环境使用不同目录名或显式设置 `RABBIT_SLOT`。

### 内嵌 PostgreSQL 的数据存在哪里？如何切外部数据库？

开发模式下内嵌 PostgreSQL 由启动脚本自动初始化与管理，适合体验与单机使用。生产环境建议设置 `DATABASE_URL` 指向外部 PostgreSQL 16，然后重新执行 `pnpm db:migrate && pnpm db:seed`。

### 如何备份 / 恢复数据？

仓库提供 `pnpm backup` 与 `pnpm restore` 脚本。

### 如何自定义管理员初始密码？

首次执行种子前设置环境变量 `RABBIT_SEED_ADMIN_PASSWORD`，再运行 `pnpm db:seed`。默认密码为 `rabbit-admin-123`。

### 社区版有用户数限制吗？

社区版默认 30 用户上限（用户管理页有容量进度条）；企业版 License 的 USER_SCALE 特性可放开。

## 接口测试

### RabbitAITest 能直接运行 JMeter 脚本吗？

不能。执行引擎是自研的（Node.js + undici 采样 + quickjs 沙箱），JMeter 仅作为**导入格式**兼容：`jmx` 文件按常用子集映射导入——HTTP 采样器 → 请求步骤、循环控制器 → loop、CSV 数据集 → 场景 CSV + foreach、JSR223(javascript) → 脚本步骤、定时器 → wait；不支持的节点会跳过并记录 warning。

### SQL 前后置处理器为什么不可用？

出于安全策略（SQL 注入与数据面防护），SQL 处理器当前**未启用**：配置后执行会显式返回 `CONFIG_ERROR`。这是预期的安全门禁行为，不是 Bug。前后置目前支持 script（quickjs 沙箱）与 wait 两类。

### Mock 请求返回 404 是怎么回事？

Mock 规则未命中时返回 404，业务码 `40401`。排查方向：确认请求路径与 Mock URL 格式一致（`{MOCK_PUBLIC_URL}/mock/{项目编号}{接口路径}`）、规则处于启用状态、请求方法与匹配条件符合预期。多规则并存时按「匹配条件最多者」优先。

### 报告里的「误报」是什么？

执行失败但被误报规则（接口测试 → 场景页入口）匹配命中的结果会标记为 FAKE_ERROR（误报），在报告与计划报告中单独统计，不计入真实失败。

### 脚本步骤能访问网络或文件吗？

不能。脚本运行在 quickjs 沙箱中：同步执行 5 秒强杀、64KB 大小上限、API 白名单（`log` / `getVar` / `setVar` / `envGet` / `randomInt` / `now`），无任何 IO 能力。

## AI 能力

### AI 功能如何配置？

管理员进入「系统设置 → 模型设置」，选择供应商（智谱 AI / DeepSeek / OpenAI，均为 OpenAI 兼容网关）、填写 API Key 并做连接测试，设为默认即可。API Key 落库加密存储、不回显。用户可在「个人中心 → 个人默认模型」绑定自己的默认模型。

### 环境变量 GLM_API_KEY 是产品 AI 功能的配置吗？

不是。`GLM_API_KEY` 用于**研发流程**的视觉还原度比对（`pnpm visual:diff`），与产品内的 AI 能力无关；产品内模型走「系统设置 → 模型设置」页面配置。

## 系统设置

### 插件显示 ERROR 状态怎么办？

插件运行在独立线程中，崩溃会按 1s / 4s / 16s 退避自动重启，连续 3 次失败标记 ERROR。可先停用再重新启用插件；仍失败请检查插件包与 SPI 版本兼容性（SPI 不兼容会被拒绝加载，错误码 70003）。

### 默认资源池可以删除吗？

默认资源池受删除 / 禁用保护，不能删除或禁用（它是执行队列的兜底路由）。多资源池为企业版 License 特性。

### 报告删除会清理哪些数据？

删除报告会级联清理报告本体、分享链接、关联任务、报告条目与事件帧。

### 性能测试、UI 测试在哪里？

标准版不包含性能测试与 UI 测试；导航中的入口为占位（默认关闭，需模块开关与对应权限双开）。

## 相关链接

- [安装部署](quickstart/installation.md)
- [接口测试概述](manual/api/overview.md)
- [AI 能力](manual/ai.md)
- [插件管理](manual/system/plugins.md)
- [资源池](manual/system/pools.md)
