# INFRA-012 CI Runner 路由开关——runs-on 经 CI_RUNNER 变量可切本地自托管 Runner

## 元信息

| 字段         | 值                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 编号         | INFRA-012                                                                                                                      |
| 类型         | 纯 CI 基建（无产品功能面变化）                                                                                                 |
| 状态         | Approved（2026-10-02）→ Implemented（本 PR）                                                                                   |
| 确认人       | 用户（2026-10-02 会话：三选一明确选定「vars 开关（推荐）」方案）                                                               |
| 高保真确认   | N/A（纯基建，以本规格契约评审替代：变更面 = 3 工作流 9 处 `runs-on` 表达式替换，零步骤/依赖/服务编排改动）                      |
| 关联         | `.github/workflows/{ci,perf,pages}.yml`；`rules/git-workflow.md` §5；组织自托管 runner `xujialiang-docker-arm64`（本地 Docker）  |
| 基线         | 2026-10-02 实测：自托管 runner 打 `ubuntu-latest` 标签后，连续 2 次 perf quick dispatch 均被 GitHub 托管池优先领走（0:2，runs 36891856176 / 36892020225） |

## 1. 背景与问题

本地 Docker Desktop 上线了组织级自托管 Runner（`xujialiang-docker-arm64`，linux-arm64）：

- **拓扑**：runner 容器与特权 dind 共享网络命名空间——`services:` 的 postgres:16 / redis:7 由嵌套 daemon 拉起并在该 netns 内发布 5432/6379，job 步骤硬编码的 `localhost:5432/6379` 直达；与宿主容器（dev redis 6379、mysql-dev 等）零端口冲突
- **执行环境**：job 以 uid 1000 `runner` 用户运行（embedded-postgres 的 initdb 拒绝 root；playwright `--with-deps` 走 sudoers NOPASSWD），依赖面 node/go/java 由 setup-* action 自取并落 tool cache（数据卷持久化）
- **问题**：仓库工作流全部 `runs-on: ubuntu-latest`，调度器对该标准标签稳定优先 GitHub 托管池——本地 runner 空闲也接不到 job（基线 0:2），加速为零

## 2. 方案

9 处（ci.yml ×7 / perf.yml ×1 / pages.yml ×1）机械替换：

```yaml
runs-on: ubuntu-latest
# →
runs-on: ${{ vars.CI_RUNNER || 'ubuntu-latest' }}
```

- 设仓库变量 `CI_RUNNER=self-hosted` → 全部 job 路由本地 runner（当前唯一持有 `self-hosted` 标签的在线 runner 即 `xujialiang-docker-arm64`）
- 删除变量（或留空）→ 表达式回落 `ubuntu-latest` 托管池（官方语义：未设置的变量求值为空串），**一步回退、零代码改动**——Mac 离线/维护期的恢复路径
- fork PR 天然隔离：GitHub 对 fork `pull_request` 不下发仓库级 vars（与 secrets 同口径）→ 表达式回落托管池，fork 代码不跑在个人 runner 上
- PR 验证即端到端验证：先设变量再开本 PR → 本 PR 的 ci/perf 由 `xujialiang-docker-arm64` 领取并在本地跑绿（services 拉起/playwright/JMeter 全链路）

## 3. 约束（不动项）

- 不改任何 job 的步骤/needs/services/缓存编排；INFRA-011 的并行与分片口径不变
- pages.yml 无 `pull_request` 触发，其路由开关只作用于 main push 与手动 dispatch（Pages 部署 job 在自托管 runner 上可正常取 OIDC 令牌）
- **已知语义**：指向 `self-hosted` 的 job 在 runner 失联时排队等待而非自动回退托管池——长时间离线前必须删变量（运维口径见 §5 与 rules/git-workflow §5）

## 4. 用例

| 编号 | 场景                                     | 预期                                                                     |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------ |
| 1    | 变量=self-hosted，runner 在线，开 PR      | ci/perf 全部 job 由 `xujialiang-docker-arm64` 领取，dind 内 services 健康 |
| 2    | 删除变量后 dispatch                       | job 回落托管池 runner_name=GitHub Actions …                              |
| 3    | fork PR（外部贡献者）                     | vars 不下发 → 回落托管池，本地 runner 不接                                |
| 4    | 变量=self-hosted，runner 掉线             | job queued 等待（不自动回退）；恢复或删变量后继续                          |

## 5. 运维

- runner 栈：`~/actions-runner-docker/`（`docker compose up -d / logs -f runner / down`；注册态在 named volume，重注册流程见该目录 README）
- 切换命令：设 `gh api -X POST repos/RabbitAI-Lab/RabbitAITest/actions/variables -f name=CI_RUNNER -f value=self-hosted`；删 `gh api -X DELETE repos/RabbitAI-Lab/RabbitAITest/actions/variables/CI_RUNNER`
- 接不到 job 排查顺序：容器在跑 → 日志 `Listening for Jobs` → org Settings → Actions → Runner groups → Default 组仓库可见性含 RabbitAITest
