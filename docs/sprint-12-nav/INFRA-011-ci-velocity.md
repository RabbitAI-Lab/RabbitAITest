# INFRA-011 CI 提速——测试作业解除 build 串行依赖 + e2e 三分片 + Next 构建缓存

## 元信息

| 字段         | 值                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| 编号         | INFRA-011                                                                                                       |
| 类型         | 纯 CI 基建（无产品功能面变化）                                                                                  |
| 状态         | Approved → Implemented                                                                                          |
| 确认人       | 用户（2026-10-01 会话：基于当轮 CI 提速评估「按这个实施看下效果吧」）                                            |
| 高保真确认   | N/A（纯基建，以接口契约评审替代：评审对象=当轮评估报告，用户已确认方案方向）                                     |
| 关联         | `.github/workflows/ci.yml`；`rules/git-workflow.md` §5                                                          |
| 基线         | run 36780312102（SYS-010 十作业全绿）：总墙钟 **16m45s**                                                        |

## 1. 背景与问题

基线 run 的关键路径是一条串行链：`quality(2m11) → next build(2m51) → Playwright 分片②(11m03)`。
step 级分解：每个测试分片固定开销 ~3-3.5m（其中 `pnpm --filter web build` 108~143s 为大头）；
JMeter 最长分片 7m29s，**不在关键路径上**——JMeter 提速对总墙钟零贡献。

## 2. 方案（三刀）

1. **e2e / api-test 解除 `needs: build`**：分片自带 web 构建（~140s），与 build job 同期并行、
   从 t=0 起跑。原链路里「等 build 完成」纯粹把 2m51s 串进关键路径；分片自建发生在 build
   同期，零墙钟代价。build job 保留为并行「构建门禁」。
2. **e2e 2→3 分片**（每分片仍 4 workers、独立栈/独立 PG/Redis）：单 runner 4 workers 封顶口径
   不变（2026-09-29 实测 8 workers 单机过载），聚合并发 8→12 依赖分片隔离（各自独立栈）
   线性扩展，无互踩。
3. **e2e×3 + api-test×2 挂 `.next/cache` 增量构建缓存**（actions/cache，key=lockfile+web 源码
   哈希，restore-keys 前缀回退）：首轮 miss=全量构建不劣化，次轮起 build 显著缩短。

### 2.1 方案选型：为何不做 build artifact 复用（评估时曾列优先级①）

artifact 方案（build job tar `.next` → 测试分片下载解包）让 e2e 仍需**等 build 完成**（含
tar+upload ~40s）才能开始；而分片自建与 build 并行发生在 t=0~140s——**「提前并行」在墙钟上
严格优于「产物复用」**，且免去 upload-artifact v4.6+ 点开头目录（`.next`）过滤的 workaround
与跨 job 产物一致性风险。留作未来私有化（计费敏感、想压总计算量）场景的后备杠杆。

## 3. 约束（不动项）

- **workers=4/runner 封顶**：单机 8 workers 两轮实测过载（4 核 runner UI 响应滞后击穿 10s
  actionTimeout，flaky 6→8 波动）——加并发只走分片轴，不碰单机 workers。
- **JMeter 分片内并行被 2026-09-29 审计否决**：计划间存在全局单例（license/系统参数/AI
  模型默认标记）与共用种子 admin@rabbit.test，共享栈并发互踩；JMeter 不在关键路径，
  分片数维持 2 不动。
- JMeter round-robin 字母序分片、分片内串行口径不变。

## 4. 语义变化与风险

| 变化/风险                              | 处置                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| quality/build 红时 e2e/api-test 不再被短路（照跑至完） | 公共仓计算免费；PR 正确性不变（仍因上游红而红）；浪费上限 ~8min×5 作业 |
| `.next/cache` 并行保存同 key 冲突      | actions/cache 同 key 首存者胜、其余 warning 不失败（矩阵作业共享 key 的常规形态）          |
| 分片均衡                               | Playwright 按用例数（219）均分不按时长（基线两分片 372s vs 452s 已有偏斜）；三分片落地后观察一轮实测，必要时数据驱动调 4 分片（预留后续，不在本规格） |
| 陈旧 `.next/cache` 影响构建正确性      | key 含 web 源码哈希：源码变=新 key；restore-keys 前缀回退由 Next 增量编译自校验（业界标准配方） |

## 5. 验收

1. 远端 CI 全绿（AGENTS 门禁 9：以 GitHub Actions 远端结果为准）。
2. 实测对比回填 §6。

## 6. 实测回填（PR #36，run 36824678991）

| 口径                     | 总墙钟  | 明细                                                                                                              |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------------------------------- |
| 基线（36780312102）      | 16m45s  | quality 2m11 → build 2m51 → e2e② 11m03 串行链；e2e① 9m16 / jm① 6m42 / jm② 7m29                                    |
| 首轮（attempt 1，缓存 miss） | **12m42s** | e2e ③ 8m15 / ② 12m03 / ① 12m41（t=0 起跑）；缓存步骤 0~1s miss、build 90~162s；11 项检查全绿（含 perf）          |
| 重跑（attempt 2，缓存命中） | ~11m06s | 缓存步骤 3~4s 命中、build 106~114s（**增益 ~30s/作业**）；e2e① 两条流程用例慢机 flake 红（见下注），②③ 全绿     |
| 失败作业重跑（attempt 3）  | —       | e2e① 单独重跑通过，run 结论 success                                                                              |

结构性收益 = 解除串行链（e2e 从 t=0 起跑，不再等 quality+build 的 ~5m）；`.next/cache` 增益 ~30s/作业，远小于共享 runner 方差（同 run 内同 build 步骤 90s vs 162s，执行步骤 339s vs 476s——**单样本 CI 时长对比不可靠，结构变化以关键路径推导为准**）。

### 6.1 慢机 flake 登记（attempt 2 + main 合并后）

**实例 1（attempt 2，分支 run）**：e2e① `MAINFLOW-s4 计划完整链路` 与 `SYS-010-04 权限二态`
各重试 2 次均超时（locator.click / waitForResponse 10s 窗口被拖满 + engine callback 404
留痕）；同 SHA attempt 1 同分片全绿、同缓存 attempt 2 分片②③全绿、attempt 3 单独重跑通过
——判定为慢机 flake 非本变更引入。后续杠杆（不在本规格）：该两条用例的等待窗口按
「CI 慢机」口径加宽（先例：SYS-010 nav helpers 轮询式展开）。

**实例 2（main 36829380186，合并后首轮）**：e2e① `ENTP-004-01 界面设置` 三连红——
clearCookies 切登出视角竞态的**浏览器原生 401 形状**（`Failed to load resource: ... 401`）
漏出白名单（既有条目只盖应用侧 `[http 401]` 日志形状，commit bbd56b1 先例的另一半）；
`MAINFLOW-s3`/`SYS-005-01` 单次失败重试通过（flaky-passed）。**修复**：ENTP-s9 白名单补
原生形状条目（分支 INFRA-011-flake-401-whitelist）。
