import { NextResponse } from "next/server";
import { DomainError, ErrCode, ErrMsg, fail, ok, requiredScopeFor } from "@rabbit/shared";
import { logFor, runWithLogContext } from "@rabbit/shared/logger";
import { getSession } from "@/lib/session";
import { getActiveUserId, getTokenScope } from "@/server/current-user";
import { prisma, runWithTenantContext } from "@rabbit/db";
import { permissionSetFor } from "@/server/rbac";
import { ensureBoot } from "@/server/boot";
import { httpIncr, httpObserve } from "@/server/metrics-counter";
import { initSlowQueryMeter } from "@/server/metrics-db";

initSlowQueryMeter();

/** INFRA-004：访问日志 + reqId 上下文（middleware 零改写直通——reqId 此处兜底生成，出口回写 X-Request-Id）。
 * INFRA-007：导出供 /system/metrics 路由复用（鉴权矩阵不走 withSystemPerm）；出口补 httpObserve 时延埋点。 */
export function accessLog(req: unknown, run: () => Promise<NextResponse>): Promise<NextResponse> {
  if (!(req instanceof Request)) return run();
  const reqId =
    req.headers.get("x-request-id")?.slice(0, 64) ??
    crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const start = Date.now();
  let path = "";
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = "invalid";
  }
  return runWithLogContext({ reqId }, async () => {
    const res = await run();
    if (!res.headers.has("x-request-id")) res.headers.set("x-request-id", reqId);
    httpIncr(path, res.status);
    httpObserve(path, Date.now() - start);
    logFor("http").info(
      { method: req.method, path, status: res.status, ms: Date.now() - start },
      "http request",
    );
    return res;
  });
}

