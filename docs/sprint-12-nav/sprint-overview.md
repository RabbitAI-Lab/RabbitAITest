# Sprint 12 — 全局导航改版（SYS-010）

| 项     | 值                                        |
| ------ | ----------------------------------------- |
| 主题   | 三域导航 + 浏览器式多标签页 + 侧栏折叠/收起 |
| 规格   | [SYS-010-nav-refresh.md](./SYS-010-nav-refresh.md)（Approved；高保真九轮交互确认） |
| 背景   | 用户反馈导航平铺/主色滥用/观感原始；原型方向 A 经十轮走查收敛 |

## 交付表

| 编号    | 规格 | 状态         | 交付物                                                                     |
| ------- | ---- | ------------ | -------------------------------------------------------------------------- |
| SYS-010 | 同上 | Implemented（随 PR 登记） | `lib/nav-config.tsx`、`stores/tabs.ts`、`TabBar.tsx`、`LeftNav.tsx` 三域重构、`TopBar.tsx` 域入口、`NavShell.tsx`、layout 接入、Vitest 15 例、e2e SYS-010 7 例 + 6 文件适配 |

## 交付时随批 UI 修复（用户报障，同 PR）

帮助链接兜底换文档站、6 页查询 Input 宽度（antd className 坑）、缺陷页表格列宽/折行、Tailwind v4 默认边框色黑边（111 处全局恢复）、space-y 被antd 无层样式压制（全局裸规则）、ai-prompts 一体式 Tabs、oauth/device 间距、cases 视图条滚动条。

## Backlog（非本 Sprint）

- 多标签页保活（react-activation）与表单防误关二次确认——P2
- antd `StyleProvider layer` 全局层叠根治——独立技术债评估
