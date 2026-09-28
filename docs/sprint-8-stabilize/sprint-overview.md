# Sprint 8 · 稳定化（sprint-8-stabilize）概览 · INFRA-005 增补页

> ⚠ 本文件为 **INFRA-005 分支（基线 d19e493）上的增补概览**：正式 S8 概览（3 规格
> INFRA-004-observability-backup / QA-001 / QA-002）随 S8 交付合入 origin/main（2865e08），
> 本分支基线尚不含——**合并/PR 时将下表 INFRA-005 行并入正式概览交付表后删除本文件**。

## 交付表（本分支增补）

| 编号      | 规格                   | 状态        | 说明                                                                                  |
| --------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------- |
| INFRA-005 | 并行 worktree 槽位隔离 | Implemented | 2026-09-28 分支 `INFRA-005-parallel-slot-isolation`（worktree RabbitAITest-s2，slot 2）：端口/Redis 键空间/共享 /tmp 按槽位隔离，单一事实源 `scripts/rabbit-env.mjs`；规则沉淀 rules/git-workflow.md §9 |

## 遗留项与风险

- 过渡期：基线不含 INFRA-005 的旧 worktree 仍用旧固定端口（3000/4000/4001/5433/5434/3101/4020/5438），彼此互抢且与新表在 slot 1 有两处交叠——应尽早 rebase（rules/git-workflow.md §9.6）。
- 与 origin/main（S8）的合并对齐清单见 INFRA-005 规格 §6。