/** api-conventions §2：统一信封 + 错误码。 */
export function toResponse(err: unknown): NextResponse {
  if (err instanceof DomainError) {
    const status =
      err.code === ErrCode.UNAUTHENTICATED
        ? 401
        : err.code === ErrCode.FORBIDDEN ||
            err.code === ErrCode.CSRF_REJECTED ||
            // 90xxx 企业版门控（S9 ENTP-007）
            err.code === ErrCode.LICENSE_REQUIRED ||
            err.code === ErrCode.LICENSE_FEATURE_NOT_ENABLED
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
                  ErrCode.API_NOT_FOUND,
                  ErrCode.API_CASE_NOT_FOUND,
                  ErrCode.MOCK_NOT_FOUND,
                  ErrCode.ENV_NOT_FOUND,
                  ErrCode.FILE_NOT_FOUND,
                  ErrCode.POOL_NOT_FOUND,
                  ErrCode.REPORT_NOT_FOUND,
                  ErrCode.SHARE_NOT_FOUND,
                  ErrCode.SCENARIO_NOT_FOUND,
                  ErrCode.SCENARIO_STEP_NOT_FOUND,
                  ErrCode.FALSE_ALARM_RULE_NOT_FOUND,
                  ErrCode.POINT_NOT_FOUND,
                  ErrCode.PLAN_GROUP_NOT_FOUND,
                  ErrCode.FOLLOW_TARGET_NOT_FOUND,
                  ErrCode.AI_MODEL_NOT_FOUND,
                  ErrCode.AI_CONVERSATION_NOT_FOUND,
                  ErrCode.AI_PROMPT_NOT_FOUND,
                  ErrCode.AI_NO_MODEL_AVAILABLE,
                  ErrCode.PLUGIN_NOT_FOUND,
                  ErrCode.INTEGRATION_NOT_FOUND,
                  ErrCode.SWAGGER_SYNC_TASK_NOT_FOUND,
                  ErrCode.ROBOT_NOT_FOUND,
                  ErrCode.SCRIPT_NOT_FOUND,
                  ErrCode.ENV_GROUP_NOT_FOUND,
                  ErrCode.FILE_REPO_NOT_FOUND,
                  ErrCode.NOTIFICATION_NOT_FOUND,
                  // S9 ENTP
                  ErrCode.SSO_SOURCE_NOT_FOUND,
                  ErrCode.DEPARTMENT_NOT_FOUND,
                  // S11 LOAD/UIT
                  ErrCode.LOAD_TEST_NOT_FOUND,
                  ErrCode.UI_ELEMENT_NOT_FOUND,
                  ErrCode.UI_CASE_NOT_FOUND,
                  // S11 SYS-009（授权会话 404 防枚举）
                  ErrCode.OAUTH_GRANT_NOT_FOUND,
                ] as number[]
              ).includes(err.code)
            ? 404
            : err.code === ErrCode.VERSION_CONFLICT ||
                err.code === ErrCode.SCRIPT_IN_USE ||
                // S9 ENTP 409（组织/池/部门冲突与保护）
                err.code === ErrCode.ORG_NAME_EXISTS ||
                err.code === ErrCode.ORG_DEFAULT_PROTECTED ||
                err.code === ErrCode.POOL_DEFAULT_UNDELETABLE ||
                err.code === ErrCode.POOL_NAME_EXISTS ||
                err.code === ErrCode.POOL_HAS_TASKS ||
                err.code === ErrCode.DEPARTMENT_NAME_EXISTS ||
                err.code === ErrCode.DEPARTMENT_HAS_CHILDREN ||
                err.code === ErrCode.SSO_ACCOUNT_CONFLICT ||
                // S11 LOAD/UIT 409
                err.code === ErrCode.LOAD_TEST_RUNNING ||
                err.code === ErrCode.LOAD_TASK_NOT_RUNNABLE
              ? 409
              : err.code === ErrCode.VALIDATION_FAILED ||
                  (
                    [
                      ErrCode.PROJECT_ENDED,
                      ErrCode.WORKFLOW_DENIED,
                      ErrCode.REVIEW_ENDED,
                      ErrCode.PLAN_ARCHIVED,
                      ErrCode.DUP_ASSOC,
                      ErrCode.API_IMPORT_INVALID,
                      ErrCode.REF_TARGET_INVALID,
                      ErrCode.TASK_NOT_RUNNING,
                      ErrCode.TASK_NOT_RERUNNABLE,
                      ErrCode.SCENARIO_CIRCULAR_REF,
                      ErrCode.CRON_INVALID,
                      ErrCode.SCHEDULE_SCENARIOS_EMPTY,
                      ErrCode.MATCHER_EMPTY,
                      ErrCode.RULES_LIMIT_EXCEEDED,
                      ErrCode.CSV_TOO_LARGE,
                      ErrCode.IMPORT_FILE_TOO_LARGE,
                      ErrCode.IMPORT_FORMAT_UNKNOWN,
                      ErrCode.POINT_NOT_EMPTY,
                      ErrCode.POINT_CYCLE,
                      ErrCode.PLAN_GROUP_NOT_EMPTY,
                      ErrCode.GROUP_NESTED,
                      ErrCode.GROUP_NOT_EXECUTABLE,
                      ErrCode.DEPENDENCY_CYCLE,
                      ErrCode.SELF_DEPENDENCY,
                      ErrCode.MINDMAP_TOO_LARGE,
                      ErrCode.PLAN_NO_EXECUTABLE,
                      ErrCode.AI_BASEURL_FORBIDDEN,
                      ErrCode.AI_RESPONSE_UNPARSEABLE,
                      ErrCode.AI_OPENAPI_INVALID,
                      ErrCode.AI_PROMPT_DUP,
                      ErrCode.AI_PROMPT_PLACEHOLDER_INVALID,
                      ErrCode.PLUGIN_PACKAGE_INVALID,
                      ErrCode.PLUGIN_SPI_INCOMPATIBLE,
                      ErrCode.APIKEY_LIMIT_EXCEEDED,
                      ErrCode.APIKEY_INVALID,
                      ErrCode.PROTOCOL_NOT_SUPPORTED,
                      ErrCode.SWAGGER_SYNC_URL_BLOCKED,
                      ErrCode.SWAGGER_FETCH_FAILED,
                      ErrCode.SWAGGER_PARSE_FAILED,
                      ErrCode.SWAGGER_TASKS_LIMIT_EXCEEDED,
                      ErrCode.AUDIT_QUERY_INVALID,
                      ErrCode.INTEGRATION_SECRET_MISSING,
                      ErrCode.INTEGRATION_NOT_FOUND,
                      ErrCode.INTEGRATION_CONNECT_FAILED,
                      ErrCode.PLATFORM_SYNC_CONFIG_INVALID,
                      ErrCode.SYNC_TASK_FAILED,
                      ErrCode.PLATFORM_UNAUTHORIZED,
                      // S5（MSG-001/PROJ-005/PROJ-006/FILE-001/SYS-007）
                      ErrCode.ROBOT_WEBHOOK_INVALID,
                      ErrCode.ROBOT_WEBHOOK_BLOCKED,
                      ErrCode.ROBOT_LIMIT_EXCEEDED,
                      ErrCode.MESSAGE_CONFIG_INVALID,
                      ErrCode.ROBOT_SEND_FAILED,
                      ErrCode.SCRIPT_DEBUG_FAILED,
                      ErrCode.SCRIPT_INVALID_REF,
                      ErrCode.SCRIPT_LIMIT_EXCEEDED,
                      ErrCode.ENV_GROUP_EMPTY,
                      ErrCode.FILE_REPO_CONNECT_FAILED,
                      ErrCode.FILE_REPO_PULL_FAILED,
                      ErrCode.FILE_REPO_URL_BLOCKED,
                      ErrCode.PERSONAL_PASSWORD_MISMATCH,
                      ErrCode.PERSONAL_LOCAL_RUNNER_INVALID,
                      ErrCode.PERSONAL_AI_MODEL_INVALID,
                      ErrCode.PACK_NOT_ALLOWED,
                      // S9 ENTP（90xxx 422 面：License 校验/SSO 配置与状态/组织确认/池规则/部门环/模板事件/主题图片）
                      ErrCode.LICENSE_FORMAT_INVALID,
                      ErrCode.LICENSE_SIGNATURE_INVALID,
                      ErrCode.LICENSE_EXPIRED,
                      ErrCode.SSO_SOURCE_DISABLED,
                      ErrCode.SSO_STATE_INVALID,
                      ErrCode.SSO_USER_MAPPING_FAILED,
                      ErrCode.SSO_CONFIG_INVALID,
                      ErrCode.ORG_DELETE_CONFIRM_REQUIRED,
                      ErrCode.ORG_OWNER_IMMUTABLE,
                      ErrCode.POOL_DEFAULT_UNDISABLEABLE,
                      ErrCode.POOL_DISABLED,
                      ErrCode.POOL_TYPE_INVALID,
                      ErrCode.POOL_ORG_NOT_ALLOWED,
                      ErrCode.DEPARTMENT_CYCLE,
                      ErrCode.DEPARTMENT_MEMBER_NOT_IN_ORG,
                      ErrCode.TEMPLATE_EVENT_INVALID,
                      ErrCode.THEME_IMAGE_TOO_LARGE,
                      // S-future（PLUG-003/TOOL-001/002/EXEC-004/RPT-004）
                      ErrCode.PROTOCOL_PLUGIN_LOAD_FAILED,
                      ErrCode.OPEN_SYNC_VALIDATION_FAILED,
                      ErrCode.OPEN_SYNC_LIMIT_EXCEEDED,
                      ErrCode.OPEN_CAPTURE_INVALID,
                      // S11 SYS-009（设备码无效/过期/锁定 422）
                      ErrCode.OAUTH_USER_CODE_INVALID,
                      ErrCode.POOL_CONFIG_INVALID,
                      ErrCode.REPORT_STATS_INVALID,
                    ] as number[]
                  ).includes(err.code)
                ? 422
                : err.code === ErrCode.PLUGIN_VERSION_CONFLICT ||
                    err.code === ErrCode.PLUGIN_DELETE_FORBIDDEN
                  ? 409
                  : err.code === ErrCode.AI_PROVIDER_ERROR ||
                      err.code === ErrCode.SSO_PROVIDER_ERROR || // 供应商上游失败（透出上游状态不泄 key）
                      err.code === ErrCode.POOL_K8S_UNREACHABLE // apiServer 探测失败（透出上游状态不泄 token）
                    ? 502
                    : err.code === ErrCode.OPEN_RATE_LIMITED ||
                        err.code === ErrCode.LOGIN_RATE_LIMITED
                      ? 429
                      : 400;
    return NextResponse.json(fail(err.code, err.message ?? ErrMsg[err.code] ?? "业务错误"), {
      status,
    });
  }
  logFor("http").error({ err }, "unhandled error");
  return NextResponse.json(fail(50000, "服务内部错误"), { status: 500 });
}

