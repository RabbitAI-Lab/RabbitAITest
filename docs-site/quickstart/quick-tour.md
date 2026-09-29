# 快速体验

本章用约 10 分钟走完 RabbitAITest 的主链路：**登录 → 用例 → 接口调试 → Mock → 场景 → 测试计划 → 报告 → AI**。请先按[安装部署](quickstart/installation.md)完成启动。

## 1. 登录

打开 http://localhost:3000，使用默认管理员 `admin@rabbit.test / rabbit-admin-123` 登录。

<img src="_media/shots/login.png" alt="登录页">

登录后进入工作台首页：四张概览卡（用例总数 / 评审通过率 / 计划执行进度 / 缺陷待处理）与「我的待办 / 我关注的 / 我创建的」三个页签。详见[工作台](manual/workbench.md)。

## 2. 创建第一条功能用例

进入「测试管理 → 功能用例」：

1. 点击「新建用例」，填写名称、等级（P0-P3）、前置条件与步骤（描述 + 预期结果）。
2. 保存后在列表查看，也可切换到「脑图」模式（URL 带 `?view=mindmap`），以模块 → 用例 → 步骤三层树的方式编辑并保存。

<img src="_media/shots/case-list.png" alt="功能用例列表">

?> 已有存量用例？用「导入」向导（.xlsx / .xmind，兼容 MeterSphere 官方模板）三步完成迁移。详见[功能用例](manual/test-track/case.md)。

## 3. 调试一个接口

进入「接口测试 → 接口调试」：

1. 选择方法（HTTP 8 种）、输入 URL（相对路径将按所选环境域名拼接）、选择环境。
2. 在统一编辑器里补齐 Query / 请求头 / 请求体 / 认证，按需添加断言（状态码、JSONPath、正则、响应时间等 6 种）。
3. 点击「执行」，实时查看响应与断言结果。

<img src="_media/shots/debug.png" alt="接口调试">

调试满意后可以「另存为接口定义」，沉淀为团队的接口资产。

## 4. 为接口配置 Mock

在「接口测试 → 接口定义」打开某条接口的详情页，切换到 **MOCK** 页签：

1. 复制 Mock URL（形如 `{MOCK_PUBLIC_URL}/mock/{项目编号}{接口路径}`）。
2. 新建 Mock 规则（响应内容、延迟），保存即热更新，无需重启。
3. 直接用 curl 验证：

```bash
curl -i http://localhost:4000/mock/1/api/ping
```

详见 [Mock 服务](manual/api/mock.md)。

## 5. 编排一个自动化场景

进入「接口测试 → 接口场景」，新建场景并添加步骤：

- **request** 请求步骤（可从接口定义引用）
- **loop / condition / once** 循环、条件、仅一次控制器
- **script** 前后置脚本（quickjs 沙箱）/ **wait** 等待

<img src="_media/shots/scenario-editor.png" alt="场景编辑器">

保存后可单个执行，或勾选多个场景批量执行（串行 / 并行、失败停止开关）。详见[自动化场景](manual/api/scenario.md)。

## 6. 创建测试计划并执行

进入「测试管理 → 测试计划」：

1. 新建计划（可配置阈值判定、自动更新用例状态、允许重复关联）。
2. 在计划详情关联**功能用例 / 接口用例 / 场景**（三类混排），或先按「测试点」组织归组。
3. 执行：功能用例人工标记结果，接口与场景由引擎真实执行，统一时间线呈现。

<img src="_media/shots/plans.png" alt="测试计划">

## 7. 查看报告并导出

- 接口报告：在「接口测试 → 报告」查看事件流详情与 7/14/30 天统计。
- 计划报告：计划详情「报告」页查看通过率、进度、阈值判定，支持**一键总结**、**分享链接**（免登录只读）与导出 **PDF / CSV**。

<img src="_media/shots/report.png" alt="接口报告">

## 8. 试试 AI

- 「测试管理 → 功能用例 → AI 生成」：输入需求文本，勾选草稿一键导入（等级自动映射 P0-P3）。
- 顶栏 ✨ 图标打开**智能助手**：流式对话，内置「用例设计思路 / 接口故障排查 / 测试文档解读」等建议。

<img src="_media/shots/ai-assistant.png" alt="AI 智能助手">

AI 需要先在「系统设置 → 模型设置」配置模型供应商，详见 [AI 能力](manual/ai.md)。

## 下一步

- 按角色阅读功能手册：[测试管理](manual/test-track/case.md) · [接口测试](manual/api/overview.md) · [项目管理](manual/project/overview.md) · [系统设置](manual/system/users.md)
- 了解平台概念：[通用功能（权限与模块开关）](manual/common/overview.md)
- 遇到问题：[常见问题](faq.md)
