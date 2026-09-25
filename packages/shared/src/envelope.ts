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
  EMAIL_EXISTS: 10101,
  BAD_CREDENTIALS: 10102,
  USER_TOO_MANY: 10151,
  // 20xxx 项目与配置
  PROJECT_NOT_FOUND: 20404,
  VALIDATION_FAILED: 20422,
  VERSION_CONFLICT: 20409,
  // 40xxx 接口测试
  TASK_NOT_FOUND: 40404,
  // 50xxx 执行引擎
  ENGINE_CALLBACK_INVALID: 50001,
} as const;

export const ErrMsg: Record<number, string> = {
  [ErrCode.UNAUTHENTICATED]: '未登录或会话已过期',
  [ErrCode.EMAIL_EXISTS]: '该邮箱已注册',
  [ErrCode.BAD_CREDENTIALS]: '邮箱或密码错误',
  [ErrCode.USER_TOO_MANY]: '超出用户数上限',
  [ErrCode.PROJECT_NOT_FOUND]: '项目不存在或无权访问',
  [ErrCode.VALIDATION_FAILED]: '参数校验失败',
  [ErrCode.VERSION_CONFLICT]: '内容已被他人修改，请刷新后重试',
  [ErrCode.TASK_NOT_FOUND]: '任务不存在或无权访问',
  [ErrCode.ENGINE_CALLBACK_INVALID]: '引擎回调校验失败',
};
