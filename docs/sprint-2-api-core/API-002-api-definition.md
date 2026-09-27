# 接口定义（API/CASE/MOCK 三页签）

| 元信息项     | 内容                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| 文档编号     | API-002                                                                                                                             |
| 所属迭代     | Sprint 2 — 接口测试核心                                                                                                             |
| 优先级       | P1                                                                                                                                  |
| 所属模块     | 接口测试（api_test 域）                                                                                                             |
| 文档状态     | Implemented（2026-09-27 代码合并：单测 84 + JMeter 24 计划 + Playwright 91 用例全绿；高保真人工确认与走查待用户验收——S0 §8.1 先例） |
| 最后更新日期 | 2026-09-27                                                                                                                          |
| 上游依赖     | PROJ-003（环境选择/变量）、API-004（请求编辑器契约 v2）、CASE-002（模块树组件复用）、CASE-004（导入向导复用）、SYS-004（按钮级权限） |
| 下游消费     | API-003（CASE 页签）、API-005（MOCK 页签）、CASE-006（关联目标）、S3 API-006（场景步骤引用）、S6 API-011（Swagger 同步）            |
| 上游依据     | 需求文档 M6（接口定义）；功能清单 §6.2                                                                                              |
| 对标基线     | 功能清单 §6.2：三页签、视图与筛选、导入（Swagger/Postman/Har/JMeter/MeterSphere）覆盖/不覆盖、API 详情=定义+调试+引用关系+变更历史、多协议 |
| 关联架构文档 | test-domain-model.md §2.6/§4（num 分配/变更历史横切）                                                                              |
| 高保真确认   | 待确认（原型 docs/design/API-002-api-definition/，人工确认待 Sprint 验收走查——不可由 AI 代签）                                     |
| 工作量估算   | 后端 4 人日 / 前端 6 人日 / 联调 1.5 人日                                                                                           |

## 1. 概述

### 1.1 功能定位

接口测试主入口：左侧 api 模块树 + 定义列表；详情页三页签（API/CASE/MOCK）对齐基线交互范式。API 页签=完整参数体系编辑+调试（API-004 编辑器）；CASE/MOCK 页签分别由 API-003/API-005 承载。

### 1.2 范围边界（能力行 → §5 用例映射）

| 能力                                                                       | P1 ✅ | 后续                                                     |
| -------------------------------------------------------------------------- | ----- | -------------------------------------------------------- |
| api 模块树（默认「未规划接口」；增删改拖拽/计数，复用 CASE-002 组件）      | ✅     | —                                                        |
| 定义 CRUD：模块/method/path/名称/标签/状态（调试中 DEBUG/已发布 RELEASED） | ✅     | 协议字段仅 HTTP 展示（多协议 PLUG-002）                  |
| 列表：模块过滤（含子级）/method/名称/状态筛选 + 分页；num 展示编号        | ✅     | 预置视图（我关注的/我创建的——Follow 表已通用，S3 补 UI） |
| 详情 API 页签：请求编辑（API-004 全量）+默认响应编辑（JSON，Mock 跟随源）+调试执行（环境选择，跳报告） | ✅     | 响应多示例（基线多响应，简化单响应登记） |
| 保存口径：调试页「保存为接口」（API-001 去向承接）；定义编辑保存 bump version | ✅     | —                                                        |
| cURL 导入：粘贴 cURL 命令解析为请求（API-001 去向承接）                    | ✅     | —                                                        |
| 批量导入：OpenAPI 3（json/yaml，URL/文件）、Postman Collection v2.1（文件）、Rabbit JSON（自有格式）；覆盖/不覆盖（method+path 判重）；校验报告（行级错误） | ✅     | Har/JMeter（S3 API-009）、Swagger 定时同步（S6 API-011） |
| 导出：Rabbit JSON（模块/勾选范围）→ 可再导入 roundtrip                     | ✅     | —                                                        |
| 变更历史：ChangeLog（请求/名称/状态 diff 白名单）抽屉                      | ✅     | —                                                        |
| 引用关系：被用例数/被计划关联数 + 明细列表（经 Provider，CASE-006 通道）   | ✅     | 场景引用（S3）                                           |
| API 文档分享（范围/截止/密码/可导出）                                      | ❌     | Backlog（随 S3 导入导出扩展评审，理由：S2 主线为执行闭环）|
| 回收站                                                                     | ✅     | 软删+列表隐藏；恢复 UI 随 S3 统一回收站                  |

### 1.3 前置依赖

PROJ-003 环境选择器；API-004 编辑器与执行契约 v2（第 4 天冻结）；CASE-002 树组件、CASE-004 导入向导状态机复用。

### 1.4 对标基线核对

完全复刻：三页签范式/导入覆盖不覆盖/变更历史/引用关系/cURL 导入。简化实现：单默认响应（基线多响应示例）；预置视图 S3；Har/JMeter 导出导入去向登记；多协议=HTTP only（技术栈冻结）。超出基线：Rabbit JSON 自有导入导出格式（迁移兼容口径）。

## 2. 业务逻辑

- 定义保存：request 落库 v2 结构；每次保存 `version+1`（乐观锁 409 code 20409）并写 ChangeLog；version>用例 syncedVersion 时用例标「待同步」（API-003）。
- 删除：软删（连带 CASE/MOCK 页签数据不可达；物理数据保留）。模块删除：子树内定义上移默认模块（复用 CASE-002 口径）。
- 导入判重：同项目 method+path 相同=重复；覆盖=更新 request/名称（version+1）、不覆盖=跳过；报告列明 新增/覆盖/跳过/失败(行号+原因)。
- cURL 解析：`curl [-X m] [-H k:v] [-d body] [--data-raw] url`，-d 默认 raw_json（Content-Type 推断）；解析失败 422 指明位置。
- 调试执行：定义 API 页签「执行」以当前编辑态（未保存也可执行）提交 api_debug 任务（envSnapshot 由所选环境构建）→ 跳报告页。

