# docs/design — 高保真原型目录

| 规格编号 | 原型 | 高保真确认（确认人/日期） | 勘误登记 |
| --- | --- | --- | --- |
| SYS-001 | [registration-login](./SYS-001-registration-login/index.html) | 待确认 | — |
| SYS-003 | [org-project-init](./SYS-003-org-project-init/index.html) | 待确认 | — |
| CASE-001 | [case-crud/list](./CASE-001-case-crud/list.html) · [form](./CASE-001-case-crud/form.html) | 待确认 | — |
| API-001 | [http-debug](./API-001-http-debug/index.html) | 待确认 | — |
| RPT-001 | [execution-report](./RPT-001-execution-report-mvp/index.html) | 待确认 | — |

**勘误 1（2026-09-26，走查①）**：用户走查反馈「样式太丑」——实现侧已完成视觉升级（设计 tokens：主色 #574BFF/圆角 6/13px 密度/卡片阴影体系/分组侧栏/品牌化登录页），**实现现为视觉基线**；本目录原型待按新基线同步重绘（Sprint 1 前完成），期间以实现走查为准。

规则（AGENTS.md 门禁 2）：
1. 原型经人工确认后才能开始对应功能编码；确认后交互变更须重新确认。
2. 实现与原型不一致处：要么回改实现，要么更新原型并在上表登记「勘误 N」（日期+变更+原因）。
3. 走查批次结论（走查①②…）记入对应 PR 描述。

设计基线：浅色工作台；顶栏 48px（左：Logo+项目切换；右：帮助/消息/用户）；左侧导航 200px（工作台/测试用例/测试计划/接口测试/缺陷管理/项目设置）；主色 `#574BFF`（AntD 默认蓝紫），成功 `#52C41A` 失败 `#FF4D4F` 进行中 `#1677FF`。
