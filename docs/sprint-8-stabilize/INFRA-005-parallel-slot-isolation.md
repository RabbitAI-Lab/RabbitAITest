# INFRA-005 并行 worktree 槽位隔离（parallel slot isolation）

## 0. 元信息

| 项       | 值                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态     | Implemented（分支 `INFRA-005-parallel-slot-isolation`，基线 main d19e493，2026-09-28）                                                           |
| 模块     | INFRA（开发/测试环境工具链，无产品面变更）                                                                                                       |
| 评审方式 | 纯后端/工具类规格，依 AGENTS 门禁 2 以**接口契约评审**替代高保真原型——方案于 2026-09-28 会话中经用户认可后实施（确认人：用户；原型：不适用 N/A） |
| 关联规则 | rules/git-workflow.md §9（并行纪律）· rules/testing.md §3.4.2（环境复用命令槽位化）· AGENTS.md §4.2                                              |

## 1. 问题（为什么必须做）

多 worktree 并行开发时（S7 期间实测 6+ worktree 并存），联调/自测互相冲突：

1. **固定端口互抢**：dev 栈 3000/4000/5433、e2e 栈 3100/4001/5434、JMeter 栈 3101/4020/5438 全部写死在脚本里；「端口通了就复用」的复用逻辑会把别的 worktree 起的栈连进来（跑的是别人分支的代码/数据）。
2. **Redis 串台（最隐蔽）**：BullMQ 队列与 SSE Stream 的键名全局——两个 worktree 共用 6379/6381 时，A 栈 engine 消费 B 栈 web 入队的执行任务，联调任务莫名消失/结果错乱。
3. **共享 /tmp 路径**：`/tmp/rabbit-e2e-root`（e2e web 构建副本）、`/tmp/pg5438.pid`、`/tmp/jm-*.log` 被并行会话互相覆盖。
4. **清场互杀**：e2e global-setup 用 `lsof -ti :4001` 杀一切占用者；teardown 用裸 `pkill -f "apps/mock"` 按**相对路径特征**清残留——会误杀其他 worktree 的同路径进程。
5. **常驻资源单例**：pg-e2e 常驻库（5434）与 Docker 容器名单例，复用语义实际是「共享别人的数据目录与迁移版本」。

S7 的 mock 4020 教训是对问题 1 的一次点状修补；本规格将其升级为系统性方案。

## 2. 方案：槽位（slot）制全维度隔离

### 2.1 槽位推导

优先级：`RABBIT_SLOT` 环境变量（0-9，显式覆盖） > worktree 目录名 `RabbitAITest-s{N}` → N > 其余（主仓 / CI checkout）→ 0。CI 恒为 slot 0（runner 天然隔离）。超出 0-9 报错（端口表按 10 槽设计，扩容须重排基址并同步本规格与单测）。

### 2.2 端口与资源表（base + slot）

| 用途 | web    | mock   | PostgreSQL | Redis（逻辑库号 = slot）       | 临时路径                  |
| ---- | ------ | ------ | ---------- | ------------------------------ | ------------------------- |
| dev  | 3000+s | 4000+s | 5440+s     | redis://127.0.0.1:**6379**/{s} | .pgdata（worktree 本地）  |
| e2e  | 3100+s | 4100+s | 5450+s     | redis://127.0.0.1:**6381**/{s} | /tmp/rabbit-e2e-root-s{s} |
| jm   | 3200+s | 4200+s | 5460+s     | redis://127.0.0.1:**6381**/{s} | /tmp/rabbit-s{s}-jm/      |

- **slot 0 兼容**：dev web 3000、e2e web 3100 与历史一致；dev PG 5433→5440、e2e PG 5434→5450、e2e mock 4001→4100、jm 栈 3101/4020/5438→3200/4200/5460 迁移无害（`.pgdata*` 数据目录跟 worktree 走，端口仅运行时参数；CI 的 DATABASE_URL/REDIS_URL 由 GitHub services 注入，不走这些默认值）。
- **Redis 逻辑库隔离**：实例共享（容器不增），键空间随 `SELECT {slot}` 完全隔离——BullMQ 队列/SSE Stream/缓存互不可见，比 key 前缀彻底且零容器成本。ioredis/BullMQ 全链路 URL 透传（apps/web `new Redis(config.redisUrl)`、engine `redis.duplicate()`），无代码改动。
- **过渡期交叠（登记）**：旧固定端口 5433/5434/5438/4001/3101/4020 被新表显式弃用；旧 worktree（基线不含本规格）仍用旧端口，与新表仅 slot 1 两处交叠（dev mock 4001 / e2e web 3101）——过渡期避开 s1 目录命名，旧 worktree 尽早 rebase。

