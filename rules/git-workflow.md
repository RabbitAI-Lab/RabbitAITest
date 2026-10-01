# rules/git-workflow.md — 分支、PR、CI 与发布规范

> 由 AGENTS.md §5 引用并细化。目标：每个 PR 可追溯到规格文档与高保真确认，CI 全绿才可合并，发布可回滚。

## 1. 分支模型

| 分支                           | 用途                     | 规则                                               |
| ------------------------------ | ------------------------ | -------------------------------------------------- |
| `main`                         | 唯一长期分支，始终可发布 | 保护：≥1 approve + CI 全绿 + squash merge          |
| `feat/{MODULE}-NNN-{slug}`     | 功能开发                 | 与规格文档编号一一对应；生命周期 ≤1 个 sprint      |
| `fix/{MODULE}-NNN-{slug}`      | 缺陷修复                 | 必须先有失败用例复现（rules/testing.md §5.3）      |
| `hotfix/{slug}`                | 生产紧急修复             | 从 main 拉出，修复合入后同步 tag；须补审计事件说明 |
| `docs/{slug}` / `chore/{slug}` | 文档/工程                | 不触碰 apps/packages 代码                          |

## 2. Commit 规范

1. Conventional Commits：`feat|fix|docs|refactor|test|chore|perf(scope): 描述`，scope 用模块缩写（`feat(case): …`、`fix(exec): …`）；commitlint CI 校验。
2. 一个 commit 一个关注点；禁止「功能+格式化+无关重构」混提；migration 与其消费代码同 commit 或紧邻。
3. 提交信息体（body）写「为什么」与影响面；破坏性变更标 `BREAKING CHANGE:` 并说明迁移路径。

## 3. PR 规范

1. 变更 ≤ 400 行（不含生成物与 lockfile）；超出必须拆 PR（按规格章节或分层）。
2. PR 描述模板（`.github/pull_request_template.md`，INFRA-001 建立）必填：
   - 对应规格：`docs/sprint-N/MODULE-NNN-*.md`（链接）
   - 高保真确认：确认人/日期/原型链接（UI 类必填）
   - 测试证据：新增/修改的 jmx 与 spec 列表 + CI 报告链接（含录屏/trace，若 UI 变更）
   - 截图：UI 变更前后对比（GIF/短视频优先）
   - 数据库：migration 编号与影响；权限点变更
3. Review 要求：至少 1 名维护者 approve；涉及 schema/契约/权限/引擎内核的变更必须由对应 owner 二审（CODEOWNERS 按 `apps/*/src/server/domains` 与 `packages/db` 划分）。
4. 合并方式 squash merge，标题沿用 PR 标题（符合 commit 规范）；合并即触发部署到 staging。

## 4. Code Review Checklist（Reviewer 逐项核对）

- [ ] 规格文档存在且状态 ≥ Approved；高保真已人工确认（UI 类）
- [ ] 测试三类断言齐备（UI/Console/接口）；jmx 四项断言齐备；录屏/trace 产物存在
- [ ] 权限点已声明（withPermission）；对象级授权（withProjectScope）无遗漏
- [ ] 跨域引用走 Provider；无 engine→web/db 依赖
- [ ] schema 变更符合一次建齐；migration 只增不改；expand-contract（若破坏性）
- [ ] 日志/错误码/脱敏符合 observability 与 security 规范
- [ ] 无规范外新依赖；无 any/裸 throw

## 5. CI 流水线（PR 必过，阶段即失败即止）

```
lint(oxlint) → typecheck(tsc) → unit(vitest, 含覆盖率阈值)
→ build(turbo) → migrate-replay(空库全量迁移重放 + prisma diff)
∥ api-test(JMeter ×2 分片, 各自独立栈/独立 DB) ∥ e2e(Playwright ×3 分片, 4 workers/片)
→ audit(pnpm audit --prod) → bundle-size(变更阈值)
```

