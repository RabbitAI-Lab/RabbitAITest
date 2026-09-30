# 认证与授权（企业版）

RabbitAITest 分社区版与企业版两个 edition。**ENTP-009（2026-09-30）起开源全功能：License 不再门控任何功能**——本页所有特性无 License 即可用，授权管理页仅作授权信息登记；企业发行版可设 `RABBIT_FEATURE_GATE=1` 恢复下述门控口径（此时未授权以社区版运行、特性关闭）。

> 所需权限：授权管理要求系统级 License 管理权限；多组织管理要求 ENTP_ORG:READ / ENTP_ORG:CREATE / ENTP_ORG:UPDATE / ENTP_ORG:DELETE。

## 授权管理

路径：`/system/license`（系统 › 授权管理，企业版功能总开关）。

- **状态卡**：展示当前 edition（社区版 ⇄ 企业版）与授权信息；
- **功能矩阵**：逐项列出六特性及当前授权开关状态；
- **添加/移除授权**：导入企业版 License 后特性即时启用；移除授权即回退社区版（多组织/SSO/多资源池等将锁定，现有数据保留）；
- **到期提示**：临期显示黄色提示条（将于 N 天后到期）；已过期显示红色提示条，企业功能锁定、数据保留。

## 六项企业特性

| 特性 key     | 名称               | 能力入口                                                     |
| ------------ | ------------------ | ------------------------------------------------------------ |
| MULTI_ORG    | 多组织管理         | `/system/orgs` 组织管理（ENTP_ORG 权限）                      |
| SSO          | 单点认证 + 扫码登录 | `/system/sso` 认证配置（8 类认证源）与登录页扫码              |
| MULTI_POOL   | 多资源池           | `/system/pools` 多池 CRUD/组织范围/启停，见[资源池](manual/system/pools.md) |
| THEME        | 自定义主题品牌     | 系统参数 theme 组（品牌名/Logo 等），见[参数设置](manual/system/params.md) |
| MSG_TEMPLATE | 自定义消息模板     | 消息管理 Tab3 模板，见[消息管理](manual/project/message.md)   |
| USER_SCALE   | 用户扩容与部门     | 突破社区版 30 用户上限；部门管理 `/org/departments`           |

## 单点认证（SSO）

路径：`/system/sso`（系统 › 认证配置）。支持 8 类认证源：

| 类型    | 说明                                           |
| ------- | ---------------------------------------------- |
| LDAP    | 目录认证（host/port/bindDn/userOu 等；filterKey 支持 uid / sAMAccountName / cn） |
| CAS     | CAS 协议                                       |
| OIDC    | OpenID Connect                                 |
| OAuth2  | OAuth 2.0                                      |
| SAML    | 协议枚举已预留，页面标记「未实现」，暂不可选     |
| WECOM   | 企业微信扫码                                   |
| DINGTALK| 钉钉扫码                                       |
| FEISHU  | 飞书扫码                                       |

配置要点：

- **属性映射**：username 与 email 的 IdP 属性键名必填（name 可选），决定登录后账号的归属字段；
- **LDAP 登录**：配置 LDAP 后，登录页出现「账号登录 / LDAP 目录登录」双 Tab；
- **SSO 登录**：登录页「更多登录方式」提供 SSO（OIDC/OAuth2/CAS）入口。

## 扫码登录

企业微信 / 钉钉 / 飞书三类扫码登录归入 SSO 特性位：在 `/system/sso` 完成对应扫码源配置后，登录页「更多登录方式」出现扫码入口，扫码完成即登录/自动建号。

## 主题品牌

THEME 特性解锁系统参数 theme 组的完整定制：品牌名、Logo（dataUrl，二进制上限 200KB）等，全平台界面即时生效。

## 多组织与部门

- **多组织**（MULTI_ORG）：`/system/orgs` 管理多个组织，实现一套部署多团队隔离；社区版单组织运行。
- **部门**（USER_SCALE 配套）：`/org/departments` 组织 › 部门管理，左树右表维护部门树与人员归属。

## 用户扩容

社区版默认 30 用户上限（容量进度条见[用户管理](manual/system/users.md)）。USER_SCALE 授权后：

- 不限额授权：用户数不受 30 限制（页面显示「授权上限不限」）；
- 封顶授权：按 License 声明的 maxUsers 上限控制。

## 边界与注意事项

- 六特性在社区版**全部关闭**：相关页面/入口不出现或明确标注企业版，按 License 授权逐项开启。
- 授权过期或移除后企业功能锁定，但**已产生的数据（多组织、模板、部门等）保留**，重新授权即可恢复使用。
- SAML 认证源当前为预留枚举，页面不可选；如需对接请关注后续版本。
- 认证源配置含客户端密钥等敏感信息，保存后不回显，编辑留空表示不变。

## 相关链接

- [用户管理](manual/system/users.md)
- [资源池](manual/system/pools.md)
- [消息管理](manual/project/message.md)
- [参数设置](manual/system/params.md)
