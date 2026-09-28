/** 响应信封与错误（api-conventions §2/§3）。 */
export interface Envelope<T> {
  code: number;
  message: string;
  data: T | null;
}

export class DomainError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function ok<T>(data: T): Envelope<T> {
  return { code: 0, message: "ok", data };
}

export function fail(code: number, message: string): Envelope<null> {
  return { code, message, data: null };
}

/** 错误码分段（api-conventions §3）。 */
export const ErrCode = {
  // 10xxx 系统与认证
  UNAUTHENTICATED: 10001,
  FORBIDDEN: 10003, // 无权限点（rbac §4）
  EMAIL_EXISTS: 10101,
  BAD_CREDENTIALS: 10102,
  USER_NOT_FOUND: 10404,
  GROUP_NOT_FOUND: 10414,
  USER_TOO_MANY: 10151,
  PROJECT_ENDED: 10005, // 项目已结束（PROJ-001：写端点统一 422）
  WORKFLOW_DENIED: 10006, // 非法工作流流转（PROJ-002）
  REVIEW_ENDED: 10007, // 评审已结束（CASE-005）
  PLAN_ARCHIVED: 10008, // 计划已归档（PLAN-001）
  DUP_ASSOC: 10009, // 重复关联（PLAN-001 重复关联开关）
  APIKEY_INVALID: 10010, // S6 INTG-003：APIKEY 无效/已吊销
  APIKEY_LIMIT_EXCEEDED: 10011, // APIKEY 超上限（5 条/人）
  OPEN_RATE_LIMITED: 10012, // 开放 API 限流（10 QPS/key）
  PERSONAL_PASSWORD_MISMATCH: 10020, // S5 SYS-007：修改密码旧密码错误
  PERSONAL_LOCAL_RUNNER_INVALID: 10021, // S5 SYS-007：本地 runner 地址非环回
  PERSONAL_AI_MODEL_INVALID: 10022, // S5 SYS-007：个人默认模型不存在或未启用
  // 20xxx 项目与配置
  PROJECT_NOT_FOUND: 20404,
  TEMPLATE_NOT_FOUND: 20414,
  VALIDATION_FAILED: 20422,
  VERSION_CONFLICT: 20409,
  // 20xxx 消息机器人（S5 MSG-001）
  ROBOT_NOT_FOUND: 20440,
  ROBOT_WEBHOOK_INVALID: 20441,
  ROBOT_WEBHOOK_BLOCKED: 20442, // webhook 命中 SSRF 守卫
  ROBOT_LIMIT_EXCEEDED: 20443, // 机器人上限 10/项目
  MESSAGE_CONFIG_INVALID: 20444,
  NOTIFICATION_NOT_FOUND: 20445,
  ROBOT_SEND_FAILED: 20446, // 测试发送投递失败
  // 20xxx 公共脚本（S5 PROJ-005）
  SCRIPT_NOT_FOUND: 20450,
  SCRIPT_IN_USE: 20451, // 被引用禁止删除（409）
  SCRIPT_DEBUG_FAILED: 20452, // 调试运行时错误/超时
  SCRIPT_INVALID_REF: 20453, // 引用的脚本不存在或非启用态
  SCRIPT_LIMIT_EXCEEDED: 20454, // 脚本上限 100/项目
  // 20xxx 环境组（S5 PROJ-006）
  ENV_GROUP_NOT_FOUND: 20460,
  ENV_GROUP_EMPTY: 20461, // 组内无可用环境
  // 30xxx 用例与评审（含计划/缺陷——测试管理域族）
  CASE_NOT_FOUND: 30404,
  MODULE_NOT_FOUND: 30414,
  REVIEW_NOT_FOUND: 30424,
  PLAN_NOT_FOUND: 30434,
  BUG_NOT_FOUND: 30444,
  POINT_NOT_FOUND: 30454, // S4 PLAN-002 测试点
  POINT_NOT_EMPTY: 30455, // 点下有用例或子点不可删
  POINT_CYCLE: 30456, // parent 指向自身或后代
  PLAN_GROUP_NOT_FOUND: 30464, // S4 PLAN-004
  PLAN_GROUP_NOT_EMPTY: 30465,
  GROUP_NESTED: 30466, // 组不可挂 groupId（不嵌套）
  GROUP_NOT_EXECUTABLE: 30467, // 组不可执行/关联用例
  DEPENDENCY_CYCLE: 30484, // S4 CASE-008 依赖成环
  SELF_DEPENDENCY: 30485,
  MINDMAP_TOO_LARGE: 30495, // S4 CASE-007 节点超 500
  FOLLOW_TARGET_NOT_FOUND: 30504, // S4 DASH-002
  // 40xxx 接口测试
  TASK_NOT_FOUND: 40404,
  API_NOT_FOUND: 40414,
  API_CASE_NOT_FOUND: 40424,
  MOCK_NOT_FOUND: 40434,
  ENV_NOT_FOUND: 40444,
  FILE_NOT_FOUND: 40454,
  API_IMPORT_INVALID: 40422,
  MOCK_NO_MATCH: 40401, // Mock 服务未命中响应体（对齐信封口径）
  REF_TARGET_INVALID: 40464, // 关联目标无效（CASE-006 batch_validate）
  SCENARIO_NOT_FOUND: 40474, // S3 API-006
  SCENARIO_CIRCULAR_REF: 40476, // 场景引用循环（API-006 §2）
  SCENARIO_STEP_NOT_FOUND: 40484,
  FALSE_ALARM_RULE_NOT_FOUND: 40494, // S3 API-010
  PROTOCOL_NOT_SUPPORTED: 40510, // S6 PLUG-002：执行时协议插件不可用
  PROTOCOL_PLUGIN_LOAD_FAILED: 40511, // S6 PLUG-002：定义保存时协议加载失败
  SWAGGER_SYNC_TASK_NOT_FOUND: 40520, // S6 API-011
  SWAGGER_SYNC_URL_BLOCKED: 40521, // URL 被 SSRF 守卫拦截
  SWAGGER_FETCH_FAILED: 40522,
  SWAGGER_PARSE_FAILED: 40523,
  SWAGGER_TASKS_LIMIT_EXCEEDED: 40524, // 同步任务上限 10
  // 40xxx Git 存储库（S5 FILE-001，file 族顺延）
  FILE_REPO_NOT_FOUND: 40460,
  FILE_REPO_CONNECT_FAILED: 40461,
  FILE_REPO_PULL_FAILED: 40462,
  FILE_REPO_URL_BLOCKED: 40463, // 仓库地址命中 SSRF 守卫
  // 50xxx 执行引擎
  ENGINE_CALLBACK_INVALID: 50001,
  TASK_NOT_RUNNING: 50003,
  TASK_NOT_RERUNNABLE: 50004,
  CRON_INVALID: 50005, // S3 API-008
  SCHEDULE_SCENARIOS_EMPTY: 50006,
  MATCHER_EMPTY: 50007, // S3 API-010 匹配器至少一项
  RULES_LIMIT_EXCEEDED: 50008, // 误报规则上限 50
  CSV_TOO_LARGE: 50009, // S3 API-007 行数/行宽超限
  IMPORT_FILE_TOO_LARGE: 50010, // S3 API-009 ≤2MB
  IMPORT_FORMAT_UNKNOWN: 50011, // 导入格式探测失败
  PLAN_NO_EXECUTABLE: 50012, // S4 PLAN-003 计划内无可引擎执行项
  POOL_NOT_FOUND: 50404,
  SCHEDULE_NOT_FOUND: 50414,
  // 60xxx 报告与分享
  REPORT_NOT_FOUND: 60404,
  SHARE_NOT_FOUND: 60414,
  // 70xxx AI 能力（S7）
  AI_MODEL_NOT_FOUND: 70404,
  AI_CONVERSATION_NOT_FOUND: 70414,
  AI_PROMPT_NOT_FOUND: 70424,
  AI_NO_MODEL_AVAILABLE: 70444, // 无任何启用的模型（AI-002/003/004 消费前置）
  AI_BASEURL_FORBIDDEN: 70422, // baseUrl 命中 SSRF 守卫（AI-001）
  AI_PROVIDER_ERROR: 70501, // 供应商上游失败（透出上游状态，不泄 key）
  AI_RESPONSE_UNPARSEABLE: 70502, // 生成结果无法解析为 JSON 数组（AI-002/003）
  AI_OPENAPI_INVALID: 70503, // 批量生成 OpenAPI 文档解析失败（AI-003）
  AI_PROMPT_DUP: 70504, // 提示词模板名称重复（AI-005）
  AI_PROMPT_PLACEHOLDER_INVALID: 70505, // 提示词模板占位符未定义（AI-005）
  // 70xxx 集成与插件（S6）
  PLUGIN_NOT_FOUND: 70001,
  PLUGIN_PACKAGE_INVALID: 70002,
  PLUGIN_SPI_INCOMPATIBLE: 70003,
  PLUGIN_RUNNER_UNAVAILABLE: 70004,
  PLUGIN_VERSION_CONFLICT: 70005,
  PLUGIN_DELETE_FORBIDDEN: 70006,
  PROTOCOL_PLUGIN_CONFLICT: 70007, // 协议标识与已启用插件冲突（保留）
  INTEGRATION_NOT_FOUND: 70010,
  INTEGRATION_CONNECT_FAILED: 70011,
  PLATFORM_SYNC_CONFIG_INVALID: 70012,
  SYNC_TASK_FAILED: 70013,
  PLATFORM_UNAUTHORIZED: 70014,
  INTEGRATION_SECRET_MISSING: 70015,
  AUDIT_QUERY_INVALID: 70030, // S6 SYS-008
} as const;

