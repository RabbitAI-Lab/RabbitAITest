# 安装部署

本章介绍如何从源码启动 RabbitAITest 全套服务，以及切换外部数据库、生产部署的要点。开发环境推荐使用内嵌 PostgreSQL 的开箱即用模式；生产环境建议使用外部 PostgreSQL 16 + Redis。

## 环境要求

| 依赖 | 要求 | 说明 |
| --- | --- | --- |
| Node.js | ≥ 20 | 服务端运行时 |
| pnpm | ≥ 10（开发锁定 10.32.0） | 包管理与 Monorepo 脚本 |
| PostgreSQL | 可选 | 不配置时使用 embedded-postgres 内嵌实例；生产建议外部 PostgreSQL 16 |
| Redis | 可选 | 本机已有 6379 实例则直接使用；缺失时开发脚本会尝试用 Docker 拉起 `rabbit-dev-redis` |
| Docker | 可选 | 仅在需要自动拉起 Redis / MinIO 时使用 |

## 源码启动

```bash
git clone https://github.com/RabbitAI-Lab/RabbitAITest.git
cd RabbitAITest

# 1. 准备环境变量（按需修改）
cp .env.example .env

# 2. 安装依赖并启动（自动初始化内嵌 PostgreSQL、执行迁移与种子数据）
pnpm install
pnpm dev
```

`pnpm dev` 会同时启动：Web 控制台（含 API）、执行引擎、Mock 服务、插件运行时。

启动成功后访问 **http://localhost:3000**，使用默认管理员登录：

| 项 | 值 |
| --- | --- |
| 账号 | `admin@rabbit.test` |
| 密码 | `rabbit-admin-123` |

首次执行种子数据时会自动创建：组织「管理员组织」、项目「管理项目」、三个默认模块（未规划用例 / 未规划接口 / 未规划场景）、系统参数与默认资源池。

?> 初始化前可通过环境变量 `RABBIT_SEED_ADMIN_PASSWORD` 自定义管理员初始密码。种子脚本幂等，可重复执行。

## 环境变量

主要变量（完整清单见仓库根目录 `.env.example`）：

| 变量 | 作用 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串。开发模式默认由启动脚本注入内嵌实例；设置后可切外部 PostgreSQL 16 |
| `REDIS_URL` | Redis 连接串（默认本机 6379） |
| `WEB_URL` | Web 服务对外地址（用于分享链接等） |
| `SESSION_SECRET` | 会话签名密钥，≥ 32 字符 |
| `INTERNAL_TOKEN` | Web ↔ 引擎内部回调 / 注册令牌 |
| `MOCK_PUBLIC_URL` | Mock 服务对外地址（接口详情页展示的 Mock URL 前缀） |
| `MINIO_*` | MinIO 对象存储连接（可选） |

## 默认端口

单仓（主槽位）开发模式默认端口：

| 服务 | 端口 |
| --- | --- |
| Web 控制台 | 3000 |
| Mock 服务 | 4000 |
| 插件运行时 | 4300 |
| 内嵌 PostgreSQL | 5440 |
| Redis | 6379 |

?> 多个 worktree / 多套环境并行时，端口按「槽位」自动偏移（单一事实源 `scripts/rabbit-env.mjs`，槽位取自 `RABBIT_SLOT` 或目录名）。仓库禁止任何脚本硬编码端口。遇到端口占用见[常见问题](faq.md)。

## 数据库管理

```bash
pnpm db:migrate   # 执行 Prisma 迁移
pnpm db:seed      # 执行种子数据（幂等）
pnpm backup       # 备份
pnpm restore      # 恢复
```

切换外部 PostgreSQL：设置 `DATABASE_URL` 指向外部实例后，重新执行迁移与种子即可。内嵌实例由开发脚本自动管理，适合体验与单机使用；生产环境建议使用外部数据库，便于备份与升级。

## 生产部署

- 仓库提供 `Dockerfile` 与 `deploy/` 部署配置，可基于容器构建生产镜像。
- 生产建议：外部 PostgreSQL 16 + Redis（中间件仅 PostgreSQL / Redis / MinIO 三个）；通过 `WEB_URL`、`MOCK_PUBLIC_URL` 配置对外地址；密钥类变量（`SESSION_SECRET`、`INTERNAL_TOKEN`）使用强随机值。
- 数据备份与恢复可使用仓库提供的 `pnpm backup` / `pnpm restore` 脚本。

## 常见安装问题

- 端口被占用 / 多套环境并行：见[常见问题 · 端口与槽位](faq.md)。
- AI 能力无法使用：先在「系统设置 → 模型设置」配置模型供应商并做连接测试，见 [AI 能力](manual/ai.md)。
- 启动报数据库相关错误：确认 `DATABASE_URL` 是否指向可用实例；内嵌模式首次启动会自动初始化，耗时稍长属正常。

## 相关链接

- [产品介绍](quickstart/introduction.md)
- [快速体验](quickstart/quick-tour.md)
- [二次开发指南](developer/contributing.md)
- [常见问题](faq.md)
