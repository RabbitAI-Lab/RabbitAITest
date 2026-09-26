import { NextResponse } from "next/server";
import { DomainError, ErrCode, ErrMsg, fail, ok } from "@rabbit/shared";
import { getSession } from "@/lib/session";
import { getActiveUserId } from "@/server/current-user";
import { prisma } from "@rabbit/db";
import { permissionSetFor } from "@/server/rbac";
import { ensureBoot } from "@/server/boot";

/** api-conventions §2：统一信封 + 错误码。 */
export function toResponse(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status =
      err.code === ErrCode.UNAUTHENTICATED
        ? 401
        : err.code === ErrCode.FORBIDDEN
          ? 403
          : (
                [
                  ErrCode.PROJECT_NOT_FOUND,
                  ErrCode.TASK_NOT_FOUND,
                  ErrCode.USER_NOT_FOUND,
                  ErrCode.GROUP_NOT_FOUND,
                  ErrCode.TEMPLATE_NOT_FOUND,
                  ErrCode.CASE_NOT_FOUND,
                  ErrCode.MODULE_NOT_FOUND,
                  ErrCode.REVIEW_NOT_FOUND,
                  ErrCode.PLAN_NOT_FOUND,
                  ErrCode.BUG_NOT_FOUND,
                ] as number[]
              ).includes(err.code)
            ? 404
            : err.code === ErrCode.VERSION_CONFLICT
              ? 409
              : err.code === ErrCode.VALIDATION_FAILED ||
                  (
                    [
                      ErrCode.PROJECT_ENDED,
                      ErrCode.WORKFLOW_DENIED,
                      ErrCode.REVIEW_ENDED,
                      ErrCode.PLAN_ARCHIVED,
                      ErrCode.DUP_ASSOC,
                    ] as number[]
                  ).includes(err.code)
                ? 422
                : 400;
    return NextResponse.json(fail(err.code, err.message ?? ErrMsg[err.code] ?? "业务错误"), {
      status,
    });
  }
  console.error("[unhandled]", err);
  return NextResponse.json(fail(50000, "服务内部错误"), { status: 500 });
}

export interface AuthedCtx {
  userId: string;
  email?: string;
}

