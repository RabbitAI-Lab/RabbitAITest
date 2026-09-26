import { withProjectScope, toResponse, okResponse } from "@/server/guard";
import { orgMemberQuerySchema, projectMembersAddSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/project/project.service";

export const GET = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_MEMBER:READ");
    const q = orgMemberQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return okResponse(await svc.listProjectMembers(ctx.projectId, q));
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_MEMBER:UPDATE");
    ctx.requireWritable();
    const body = projectMembersAddSchema.parse(await req.json());
    return okResponse(await svc.addProjectMembers(ctx.projectId, ctx.userId, body.userIds), 201);
  } catch (err) {
    return toResponse(err);
  }
});