## 3. UI/UX 设计（高保真 docs/design/API-002-api-definition/）

- 左导航「接口测试」组：接口定义 /apis、接口调试 /debug、文件管理 /apis/files（PROJ-004）；Mock 服务入口在定义 MOCK 页签；任务中心 /tasks、报告 /reports 独立组（SYS-006/RPT-002）。
- /apis 列表页：左 240px 模块树（+树工具栏/右键菜单同 CASE-002）+ 右区（工具条：新建接口/导入/导出/cURL 导入 + 筛选：method 下拉/名称搜索/状态；表格：名称(num)/method 徽标/path/状态/用例数/更新时间/操作：编辑·执行·删除）。
- 详情页 /apis/{id}：头部（可编辑名称+method+path+状态切换+保存（version 冲突提示）+执行（环境下拉））；Tab=API/CASE/MOCK；API=左右分栏（左 RequestEditor 七区，右 默认响应编辑器 JSON+执行结果摘要卡（最近一次报告链接））；引用关系与变更历史入口在头部「⋯」下拉（抽屉）。
- 导入向导：复用 CASE-004 三步（来源选择（格式单选+URL/文件/粘贴）→ 参数（覆盖开关/目标模块）→ 校验报告）；cURL 导入为单弹窗（textarea+解析预览表单）。
- 空态：无定义引导「新建/导入」；MOCK/CASE 空页签各自引导。

## 4. 技术架构

- 数据模型（已建齐）：ApiDefinition(request/response JSONB/status/version)、ApiCase、ApiMock、ModuleNode(scene=api)、ChangeLog（entityType=api_definition）。
- 端点：`GET/POST /api/v1/projects/{pid}/apis`（列表 query：moduleId/includeChildren/method/name/status）、`GET/PUT/DELETE .../apis/{id}`、`POST .../apis/{id}/debug`（执行当前编辑态）、`POST .../apis/import`（{format, source:{url?/content?}, overwrite, moduleId}）、`GET .../apis/export`（?moduleId=&ids=）、`POST .../apis/parse-curl`；CASE/MOCK 端点见 API-003/API-005；ChangeLog 复用 S1 通用端点口径（`GET .../apis/{id}/changes`）。
- zod（`packages/shared/src/api/schemas.ts` 新目录）：apiUpsertSchema（method 8/path 1-1024/名称必填/requestSpecSchema v2）、apiListQuerySchema、apiImportSchema、apiExportQuerySchema。
- 服务：`src/server/domains/api/api.service.ts` + `import.service.ts`（openapi3/postman/rabbit 三解析器纯函数，单测覆盖）。
- 权限点：PROJECT_API:READ|CREATE|UPDATE|DELETE（预置组同步：PROJECT_ADMIN 增全量、PROJECT_MEMBER 增 READ|CREATE|UPDATE、ORG_ADMIN 增 READ）。
- 错误码：`API_NOT_FOUND 40414`、`API_IMPORT_INVALID 40422`。
- 前端：`/(console)/apis/`（page.tsx 列表 + [id]/page.tsx 详情）；`components/api/RequestEditor.tsx`（API-004）等组件目录。

## 5. 测试用例

- API-002-T1（jmx 四类）：定义 CRUD/debug 提交；401/403/404（他项目）；path 超长/method 非法 422；列表分页信封+method 筛选。
- API-002-T2（spec 主链路）：建模块树→新建定义（POST /pets）→API 页签编辑请求（query+body raw_json+断言）→选环境执行→报告 SUCCESS→保存 version+1→变更历史抽屉见记录（UI+Console+接口）。
- API-002-T3（spec 导入）：OpenAPI3 样例（含 3 接口+1 非法 path）导入→校验报告 2 新增 1 失败（行级定位）；二次导入覆盖=true→报告「覆盖」；导出→导入 roundtrip 数量一致。
- API-002-T4（spec 二态+权限）：仅 PROJECT_API:READ 用户列表可见/新建按钮隐藏/直发 POST 403（code 10003）；RELEASED/DEBUG 状态切换与筛选。
- 单测：openapi3/postman/cURL 三解析器矩阵、判重覆盖逻辑、ChangeLog diff 白名单。

## 6. 竞品深度对标

基线 §6.2：三页签/导入/历史/引用全覆盖。差异：①多协议=HTTP only（基线协议插件多为企业版，PLUG-002 后）；②导入三格式先行（Har/JMeter 登记 S3）；③API 文档分享延后（登记）；④Swagger URL 同步=S6 API-011（plan 既定拆分）。技术差异必引：JMeter 引擎→自研 Node 内核，导入格式兼容承诺限定（plan §六）。

## 7. 里程碑与验收

DoD 前置：高保真人工确认。树组件/编辑器复用降低前端风险；验收对应 sprint-overview 验收 1/8 与 MAINFLOW-s2 前段。

## 8. 勘误登记

- 勘误 1（2026-09-27）：接口定义「标签」未随 INFRA-003 建列（api_definitions 无 tags），按门禁 3 不加列——S2 定义不带标签（用例标签保留于 API-003）；导入三格式中的 tags 字段解析后暂存丢弃。
