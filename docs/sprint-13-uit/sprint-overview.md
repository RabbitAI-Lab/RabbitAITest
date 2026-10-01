# Sprint 13 — UI 测试脚本化（AI 时代工作流）

| 项   | 值                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------- |
| 主题 | UI 测试直录 Playwright 脚本 + 引擎官方 runner 直执行                                                                   |
| 规格 | [UIT-003-playwright-script.md](./UIT-003-playwright-script.md)（Implemented，远端 CI 全绿 run 36844501785，待走查翻 Verified） |
| 背景 | 用户直提（2026-10-01）：AI 时代表单式步骤编排不满足要求；AI 助手直接产出标准 Playwright 脚本，平台须零改造收编并直执行 |

## 交付表

| 编号    | 规格 | 状态       | 交付物                                                                                                                                       |
| ------- | ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| UIT-003 | 同上 | **Implemented**（PR #38，**远端 CI 全绿** run 36844501785） | shared 契约 v6（ui_validate/ui-trace/脚本命令）+ db 迁移 + engine script-runner（官方 playwright test 子进程）+ web 双模式编辑器（CodeMirror 6）/粘贴导入/校验干跑/测试树+代码帧+trace 报告 + jmx 25 采样 + e2e 3 例；存量步骤模式零回归；随批根治：CI jmeter 作业补 playwright 浏览器安装（S11 起缺浏览器假绿）+ UIT-002 T2-5 补 status 断言 + jmx 轮询化（WhileController） |

## Backlog（非本 Sprint）

- API 自动补全/格式化（CodeMirror 扩展）——P2
- 内嵌 trace viewer 网页回放——P2
- AI 生成 UI 脚本（对接 AI-004）——P2
- 文件上传 .spec.ts / zip 批量导入——P2
