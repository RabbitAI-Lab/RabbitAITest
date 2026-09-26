import { toResponse, okResponse, withAuth } from "@/server/guard";
import * as svc from "@/server/domains/case/pref.service";

export const GET = withAuth(async (_ctx, req: Request, seg: unknown) => {
  try {
    const { key } = await (seg as { params: Promise<{ key: string }> }).params;
    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    return okResponse(await svc.getPreference(_ctx.userId, key, projectId));
  } catch (err) {
    return toResponse(err);
  }
});

export const PUT = withAuth(async (ctx, req: Request, seg: unknown) => {
  try {
    const { key } = await (seg as { params: Promise<{ key: string }> }).params;
    const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
    const body = (await req.json()) as { value: unknown };
    return okResponse(await svc.putPreference(ctx.userId, key, projectId, body.value));
  } catch (err) {
    return toResponse(err);
  }
});