export const ErrMsg: Record<number, string> = {
  [ErrCode.UNAUTHENTICATED]: "未登录或会话已过期",
  [ErrCode.FORBIDDEN]: "无操作权限",
  [ErrCode.USER_NOT_FOUND]: "用户不存在",
  [ErrCode.GROUP_NOT_FOUND]: "用户组不存在",
  [ErrCode.PROJECT_ENDED]: "项目已结束，禁止修改",
  [ErrCode.WORKFLOW_DENIED]: "该状态流转不被工作流允许",
  [ErrCode.REVIEW_ENDED]: "评审已结束，禁止操作",
  [ErrCode.PLAN_ARCHIVED]: "计划已归档，只读",
  [ErrCode.DUP_ASSOC]: "重复关联",
  [ErrCode.TEMPLATE_NOT_FOUND]: "模板不存在",
  [ErrCode.CASE_NOT_FOUND]: "用例不存在或已删除",
  [ErrCode.MODULE_NOT_FOUND]: "模块不存在",
  [ErrCode.REVIEW_NOT_FOUND]: "评审不存在或已删除",
  [ErrCode.PLAN_NOT_FOUND]: "计划不存在或已删除",
  [ErrCode.BUG_NOT_FOUND]: "缺陷不存在或已删除",
  [ErrCode.EMAIL_EXISTS]: "该邮箱已注册",
  [ErrCode.BAD_CREDENTIALS]: "邮箱或密码错误",
  [ErrCode.USER_TOO_MANY]: "超出用户数上限",
  [ErrCode.PROJECT_NOT_FOUND]: "项目不存在或无权访问",
  [ErrCode.VALIDATION_FAILED]: "参数校验失败",
  [ErrCode.VERSION_CONFLICT]: "内容已被他人修改，请刷新后重试",
  [ErrCode.TASK_NOT_FOUND]: "任务不存在或无权访问",
  [ErrCode.SCENARIO_NOT_FOUND]: "场景不存在或已删除",
  [ErrCode.SCENARIO_CIRCULAR_REF]: "场景引用形成循环（引用链深度超限）",
  [ErrCode.SCENARIO_STEP_NOT_FOUND]: "场景步骤不存在",
  [ErrCode.FALSE_ALARM_RULE_NOT_FOUND]: "误报规则不存在",
  [ErrCode.CRON_INVALID]: "cron 表达式非法（5 段，最短间隔 5 分钟）",
  [ErrCode.SCHEDULE_SCENARIOS_EMPTY]: "定时任务场景集为空（可能已被全部删除）",
  [ErrCode.MATCHER_EMPTY]: "误报匹配器至少一项条件",
  [ErrCode.RULES_LIMIT_EXCEEDED]: "误报规则数量超出上限（50）",
  [ErrCode.CSV_TOO_LARGE]: "CSV 数据超限（行数≤10000，单行≤8KB）",
  [ErrCode.IMPORT_FILE_TOO_LARGE]: "导入文件超出大小上限（2MB）",
  [ErrCode.IMPORT_FORMAT_UNKNOWN]: "导入格式无法识别（支持 Rabbit/MeterSphere JSON 与 JMeter jmx）",
  [ErrCode.SCHEDULE_NOT_FOUND]: "定时任务不存在",
  [ErrCode.ENGINE_CALLBACK_INVALID]: "引擎回调校验失败",
  [ErrCode.API_NOT_FOUND]: "接口定义不存在或已删除",
  [ErrCode.API_CASE_NOT_FOUND]: "接口用例不存在或已删除",
  [ErrCode.MOCK_NOT_FOUND]: "Mock 规则不存在",
  [ErrCode.ENV_NOT_FOUND]: "环境不存在或已删除",
  [ErrCode.FILE_NOT_FOUND]: "文件不存在或已删除",
  [ErrCode.API_IMPORT_INVALID]: "导入内容解析失败",
  [ErrCode.MOCK_NO_MATCH]: "无匹配 Mock 规则",
  [ErrCode.REF_TARGET_INVALID]: "关联目标无效",
  [ErrCode.TASK_NOT_RUNNING]: "任务不在运行中，无法停止",
  [ErrCode.TASK_NOT_RERUNNABLE]: "任务当前状态不可重跑",
  [ErrCode.POOL_NOT_FOUND]: "资源池不存在",
  [ErrCode.REPORT_NOT_FOUND]: "报告不存在或已删除",
  [ErrCode.SHARE_NOT_FOUND]: "分享链接不存在或已过期",
  [ErrCode.POINT_NOT_FOUND]: "测试点不存在",
  [ErrCode.POINT_NOT_EMPTY]: "测试点下还有用例或子点，请先清空",
  [ErrCode.POINT_CYCLE]: "父测试点不能指向自身或后代",
  [ErrCode.PLAN_GROUP_NOT_FOUND]: "计划组不存在或已删除",
  [ErrCode.PLAN_GROUP_NOT_EMPTY]: "计划组内还有成员计划，请先移出",
  [ErrCode.GROUP_NESTED]: "计划组不可嵌套",
  [ErrCode.GROUP_NOT_EXECUTABLE]: "计划组不支持该操作（组不可执行或关联用例）",
  [ErrCode.DEPENDENCY_CYCLE]: "将形成循环依赖",
  [ErrCode.SELF_DEPENDENCY]: "用例不能依赖自身",
  [ErrCode.MINDMAP_TOO_LARGE]: "脑图节点数超上限（500）",
  [ErrCode.FOLLOW_TARGET_NOT_FOUND]: "关注目标不存在或已删除",
  [ErrCode.PLAN_NO_EXECUTABLE]: "计划内没有可引擎执行的用例（接口用例/场景）",
  [ErrCode.AI_MODEL_NOT_FOUND]: "AI 模型不存在或已删除",
  [ErrCode.AI_CONVERSATION_NOT_FOUND]: "会话不存在或无权访问",
  [ErrCode.AI_PROMPT_NOT_FOUND]: "提示词模板不存在或已删除",
  [ErrCode.AI_NO_MODEL_AVAILABLE]: "尚未配置任何启用的 AI 模型，请联系管理员在系统管理-模型设置中配置",
  [ErrCode.AI_BASEURL_FORBIDDEN]: "BaseUrl 指向内网/环回/云元数据地址，已被安全策略拒绝",
  [ErrCode.AI_PROVIDER_ERROR]: "AI 供应商调用失败",
  [ErrCode.AI_RESPONSE_UNPARSEABLE]: "AI 生成结果无法解析，请重试或调整提示词",
  [ErrCode.AI_OPENAPI_INVALID]: "OpenAPI 文档解析失败（支持 3.x JSON）",
  [ErrCode.AI_PROMPT_DUP]: "提示词模板名称已存在",
  [ErrCode.AI_PROMPT_PLACEHOLDER_INVALID]: "提示词模板包含未定义的占位符",
  [ErrCode.APIKEY_INVALID]: "APIKEY 无效或已吊销",
  [ErrCode.APIKEY_LIMIT_EXCEEDED]: "APIKEY 数量超出上限（5 条）",
  [ErrCode.OPEN_RATE_LIMITED]: "请求过于频繁（每 key 10 次/秒）",
  [ErrCode.PROTOCOL_NOT_SUPPORTED]: "该协议未启用或协议插件不可用",
  [ErrCode.PROTOCOL_PLUGIN_LOAD_FAILED]: "协议插件加载失败",
  [ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND]: "同步任务不存在",
  [ErrCode.SWAGGER_SYNC_URL_BLOCKED]: "文档 URL 不允许（内网/元数据地址被守卫拦截）",
  [ErrCode.SWAGGER_FETCH_FAILED]: "文档拉取失败（超时或非 2xx）",
  [ErrCode.SWAGGER_PARSE_FAILED]: "文档解析失败（仅支持 OpenAPI/Swagger 3.0 json/yaml）",
  [ErrCode.SWAGGER_TASKS_LIMIT_EXCEEDED]: "同步任务数量超出上限（10）",
  [ErrCode.PLUGIN_NOT_FOUND]: "插件不存在",
  [ErrCode.PLUGIN_PACKAGE_INVALID]: "插件包非法（清单缺失或字段不合法）",
  [ErrCode.PLUGIN_SPI_INCOMPATIBLE]: "插件 SPI 版本与宿主不兼容",
  [ErrCode.PLUGIN_RUNNER_UNAVAILABLE]: "插件运行时不可用（plugin-runner 未就绪）",
  [ErrCode.PLUGIN_VERSION_CONFLICT]: "同名同版本插件已存在（版本号需递增）",
  [ErrCode.PLUGIN_DELETE_FORBIDDEN]: "插件启用中或被引用，禁止删除",
  [ErrCode.PROTOCOL_PLUGIN_CONFLICT]: "协议标识与已启用插件冲突",
  [ErrCode.INTEGRATION_NOT_FOUND]: "服务集成配置不存在",
  [ErrCode.INTEGRATION_CONNECT_FAILED]: "平台连接失败",
  [ErrCode.PLATFORM_SYNC_CONFIG_INVALID]: "项目同步关联配置无效（组织未配置该平台或参数非法）",
  [ErrCode.SYNC_TASK_FAILED]: "同步任务执行失败",
  [ErrCode.PLATFORM_UNAUTHORIZED]: "平台凭据失效（401/403），请重新配置",
  [ErrCode.INTEGRATION_SECRET_MISSING]: "集成加密密钥未配置（RABBIT_INTEGRATION_SECRET）",
  [ErrCode.AUDIT_QUERY_INVALID]: "审计查询参数非法",
  [ErrCode.PERSONAL_PASSWORD_MISMATCH]: "当前密码错误",
  [ErrCode.PERSONAL_LOCAL_RUNNER_INVALID]: "本地 runner 地址仅允许环回（127.0.0.1/localhost/::1）",
  [ErrCode.PERSONAL_AI_MODEL_INVALID]: "个人默认模型不存在或未启用",
  [ErrCode.ROBOT_NOT_FOUND]: "机器人不存在",
  [ErrCode.ROBOT_WEBHOOK_INVALID]: "Webhook 地址非法（机器人渠道必填 http(s) URL）",
  [ErrCode.ROBOT_WEBHOOK_BLOCKED]: "Webhook 指向内网/环回/元数据地址，已被安全策略拒绝",
  [ErrCode.ROBOT_LIMIT_EXCEEDED]: "机器人数量超出上限（10/项目）",
  [ErrCode.MESSAGE_CONFIG_INVALID]: "消息事件配置非法",
  [ErrCode.NOTIFICATION_NOT_FOUND]: "通知不存在",
  [ErrCode.ROBOT_SEND_FAILED]: "机器人消息投递失败",
  [ErrCode.SCRIPT_NOT_FOUND]: "公共脚本不存在或已删除",
  [ErrCode.SCRIPT_IN_USE]: "公共脚本正被引用，禁止删除（可强制删除）",
  [ErrCode.SCRIPT_DEBUG_FAILED]: "脚本调试失败（运行时错误或超时）",
  [ErrCode.SCRIPT_INVALID_REF]: "引用的公共脚本不存在或未发布",
  [ErrCode.SCRIPT_LIMIT_EXCEEDED]: "公共脚本数量超出上限（100/项目）",
  [ErrCode.ENV_GROUP_NOT_FOUND]: "环境组不存在",
  [ErrCode.ENV_GROUP_EMPTY]: "环境组内没有可用环境",
  [ErrCode.FILE_REPO_NOT_FOUND]: "文件存储库不存在",
  [ErrCode.FILE_REPO_CONNECT_FAILED]: "存储库连接失败",
  [ErrCode.FILE_REPO_PULL_FAILED]: "存储库文件拉取失败",
  [ErrCode.FILE_REPO_URL_BLOCKED]: "仓库地址不允许（内网/元数据地址被守卫拦截）",
};
