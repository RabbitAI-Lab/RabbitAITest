# 文件管理

| 元信息项     | 内容                                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | PROJ-004                                                                                                                                 |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                                  |
| 优先级       | P2（迭代内高优：API-004 form-data/binary 依赖）                                                                                          |
| 所属模块     | 项目管理（project 域）                                                                                                                   |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                               |
| 上游依赖     | PROJ-001（模块树基建）、SYS-005（文件大小限制参数）                                                                                      |
| 下游消费     | API-004（form-data 文件/binary 请求体，经 internal 端点消费）、S5 FILE-001（Git 存储库）、S5 PROJ-005（公共脚本包引用 JAR）             |
| 上游依据     | 需求文档 M2（文件管理）；功能清单 §8.3                                                                                                   |
| 对标基线     | 功能清单 §8.3：模块树组织、上传（JAR/脚本/CSV；JAR 默认禁用、启用后前后置可引用）、下载/删除/移动、列表与卡片视图                          |
| 关联架构文档 | test-domain-model.md §2.2（FileItem/FileRepo）；monorepo-structure（存储驱动抽象）                                                        |
| 高保真确认   | 待确认（原型 docs/design/PROJ-004-file-management/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                         |
| 工作量估算   | 后端 2.5 人日 / 前端 3 人日 / 联调 0.5 人日                                                                                              |

## 1. 概述

### 1.1 功能定位

项目级文件仓库：接口测试（form-data/binary/CSV 数据源 S3）与脚本包（JAR/TS）的文件来源。S2 落本地磁盘驱动（存储抽象沿用 BUG-001 storageKey 口径），为执行链路提供 internal 读取端点。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                     | P1 ✅ | 后续                                              |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------- |
| file 场景模块树（默认模块「未规划文件」懒创建）+ 列表按模块过滤（含子级） | ✅     | 跨场景拖拽（通用树后续增强）                      |
| 上传：拖拽/点选多文件；类型白名单（jar/csv/js/ts/json/txt/xmind/zip/png/jpg/xlsx/xmind）；单文件大小受 SYS-005 file.maxSizeMB | ✅     | 分片/秒传（基线无，不做）                         |
| JAR 启用制：默认 `jarEnabled=false`，手动启用/禁用（提示安全口径）        | ✅     | 启用后脚本引用（S5 公共脚本/插件包）              |
| 行操作：下载（鉴权流式）/重命名/移动（模块）/删除（软删）                | ✅     | 回收站 UI（软删数据保留，恢复端点随 S3 回收站统一）|
| 列表信息：名称/类型图标/大小/模块/JAR 状态/上传人/时间 + 关键字筛选      | ✅     | 卡片视图（P2 列表先行，登记简化）                 |
| 执行引用：`GET /api/v1/internal/files/{id}`（X-Internal-Token，engine 拉取字节） | ✅     | —                                                 |
| Git 存储库（Gitea/GitHub/GitLab/Gitee 分支+路径拉取）                    | ❌     | S5 FILE-001（plan 既定拆分）                      |
| MinIO 驱动                                                               | ❌     | 接口已抽象（storageKey），镜像源修复后替换驱动    |

### 1.3 前置依赖

SYS-005 file.maxSizeMB 参数已就绪（S1 交付）；存储目录独立命名空间 `data/files`（与附件 `data/attachments` 区分——附件黑名单禁 jar，文件管理白名单允许）。

### 1.4 对标基线核对

完全复刻：模块树组织/上传三类/JAR 启用制/下载删除移动。简化实现：卡片视图不做（列表先行）；回收站 UI 不做（软删保留数据）。超出基线：internal 读取端点（本项目 engine 无 DB 架构所需，基线引擎直读存储）。

## 2. 业务逻辑

- 上传校验：扩展名白名单+大小上限（超出 422 code 20422，消息含上限值）；同名文件允许（storageKey 唯一，名称可重复，靠 num/时间区分展示）。
- JAR 启用：仅状态位（S2 无消费方——S5 脚本包引用）；启用弹安全提示（社区版口径：启用=项目内可引用）。
- 删除：软删（deletedAt）；已删文件被执行引用时 engine 拉取 404→任务 CONFIG_ERROR（执行时点校验）。
- 移动：仅改 moduleId；移动到默认模块=未规划。

