import { NextResponse } from 'next/server';
import { DomainError, ErrCode, ErrMsg, fail } from '@rabbit/shared';
import { getSession } from '@/lib/session';
import { prisma } from '@rabbit/db';

/** api-conventions §2：统一信封 + 错误码。 */
export function toResponse(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status = err.code === ErrCode.UNAUTHENTICATED ? 401
      : err.code === ErrCode.PROJECT_NOT_FOUND || err.code === ErrCode.TASK_NOT_FOUND ? 404
        : err.code === ErrCode.VERSION_CONFLICT ? 409
          : err.code === ErrCode.VALIDATION_FAILED ? 422 : 400;
    return NextResponse.json(fail(err.code, err.message ?? ErrMsg[err.code] ?? '业务错误'), { status });
  }
  console.error('[unhandled]', err);
  return NextResponse.json(fail(50000, '服务内部错误'), { status: 500 });
}

export interface AuthedCtx { userId: string; email?: string }

/** SYS-002：认证守卫（未登录 401 code 10001）。 */
export function withAuth<Ctx, Args extends unknown[]>(
  handler: (ctx: AuthedCtx & Ctx, ...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session.userId) {
        return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), { status: 401 });
      }
      const ctx = { userId: session.userId, email: session.email } as AuthedCtx & Ctx;
      return await handler(ctx, ...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

export interface ProjectCtx extends AuthedCtx { projectId: string }

/** SYS-002：项目作用域守卫（成员校验；不存在/越域一律 404 防枚举）。透传路由段参数。 */
export function withProjectScope<Args extends unknown[]>(
  handler: (ctx: ProjectCtx, req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      const session = await getSession();
      if (!session.userId) {
        return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), { status: 401 });
      }
      const seg = args[0] as { params: Promise<{ projectId: string }> } | undefined;
      const projectId = seg ? (await seg.params).projectId : '';
      const member = await prisma.projectMember.findFirst({
        where: { projectId, userId: session.userId },
        select: { id: true },
      });
      const project = member
        ? await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true } })
        : null;
      if (!project) {
        return NextResponse.json(fail(ErrCode.PROJECT_NOT_FOUND, ErrMsg[ErrCode.PROJECT_NOT_FOUND]!), { status: 404 });
      }
      return await handler({ userId: session.userId, email: session.email, projectId }, req, ...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** engine 内部回调/注册令牌守卫。 */
export function withInternalToken(
  handler: (req: Request, seg: { params: Promise<Record<string, string>> }) => Promise<NextResponse>,
) {
  return async (req: Request, seg: { params: Promise<Record<string, string>> }): Promise<NextResponse> => {
    try {
      const { config: cfg } = await import('@rabbit/shared');
      if (req.headers.get('x-internal-token') !== cfg.internalToken) {
        return NextResponse.json(fail(ErrCode.ENGINE_CALLBACK_INVALID, ErrMsg[ErrCode.ENGINE_CALLBACK_INVALID]!), { status: 401 });
      }
      return await handler(req, seg);
    } catch (err) {
      return toResponse(err);
    }
  };
}
