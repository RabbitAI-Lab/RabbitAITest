# 自定义主题与品牌定制（界面设置 · 实时预览 · 全站应用）

| 字段         | 内容                                                                                                                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | ENTP-004                                                                                                                                                                                                                                 |
| 所属迭代     | Sprint 9 — 企业版核心                                                                                                                                                                                                                    |
| 优先级       | P3（迭代内 P1）                                                                                                                                                                                                                          |
| 所属模块     | system 域（theme 参数组）+ 全站前端（ConfigProvider/登录页/TopBar）；engine/mock 不感知                                                                                                                                                  |
| 文档状态     | Implemented（2026-09-28 交付：代码+单测+JMeter+Playwright 全绿；走查随验收）                                                                                                                                                             |
| 最后更新日期 | 2026-09-28                                                                                                                                                                                                                               |
| 上游依赖     | SYS-005（SystemParam 组模式/params 页 Tab 先例）、ENTP-007（THEME 特性门控）、S0 UI 基线（#574BFF/antd token 集中 providers.tsx）                                                                                                        |
| 下游消费     | —（品牌定制影响全站视觉）                                                                                                                                                                                                                |
| 上游依据     | 需求文档 §三 M10；功能清单 §十 系统参数-【企业版】界面设置、§十二 12.3 自定义主题/品牌定制                                                                                                                                               |
| 对标基线     | 功能清单 12.3：入口=系统设置-系统-系统参数-界面设置；主题色、平台风格（背景色可跟随主题色）；登录页定制（网站 Icon、登录 Logo、背景图、Slogan、网站名称，实时预览）；平台设置（平台 Logo、平台名称、帮助文档地址）；恢复默认、保存并应用 |
| 关联架构文档 | test-domain-model.md（SystemParam 键值复用零新表）；rbac-permission-model.md §6（THEME）                                                                                                                                                 |
| 高保真确认   | 待确认（原型 docs/design/ENTP-004-custom-theme-branding/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                                                                                                                   |
| 工作量估算   | 后端 0.5 人日 / 前端 2.5 人日 / 联调 0.5 人日                                                                                                                                                                                            |

## 1. 概述

### 1.1 功能定位

SystemParam 新增 `theme` 组，系统参数页新增「界面设置」Tab（License 门控）：主题色/背景跟随/登录页五项（Icon/Logo/背景图/Slogan/网站名称）/平台三项（Logo/名称/帮助地址），左侧表单右侧**实时预览**，恢复默认+保存并应用；公开端点 `GET /public/theme` 驱动全站（antd token 主色、CSS 变量、登录页/顶栏品牌、document title）。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                                            | P1 ✅ | 后续                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| theme 参数组：primaryColor(hex)/followPrimary(背景跟随)/siteName/slogan/loginLogo/loginBg/icon（dataUrl≤200KB）/platformName/platformLogo/helpUrl；默认值=现状                  | ✅    | 多主题套包/暗色模式/租户级主题 Backlog                                                         |
| 界面设置 Tab：分区表单（基本/登录页/平台）+图片上传（本地→base64，≤200KB 校验 422）+实时预览画板                                                                                | ✅    | 素材库与对象存储托管 Backlog（dataUrl 内联为单机简化）                                         |
| 全站应用：antd ConfigProvider colorPrimary 动态；`--rabbit-primary` CSS var 注入（globals 根级）；登录页 Logo/Slogan/背景/名称；TopBar 平台 Logo/名称；metadata title；帮助链接 | ✅    | 存量散落硬编码色值全量迁 CSS var（本迭代覆盖主按钮/链接/选中态/登录页/导航，其余分批 Backlog） |
| 公开端点 `GET /public/theme`（无鉴权，未配置返回默认——登录页可用）                                                                                                              | ✅    | 主题版本缓存etag Backlog（响应 no-store 简化）                                                 |
| 恢复默认：一键回默认值并应用（等价写默认 JSON）                                                                                                                                 | ✅    | —                                                                                              |
| 门控：PUT theme 组经 THEME 特性；GET/公开端点不门控（社区版读默认）                                                                                                             | ✅    | —                                                                                              |

### 1.3 前置依赖

- SystemParam 键值表零新表（`theme` 一组 Json）
- providers.tsx 集中 token（现状唯一改色点）+ globals.css 根级（CSS var 注入点）
- SYS-005 params 页 Tab 结构（新增第五 Tab 兼容既有四组）

### 1.4 对标基线核对

完全复刻：入口位置✓ 主题色+背景跟随✓ 登录页五项定制+实时预览✓ 平台三项✓ 恢复默认/保存并应用✓。简化实现：图片内联 dataUrl≤200KB（基线上传对象存储——单机部署内联免存储依赖，登记）；预览为同页画板（基线「实时预览」语义一致）。

