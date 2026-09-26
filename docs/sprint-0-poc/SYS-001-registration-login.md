# 注册登录与会话

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | SYS-001 |
| 所属迭代 | Sprint 0 — POC |
| 优先级 | P0 |
| 文档状态 | Verified（用户验收通过 2026-09-26） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | INFRA-001/003 |
| 下游消费 | SYS-002/003、全部需登录功能 |
| 上游依据 | 需求文档 M1；功能清单 §九.1 用户管理（P0 仅注册登录子集） |
| 对标基线 | 功能清单 §九：MeterSphere 由管理员创建/邀请用户，无开放注册——本项目 POC 简化为开放注册（超出基线，为演示效率；正式用户管理 SYS-004 在 Sprint 1） |
| 高保真确认 | 待确认（docs/design/SYS-001-registration-login/） |

## 1. 概述

邮箱+密码注册、登录、退出；Argon2id 存储；iron-session 加密 Cookie 会话。注册成功即触发 SYS-003 默认组织/项目初始化（同事务）。

### 范围边界
✅：注册（邮箱唯一校验、密码≥8 位）、登录、退出、GET me、错误码（10101 邮箱已存在 / 10102 凭据错误 / 10001 未登录）。
❌：邮箱验证、忘记密码、邀请、用户管理页（Sprint 1 SYS-004）、SSO（ENTP）。

## 2. 业务逻辑

注册：校验 → 查重 → Argon2 hash → 事务[User + SYS-003 初始化] → 建会话。
登录：查 User（status=ACTIVE）→ verify → 建会话。会话 cookie：httpOnly/Secure( prod)/SameSite=Lax/7d。
退出：销毁会话。连续失败不限流（P0；QA-002 补）。

## 3. UI/UX 设计（高保真 docs/design/SYS-001-registration-login/index.html）

- `/login` 与 `/register` 双卡片表单（邮箱/密码/确认密码），错误就地红字（透出服务端 code 对应文案）
- 登录成功跳 `/`（工作台占位→项目用例页）；未登录访问受保护页由 SYS-002 跳 `/login?next=`
- 空态：按钮 loading 态防重复提交

## 4. 技术架构

- API：`POST /api/v1/auth/register` `{email,password}` → `{user, projectId}`；`POST /api/v1/auth/login`；`POST /api/v1/auth/logout`；`GET /api/v1/personal/me`
- server/domains/system/auth.service.ts；密码 @node-rs/argon2（Argon2id 默认参）
- 会话：iron-session（cookie 名 `ras`，secret=SESSION_SECRET env）；SessionContent `{userId, email}`
- 审计：注册/登录/登出记 AuditLog（withAudit）

## 5. 测试用例
- SYS-001-T1（jmx）：注册 200+code0+返回 projectId；重复注册 10101；登录错误密码 10102；me 未登录 401(10001)
- SYS-001-T2（spec）：注册→自动登录跳转（UI 断言顶栏用户名；Console 断言零错误；接口断言 register/login 响应体）；登出后再访问受保护页跳 login

## 6. 竞品深度对标
MeterSphere 管理员建号模式 → 开放注册（POC 简化，Sprint 1 恢复完整用户管理）；Argon2id/会话策略与其「密码 Argon2、Session 保持」基线一致。

## 7. 里程碑与验收
验收标准 2 前半：注册→登录→默认项目可见。
