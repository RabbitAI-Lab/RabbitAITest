# 系统-组织-项目三级权限模型

| 元信息项 | 内容 |
| --- | --- |
| 文档层级 | 架构文档（全局约束） |
| 状态 | 已确认（Approved） |
| 对标基线 | MeterSphere 功能清单 §九（系统/组织两级设置 + 三级用户组 + 菜单权限勾选）；MeterSphere `PermissionConstants` 权限点风格 |
| 下游消费 | SYS-002/004、PROJ-001、全部业务规格 §4 权限点声明 |

---

## 1. 三级作用域

```
system（系统管理员）──→ organization（组织管理员）──→ project（项目管理员/成员）
```

- 标准版：单组织（默认组织），多组织为企业版 ENTP-001（License 门控）
- 用户跨组织/项目通过成员关系与用户组获得叠加权限，**权限取并集、禁用取交集**（任一所在组禁用即禁用）

## 2. 预置用户组（不可删除）

| 级别 | 组 | 权限 |
| --- | --- | --- |
| 系统 | 系统管理员 / 系统成员 | 全量 / 基础只读（组织列表、个人中心） |
| 组织 | 组织管理员 / 组织成员 | 组织全量（成员/项目/服务集成/模板/日志） / 项目列表只读 |
| 项目 | 项目管理员 / 项目成员 | 项目全量 / 业务读写（按各资源默认权限点） |

预置组权限不可编辑（对齐基线）；自定义组在三级各自可建，勾选权限点生成。

## 3. 权限点规范

格式：`{SCOPE}_{RESOURCE}:{ACTION}`，ACTION ∈ READ / CREATE / UPDATE / DELETE。

```python
# packages/shared / apps/api/domains/system/constants.py 单一来源
SYSTEM_USER:READ|CREATE|UPDATE|DELETE          # 用户管理
SYSTEM_PARAM:UPDATE  SYSTEM_POOL:READ|UPDATE   # 参数/资源池
ORG_TEMPLATE:READ|UPDATE  ORG_INTEGRATION:UPDATE
PROJECT_CASE:READ|CREATE|UPDATE|DELETE          # 功能用例
PROJECT_CASE_REVIEW:READ|UPDATE                 # 评审
PROJECT_API:READ|CREATE|UPDATE|DELETE           # 接口定义/CASE/Mock
PROJECT_SCENARIO:READ|CREATE|UPDATE|DELETE
PROJECT_PLAN:READ|CREATE|UPDATE|DELETE|EXECUTE  # 执行单独授权
PROJECT_BUG:READ|CREATE|UPDATE|DELETE
PROJECT_ENV:READ|UPDATE  PROJECT_FILE:READ|UPDATE  PROJECT_SCRIPT:UPDATE
PROJECT_REPORT:READ|SHARE|EXPORT                # 分享/导出单独授权
ENTP_SSO:UPDATE  ENTP_POOL:CREATE|UPDATE        # 企业版权限点（License 门控）
```

新增权限点规则：随首份消费它的功能规格评审入库，禁止规格外私用。

## 4. 检查链

```
请求 → 认证中间件（Session/Token/APIKEY）→ Route Handler 声明权限点（withPermission 包装）
     → 三级取并集判定 → 通过/403(10003)
前端 → 路由守卫（菜单级）+ v-permission 指令（按钮级），权限点清单登录时下发
```

- **APIKEY 与会话用户走同一权限链**（个人中心 APIKEY ≤5 条，对齐基线）
- 免登录分享路由（/share/*）不走权限链，走独立 share_token 校验 + 过期判断
- 越权访问返回 404（资源不存在或不属于当前项目）与 403（无权限点）区分，防资源枚举

## 5. 数据隔离

- 项目级资源所有查询强制 `project_id` 过滤（服务端守卫 `withProjectScope()` 统一收口）
- 组织级资源强制 `org_id`；跨域引用只经 Provider 接口（test-domain-model §3）
- 任务中心/日志按用户所在 org/project 范围过滤

## 6. License 门控（企业版开关）

```python
def gated(feature: EntpFeature):   # MULTI_ORG / SSO / MULTI_POOL / THEME / MSG_TEMPLATE / USER_SCALE
    # LicenseService.valid() 且 feature 授权 → 放行；否则 403(90xxx)
```

- 门控点集中登记（`entp_features.py`），企业版功能端点必须经 `@gated` 装饰，Code Review 按 ENTP 前缀规格核对
- 前端对应菜单/按钮隐藏；社区版容量限制（默认池唯一、用户上限）在后端强制，前端只做提示