- **测试作业不串行等待 build（INFRA-011，2026-10-01）**：e2e/api-test 分片自带 web 构建（挂 `.next/cache` 增量缓存）从 t=0 并行起跑——build 是并行「构建门禁」而非前置依赖（原 quality→build→e2e 串行链是总墙钟 16m45s 的主因）；quality/build 红时测试作业照跑至完（公共仓计算免费，PR 仍红）。
- main 每日：全量 e2e + embedded/外部 PG 双环境迁移重放 + 性能基线冒烟（红灯成批收口到 `fix/nightly-regression-YYYYMMDD` 分支，合并后删分支）。
- 产物上传：HTML 报告 always；video/trace/截图 on-failure；保留 30 天。
- **CI 结果以 GitHub Actions 远端为准**（AGENTS.md 门禁 9）：本地全过仍可能因环境差异挂远端，push 后必须跟踪 Actions 结果直至绿。
- **main 保持绿（stop the line）**：main CI 变红，所有人停止新功能开发，优先修复或 `git revert` 对应 PR；修复期间冻结合并（hotfix 除外）。

### 5.1 CI 工程纪律（源自 RabbitProjects 281 commit 实践教训）

1. **门禁「第一天真跑」**：任何新门禁（lint/覆盖率/类型检查/性能）接入当天必须全量真跑并**清零存量**——禁止「先接门禁、存量后补」，历史教训：lint 首次真跑爆出 60 项存量错误被迫专门收口；增量（affected）面板首次纳入某包时同样会暴露其存量问题。
2. **CI 起栈必须起全依赖**：种子/测试依赖的每个服务（DB/Redis/MinIO/mock receiver 等）都要在 CI 编排中声明；本地能起≠CI 能起（曾因 CI 缺 Redis/RabbitMQ service 与 mock receiver 四红）。
3. **CI 环境自适应，禁硬编码**：容器名、库名、host、路径一律从环境/统一配置读取；同一资源的地址常量（如 MinIO endpoint 与种子里的 URL）必须**单一来源**——曾因 `127.0.0.1` 与 `localhost` 两处常量不一致导致预签名直传 403。
4. **CI 不硬依赖可选产物**：录屏样本、人工产物等缺失时**降级跳过并告警**，不得让整门误红。
5. **性能门禁阈值按 CI 硬件标定**：P95/P99 阈值必须在 CI 机器上实测标定后写入，不得照搬本地数值（CI 硬件慢导致误红）。
6. **pre-push hook 必装**（husky）：push 前至少跑 `lint + typecheck`——实践中该 hook 拦截过参数签名错误等真实缺陷。

## 6. 版本与发布

1. 语义化版本：标准版 `v1.x`（v1.0 = 社区版功能面 GA）、企业版 `v2.x`；pre-release 用 `-alpha.N/-rc.N`。
2. Changelog：Keep a Changelog 格式，PR 合并时同步追加（用户可读描述，非 commit 罗列）；发布时由 release PR 汇总。
3. 发布流程：`release/vX.Y.Z` 分支 → 全量回归（Release Gate：主链路 E2E + 全量 tests + QA 基线）→ tag → 构建产物（镜像/Compose 包）→ changelog 归档。
4. 可回滚：镜像与 Compose 包按 tag 保留；数据库回滚依赖 expand-contract 保证旧代码可跑新 schema（禁止依赖「迁移回退」）；hotfix 只 cherry-pick 修复 commit + 独立 migration。

## 7. 仓库卫生

1. 生成物（api-client、覆盖率、test-results、.pgdata、dist）全部 gitignore；禁止提交。
2. 文档与代码同 PR 变更（AGENTS.md §5）；文档 drift 在 sprint 收尾统一清点。
3. 分支删除：合并后自动删除；僵死分支（>1 sprint 无活动）由维护者清理。

## 8. Sprint 收尾交付流程（每个 Sprint 结束时必做）

按顺序执行，全部完成才算 Sprint 交付（AGENTS.md 门禁 9.3）：

