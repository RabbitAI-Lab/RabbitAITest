# PLUG-004 数据库驱动五家 · 高保真原型

- 页面：`index.html`（Tailwind CDN，浏览器直接打开走查）
- 规格：`docs/sprint-future-p4/PLUG-004-database-drivers.md`
- 确认状态：待确认（确认人/日期后补——目标授权下人工确认可后置）

## 画板

1. 环境数据源区：driver 下拉五家 + URL 占位跟随 + 连接测试三态（PG 内置直连成功 / 不可达失败文案 / 非 PG 驱动未启用提示）
2. RequestEditor 前置 SQL 表单（启用态）：数据源选择（当前环境 database 列表）+ SQL 文本域 + 绑定参数行（变量↔字面值）+ 变量提取行（首行列→变量）+ 只读防线提示
3. 插件管理驱动插件行：kind=驱动徽标/启停（PLUG-001 既有组件零改动，锚定形态）

## 勘误

（暂无）
