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
  // 20xxx 项目与配置
  PROJECT_NOT_FOUND: 20404,
  TEMPLATE_NOT_FOUND: 20414,
  VALIDATION_FAILED: 20422,
  VERSION_CONFLICT: 20409,
  // 30xxx 用例与评审（含计划/缺陷——测试管理域族）
  CASE_NOT_FOUND: 30404,
  MODULE_NOT_FOUND: 30414,
  REVIEW_NOT_FOUND: 30424,
  PLAN_NOT_FOUND: 30434,
  BUG_NOT_FOUND: 30444,
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
};
