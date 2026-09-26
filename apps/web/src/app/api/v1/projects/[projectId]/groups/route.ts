import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { groupUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/system/group.service";

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_GROUP:READ");
    return okResponse(
      await svc.listGroups(
        { scope: "project", projectId: ctx.projectId },
        new URL(req.url).searchParams.get("withMembers") === "1" ? { withMembers: "1" } : undefined,
      ),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req, _seg) => {
  try {
    ctx.requirePerm("PROJECT_GROUP:CREATE");
    const body = groupUpsertSchema.parse(await req.json());
    return okResponse(
      await svc.createGroup(ctx.userId, { scope: "project", projectId: ctx.projectId }, body),
      201,
    );
  } catch (err) {
    return toResponse(err);
  }
});
