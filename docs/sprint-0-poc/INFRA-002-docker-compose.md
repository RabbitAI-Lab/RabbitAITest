# Docker Compose 一键启动 + 本地零依赖开发

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | INFRA-002 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0 |
| 文档状态 | Implemented（Sprint 0 交付，验收自查见 sprint-overview §7） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | INFRA-001（骨架）、INFRA-003（migration/seed） |
| 下游消费 | 验收标准 1；全部本地/CI 环境说明 |
| 上游依据 | 需求文档 §四可部署、sprint-overview 交付项 2 |
| 对标基线 | 功能清单 §二（安装部署：一键部署思想，MeterSphere 为离线安装包模式） |
| 高保真确认 | 不适用（契约=compose 服务表 §4） |

## 1. 概述

### 1.1 范围边界

| 能力 | P0 ✅ | 后续 |
| --- | --- | --- |
| `docker compose up -d` 一键起全栈（db/redis/minio/web/engine/mock） | ✅ | — |
| web 容器启动自动 migrate deploy + seed | ✅ | — |
| 本地零依赖开发模式：embedded-postgres + redis-memory-server（`pnpm dev`，不依赖 Docker） | ✅ | — |
| MinIO 服务位（代码暂不使用，带健康检查） | ✅ | Sprint 2 文件管理接入 |
| 备份/恢复脚本 | ❌ | INFRA-004 |

### 1.2 关键决策（环境自适应，rules/git-workflow §5.1）
- 容器内 DB 用 `postgres:16-alpine` service（embedded-postgres 的 Linux 容器二进制不保证，开发态才内嵌）；**同一 DATABASE_URL 抽象**两种模式。
- 所有地址常量单一来源：`packages/shared/config.ts`（env 读取，禁硬编码 127.0.0.1/localhost 双写）。

## 2. 业务逻辑
启动序：db/redis/minio → web（entrypoint: migrate+seed 后 next start，健康探针 `/api/v1/system/health`）→ engine（等 web ready 后注册资源池）→ mock。

## 3. UI/UX 设计
不适用。

## 4. 技术架构

compose 服务表：

| 服务 | 镜像/构建 | 端口 | 依赖健康条件 |
| --- | --- | --- | --- |
| db | postgres:16-alpine（volume pgdata） | 5432 内部 | pg_isready |
| redis | redis:7-alpine | 6379 内部 | redis-cli ping |
| minio | minio/minio（volume） | 9000/9001 | curl /minio/health/live |
| web | 本仓 Dockerfile（multi-stage, pnpm build） | 3000 | 依赖 db/redis |
| engine | 同仓构建（node 入口 runner） | — | 依赖 redis + web healthy |
| mock | 同仓构建（Hono 占位） | 4000 | — |

本地 `pnpm dev`：scripts/dev.mjs 先起 embedded-postgres（packages/db 内封装，数据目录 .pgdata）与 redis-memory-server，再并发 `next dev` + engine + mock；Ctrl-C 统一回收。

## 5. 测试用例
- INFRA-002-T1：`docker compose up -d` 后 60s 内 `/api/v1/system/health` 与 `/ready` 均 200（ready 检查 db+redis）
- INFRA-002-T2：`pnpm dev`（无 Docker 依赖）同样 ready
- INFRA-002-T3：重复 up（已有 volume）幂等，不重置数据

## 6. 竞品深度对标
MeterSphere 离线安装包（多个中间件强制外置）→ 本项目双模式（开发零依赖内嵌 / 部署 compose 一键）。

## 7. 里程碑与验收
验收标准 1「一条命令起全栈，5 分钟内可操作」；compose 与 dev 模式均可完成主链路。
