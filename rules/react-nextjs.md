# rules/react-nextjs.md — React 19 / Next.js（App Router）编码规范

> 适用于 `apps/web` 与所有 packages；由 AGENTS.md §2 引用，违反项按 Code Review 阻塞处理。

## 1. Server / Client 边界

1. 组件**默认 Server Component**；仅交互组件（useState/useEffect/事件）加 `'use client'`，且尽量「叶子化」——把 client 边界压到最小节点，禁止整页 `'use client'`。
2. `apps/web/src/server/**` 只允许被 Server Component、Route Handler、Server Action 引用；client 组件**禁止** import 任何 `src/server` 代码。
3. 重型库（@antv/x6、Monaco、AntD 日期等）必须 `next/dynamic` 动态导入并配置 loading 态。

## 2. 数据获取与变更

1. **读数据**：Server Component 内直接调用 `src/server/domains/*` 服务函数（跳过 HTTP）；客户端交互态用 TanStack Query + `packages/api-client`。
2. **禁止手写 fetch/axios 直连 `/api/v1`**：前端一律使用 api-client 生成的方法（AGENTS.md 门禁 4）。
3. **变更数据**：表单类变更优先 Server Action（`'use server'`）；需要乐观更新/复杂交互的走 api-client + TanStack Query mutation。
4. Server Action 内必须复用与 Route Handler 相同的 zod 入参校验与权限包装，禁止「Action 里裸写逻辑」绕过 `withPermission`。

## 3. Route Handler（API 层）

1. 路径只出现在 `src/app/api/v1/**/route.ts`，遵循 api-conventions.md（信封、错误码、分页、软删除、幂等）。
2. 每个 handler 的组装顺序固定：`withAuth → withPermission(权限点) → withProjectScope → withAudit` → zod parse → domain 调用 → `ok(data)` / `fail(code)`。
3. 一律 Node runtime（`export const runtime = 'nodejs'`），禁止 edge runtime（embedded-postgres/Prisma 依赖）。
4. 入参/出参 schema 定义在 `packages/shared`（zod），handler 内不得内联裸对象校验。

## 4. 状态管理

1. 服务端状态：TanStack Query（queryKey 按域分层：`['case', 'list', filters]`）。
2. 客户端 UI 状态：Zustand（仅布局/弹窗/选中等瞬态）；**禁止**把服务端数据复制进 Zustand 造成双源。
3. 表单：AntD Form + zod resolver；提交前必须经过 schema 校验。

## 5. 组件与样式

1. 通用组件沉淀 `packages/ui`（不得依赖业务 Store / api-client / packages/shared 之外的服务层）。
2. 业务组件放 `apps/web/src/components/{domain}/`，目录名与文档模块缩写一致（`case/` ↔ `CASE-NNN`）。
3. 样式：Tailwind 优先；AntD 主题定制集中在 token 配置；禁止散落内联 magic number（颜色/间距走 token 与 tailwind config）。
4. 可交互元素必须有可访问名称（aria-label/文本），供 Playwright getByRole 定位（见 rules/testing.md）。
5. **弹层一律 portal/fixed**：下拉、tooltip、右键菜单、行内弹出必须 portal 挂载或 fixed 定位——禁止让弹层被父容器 `overflow-hidden` 裁剪（历史高频缺陷：下拉/tooltip 被表格与网格容器裁切不可见）。
6. **路由高亮精确匹配**：NavLink/菜单 active 判断必须处理「前缀误命中」（根路由在一切子路由高亮、侧栏残留高亮）——精确匹配用 `end`，切换路由后清理高亮态。
7. **错误提示必须透出真实原因**：失败提示要展示服务端错误码与原因（ApiError 解包），禁止统一「操作失败」通用文案——历史教训：通用文案掩盖了 403 越权根因，排障成本翻倍。
8. **日期/时区计算统一走日期库工具**（packages/shared/utils）：禁止手算跨时区/周起始（曾因手算周一在跨时区下错位）；所有展示按用户时区格式化。
9. **权限数据未就绪 = 禁止操作（fail-closed）**：权限快照异步加载完成前，受权限控制的操作按钮/入口一律禁用或隐藏，不得先渲染可点状态再等权限快照「晚到纠正」——历史教训：权限快照晚到竞态导致越权闪现；加载中状态与无权限状态视觉一致。

## 6. 类型纪律

1. 禁止 `any`；跨边界类型一律 `z.infer<typeof Schema>` 推导，手写 interface 仅限 UI 私有 props。
2. API 返回值不得二次手写类型，统一从 api-client 导入。
3. `packages/shared` 是三端（web/engine/mock）契约唯一来源，修改 schema 必须同步 OpenAPI 快照（CI 校验）。

## 7. 流式与实时

SSE 消费统一走 api-client 的 stream 封装（自动重连 + Last-Event-ID 续传），页面组件不得自行 new EventSource。

## 8. 性能红线

1. 列表页必须服务端分页，禁止全量拉取前端分页。
2. 图片/附件走 MinIO 预签名直链，不经 Next 服务中转。
3. 长任务（执行/导入/导出）一律提交任务 + 轮询/SSE，禁止同步阻塞请求。