export interface AuthedCtx {
  userId: string;
  email?: string;
}

/**
 * SYS-009 §2.3：Token 通道 scope 断言——所需类别由 requiredScopeFor（exec 注册表+方法缺省）判定；
 * session/APIKEY 通道 tokenScope=null 不受约束。scope 是收窄不是替代：RBAC requirePerm 照常。
 */
async function assertTokenScope(req: unknown): Promise<void> {
  const scope = await getTokenScope();
  if (!scope || !(req instanceof Request)) return;
  let path = "";
  try {
    path = new URL(req.url).pathname;
  } catch {
    path = "invalid";
  }
  // oauth/* 生命周期端点（revoke 等）豁免：token 自管理（RFC 7009 语义——
  // 吊销由 token 自身认证，read/exec token 也必须能登出；SYS-009 §4.3 登记）
  if (path.startsWith("/api/v1/oauth/")) return;
  const need = requiredScopeFor(req.method, path);
  if (!scope.includes(need)) {
    throw new DomainError(
      ErrCode.FORBIDDEN,
      `token scope 缺少 ${need}（当前：${scope.join(",") || "无"}）`,
    );
  }
}

/** SYS-002：认证守卫（未登录 401 code 10001）。 */
export function withAuth<Ctx, Args extends unknown[]>(
  handler: (ctx: AuthedCtx & Ctx, ...args: Args) => Promise<NextResponse>,
) {
  return async (...args: Args): Promise<NextResponse> =>
    accessLog(args[0], async () => {
      try {
        ensureBoot();
        const userId = await getActiveUserId();
        if (!userId) {
          return NextResponse.json(
            fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!),
            {
              status: 401,
            },
          );
        }
        const session = await getSession();
        const ctx = { userId, email: session.email } as AuthedCtx & Ctx;
        await assertTokenScope(args[0]);
        return await runWithLogContext({ userId }, () => handler(ctx, ...args));
      } catch (err) {
        return toResponse(err);
      }
    });
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
  return async (req: Request, ...args: Args): Promise<NextResponse> =>
    accessLog(req, async () => {
      try {
        ensureBoot();
        const userId = await getActiveUserId();
        if (!userId) {
          return NextResponse.json(
            fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!),
            {
              status: 401,
            },
          );
        }
        const seg = args[0] as { params: Promise<{ projectId: string }> } | undefined;
        const projectId = seg ? (await seg.params).projectId : "";
        await assertTokenScope(req);
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
        // INFRA-006：项目作用域请求进入 RLS 租户事务（漏过滤的跨组织查询/写入由数据库层兜底）
        return await runWithLogContext({ userId, orgId: project.orgId, projectId }, () =>
          runWithTenantContext(project.orgId, () => handler(ctx, req, ...args)),
        );
      } catch (err) {
        return toResponse(err);
      }
    });
}

