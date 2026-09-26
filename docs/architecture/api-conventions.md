# REST API 统一规范

| 元信息项 | 内容                                                               |
| -------- | ------------------------------------------------------------------ |
| 文档层级 | 架构文档（全局约束）                                               |
| 状态     | 已确认（Approved）                                                 |
| 下游消费 | 全部功能规格 §4 API 契约；zod-to-openapi 自动文档；api-client 生成 |

---

## 1. 路径规范

```
/api/v1/system/{resource}                      # 系统级：用户/用户组/组织/参数/资源池/插件/日志/license
/api/v1/orgs/{orgId}/{resource}                # 组织级：成员/项目/服务集成/模板/任务中心/日志
/api/v1/projects/{projectId}/{resource}        # 项目级：业务主体（cases/plans/bugs/apis/scenarios/...）
/api/v1/projects/{projectId}/{module}/{id}/{sub}   # 级联子资源：/cases/{id}/comments
/api/v1/share/{token}/...                      # 免登录分享（报告/接口文档）
/api/v1/personal/...                           # 个人中心（当前会话用户）
```

- 资源一律复数名词；操作动词仅用于「动作型」端点：`POST .../scenarios/{id}/execute`、`POST .../cases/batch-move`
- 批量操作统一 `POST .../{resource}/batch-{action}`，请求体 `{ids: [], payload}`
- 执行提交幂等：`POST .../exec-tasks` 携带可选 `client_task_id`，重复提交返回既有任务

## 2. 响应信封

```json
// 成功
{ "code": 0, "message": "ok", "data": { ... } }
// 分页 data
{ "code": 0, "message": "ok", "data": { "total": 132, "items": [ ... ] } }
// 失败
{ "code": 30402, "message": "无权访问该用例", "data": null }
```

- HTTP 状态码仅表达传输层（200/400/401/403/404/409/422/500），业务语义由 `code` 承载
- 分页：`?page=1&pageSize=20`（上限 100）；排序 `?orderBy=name&order=asc`；组合筛选走 `?filter={json}`（各规格定义 schema）

## 3. 错误码分段

| 段    | 域                                                          |
| ----- | ----------------------------------------------------------- |
| 10xxx | 系统与认证（10001 未登录、10003 权限不足、10151 用户超限…） |
| 20xxx | 项目与配置（模板/环境/文件）                                |
| 30xxx | 用例与评审                                                  |
| 40xxx | 接口测试（定义/CASE/Mock/场景）                             |
| 50xxx | 执行引擎（调度失败/引擎离线/超时/沙箱异常）                 |
| 60xxx | 报告与分享                                                  |
| 70xxx | 集成与插件（三方平台同步、连接测试）                        |
| 80xxx | AI（模型未配置/配额/超时）                                  |
| 90xxx | 企业版（License 无效/功能未授权）                           |

错误码一经发布不改语义，新增不复用；与 `packages/shared/errors.ts` 单一来源同步。

## 4. 通用约定

| 约定     | 规则                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| ID       | 对外一律 UUID；对外展示编号（如 `CASE-0001`）由 `num` 字段生成，项目内自增（advisory lock）                          |
| 软删除   | 业务主体带 `deleted_at`；回收站查询 `?recycled=true`；恢复 `POST .../{id}/restore`；「彻底删除」单独端点             |
| 审计     | 需审计端点用 `withAudit()` 包装（Route Handler 高阶函数：操作人/对象/类型/快照 diff），经 BullMQ 异步落库（SYS-008） |
| 变更历史 | 继承 `ChangeLoggedModel` 的实体自动记录变更序号与 diff（用例/接口/场景/缺陷/计划）                                   |
| 乐观锁   | 编辑型实体带 `version`，PUT 冲突返回 409                                                                             |
| 长任务   | 执行/导入/同步/导出统一返回 `{taskId}`，进度走任务中心接口或 SSE 通道                                                |
| 时间     | ISO 8601 UTC，前端本地化展示                                                                                         |
| 枚举     | 值为 SCREAMING_SNAKE，登记于 `packages/shared/enums.ts`                                                              |
| 权限     | 每个端点声明所需权限点（见 rbac-permission-model.md §4），经 `withPermission()` 包装并输出到 OpenAPI 文档            |

## 5. SSE 事件流通道

```
GET /api/v1/stream/exec/{execTaskId}      # 执行日志流（分帧：log/step-start/step-result/task-final）
GET /api/v1/stream/task-center            # 任务中心实时状态
```

- Next.js Route Handler 流式响应（SSE，text/event-stream）；帧格式 `{type, seq, payload, ts}`
- 断线重连：客户端带 `Last-Event-ID`（即 `seq`），服务端从 Redis Stream 回放续传（日志与报告事件同源）
- 事件契约（帧类型/负载 schema）定义于 `packages/shared`（zod），web 与 engine 共享

## 6. 契约流程

schema（zod）定义于 `packages/shared` → CI 生成 OpenAPI 快照并校验 diff → 变更合并后 CI 再生成 `packages/api-client` 并提 PR。前端禁止手写接口路径常量，一律引用生成的 client。
