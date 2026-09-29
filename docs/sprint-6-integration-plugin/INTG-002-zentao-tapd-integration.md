# 禅道 / TAPD 对接（平台适配器 ×2）

| 元信息项     | 内容                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| 文档编号     | INTG-002                                                                                                          |
| 所属迭代     | Sprint 6 — 集成与插件                                                                                             |
| 优先级       | P2（迭代内）                                                                                                      |
| 所属模块     | 组织设置（org 域）+ 缺陷管理（bug 域）+ 插件运行时                                                                |
| 文档状态     | Implemented（2026-09-27 交付：代码+单测+JMeter+Playwright 全绿、CI 六作业全绿；高保真走查随验收）                 |
| 最后更新日期 | 2026-09-27                                                                                                        |
| 上游依赖     | INTG-001（集成编排/加密/同步状态机全复用）、PLUG-001                                                              |
| 下游消费     | S7（同步数据分析）                                                                                                |
| 上游依据     | 需求文档 §二「三方同步：Jira/禅道/TAPD」；功能清单 §8.4 禅道（GET/PATH_INFO 请求型）、TAPD                        |
| 对标基线     | 功能清单 §8.4/§9.2 服务集成：禅道/TAPD 插件为**社区版**（与 Jira 企业版口径对照）；§七 双向同步                   |
| 关联架构文档 | plugin-architecture.md（PlatformPlugin SPI 单一接口多平台适配）；INTG-001 §4（端点/模型/权限全部复用）            |
| 高保真确认   | 待确认（原型 docs/design/INTG-001-jira-integration/ 三平台卡片共用布局——禅道/TAPD 复用同原型，配置抽屉差异见 §3） |
| 工作量估算   | 插件 4 人日 / 后端 1 人日 / 前端 1 人日                                                                           |

## 1. 概述

### 1.1 功能定位

在同一 PlatformPlugin SPI 与 INTG-001 全部编排（组织集成/项目关联/推送拉取/定时/留痕）之上，交付禅道与 TAPD 两个平台适配器。本规格工作量集中于**适配器与平台差异**，编排层零新增。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                                                                                                             | P1 ✅  | 后续                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| 禅道适配器：REST（GET 请求型）模式——address+account+password；token 会话（POST user-login 取 token）                                                             | ✅     | PATH_INFO 请求型（基线列两型，REST 先行，登记）                 |
| 禅道方法：testConnection（get-user-info）/createIssue（bug-create）/updateIssue/syncBugs（bug-list by product+日期）                                             | ✅     | 需求/工单同步（基线缺陷先行）                                   |
| TAPD 适配器：Basic Auth（api_user/api_password）；testConnection（auth verify）/createIssue（/bugs）/updateIssue/syncBugs（/bugs by workspace_id+modified）      | ✅     | —                                                               |
| 平台标识注册：platform ∈ jira                                                                                                                                    | zentao | tapd（Plugin.kind=platform，name 区分）；组织集成页三卡片全可用 | ✅  | 更多平台（飞书等，基线个人账号绑定范围） |
| 差异字段映射：禅道 product 为项目关联键（projectKey=product id）；TAPD workspace_id 同义；状态映射表各自内置默认（禅道 closed/resolved、TAPD resolved/rejected） | ✅     | —                                                               |
| 编排复用：加密/测试连接/推送拉取状态机/定时/同步历史/断链保护——INTG-001 原样                                                                                     | ✅     | —                                                               |

### 1.3 前置依赖

INTG-001 全量（本规格不重复建模：PlatformIntegration.platform 直接取 zentao|tapd）。

### 1.4 对标基线核对

复刻：禅道/TAPD 社区版插件口径（本项目均标准版）；服务集成配置+测试连接+双向同步。简化：①禅道仅 GET 请求型（PATH_INFO 型登记，基线列两型）；②平台 API 版本取主流稳定版（禅道 REST v1、TAPD v1），旧版本兼容登记 Backlog；③评论/附件同步延后（与 Jira 同批登记）。

## 2. 业务逻辑

- **禅道会话**：testConnection 与业务方法统一先 `POST /api.php/v1/tokens`（account+password）取 token（TTL 60min，插件内存缓存，401 失效重登一次）；后续 `GET/POST /api.php/v1/{res}` 带 `Token: {token}`。
- **项目键语义**：projectKey——jira=project key、zentao=product id、tapd=workspace_id（同一列不同平台语义，关联表单 placeholder/校验正则随平台）。
- **状态映射默认表**：zentao（active→进行中/resolved→已解决/closed→已关闭）；tapd（new→进行中/in_progress→进行中/resolved→已解决/rejected→已关闭/closed→已关闭）；项目关联配置可覆盖（INTG-001 同一覆盖机制）。
- **字段映射**：title→title/summary、description→steps/description；自定义字段按平台标识直传（zentao 字段名直传，tapd custom_field.* 包装——适配器内消化）。
- **拉取增量**：jira JQL updated / zentao lastEditedDate / tapd modified——统一 `syncBugs({projectKey, since})` SPI 签名，适配器翻译为各自过滤参数。

## 3. UI/UX 设计（复用 INTG-001 原型）

- 服务集成页三卡片中禅道/TAPD 卡片启用（图标+状态同布局）。
- 配置抽屉差异：禅道=地址+账号+密码（无认证方式单选）；TAPD=地址+api_user+api_password；测试连接成功分别展示「姓名（禅道用户）/邮箱（TAPD 用户）」。
- 项目关联表单：projectKey 标签随平台切换（禅道=产品 ID、TAPD=项目 ID）。
- 缺陷列表平台徽标扩展 ZENTAO/TAPD 两色。

## 4. 技术架构

- **插件**：`plugins/zentao-platform/`、`plugins/tapd-platform/`（各 ~200 行：五方法+会话/字段翻译）。
- **web**：`integration.service`/`platform-sync.service` 平台分支零改动（platform 字段透传）；唯一改动=关联表单/占位文案的平台元数据表 `PLATFORM_META`（label/projectKeyLabel/authFields）于 shared。
- **端点/权限/错误码**：全部复用 INTG-001（70010-70015 平台无关）。
- **mock 扩**（e2e）：apps/mock 增 `/mock-zentao/*`、`/mock-tapd/*`（token/bug CRUD 最小面）。

## 5. 测试用例

- INTG-002-T1（jmx 四类）：禅道集成 PUT+测试连接（mock）/TAPD 同；401/403/404/422 同 INTG-001 口径（抽样两平台各一条）。
- INTG-002-T2（spec 禅道端到端）：配置→关联（product id）→推送 Bug→mock 返回 id→回写断言→拉取状态 resolved→本地「已解决」。
- INTG-002-T3（spec TAPD 端到端）：同 T2（workspace 语义+Basic Auth 路径）；token 失效自动重登一次（mock 401 一次后 200）。
- 单测：禅道 token 缓存/重登、三平台状态映射默认表、projectKey 平台语义校验、字段翻译（tapd custom_field 包装）。

## 6. 竞品深度对标

与 INTG-001 同构复刻。差异：禅道 PATH_INFO 请求型登记延后；平台旧版本兼容登记；需求同步不做（基线禅道/TAPD 有需求联动，本项目需求关联整体在用例侧 CaseDemandRef 本地口径，三方需求同步登记 Backlog）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认（复用 INTG-001 原型走查禅道/TAPD 卡片与抽屉）。联调点：mock 平台与适配器契约（token 流/分页游标）。

## 8. 勘误登记

（暂无）
