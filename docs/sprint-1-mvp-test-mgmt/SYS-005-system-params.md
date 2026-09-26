# 系统参数（基础/SMTP/文件限制/数据清理）

| 元信息项 | 内容 |
| --- | --- |
| 文档编号 | SYS-005 |
| 所属迭代 | Sprint 1 — 测试管理 MVP |
| 优先级 | P1 |
| 所属模块 | 系统设置（system 域） |
| 文档状态 | Implemented（2026-09-26 代码合并：单测 49 + JMeter 11 计划 + Playwright 38 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-26 |
| 上游依赖 | SYS-004（仅系统管理员可配置）、INFRA-002（BullMQ 可用） |
| 下游消费 | SMTP → Sprint 5 消息通知（MSG-001）；文件限制 → BUG-001 附件上传；数据清理 → 全域变更历史/日志清理 |
| 上游依据 | 需求文档 M1（系统参数）；功能清单 §9.1（系统参数四组配置） |
| 对标基线 | 功能清单 §9.1：基础配置（站点 URL）、SMTP 邮件、文件大小限制、数据清理（日志/变更历史保留时长） |
| 关联架构文档 | rules/security.md（密钥加密存储）、rules/observability.md |
| 高保真确认 | 待确认（原型已产出 docs/design/SYS-005-system-params/，人工确认待 Sprint 验收走查——不可由 AI 代签，见 ai-collaboration §5） |
| 工作量估算 | 后端 2.5 人日 / 前端 1.5 人日 / 联调 1 人日 |

## 1. 概述

### 1.1 功能定位
系统级运行参数的单一来源：站点 URL（分享链接拼装）、SMTP（后续邮件通知）、上传上限、保留时长驱动的定时清理。`config.ts` 只读消费，杜绝散落硬编码。

### 1.2 范围边界

| 能力 | P1 ✅ | 后续 |
| --- | --- | --- |
| 基础：站点 URL（必填校验）、默认登录页横幅文案 | ✅ | 显示设置/界面主题（ENTP-004） |
| SMTP：主机/端口/账号/密码/SSL/TLS/发件人 + 测试连接 | ✅ | 邮件模板（ENTP-005）、真实通知投递（MSG-001） |
| 文件大小限制：全局默认（MB），缺陷附件等统一读取 | ✅ | 按场景差异化上限 |
| 数据清理：日志保留天数、变更历史保留天数；每日 03:00 清理 job | ✅ | 手动立即清理、清理报告 |

### 1.3 前置依赖
无阻塞；SMTP 密码与站点 URL 变更走 security.md 密钥规范（AES-GCM 加密落库）。

### 1.4 对标基线核对
完全复刻四组参数。简化实现：基线「显示设置」中企业版部分不做；测试连接对齐。

## 2. 业务逻辑

- 保存即生效（无发布概念）；SMTP 测试连接 = nodemailer verify()，结果与错误明细回显，不落历史。
- 清理 job（BullMQ repeatable daily 03:00 系统时区）：删除 `ChangeLog.ts < now-保留天数` 与操作日志超期记录；按 5000 条分批；记录清理计数到结构化日志。
- 保留天数下限 7 天（防误配 0 导致全清）；站点 URL 变更后新分享链接即时采用新域名。

## 3. UI/UX 设计（高保真 docs/design/SYS-005-system-params/）

系统设置 › 参数：Tab 分区（基础/邮箱/文件/数据清理），每区独立「保存」；SMTP 区含「测试连接」按钮（loading→成功绿点/失败红点+错误信息）；数据清理区展示「上次清理时间与清理量」（只读）。

## 4. 技术架构

- 数据模型（已建齐）：SystemParam(key 唯一, value JSONB, encrypted bool)。
- 端点：`GET /api/v1/system/params`（脱敏返回 SMTP 密码为 `******`）、`PUT /api/v1/system/params/{group}`（group ∈ basic/smtp/file/cleanup）、`POST /api/v1/system/params/smtp/test`。
- zod：smtpSchema(host/port/user/pass/ssl/from)、cleanupSchema(≥7)、fileLimitSchema(1-1024MB)。
- 权限点：SYSTEM_PARAM:UPDATE（读随菜单）。
- 前端：表单分区组件；TanStack Query invalidate ['system','params']。

## 5. 测试用例
- SYS-005-T1（jmx 四类）：读参数、更新基础组、SMTP 测试端点；401/403/422（保留天数 0 拒绝）；信封。
- SYS-005-T2（spec）：更新站点 URL → 分享链接前缀变化（UI+接口断言）；保存非法 SMTP 端口前端校验拦截（Console 零错误）。
- 单测：清理 job 的边界（恰好 7 天/超期分批）、加密往返。

## 6. 竞品深度对标
基线 §9.1 参数四组完全对齐；差异：基线 SMTP 支持多场景邮件（企业模板化），本项目 P1 仅配置+测试连接，投递面在 MSG-001（通知渠道统一）再开。数据清理对齐「日志/变更历史」两项。

## 7. 里程碑与验收
DoD 前置：高保真人工确认。验收：参数保存生效、测试连接可用、清理 job 在测试库验证删除超期记录。