/** SYS-002：认证守卫（未登录 401 code 10001）。 */
export function withAuth<Ctx, Args extends unknown[]>(
  handler: (ctx: AuthedCtx & Ctx, ...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> => {
    try {
      ensureBoot();
      const userId = await getActiveUserId();
      if (!userId) {
        return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), {
          status: 401,
        });
      }
      const session = await getSession();
      const ctx = { userId, email: session.email } as AuthedCtx & Ctx;
      return await handler(ctx, ...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

export interface ProjectCtx extends AuthedCtx {
  projectId: string;
  /** 项目上下文（SYS-004/PROJ-001：权限判定与结束态拦截用） */
  orgId: string;
  projectStatus: string;
  permissions: Set<string>;
  /** 无权限点 → 403（10003）；项目已结束的写操作 → 422（10005，PROJ-001） */
  requirePerm(point: string): void;
  requireWritable(): void;
}

/** SYS-002/PROJ-001：项目作用域守卫（成员校验；不存在/越域一律 404 防枚举）+ RBAC 权限集注入。
 *  opts.allowDeleted：恢复类端点（restore）需作用于已软删项目，跳过 deletedAt 过滤（PROJ-001 §3）。 */
export function withProjectScope<Args extends unknown[]>(
  handler: (ctx: ProjectCtx, req: Request, ...args: Args) => Promise<NextResponse>,
  opts: { allowDeleted?: boolean } = {},
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      ensureBoot();
      const userId = await getActiveUserId();
      if (!userId) {
        return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), {
          status: 401,
        });
      }
      const seg = args[0] as { params: Promise<{ projectId: string }> } | undefined;
      const projectId = seg ? (await seg.params).projectId : "";
      const member = await prisma.projectMember.findFirst({
        where: { projectId, userId },
        select: { id: true },
      });
      const project = member
        ? await prisma.project.findFirst({
            where: { id: projectId, ...(opts.allowDeleted ? {} : { deletedAt: null }) },
            select: { id: true, orgId: true, status: true },
          })
        : null;
      if (!project) {
        return NextResponse.json(
          fail(ErrCode.PROJECT_NOT_FOUND, ErrMsg[ErrCode.PROJECT_NOT_FOUND]!),
          { status: 404 },
        );
      }
      const permissions = await permissionSetFor(userId, { orgId: project.orgId, projectId });
      const session = await getSession();
      const ctx: ProjectCtx = {
        userId,
        email: session.email,
        projectId,
        orgId: project.orgId,
        projectStatus: project.status,
        permissions,
        requirePerm(point: string) {
          if (!permissions.has(point))
            throw new DomainError(ErrCode.FORBIDDEN, `缺少权限点 ${point}`);
        },
        requireWritable() {
          if (project.status === "ENDED")
            throw new DomainError(ErrCode.PROJECT_ENDED, ErrMsg[ErrCode.PROJECT_ENDED]!);
        },
      };
      return await handler(ctx, req, ...args);
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** 系统级权限守卫（SYS-004/SYS-005）：登录 + 权限点。 */
export function withSystemPerm(point: string) {
  return function <Args extends unknown[]>(
    handler: (ctx: AuthedCtx, req: Request, ...args: Args) => Promise<NextResponse>,
  ) {
    return async (req: Request, ...args: Args): Promise<NextResponse> => {
      try {
        const userId = await getActiveUserId();
        if (!userId) {
          return NextResponse.json(
            fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!),
            { status: 401 },
          );
        }
        const perms = await permissionSetFor(userId);
        if (!perms.has(point)) {
          return NextResponse.json(fail(ErrCode.FORBIDDEN, `缺少权限点 ${point}`), { status: 403 });
        }
        const session = await getSession();
        return await handler({ userId, email: session.email }, req, ...args);
      } catch (err) {
        return toResponse(err);
      }
    };
  };
}

export interface OrgCtx extends AuthedCtx {
  orgId: string;
  permissions: Set<string>;
  requirePerm(point: string): void;
}

/** 组织级守卫（PROJ-001/SYS-004 组织组）：组织成员 + org 作用域权限集。 */
export function withOrgScope<Args extends unknown[]>(
  handler: (ctx: OrgCtx, req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return async (req: Request, ...args: Args): Promise<NextResponse> => {
    try {
      ensureBoot();
      const userId = await getActiveUserId();
      if (!userId) {
        return NextResponse.json(fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!), {
          status: 401,
        });
      }
      const seg = args[0] as { params: Promise<{ orgId: string }> } | undefined;
      const orgId = seg ? (await seg.params).orgId : "";
      const member = await prisma.orgMember.findFirst({
        where: { orgId, userId },
        select: { id: true },
      });
      if (!member) {
        return NextResponse.json(fail(ErrCode.PROJECT_NOT_FOUND, "组织不存在或无权访问"), {
          status: 404,
        });
      }
      const permissions = await permissionSetFor(userId, { orgId });
      const session = await getSession();
      return await handler(
        {
          userId,
          email: session.email,
          orgId,
          permissions,
          requirePerm(point: string) {
            if (!permissions.has(point))
              throw new DomainError(ErrCode.FORBIDDEN, `缺少权限点 ${point}`);
          },
        },
        req,
        ...args,
      );
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** engine 内部回调/注册令牌守卫。 */
export function withInternalToken(
  handler: (
    req: Request,
    seg: { params: Promise<Record<string, string>> },
  ) => Promise<NextResponse>,
) {
  return async (
    req: Request,
    seg: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      const { config: cfg } = await import("@rabbit/shared");
      if (req.headers.get("x-internal-token") !== cfg.internalToken) {
        return NextResponse.json(
          fail(ErrCode.ENGINE_CALLBACK_INVALID, ErrMsg[ErrCode.ENGINE_CALLBACK_INVALID]!),
          { status: 401 },
        );
      }
      return await handler(req, seg);
    } catch (err) {
      return toResponse(err);
    }
  };
}

/** 统一成功响应。 */
export function okResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(ok(data), { status });
}
