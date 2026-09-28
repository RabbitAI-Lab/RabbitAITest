# UI 测试模块占位（UIT-001 · 企业版方向）

| 元信息项     | 内容                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | UIT-001                                                                                                                          |
| 所属迭代     | Sprint future — 远期 P4                                                                                                          |
| 优先级       | P4（远期增强级）                                                                                                                 |
| 所属模块     | UIT UI 测试（占位）/ PROJ 项目设置（模块开关）                                                                                   |
| 文档状态     | Implemented（2026-09-28 交付：功能+三层测试全绿；走查随验收）                                                                                                                         |
| 最后更新日期 | 2026-09-28                                                                                                                       |
| 上游依赖     | PROJ-001（模块开关机制）、LOAD-001（占位口径先例，同 PR 交付）                                                                   |
| 下游消费     | ENTP 企业版迭代（Selenium 方向激活）                                                                                             |
| 上游依据     | 需求文档「明确不做（P4 远期）：UI 测试（Selenium）——MeterSphere v3 社区版同样没有，仅在企业版方向占位」                          |
| 对标基线     | MeterSphere功能清单 §12.10（占位证据=menu.UI_* 配置项、PROJECT_APPLICATION_UI 权限点、资源池 DTO uiTest 字段、menu.uiTest 文案） |
| 关联架构文档 | rbac-permission-model.md、test-domain-model.md                                                                                   |
| 高保真确认   | 待确认（原型：docs/design/UIT-001-uit-placeholder/；确认人/日期后补）                                                            |
| 工作量估算   | 前端 1 人日（与 LOAD-001 同机制，边际成本低）                                                                                    |

## 1. 概述

### 1.1 功能定位

与 LOAD-001 同构的**UI 测试占位资产**：复刻 MeterSphere v3 社区版对 UI 测试的处理（v1/v2 基于 Selenium 的 UI 测试在 v3 社区版完全移除，仅留企业版方向占位）。交付模块开关 `uit`（默认关）+ 保留权限点 `PROJECT_UIT:READ` + 占位导航与页面 + 资源池 DTO `uiTest` 占位字段（与 LOAD-001 同 PR 一次实现，本规格为 uiTest 字段的登记主责）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                             | P1 ✅ | 后续                                     |
| ---------------------------------------------------------------- | ----- | ---------------------------------------- |
| 模块开关 `uit` 键（默认关闭）+ 设置页开关（企业版方向 Tag）      | ✅    | —                                        |
| 权限点 `PROJECT_UIT:READ` 声明（保留位）                         | ✅    | 企业版激活时扩展                         |
| 开关开启后导航「UI 测试」组与占位页 `/ui-test`（企业版方向空态） | ✅    | 企业版替换为真实模块                     |
| 资源池 DTO `uiTest: false` 占位字段                              | ✅    | 企业版浏览器网格池配置                   |
| Selenium/WebDriver 驱动、浏览器网格、UI 自动化编排               | ❌    | 企业版方向（本仓不实现，无红线冲突外溢） |

### 1.3 前置依赖

同 LOAD-001（模块开关机制与权限模型）。

### 1.4 对标基线核对

| 基线行为（清单 §12.10）                   | 本项目实现                             | 口径     |
| ----------------------------------------- | -------------------------------------- | -------- |
| v3 社区版无 UI 测试模块（v1/v2 Selenium） | 无模块，仅占位资产                     | 完全复刻 |
| `menu.UI_*` 配置项                        | `Project.modules.uit` 键（默认 false） | 完全复刻 |
| `PROJECT_APPLICATION_UI` 权限点           | `PROJECT_UIT:READ` 保留位              | 简化实现 |
| 资源池 DTO `uiTest` 字段                  | serializePool 输出 `uiTest: false`     | 完全复刻 |
| 多语言 `menu.uiTest` 文案                 | 导航文案「UI 测试」                    | 完全复刻 |

## 2. 业务逻辑

与 LOAD-001 完全同构（双门控=模块开关 ∧ 权限点；缺省 false；无数据面）。差异点仅文案与规划能力清单（UI 自动化用例编排/浏览器驱动矩阵/元素定位仓库/视觉快照对比——均置灰展示）。

## 3. UI/UX 设计

- 原型：`docs/design/UIT-001-uit-placeholder/index.html`（三态同 LOAD-001：关/开/无权限）。
- 占位页 `/ui-test`：PageHeader「UI 测试」+ 企业版方向空态卡片 + 置灰能力清单 + 规格链接。

## 4. 技术架构

- 权限点 `PROJECT_UIT:READ`（与 `PROJECT_LOAD:READ` 相邻声明，同一注释块）。
- 路由 `apps/web/src/app/(console)/ui-test/page.tsx`；LeftNav 组「UI 测试」`module="uit"`。
- 设置页 MODULES 列表 `{key:"uit", defaultOn:false, enterprise:true}`。
- 资源池 DTO `uiTest` 字段实现落在 pool.service.ts（LOAD-001 §4 已登记实现位置，此处登记字段归属）。

## 5. 测试用例

| 编号       | 类型   | 前置       | 步骤                        | 预期                                                  |
| ---------- | ------ | ---------- | --------------------------- | ----------------------------------------------------- |
| UIT-001-T1 | Vitest | 权限点清单 | 断言 PROJECT_UIT:READ 存在  | 存在                                                  |
| UIT-001-T2 | jmx    | admin 会话 | PUT modules.uit=true 后 GET | code=0，modules.uit=true                              |
| UIT-001-T3 | e2e    | admin 登录 | 开启开关→导航→/ui-test      | UI：占位页可见；Console：无 error；接口：PUT 200 回显 |

四类场景：正常=T2；权限/校验/分页=登记豁免（同 LOAD-001 口径）。

## 6. 竞品深度对标

基线 v1/v2 UI 测试基于 Selenium（用例=步骤指令序列，驱动浏览器执行）；v3 社区版移除全部实现仅留占位。本项目占位口径与 LOAD-001 一致；差异化决策同 LOAD-001（权限动作收敛为 READ 保留位）。企业版实施时的技术选型（Selenium Grid vs Playwright 网格）属 ENTP 迭代决策，本规格不冻结。

## 7. 里程碑与验收

DoD：开关/导航/占位页/权限点交付 + T1-T3 全绿 + 高保真走查。回归：同 LOAD-001。
