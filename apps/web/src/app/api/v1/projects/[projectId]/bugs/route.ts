import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { bugUpsertSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/bug/bug.service";

export const GET = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:READ");
    const url = new URL(req.url);
    return okResponse(
      await svc.listBugs(ctx.projectId, {
        keyword: url.searchParams.get("keyword") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
        handler: url.searchParams.get("handler") ?? undefined,
        moduleId: url.searchParams.get("moduleId") ?? undefined,
        includeChildren: url.searchParams.get("includeChildren") === "true",
        tags: url.searchParams.get("tags") ?? undefined,
        fields: url.searchParams.get("fields") ?? undefined,
        recycled: url.searchParams.get("recycled") === "true",
        page: Number(url.searchParams.get("page") ?? 1),
        pageSize: Number(url.searchParams.get("pageSize") ?? 20),
      }),
    );
  } catch (err) {
    return toResponse(err);
  }
});

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_BUG:CREATE");
    ctx.requireWritable();
    const body = bugUpsertSchema.parse(await req.json());
    return okResponse(await svc.createBug(ctx.projectId, ctx.orgId, ctx.userId, body), 201);
  } catch (err) {
    return toResponse(err);
  }
});
