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
4. **CI 工作流供应链（2026-09-29 制度化）**：actions 一律固定完整 commit SHA（注释保留版本号，升级即换 SHA 重审）；workflow 显式声明 `permissions: contents: read`（GITHUB_TOKEN 最小权限）；依赖安装只走 `--frozen-lockfile`——禁止 `|| pnpm install` 回退，lockfile 漂移必须红灯而非静默装浮动版本；外部二进制（JMeter 等）下载后必须校验官方 checksum（SHA512），并用 `actions/cache` 缓存复用（`archive.apache.org` 限速直连单步曾耗时 90s+）。

## 6. AI 与外部调用

1. AI Provider 的 key 系统级加密存储；AI 请求日志不得记录完整 prompt 中的敏感数据（脱敏后再记）。
2. AI 生成内容入库前按普通用户输入同等校验/净化（生成的用例/脚注走同一 zod 与富文本净化管道）。

## 7. 审计与响应

1. 安全相关事件（登录失败、APIKEY 创建、插件上传、License 操作、越权尝试 403）必须审计落库（SYS-008）。
2. 任何安全缺陷修复：先写复现用例（tests）再修复；涉及数据的漏洞修复须评估是否需要通知与数据订正。

## 8. Mimosa 安全门禁与误报处置（2026-09-27 制度化，S3 教训）

1. **门禁语义分级**：Mimosa pre-commit gate 对 high 级 finding 拦截写入（如 SQL 处理器，见 API-004/006 勘误）；对 medium 级为「向用户说明风险并取得确认」的信息性放行——不得为消音而绕过门禁（禁改插件/禁全局禁用 hook），也不得无验证地接受 finding。
2. **误报核实 SOP（三命题法）**：判定误报必须走完整证据链，缺一不可——
   - 聚焦深扫取密封证据（focusFiles/focusLines）；0 findings 仅作参考，coverage partial 不作依据；
   - 命题一·汇聚点固定：枚举污点值可达的全部汇聚点，证明无 eval/exec/fs 写/动态加载/数据驱动外联 host；
   - 命题二·源头自产：污点源头是被测系统自产数据（DB 生成 id、服务端校验过的值），且下游 schema/route 强校验；
   - 命题三·敌意输入实验：SQLi/XSS/原型污染/超深嵌套等敌意输入喂入污点链，证明最坏后果无安全影响；
   - 汇聚点实放：用真实校验代码（zod schema 原样 safeParse）证明全部敌意值被拒（422 路径）。
3. **证据留痕**：验证脚本按 `scripts/verify-fp-*.mjs` 命名提交入库（可复跑、CI 绿），登记至 [docs/security/mimosa-fp-ledger.md](../docs/security/mimosa-fp-ledger.md)（含 seal、commit、断言数）；后续同 finding 重复出现时引用台账答复，不重复推导、不绕过。
4. **顺手加固登记**：核实过程中发现的稳健性观察（非安全，如递归无深度上限）登记台账「观察」栏，排期修复；不得以"误报"为由忽略真实缺陷。
5. **门禁局限申报**：当前插件（v1.0.3）git-gate 为密封包，无 finding 级 accept / 项目级 ignore / 阈值配置；向插件维护方反馈豁免机制需求（上游能力，非本仓库可控）。
6. **根治优先（2026-09-28 制度化，替代「引用即答」的默认路径）**：已证实误报**优先按下列已验证形态改代码消链**（行为等价、可测），git-gate 从此不再重复出现；确属无法结构化消除的才走第 3 条台账引用。三类已实证形态（audit crossFile 39→0，台账 #3/#4/#5）：
   - **① 出站守卫不做成「导出函数直接以自身参数调 fetch」的薄包装**：守卫封装为 dispatcher 工厂（如 `safe-fetch.ts` 的 `outboundDispatcher()`，连接期 IP 校验在 Agent 内），调用方**模块级一次性构造实例**后直连 `fetch(url, { dispatcher: 常量 })`。薄包装形态（原 `safeFetch(url, init, opts)`）会被判 SSRF 入口——分析器无法建模包装内的守卫语义；
   - **② 调用 fetch 的表达式里零 `process.env` 读取**（含模块级 env 常量传入同一调用的参数对象）：env 豁免开关在**模块初始化时**消化成 dispatcher/布尔常量，不进入 fetch 调用表达式（「env→fetch」污点锚在文件级，模块级常量也会被链上——须隔一层构造）；
   - **③ 测试 helper 命名避开生产代码同名**（跨文件分析按函数名并链）：e2e/mock 侧局部 helper 不用 `post`/`walk` 这类生产代码常见名（曾致 35+1 条误链：mock 单测 `post()` ↔ Playwright `request.post`、e2e `walk` ↔ import.service 路径遍历）；e2e 读被测系统优先用 Playwright `request` 相对路径会话（无 URL 拼接，S8 readUnreadTitles 先例）。
   - 验证口径：改完跑 `node <插件>/dist/cli.js audit . --deep --fail-on none --json` 确认 crossFile 归零 + 全量单测/e2e 相关面绿 + commit 实过门禁。
