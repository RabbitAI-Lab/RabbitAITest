# rules/typescript.md — TypeScript 通用编码规范（全仓适用）

> 由 AGENTS.md §2 引用。React/Next.js 专项见 rules/react-nextjs.md；本文件覆盖全部 TS 代码（apps/* 与 packages/*）。

## 1. 编译与工具基线

1. `tsconfig.base.json` 全仓统一：`strict: true` + `noUncheckedIndexedAccess` + `noFallthroughCasesInSwitch`；禁止局部关闭（ts-ignore 禁用，`@ts-expect-error` 必须附原因注释）。
2. CI 先行 `tsc --noEmit`（typecheck 独立于 build）；lint 用 oxlint 规则集（含 import 边界规则），格式 oxfmt——**禁止手改格式**，格式问题一律 `pnpm format` 解决。
3. 依赖版本只改 package.json + lockfile 同 PR；禁止使用未在 tech-stack.md 登记的新框架级依赖（架构级决策）。

## 2. 命名

| 对象         | 规则                               | 示例                          |
| ------------ | ---------------------------------- | ----------------------------- |
| 文件/目录    | kebab-case                         | `case-ref.provider.ts`        |
| 类型/接口/类 | PascalCase；接口不加 I 前缀        | `ExecTask`、`SamplerConfig`   |
| 变量/函数    | camelCase；布尔 `is/has/can`       | `isDefault`、`hasLicense`     |
| 常量/枚举值  | SCREAMING_SNAKE                    | `TaskStatus.RUNNING`          |
| zod schema   | 与类型同名小写开头 + `Schema` 后缀 | `execTaskSchema` → `ExecTask` |

## 3. 类型纪律

1. 跨边界类型（API 请求响应、队列消息、事件帧、DB 写入）一律 `z.infer<typeof schema>` 推导，**手写 interface 仅限组件 props 与模块私有**。
2. 禁 `any`；`unknown` 必须显式收窄后才可使用；`as` 断言仅允许出现在边界处（第三方库返回、测试造数）并附注释。
3. 优先 `type` 表达联合/工具类型；`interface` 用于被扩展的对象形状；返回类型显式标注（公共函数）。

## 4. 错误处理

1. 业务错误统一 `DomainError(code, message, data?)`（错误码见 api-conventions §3）；禁止 `throw new Error('裸字符串')` 表达业务失败。
2. catch 分支禁止吞异常：要么处理（转 DomainError/记日志），要么显式 rethrow；空 catch 块直接拒绝。
3. async 入口（Route Handler/Action/BullMQ processor）必须有顶层错误收口（统一 500 信封 + 日志 + request id）。
4. 可预期失败（三方平台超时、断言失败）不抛异常走返回值/事件；异常只用于「不该发生」。
5. **无效/缺省参数禁止 500**：参数缺失、组合非法属于客户端错误，必须映射 404/422（api-conventions §3）——历史教训：可选参数缺省路径未处理导致 500，正确语义应是 404。

## 5. 模块与导入

1. import 顺序：node 内置 → 三方 → `@rabbit/*`（packages）→ 相对路径；自动排序交给 oxfmt。
2. 包边界（monorepo-structure §2）：`packages` 不依赖 `apps`；`engine/mock/plugin-runner` 不依赖 `web` 与 `db`；违反由 lint import 规则拦截。
3. 循环依赖零容忍（CI 检测 madge）；公共导出经各包 `index.ts` 收口，禁止深路径导入（`@rabbit/shared/execution/events` 允许按子路径导出，需在 package.json exports 登记）。

## 6. 函数与结构

1. 函数单一职责，超过 60 行考虑拆分；参数 >3 个收拢为对象；优先纯函数 + 依赖注入（便于单测）。
2. 禁止副作用藏在工具函数里（写库/发请求的函数必须从命名可见：`saveCase`/`dispatchTask`）。
3. 常量魔法值一律具名（尤其是超时、上限、状态字符串——从 packages/shared 导入）。

## 7. 注释与文档

1. 注释只写「为什么/约束/坑」，不写「做什么」（代码自解释）；翻译代码的注释 Review 时删除。
2. 公共 API（packages 导出、域服务函数）用 TSDoc（含 `@param/@returns` 与示例）；规格文档编号在实现处以 `// CASE-001 §4.2` 形式标注锚点。
3. TODO 必须带 issue/文档编号与负责人：`// TODO(zhang): CASE-008 需求关联未实现`。

## 8. 测试代码同标准

测试也是 TS：禁 any/穿透类型；fixture 工厂返回类型显式；用例命名与规格编号一致（rules/testing.md §1）。

## 9. 格式化（oxfmt 必装，2026-09-26 新增）

1. **oxfmt 是仓库必装工具链**：声明于根 `package.json` `devDependencies`（与 oxlint 同族）。S0 曾出现「format 脚本存在但 oxfmt 未安装」的工具链缺口，S1 收尾补齐——不允许再出现"命令在、工具缺"。
2. **自愈安装**：根 `format` 脚本在 oxfmt 缺失时自动 `pnpm install`（依赖已声明，安装即恢复）后再格式化——
   ```json
   "format": "oxfmt --write . || (echo \"[format] oxfmt 缺失，自动安装…\" && pnpm install && oxfmt --write .)"
   ```
3. **使用口径**：提交涉及 TS/TSX/JSON 的变更前跑 `pnpm format`；全仓基线为 oxfmt 默认风格（无自定义配置，升级 oxfmt 大版本时全仓重跑一次并独立提交）。
4. CI 现状仅 lint 门禁（oxlint）；format 不阻塞合并，但走查发现格式漂移按本节回改。
