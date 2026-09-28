# Mimosa 误报台账（FP Ledger）

> 依据 [rules/security.md §8](../../rules/security.md) 运作：Mimosa 安全门禁已证实误报的登记册。
> 新会话遇到已登记 finding 时**直接引用本台账答复，不重复推导、不绕过门禁**；新 finding 走 §8 三命题 SOP 核实后追加登记。
> 已知局限：插件 git-gate（密封包）无豁免机制，已证实误报仍会在每次 commit 重复出现——引用台账即答，非缺陷。

| # | 日期 | Finding 位置与等级 | 误报机理 | 证据 | 状态 |
| - | ---- | ------------------ | -------- | ---- | ---- |
| 1 | 2026-09-27（S2 收尾期） | `apps/engine/cli.ts` SSRF 上下文盲判（6 处凭据高危随附） | 引擎探测目标守卫的 URL 由被测系统自身下发/自产，静态分析无运行时上下文（宿主固定性） | `scripts/verify-fp-ssrf.mjs` 三命题实验 6/6（宿主固定性×8 组敌意输入/污点源头=被测系统自产 UUID/构建隔离）+ 运行时边界证据（敌意 projectId → 308 同 host 重定向或 404/20404，无外联面）；commit 4a32a2f | ✅ 已证实误报 |
| 2 | 2026-09-27（S3 收尾期） | `tests/e2e/s2-helpers.ts:140` 疑似跨文件污点（medium） | e2e 夹具固有形态（响应数据→递归提取 id→后续请求 body），被测系统自产 UUID 流回同宿主 JSON body；分析器未建模测试夹具信任域 | `scripts/verify-fp-s2helpers-taint.mjs` 三命题 14/14 + 汇聚点实放 10/10（真实 `scenarioCreateSchema`/`apiUpsertSchema` 拒绝全部敌意值→422）+ 聚焦深扫 0 findings（seal `sha256:6d66203a…`，仅参考）；commit 77b74ca | ✅ 已证实误报 |
| 3 | 2026-09-28（S8 收尾期） | `tests/e2e/MSG-001-notification-robot.spec.ts:90`、`tests/e2e/BUG-002-bug-collaboration-recycle.spec.ts:95` fetchUnreadTitles SSRF 入口判（high，37 medium 疑似跨文件污点随附） | 同 #1 上下文盲同构：e2e 测试代码读被测系统站内信，baseUrl=`E2E_BASE_URL ?? localhost:3100`（环境固定指向被测栈）；非生产代码路径，无用户可控输入流入 URL | S5 交付既有文件（commit 724a777，main 在册）；fetchUnreadTitles 仅 GET `${baseUrl}/api/v1/personal/notifications`（单一汇聚点）；污点源=测试环境变量+被测系统自产 cookie——#1 宿主固定性同构；S8 分支未改动两文件（git diff main 为空） | ✅ 已证实误报（引用 #1 机理，S8 收尾登记） |
## 观察栏（核实过程中发现的稳健性/质量观察，非安全）

| # | 日期 | 位置 | 观察 | 处置 |
| - | ---- | ---- | ---- | ---- |
| O1 | 2026-09-27 | `tests/e2e/s2-helpers.ts:134`、`s3-helpers.ts` 同构 walk | 模块树递归无深度上限：敌意被测系统可用超深嵌套使测试进程栈溢出（自身 DoS，非安全边界穿越） | S4 顺手加固：深度上限（如 64）或迭代化 |