| #   | 步骤             | 标准                                                                                                                                                                  |
| --- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 合并与推送       | 未合并的功能分支完成 review 合入 main（或确需延期的以 feature 分支 push 远程并登记原因）；**所有代码已 push 到 GitHub，本地无未提交/未推送内容**（`git status` 干净） |
| 2   | 远端 CI 确认     | GitHub Actions 在 main（或对应分支）最新 commit 上**全绿**；红灯未解决不得宣布 Sprint 完成                                                                            |
| 3   | 验收核对         | sprint-overview「验收标准」逐条跑通并更新交付表状态；规格文档状态流转（Implemented/Verified）                                                                         |
| 4   | 文档与 changelog | 用户可见变更追加 changelog；覆盖率映射表（清单章节 → 文档编号）同步                                                                                                   |
| 5   | 里程碑产物       | 到达里程碑（M1-M10）时打 tag 并出 release PR；远端 CI 绿后归档                                                                                                        |
| 6   | 交接说明         | 在 sprint-overview 追加「遗留项与风险」小节，未完成项指向去向 Sprint/文档编号                                                                                         |

## 9. 并行 worktree 槽位隔离（INFRA-005，2026-09-28）

多 worktree 并行联调/自测时，全部环境资源标识（端口 / Redis 键空间 / Docker 容器 / /tmp 共享路径）**按槽位隔离**，单一事实源为 `scripts/rabbit-env.mjs`（规格：`docs/sprint-8-stabilize/INFRA-005-parallel-slot-isolation.md`）。

1. **槽位推导**（优先级）：`RABBIT_SLOT` 环境变量（0-9） > worktree 目录名 `RabbitAITest-s{N}` → N > 主仓/CI checkout → 0。CI 恒为 slot 0。
2. **端口表**（base + slot；s = 槽位号 0-9）：

   | 栈 | web | mock | plugin-runner | PostgreSQL | Redis（逻辑库号=s） | 临时路径 |
   | -- | --- | ---- | ------------- | ---------- | ------------------ | -------- |
   | dev（pnpm dev） | 3000+s | 4000+s | 4300+s | 5440+s | 6379/s | .pgdata（worktree 本地） |
   | e2e（pnpm test:e2e） | 3100+s | 4100+s | 4310+s | 5450+s | 6381/s | /tmp/rabbit-e2e-root-s{s} |
   | JMeter（api-test-stack） | 3200+s | 4200+s | 4320+s | 5460+s | 6381/s | /tmp/rabbit-s{s}-jm/ |

   Redis 实例共享（dev 6379 / e2e+jm 6381），**键空间按逻辑库号 = slot 隔离**（BullMQ 队列、SSE Stream 不串台）。速查示例：worktree `RabbitAITest-s3` → dev 栈 web **3003** / mock **4003** / runner **4303** / PG **5443** / redis 6379·db3；e2e 栈 3103 / 4103 / 4313 / 5453 / 6381·db3；JMeter 栈 3203 / 4203 / 4323 / 5463 / 6381·db3。
