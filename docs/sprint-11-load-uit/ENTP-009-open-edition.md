# 开源全功能模式（ENTP-009 · License 停用门控）

| 元信息项     | 内容                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-009                                                                                                                                        |
| 所属迭代     | Sprint 11 后置决策（2026-09-30 产品方向变更，随 S11 验收后落地）                                                                                |
| 优先级       | 产品决策级（owner 直令）                                                                                                                        |
| 所属模块     | ENTP 授权（License）/ 全部企业版特性面（MULTI_ORG·SSO·MULTI_POOL·THEME·MSG_TEMPLATE·USER_SCALE·LOAD_TEST·UI_TEST）                              |
| 文档状态     | **Approved**（决策依据=owner 2026-09-30 原话指令：「目前所有功能都不需要 License。直接开源，大家都可以用。License 功能先留着，代码不要删除。」） |
| 最后更新日期 | 2026-09-30                                                                                                                                      |
| 上游依赖     | ENTP-007（License 体系基建）、LOAD-003/UIT-002（License 门控模块）                                                                              |
| 下游消费     | 未来企业发行版（RABBIT_FEATURE_GATE=1 恢复门控口径）                                                                                            |
| 上游依据     | 开源发行策略：全功能开放、无社区/企业版功能差异（与 MeterSphere 社区/企业双轨形成差异化）                                                       |
| 对标基线     | 偏离基线（MeterSphere 社区版缺 UI 测试/性能测试；本项目开源口径=全功能）——登记为有意差异                                                       |
| 关联架构文档 | rbac-permission-model.md §6（特性门控语义）、AGENTS.md 门禁 6（范围红线同 PR 修订）                                                            |
| 高保真确认   | **豁免**（登记理由：无新增页面/交互——仅既有授权管理页文案与状态徽标调整、门控语义翻转；按门禁 2「纯后端/行为类以契约评审替代」口径，license-status 新增 featureGateEnabled 字段即契约面，ENTP-007 jmx T1.4 已断言） |
| 工作量估算   | 后端 0.5 人日 + 测试翻转 1 人日 + 文档 0.5 人日                                                                                                 |

## 1. 概述

### 1.1 决策内容

**License 不再门控任何功能**。项目以开源口径发行：无 License = 全功能（八特性全开、用户数不限）；License 体系（签发/验签/状态机/授权管理页）**全量保留**，仅作授权信息登记与展示，`RABBIT_FEATURE_GATE=1` 可一键恢复 ENTP-007 门控口径（企业发行版用，代码零删除）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                   | P1 ✅ | 后续                                     |
| ---------------------------------------------------------------------- | ----- | ---------------------------------------- |
| 门控停用：assertEntpEnabled/entpFeatureActive/effectiveUserLimit 放行   | ✅    | —                                        |
| 状态契约：license-status 新增 `featureGateEnabled`（false=开源默认）   | ✅    | —                                        |
| 前端放行：useEntp.can() 与 load/ui-test 页内联门控随开关放行           | ✅    | —                                        |
| 模块缺省：moduleFlagsSchema load/uit 缺省 false→true（显式关可覆盖）   | ✅    | —                                        |
| 授权管理页：开源口径文案/矩阵「已开放（开源版）」/容量清单全功能        | ✅    | —                                        |
| 占位组件保留：load/ui-test placeholder.tsx 死代码保留（恢复态复活）    | ✅    | —                                        |
| 门控恢复态单测双侧覆盖（setFeatureGateEnabled 翻转）                   | ✅    | —                                        |

### 1.3 明确不做

- 不删除任何 License 代码（门禁函数/占位页/授权管理页/jmx 授权链全保留）
- 不改动 RBAC 权限点（PROJECT_LOAD/UI_TEST 等权限仍按角色授予，与 License 正交）
- 不改 modules 模块开关语义（管理员仍可按项目关闭 load/uit 菜单）

## 2. 实现要点

| 落点                                                                         | 变更                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `packages/shared/src/entp/features.ts`                                        | `featureGateEnabled()`（env `RABBIT_FEATURE_GATE=1` 初始化，默认 false）+ 测试翻转器     |
| `packages/shared/src/entp/schemas.ts`                                         | `licenseStatusSchema` 新增 `featureGateEnabled: boolean`                                  |
| `apps/web/src/server/domains/entp/license.service.ts`                         | 三个门控函数（assertEntpEnabled/entpFeatureActive/effectiveUserLimit）开关短路；状态两分支带新字段 |
| `apps/web/src/hooks/useEntp.ts` + load/ui-test 页内联门控                      | `featureGateEnabled=false`（含加载期）恒放行，占位不闪现                                  |
| `apps/web/src/app/(console)/system/license/page.tsx`                          | 开源口径文案/矩阵徽标/容量清单（gate=false 分支）                                         |
| `packages/shared/src/project/schemas.ts` + LeftNav 兜底                        | load/uit 模块缺省 true（存量显式 false 不翻转）                                          |
| `scripts/gen-license.mjs`                                                     | 注释更新（八特性/开源口径说明；功能不变）                                                 |

