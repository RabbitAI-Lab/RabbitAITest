# rules/security.md — 安全编码规范

> 由 AGENTS.md §2 引用；对应 QA-002（安全加固）验收。所有 PR 按「涉及面」核对下表相关项。

## 1. 认证与会话

1. 会话 cookie：`httpOnly + Secure + SameSite=Lax`；CSRF 防护：所有变更请求校验 `Origin`（同源外拒绝）。
2. 密码：Argon2id 存储；重置链接一次性、短时效。
3. APIKEY：只存哈希 + 前缀展示（如 `rak-****`），创建时一次性明文返回；与 Session 走同一权限链（rbac）。
4. 分享链接：share_token 随机 ≥128bit、过期强制、快照不含 Secret 字段。

## 2. 输入校验

1. 一切外部输入（Route Handler、Server Action、engine 队列消息、webhook 回调、AI 响应）必须过 zod 校验——**校验失败即拒绝**，禁止「尽量解析」。
2. 分页/排序白名单：`orderBy` 只接受列名枚举，禁止透传字符串进 SQL。
3. 文件上传：类型白名单 + 大小限制（系统参数控制）；插件包（tarball）必须校验签名与目录结构（禁路径穿越/软链逃逸），解压总大小限额（防 zip 炸弹）；JAR 上传默认禁用（对齐基线）。

## 3. 注入与越权

1. SQL：一律 Prisma 参数化；`$queryRaw` 只允许标签模板（rules/database.md §5.1）。
2. XSS：用例描述/评论等富文本入库前服务端净化（白名单标签）；渲染端禁 `dangerouslySetInnerHTML`（仅净化器输出例外）；报告页（用户可控的响应体展示）一律文本化或语法高亮库渲染，**永不**作为 HTML 注入。
3. 对象级授权：域服务层显式校验资源归属（project/org），列表查询强制 scope 过滤（withProjectScope）；404（不存在/不属当前项目）与 403（无权限点）区分，防资源枚举。
   - **fail-closed 原则**：权限数据（快照/异步加载）未就绪时一律按「无权限」处理（前端禁用入口、后端拒绝请求），禁止默认放行后再纠正——历史教训：权限快照晚到竞态曾造成越权闪现；路由守卫曾因双 bug 把 OWNER 也拦成 403，必须用**越权矩阵 E2E**（每个受控路由 × {管理员, 普通成员, 未登录} 三视角至少各一条用例）兜底。
4. SSRF 边界区分两类 URL：
   - **平台侧 URL**（消息机器人 webhook、三方平台地址、IDEA/浏览器插件回调）：默认禁私网地址（CIDR 黑名单 + DNS 重绑定防护），放行需管理员配置白名单；
   - **引擎采样目标 URL**（业务测试对象）：不限制（测试平台本职），但 Mock 地址/分享域名必须是指定域。

## 4. 密钥管理

1. `.env` 不入库（`.env.example` 维护键名）；运行时密钥经环境变量/Secret 存储。
2. 落库密钥（三方平台 token、SMTP 密码、数据源密码）：加密存储（应用层 AES-GCM + 主密钥环境变量）；接口永不回显明文（写忽略、读掩码）。
3. 日志脱敏字段清单（observability.md §3）：`password/passwd/secret/token/apikey/authorization/cookie` 及嵌套 JSON 内同名字段。

## 5. 依赖与供应链

1. 依赖只从 lockfile 安装；CI 跑 `pnpm audit --prod`（high 以上阻塞）；新增三方依赖必须在 PR 说明用途与替代方案（Review 把关最小化）。
2. 插件包分发走官方市场签名；自建插件上传有醒目告警（plugin-architecture §4）。
3. 容器以非 root 运行；镜像最小化（multi-stage）。

## 6. AI 与外部调用

1. AI Provider 的 key 系统级加密存储；AI 请求日志不得记录完整 prompt 中的敏感数据（脱敏后再记）。
2. AI 生成内容入库前按普通用户输入同等校验/净化（生成的用例/脚注走同一 zod 与富文本净化管道）。

## 7. 审计与响应

1. 安全相关事件（登录失败、APIKEY 创建、插件上传、License 操作、越权尝试 403）必须审计落库（SYS-008）。
2. 任何安全缺陷修复：先写复现用例（tests）再修复；涉及数据的漏洞修复须评估是否需要通知与数据订正。
