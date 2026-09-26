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
    this.name = 'DomainError';
  }
}

export function ok<T>(data: T): Envelope<T> {
  return { code: 0, message: 'ok', data };
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
  // 50xxx 执行引擎
  ENGINE_CALLBACK_INVALID: 50001,
} as const;

export const ErrMsg: Record<number, string> = {
  [ErrCode.UNAUTHENTICATED]: '未登录或会话已过期',
  [ErrCode.FORBIDDEN]: '无操作权限',
  [ErrCode.USER_NOT_FOUND]: '用户不存在',
  [ErrCode.GROUP_NOT_FOUND]: '用户组不存在',
  [ErrCode.PROJECT_ENDED]: '项目已结束，禁止修改',
  [ErrCode.WORKFLOW_DENIED]: '该状态流转不被工作流允许',
  [ErrCode.REVIEW_ENDED]: '评审已结束，禁止操作',
  [ErrCode.PLAN_ARCHIVED]: '计划已归档，只读',
  [ErrCode.DUP_ASSOC]: '重复关联',
  [ErrCode.TEMPLATE_NOT_FOUND]: '模板不存在',
  [ErrCode.CASE_NOT_FOUND]: '用例不存在或已删除',
  [ErrCode.MODULE_NOT_FOUND]: '模块不存在',
  [ErrCode.REVIEW_NOT_FOUND]: '评审不存在或已删除',
  [ErrCode.PLAN_NOT_FOUND]: '计划不存在或已删除',
  [ErrCode.BUG_NOT_FOUND]: '缺陷不存在或已删除',
  [ErrCode.EMAIL_EXISTS]: '该邮箱已注册',
  [ErrCode.BAD_CREDENTIALS]: '邮箱或密码错误',
  [ErrCode.USER_TOO_MANY]: '超出用户数上限',
  [ErrCode.PROJECT_NOT_FOUND]: '项目不存在或无权访问',
  [ErrCode.VALIDATION_FAILED]: '参数校验失败',
  [ErrCode.VERSION_CONFLICT]: '内容已被他人修改，请刷新后重试',
  [ErrCode.TASK_NOT_FOUND]: '任务不存在或无权访问',
  [ErrCode.ENGINE_CALLBACK_INVALID]: '引擎回调校验失败',
};