### 2.3 单一事实源与接入方式

`scripts/rabbit-env.mjs`：导出 `resolveSlot(cwd)` / `rabbitEnv(slot)`（含 web/mock/pg 端口与 URL、database 名、pgDataDir、redisUrl、tmp 路径）。

- **Node**：`import { rabbitEnv } from "./rabbit-env.mjs"`（dev.mjs、pg-dev/pg-e2e、global-setup、playwright.config）。
- **bash**：`eval "$(node scripts/rabbit-env.mjs --shell)"` 导出 `RABBIT_*` 常量；脚本将其作为**默认值**（`${VAR:-$RABBIT_*}`），显式 env/参数覆盖不失效。
- **e2e 用例**：`tests/e2e/env.ts` 统一导出 `E2E_BASE / MOCK_BASE / MOCK_PORT`（保留 `E2E_BASE_URL / E2E_MOCK_URL_BASE` 覆盖口）；s2/s5/s6-helpers 改为自其重导出，全部 spec 的端口字面量（:4001/:3100 共 24 文件）已参数化。
- 注意：`rabbit-env.mjs` 被 `playwright.config.ts` 静态导入时会经 esbuild 转 CJS 编译，**不得使用 `import.meta`**（CLI 入口判定改用 `process.argv[1]` 后缀匹配）。

### 2.4 行为修正清单（防串台/防误杀）

1. dev.mjs：启动前**槽位端口预检**，被占即 fail fast 并给出排查/换槽指引；web 经 `PORT` 注入（apps/web dev 脚本去掉硬编码 `-p 3000`）；engine 回调走 `WEB_INTERNAL_URL` 指向本栈 web。
2. global-setup：lsof 清场只针对**本槽位** mock 端口，且带**归属检测**——占用者 cwd 属于其他 worktree（`lsof -a -p <pid> -d cwd`）时 fail fast 指名冲突（实测案例：2026-09-28 s6 会话的 mock 临时占了 4100=slot0 新 e2e mock 口），仅本 worktree 残留才自动清杀；e2e 各端口/种子 mock 模型 baseUrl（含 `/ai` 前缀）全部随槽位计算。
3. global-teardown：兜底 pkill 模式由裸 `apps/mock` 改为 `<worktree绝对路径>/apps/mock`——不再误杀并行 worktree 进程。
4. api-test-stack.sh：`/tmp` pid/日志收入槽位目录；`JM_MOCK_PORT` 默认取槽位值。
5. run-api-tests.sh：`BASE_URL / MOCK_URL / MOCK_BASE / MOCKPORT` 默认值槽位化（CI 内联栈经 `eval rabbit-env` 对齐，mock 以 `MOCK_PORT` 显式启动）。
6. CI：e2e job 走注入 `E2E_*`（行为不变，mock 随 slot0=4100）；api-test job 内联栈改为 rabbit-env 取值（3101/4000 → 3200/4200）。

## 3. 交付物

| 类别      | 文件                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心      | scripts/rabbit-env.mjs（新增）· scripts/rabbit-env.test.mjs（新增，node:test，接入 `pnpm test`）· scripts/e2e-web-copy.mjs（新增：槽位专属 web 生产构建副本，使同 worktree 的 `pnpm dev`（next dev 写坏仓库 .next）与 e2e/jm 生产栈并存——原 ad-hoc /tmp 副本流程脚本化）                                                                    |
| 栈脚本    | scripts/dev.mjs（槽位化 + 端口预检 fail-fast + **持久 .pgdata 幂等重启修复**：原无条件 initialise/createdb 在重启场景必失败，存量缺陷）· pg-dev.mjs · pg-e2e.mjs（含 postmaster.pid 残留清理）· api-test-stack.sh · run-api-tests.sh · demo-local-exec.sh · apps/web/package.json（dev 脚本去 -p 3000，改 PORT 注入）                       |
| e2e       | tests/global-setup.mjs（槽位化 + 归属检测；**槽位值经子进程 JSON 获取**——playwright globalSetup 加载管线会把 import 的 .mjs 转 CJS 丢命名导出）· global-teardown.mjs（pkill 限定本 worktree 绝对路径）· playwright.config.ts · tests/e2e/env.ts（新增）· s2/s5/s6-helpers.ts · 24 个 spec 端口字面量参数化 · tests/smoke/verify-fp-ssrf.mjs |
| CI        | .github/workflows/ci.yml（api-test 内联栈 slot 化：3101/4000→3200/4200；e2e 注释更新）                                                                                                                                                                                                                                                      |
| 文档/规则 | AGENTS.md §4.2 · CLAUDE.md §12 · rules/git-workflow.md §9 · rules/testing.md §3.4.2 · 本规格 · sprint-8-stabilize/sprint-overview.md                                                                                                                                                                                                        |
| 其他      | scripts/verify-fp-s2helpers-taint.mjs（playwright baseURL 正则随实现更新）；根 package.json（test 追加 `node --test scripts/*.test.mjs`）                                                                                                                                                                                                   |