/** 系统级权限守卫（SYS-004/SYS-005）：登录 + 权限点。 */
export function withSystemPerm(point: string) {
  return function <Args extends unknown[]>(
    handler: (ctx: AuthedCtx, req: Request, ...args: Args) => Promise<NextResponse>,
  ) {
    return async (req: Request, ...args: Args): Promise<NextResponse> =>
      accessLog(req, async () => {
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
            return NextResponse.json(fail(ErrCode.FORBIDDEN, `缺少权限点 ${point}`), {
              status: 403,
            });
          }
          await assertTokenScope(req);
          const session = await getSession();
          return await runWithLogContext({ userId }, () =>
            handler({ userId, email: session.email }, req, ...args),
          );
        } catch (err) {
          return toResponse(err);
        }
      });
  };
}

/** 恢复类端点专用：允许作用于已软删项目（成员校验与防枚举语义不变）。 */
export function withProjectScopeAllowDeleted<Args extends unknown[]>(
  handler: (ctx: ProjectCtx, req: Request, ...args: Args) => Promise<NextResponse>,
) {
  return withProjectScope(handler, { allowDeleted: true });
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
  return async (req: Request, ...args: Args): Promise<NextResponse> =>
    accessLog(req, async () => {
      try {
        ensureBoot();
        const userId = await getActiveUserId();
        if (!userId) {
          return NextResponse.json(
            fail(ErrCode.UNAUTHENTICATED, ErrMsg[ErrCode.UNAUTHENTICATED]!),
            {
              status: 401,
            },
          );
        }
        const seg = args[0] as { params: Promise<{ orgId: string }> } | undefined;
        const orgId = seg ? (await seg.params).orgId : "";
        await assertTokenScope(req);
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
        // INFRA-006：组织作用域请求进入 RLS 租户事务
        return await runWithLogContext({ userId, orgId }, () =>
          runWithTenantContext(orgId, () =>
            handler(
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
            ),
          ),
        );
      } catch (err) {
        return toResponse(err);
      }
    });
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
  ): Promise<NextResponse> =>
    accessLog(req, async () => {
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
    });
}

/** 统一成功响应。 */
export function okResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(ok(data), { status });
}

/** S4：请求体 zod 解析统一出口（ZodError → DomainError 20422，避免裸抛落 500）。 */
export function zodParse<T>(
  schema: {
    safeParse: (
      d: unknown,
    ) =>
      | { success: true; data: T }
      | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };
  },
  data: unknown,
): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new DomainError(
      ErrCode.VALIDATION_FAILED,
      first ? `${first.path.join(".")}: ${first.message}` : "参数校验失败",
    );
  }
  return parsed.data;
}
