# rules/git-workflow.md — 分支、PR、CI 与发布规范

> 由 AGENTS.md §5 引用并细化。目标：每个 PR 可追溯到规格文档与高保真确认，CI 全绿才可合并，发布可回滚。

## 1. 分支模型

| 分支 | 用途 | 规则 |
| --- | --- | --- |
| `main` | 唯一长期分支，始终可发布 | 保护：≥1 approve + CI 全绿 + squash merge |
| `feat/{MODULE}-NNN-{slug}` | 功能开发 | 与规格文档编号一一对应；生命周期 ≤1 个 sprint |
| `fix/{MODULE}-NNN-{slug}` | 缺陷修复 | 必须先有失败用例复现（rules/testing.md §5.3） |
| `hotfix/{slug}` | 生产紧急修复 | 从 main 拉出，修复合入后同步 tag；须补审计事件说明 |
| `docs/{slug}` / `chore/{slug}` | 文档/工程 | 不触碰 apps/packages 代码 |

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
→ api-test(JMeter, 对本地服务) → e2e(Playwright, 冒烟集)
→ audit(pnpm audit --prod) → bundle-size(变更阈值)
```

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

| # | 步骤 | 标准 |
| --- | --- | --- |
| 1 | 合并与推送 | 未合并的功能分支完成 review 合入 main（或确需延期的以 feature 分支 push 远程并登记原因）；**所有代码已 push 到 GitHub，本地无未提交/未推送内容**（`git status` 干净） |
| 2 | 远端 CI 确认 | GitHub Actions 在 main（或对应分支）最新 commit 上**全绿**；红灯未解决不得宣布 Sprint 完成 |
| 3 | 验收核对 | sprint-overview「验收标准」逐条跑通并更新交付表状态；规格文档状态流转（Implemented/Verified） |
| 4 | 文档与 changelog | 用户可见变更追加 changelog；覆盖率映射表（清单章节 → 文档编号）同步 |
| 5 | 里程碑产物 | 到达里程碑（M1-M10）时打 tag 并出 release PR；远端 CI 绿后归档 |
| 6 | 交接说明 | 在 sprint-overview 追加「遗留项与风险」小节，未完成项指向去向 Sprint/文档编号 |