## 4. 验收标准与实测结果（2026-09-28，worktree RabbitAITest-s2 / slot 2）

1. 单测：`pnpm test` 全绿（全部 vitest 套件 + rabbit-env.test.mjs 6/6：槽位推导/端口表 30 值唯一/旧端口避让/slot1 过渡期交叠登记）。✅
2. **并行隔离实测**：slot 2 dev 栈（3002/4002/5442）**运行中**同时跑 e2e 全新口径子集（global-setup 起 5452/4102/6381·db2 + webServer 从 /tmp 副本起 3102）——e2e 9/9 全绿后 dev 栈无损（teardown 只回收本 worktree e2e 进程）；s6 worktree 的 mock（4000/4100）全程不受扰。✅
3. e2e 子集选 codemod 覆盖代表 spec（API-001-debug / API-004 / SYS-005）——证明用例不再依赖写死端口。✅
4. JMeter 栈启动冒烟：stack ready on :3202（mock :4202，PG 5462，槽位 /tmp/rabbit-s2-jm 收纳 pid/日志）。✅
5. `playwright --list` 160 用例全量加载；`pnpm lint` 绿；oxfmt 格式化收口；`bash -n` 三脚本通过。✅
6. CI（推送分支后）：quality / build / migrate-replay / e2e / api-test / audit 全绿。——待推送后以远端结果为准（门禁 9.1）

> 门禁 7 适用口径说明：本规格为环境工具链（无产品功能面、无用户可见 API/UI），单测=node:test 端口表矩阵；JMeter/Playwright **用例本身**即本规格的被改造对象与验证载体（e2e 子集 + api 栈冒烟），不新增独立 jmx/spec 文件（登记豁免理由：测试对象是栈编排而非业务端点）。

## 5. 变更记录

- 2026-09-28：方案会话评审通过（用户认可），当日实现于分支 `INFRA-005-parallel-slot-isolation`（worktree RabbitAITest-s2，slot 2）。
- 2026-09-28：编号由 INFRA-004 改为 INFRA-005——S8 正式交付已占用 INFRA-004（observability-backup，origin/main 2865e08）。

## 6. 与 origin/main（2865e08，S8）的合并对齐清单

本分支基线为 d19e493（本地 main，落后 origin/main 一个 S8 合并）。rebase/PR 时需对齐：

1. **编号**：S8 已含 `docs/sprint-8-stabilize/{INFRA-004-observability-backup, QA-001, QA-002}.md` 与正式 sprint-overview——本目录的 sprint-overview 需将 INFRA-005 行**并入 S8 正式概览**交付表后删除独立版本。
2. **readUnreadTitles 重构**（S8 FP 根治）触及 tests/e2e/MSG-001、BUG-002、s5-helpers——与本分支同文件的端口参数化（E2E_BASE/MOCK_BASE）需手工合并（两者正交，保留双方）。
3. **S8 小改吸收**：api-test-stack.sh 的 `JM_MOCK_PORT` 需 `export`（baseline step 跨 shell 依赖）；global-setup `.e2e.env` 追加 `LOG_LEVEL=warn`。本分支已按此口径预置。
4. **ci.yml**：S8 追加 audit 描述与 perf job 相关变更，与本分支 api-test job 重写正交合并。
5. **S8 新增脚本 slot 化（遗留）**：`scripts/perf-baseline.mjs / perf-seed.mjs / backup.mjs / restore.mjs` 若含硬编码端口，依 rules/git-workflow §9 接入 rabbit-env（合并后补一次 grep 审计即可）。
