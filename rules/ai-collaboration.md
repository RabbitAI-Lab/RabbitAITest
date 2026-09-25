# rules/ai-collaboration.md — AI 协作开发规范

> 本项目以 AI 辅助开发为主要生产方式（RabbitAI-Lab 工作流）。本文件约束「人 + AI」协作的义务与红线，人与 AI 会话同等适用。

## 1. 会话冷启动义务

1. 任何 AI 会话开工前必须按 AGENTS.md §6 顺序读完：AGENTS.md → 当前规格 → 对应 rules（编码前 react-nextjs/typescript/database，引擎 engine，测试 testing）。
2. AI 在回答中引用依据时必须带文档编号与章节（如「CASE-001 §4.2」「rules/database.md §6.2」），禁止凭记忆断言本项目约定——不确定就查文件。

## 2. AI 生成代码红线

1. **禁止幻觉 API**：只能使用 `packages/api-client` 生成客户端、`packages/shared` 的 zod schema 推导类型与本项目既有服务函数；不确定接口是否存在时，先查 packages 源码而不是编造调用。
2. **禁止绕过门禁**：AI 不得以「先写个雏形」为由跳过高保真确认、规格文档、测试交付；门禁未满足时应停下来向人申请决策，而不是自行推进。
3. **禁止静默降级**：做不到的（某断言无法实现、某依赖缺失）必须如实报告并给替代方案；禁止删除断言、跳过测试、放宽 lint 让任务「看起来完成」。
4. 遵守全部 rules：生成代码与手写代码同一标准（types/security/database/…），Review 不因 AI 生成而放宽。

## 3. 任务拆解与提交

1. AI 一次会话只做一个功能点（对应一份规格的一个可交付切片）；切片划分以规格 §7 交付清单为准。
2. 每个切片产出顺序固定：schema/契约 → 域服务 + 单测 → API + jmx → UI + spec（三类断言）→ 文档状态流转；未完成全链路不算「完成」（AGENTS.md 门禁 7）。
3. commit 由 AI 起草、人确认后提交；commit message 说明「为什么」并在 body 注明对应规格编号。

## 4. 验证义务（交付前自查清单）

AI 交付前必须实际执行并附结果（禁止声称「应该能过」）：

```
pnpm lint && pnpm typecheck && pnpm test
pnpm test:api   # 涉及 API 变更
pnpm test:e2e   # 涉及 UI 变更（新用例单跑）
```

- 有失败必须修复或如实上报阻塞点；覆盖率/断言缺失要在交付说明中列明。
- **push 后跟踪远端 CI**：代码 push 到 GitHub 后必须跟踪 Actions 运行结果直至全绿（AGENTS.md 门禁 9）；远端挂了必须修复或如实上报，禁止「本地过了就算完成」。
- **Sprint 收尾协助**：Sprint 结束时按 rules/git-workflow.md §8 完成推送、CI 确认、状态流转与交接说明。
- 交付说明固定结构：做了什么（对应规格条目）/ 怎么验证（命令+结果+远端 CI 状态）/ 未覆盖与原因 / 需要人决策的事项。

## 5. 人的职责（不可下放）

1. 高保真原型的**人工确认**（AGENTS.md 门禁 2）与验收（规格 §7）——AI 不得代替确认。
2. 架构级决策（技术栈、schema 变更、权限模型、契约变更）与 ENTP/License 相关功能。
3. 合并前 Review（rules/git-workflow.md §4 checklist）与发布。

## 6. 上下文管理

1. 长任务（跨多会话）以规格文档 + sprint-overview 为状态载体，会话开始先读文档状态字段，结束前更新状态——禁止把关键状态只留在对话里。
2. 大范围重构前先让 AI 产出影响面清单（涉及文件/契约/migration/测试），人确认后再动手。
3. 会话产物（原型、迁移、契约变更）一律落盘到仓库对应目录，对话内容不作为交付物。