## 2. 业务逻辑

- **参数形状**：`themeSchema` zod；primaryColor 正则 `^#[0-9a-fA-F]{6}$`；图片字段为 dataUrl（`data:image/(png|jpeg|svg+xml);base64,`前缀校验）或空串=用默认。
- **读写**：readParam("theme") 合并默认（与 SMTP 同模式）；PUT 校验+审计 `param.theme.update`；门控在 PUT 路由（THEME 特性）。
- **应用链路**：根 layout（服务端）读 public/theme → 注入 `<style>:root{--rabbit-primary:X}</style>` + 传 themeConfig 给 Providers（client）；登录/注册页（服务端组件取数传 props）；TopBar 读同源缓存（React cache 单请求内）。
- **缓存语义**：公开端点 `Cache-Control: no-store`（S5 假绿教训——主题变更即时生效）。
- **恢复默认**：PUT 默认 JSON（不删除键，简化幂等）。

## 3. UI/UX 设计（高保真 docs/design/ENTP-004-custom-theme-branding/）

- 画板一（界面设置 Tab）：左表单三折叠区（基本：主题色取色器+背景跟随开关；登录页：网站名称/Slogan/Icon 上传/Logo 上传/背景图上传；平台：平台名称/Logo 上传/帮助文档地址）+右预览画板（登录页缩略预览+顶栏条预览，随表单即时变化）；底部「恢复默认」「保存并应用」。
- 画板二（定制后登录页效果）：品牌示例（自定主题色登录按钮+自定 Logo+Slogan+背景图+浏览器标签 title=自定网站名称）。
- 空态/二态：社区版（Tab 禁用态+锁提示——Tab 可见不可写，与基线「界面设置=企业版」一致）；未定制（全默认=现状视觉）；超限图片（红字「图标不能超过 200KB」）。

## 4. 技术架构

- 数据模型：零新表（SystemParam `theme` 组）。
- 契约：`packages/shared/src/system/schemas.ts` 扩展 `themeParamSchema` 并入 `paramGroupSchema` 判别联合；`themePublicSchema`。
- 端点：`GET/PUT /api/v1/system/params/{group}` 既有（group=theme 走新分支）；`GET /api/v1/public/theme`（无鉴权）。
- 服务：param.service 扩展（DEFAULTS.theme/校验/no-store）；`theme.server.ts`（服务端取数+缓存）。
- 前端：params/page.tsx 第五 Tab「界面设置」（license 态：无 THEME 特性→表单禁用+锁条）；`Providers` 接收动态 token；`login/register/page.tsx` 品牌块动态化；`TopBar` Logo/名称/帮助链接动态化；`app/layout.tsx` 服务端注入 CSS var+title；globals.css `--rabbit-primary` 消费（登录渐变/LeftNav active 等本批替换点）。
- 错误码：复用 20422（校验）+90001（门控）；图片超限 422 `THEME_IMAGE_TOO_LARGE 90060`（90xxx 段 9006x 主题小节）。
- 审计：param.theme.update。

## 5. 测试用例

- ENTP-004-T1（jmx 四类）：theme 读写主链（PUT 定制→GET 回显→public/theme 反映）；401/403（无点/无 License 90001）；422（色值非 hex/图片>200KB 90060/dataUrl 前缀错）；public 端点无鉴权+no-store 头断言。
- ENTP-004-T2（spec 主链路）：加 License → 界面设置改主题色+网站名称+Slogan → 预览画板即时变化 → 保存并应用 → 登出后登录页品牌生效（按钮色/Logo 位/Slogan/title）→ 控制台顶栏平台名生效 → 恢复默认（UI+Console+接口）。
- ENTP-004-T3（spec 二态）：社区版 Tab 禁用+PUT 403；未定制登录页=默认视觉；自定义后 public/theme 与页面渲染一致。
- 单测（`packages/shared/src/__tests__/s9-theme.test.ts`）：themeSchema 校验矩阵（hex/dataUrl/超限）；默认合并；public 形状。

## 6. 竞品深度对标

基线 12.3 核对：入口✓ 主题色/背景跟随✓ 登录页五项+实时预览✓ 平台三项✓ 恢复默认/保存并应用✓。差异：①图片内联 dataUrl（基线对象存储——单机简化登记）；②背景跟随实现为页面背景色取主题色浅化（基线「平台风格」语义对齐）；③存量硬编码色值分批迁移（本迭代主视觉面）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（走查随验收）。契约冻结点：themeSchema+public/theme。联调点：服务端注入与客户端 token 链（SSR 一致性）。验收=§5 全绿+概览主线「主题」段。

## 8. 勘误登记

无。