3. **硬性禁令**：新增服务/脚本/测试**禁止硬编码端口与共享 /tmp 路径**，一律从 `scripts/rabbit-env.mjs` 取值（Node 侧 `import { rabbitEnv }`；bash 侧 `eval "$(node scripts/rabbit-env.mjs --shell)"`，RABBIT_* 仅作默认值、显式 env 可覆盖）；e2e 用例侧统一走 `tests/e2e/env.ts`。CI 用 `pnpm test`（含 `node --test scripts/`）守住端口表唯一性。
4. **清场纪律与归属检测**：栈脚本/teardown 只清**本槽位**端口与本 worktree 绝对路径下的进程（`pkill -f "<worktree>/apps/..."`）；占用者的 cwd 属于**其他 worktree** 时必须 fail fast 指名冲突（global-setup 已内置 `lsof -d cwd` 归属检测），禁止裸 `apps/mock` 模式、跨槽 lsof 互杀或静默抢占。
5. **诊断口径**：联调自测异常先查串台——`node scripts/rabbit-env.mjs`（确认本目录槽位）+ `lsof -nP -iTCP -sTCP:LISTEN | grep -E '30[0-9]{2}|4[012][0-9]{2}|54[0-9]{2}'` + `redis-cli -p 6381 -n <slot> keys 'bull*'`。
6. **过渡期登记**：本方案合入前创建的旧 worktree（基线不含 INFRA-005）仍用旧固定端口（3000/4000/4001/5433/5434/3101/4020/5438），彼此及与 slot 0 互抢——**尽早 rebase 到含 INFRA-005 的基线**；新表与旧端口的唯二交叠为 slot 1（dev mock 4001 / e2e web 3101），过渡期避开 s1 目录命名。`tests/smoke/*.sh` 历史冒烟脚本按 slot 0（主仓）口径保留，不随槽位参数化。

### 9.7 多 worktree 并行开发·启动操作手册（谁照做谁不踩坑）

**第 1 步：建 worktree（目录名决定槽位）**——s{N} 后缀是硬约束，N 取未占用的 2-9（避开 1：与旧固定端口交叠）：

```bash
git worktree add ../RabbitAITest-s7 -b <MODULE>-NNN-{slug} origin/main
cd ../RabbitAITest-s7 && pnpm install          # worktree 各自独立 node_modules
node scripts/rabbit-env.mjs                    # 确认槽位：应输出 slot=7 及全部端口
```

**第 2 步：起 dev 栈（联调）**——一条命令，端口自动落在本槽位，无需任何手工配置：

```bash
pnpm dev
# [dev] worktree slot=7（web :3007 · mock :4007 · pg :5447）
# 就绪后：web http://localhost:3007 · mock :4007 · PG 5447 · Redis 6379 db7
```

被占会 fail fast 并给出排查/换槽指引（`RABBIT_SLOT=0-9` 临时换槽或 `lsof -i :端口` 找占用者）。Ctrl-C 统一回收；持久 `.pgdata` 支持幂等重启。

**第 3 步：跑 e2e（自测）**——全新口径直接跑，global-setup 自动起本槽位全套（PG 5450+s / mock 4100+s / web 3100+s / redis 6381·db{s}）：

```bash
pnpm test:e2e                                  # 全新口径（与 CI 一致）
# 修复循环复用口径见 rules/testing.md §3.4.2（pg-e2e 常驻库 + E2E_* 注入）
```

⚠ **同 worktree 里 dev 与 e2e 并行跑**：`next dev` 会写坏生产构建 `.next`，先做槽位专属 web 副本（dev 停止时执行一次；代码变更后重跑）：

```bash
node scripts/e2e-web-copy.mjs                  # 构建并复制到 /tmp/rabbit-e2e-root-s{s}
```

**第 4 步：跑 JMeter 接口自动化**——栈脚本自动按槽位起独立栈（web 3200+s / mock 4200+s / PG 5460+s），结束统一回收：

```bash
bash scripts/api-test-stack.sh                 # 全量 34+ 计划；NO_ENGINE=1 可免 engine
```

**第 5 步（可选）：单服务独立常驻**——`node scripts/pg-dev.mjs`（dev 口径 PG）等同口径取值；任何自写脚本取端口一律 `eval "$(node scripts/rabbit-env.mjs --shell)"` 后用 `$RABBIT_*` 变量，禁止写数字。

**冲突排查三件套**：`node scripts/rabbit-env.mjs`（本目录槽位）→ `lsof -nP -iTCP -sTCP:LISTEN | grep -E '30[0-9]{2}|4[012][0-9]{2}|54[0-9]{2}'`（谁占了什么）→ `redis-cli -p 6381 -n <slot> keys 'bull*'`（键空间是否串台）。收尾时只杀本 worktree 绝对路径的进程：`pkill -f "$(pwd)/apps/"`。