## 3. UI/UX 设计（高保真 docs/design/PROJ-004-file-management/）

- 入口：接口测试组「文件管理」（module: api，perm PROJECT_FILE:READ）。
- 布局：左模块树（复用 ModuleTreePanel scene=file）+ 右列表（上传区（拖拽虚线框+按钮）/表格/筛选行：名称关键字+模块（树联动）+类型）。
- 表格列：名称（类型图标）/大小（人性化）/模块/JAR（开关列，仅 jar 行可切）/上传人/时间/操作（下载·重命名·移动·删除）。
- 空态：无文件引导上传；上传超限 Toast 明示上限。

## 4. 技术架构

- 数据模型（已建齐）：FileItem(projectId/moduleId/name/storageKey/size/mime/jarEnabled/deletedAt)；ModuleNode(scene=file) 默认模块懒创建（presets ensureFileModule，复刻 ensureBugModule 模式）。
- 存储：`apps/web/src/server/storage.ts` 扩展第二命名空间 `files/`（put/read/stream/delete + 白名单校验独立函数）；下载走鉴权流式（复用 BUG-001 下载路由模式）。
- 端点：`GET/POST(multipart) /api/v1/projects/{pid}/files`、`GET .../files/{id}/download`、`PUT .../files/{id}`（rename/move/jarEnabled）、`DELETE .../files/{id}`；`GET /api/v1/internal/files/{id}`（internal token，返回字节流+X-File-Name/X-File-Mime 头）。
- zod：fileUpdateSchema（jarEnabled 仅 .jar 可设）。
- 权限点：**新增入库 `PROJECT_FILE:CREATE|DELETE`**（预置组同步：PROJECT_ADMIN 全量、PROJECT_MEMBER 增 READ|CREATE、ORG_ADMIN 增 READ）。
- 错误码：`FILE_NOT_FOUND 40454`。
- 前端：`/(console)/apis/files/page.tsx` 路由（导航组织见 API-002 §3）。

## 5. 测试用例

- PROJ-004-T1（jmx 四类）：文件 CRUD 元数据（上传走 multipart 采样器）/下载字节一致/jarEnabled 切换；401/403/404；超限与非白名单 422；列表分页信封。
- PROJ-004-T2（spec 主链路）：建 file 模块→拖拽上传 CSV+JAR→列表行数与大小显示→JAR 开关仅 jar 行可用（二态：开/关留痕）→下载内容一致（接口断言字节/长度）→移动模块→按模块过滤。
- PROJ-004-T3（spec 二态+引用）：上传 .exe 拒收 422；form-data 请求体引用文件执行（走 MAINFLOW-s2 断言 mock 收到的 multipart 文件名）。
- 单测：白名单/大小校验矩阵、懒创建默认模块幂等。

## 6. 竞品深度对标

基线 §8.3 主体覆盖；差异：①存储=本地磁盘驱动（基线 MinIO——BUG-001 勘误既定路线，接口已抽象）；②卡片视图简化（登记）；③Git 存储库=S5 FILE-001（plan 既定拆分，基线 Token 连接/分支路径拉取口径由 FILE-001 承接）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。internal 端点（第 5 天）是 API-004 form-data/binary 的前置；验收对应 sprint-overview 验收 7。

## 8. 勘误登记

- 勘误 1（2026-09-27，门禁 8 回补时登记）：§5 T3「form-data 请求体引用文件执行（走 MAINFLOW-s2 断言 mock 收到的 multipart 文件名）」——Mock 服务无请求回显模板，无法断言「文件名」；改以**内容标记法**断言且用例落位 `PROJ-004-03`（非 MAINFLOW-s2）：CSV 内置唯一 marker，mock 规则 `bodyContains=marker` 匹配即证明文件字节真实送达（内容级证明强于文件名级）；二态=带文件行命中 200 / 同 key 纯文本行未命中 404 断言败。