## 3. 测试翻转登记（对应门禁 8）

| 层       | 文件                                         | 翻转                                                                                   |
| -------- | -------------------------------------------- | -------------------------------------------------------------------------------------- |
| Vitest   | `entp/__tests__/license.test.ts`             | 双侧语义：开源默认放行 + withGate(true) 恢复态 90001/90005/上限30                        |
| Vitest   | `entp/__tests__/s9-template.test.ts`         | 模板回退：开源态用模板 / 门控恢复态回退 defaults                                        |
| Vitest   | `shared/__tests__/fp-schemas.test.ts`        | 模块缺省语义六键全开 + 显式 false 持久化                                                |
| e2e      | `S11-load-uit.spec.ts`                       | 全程无 License 跑功能链路；T9 门控→开放可用；模块开关缺省开回归                          |
| e2e      | `ENTP-s9-enterprise.spec.ts`                 | 六处「社区版锁定二态」→「无 License 可用」；授权信息链（徽标/矩阵/到期条）保留           |
| JMeter   | `ENTP-004/007/LOAD-003/UIT-002.jmx`          | 90001/90005 采样器→201/code=0；T1.4 增 featureGateEnabled=false 契约断言；四类场景由 RBAC 403 组继续覆盖 |

## 4. 风险与回退

- **回退**：`RABBIT_FEATURE_GATE=1`（服务端 env）即恢复 ENTP-007 全部门控，前端经 license-status 字段自动跟随，无代码改动。
- **存量项目**：modules JSON 缺 load/uit 键的项目解析后从关→开（菜单出现）；显式存过 false 的不受影响。管理员可在项目设置关闭。
- **差异登记**：与 MeterSphere 社区版（缺 UI/性能测试、5 用户）刻意不同——本项目开源=全功能，作为发行策略有意偏离基线。

## 5. 用例表

| 编号            | 用例（文件）                                                                    | 层      |
| --------------- | ------------------------------------------------------------------------------- | ------- |
| ENTP-009-T1     | 开源默认无 License 全放行 + 状态 featureGateEnabled=false（license.test.ts）     | Vitest  |
| ENTP-009-T2     | 门控恢复态 90001/90005/上限 30（license.test.ts withGate）                       | Vitest  |
| ENTP-009-T3     | 模板回退双侧（s9-template.test.ts）                                             | Vitest  |
| ENTP-009-T4     | 模块缺省六键全开 + 显式 false 持久化（fp-schemas.test.ts）                       | Vitest  |
| ENTP-009-T5     | 无 License 全功能链路 + 状态契约 + 模块缺省开回归（S11-load-uit.spec.ts）        | e2e     |
| ENTP-009-T6     | 六处无 License 可用 + 授权信息链（ENTP-s9-enterprise.spec.ts）                   | e2e     |
| ENTP-009-T7     | 开源口径放行 + 契约断言（ENTP-004/007/LOAD-003/UIT-002.jmx）                     | JMeter  |

## 6. 状态流转

Approved（2026-09-30 owner 指令）→ Implemented（本 PR）→ Verified（待人工验收走查）。

## 7. 勘误 1（2026-10-01）——「企业版方向」残留文案清扫

验收走查发现 UI 残留「企业版/企业版方向」标注误导开源口径。全量排查结论与处置：

**活文案（开源态常显，已清 8 处）**：设置›模块开关「企业版方向」徽标+占位 desc（load/uit 各一）、性能测试/UI 测试页头紫色「企业版」Tag 及无项目分支 sub、组织管理页头 sub、消息设置事件 Tab Alert「自定义模板为企业版能力」、用户管理页头 sub「系统用户 · 企业版（授权上限不限）」。

**死分支文案（门控恢复态语义正确，保留）**：load/ui-test placeholder 组件整体（owner 明令代码不删）、各页锁定态 Tooltip/Alert/空态文案（orgs/pools/sso/departments/ThemeTab/TemplateTab/login SSO 错误）、用户容量条「企业版授权扩容」链接——均位于 `can(feature)=false` 或 `!enabled` 分支，开源态不可达；恢复门控（RABBIT_FEATURE_GATE=1）时文案即回到正确语境。

**正当展示（保留）**：系统›授权管理页的社区版/企业版徽标与授权信息——License 体系本身的信息呈现。
