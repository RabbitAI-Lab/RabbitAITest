import { NextResponse } from "next/server";
import { toResponse, okResponse, withSystemPerm } from "@/server/guard";
import { pluginListQuerySchema, pluginScopeSchema } from "@rabbit/shared";
import * as svc from "@/server/domains/api/plugin.service";

export const runtime = "nodejs";

/** PLUG-001：插件列表（kind/keyword 筛选 + runtime 状态拼装）。 */
export const GET = withSystemPerm("SYSTEM_PLUGIN:READ")(async (_ctx, req) => {
  try {
    const url = new URL(req.url);
    const query = pluginListQuerySchema.parse({
      kind: url.searchParams.get("kind") ?? undefined,
      keyword: url.searchParams.get("keyword") ?? undefined,
      page: url.searchParams.get("page") ?? 1,
      pageSize: url.searchParams.get("pageSize") ?? 20,
    });
    const list = await svc.listPlugins({ kind: query.kind, keyword: query.keyword });
    return okResponse({ list, total: list.length, page: query.page, pageSize: query.pageSize });
  } catch (err) {
    return toResponse(err);
  }
});

/** PLUG-001：上传插件包（multipart tarball；orgScope 表单字段 ALL|[orgId,...]）。 */
export const POST = withSystemPerm("SYSTEM_PLUGIN:UPDATE")(async (_ctx, req) => {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ code: 70002, message: "缺少 file 字段（tarball）", data: null }, { status: 422 });
    }
    const rawScope = form.get("orgScope");
    const orgScope = rawScope ? pluginScopeSchema.parse(JSON.parse(String(rawScope))) : "ALL";
    const buffer = Buffer.from(await file.arrayBuffer());
    const { id, manifest } = await svc.uploadPlugin(buffer, orgScope);
    return okResponse({ id, manifest }, 201);
  } catch (err) {
    return toResponse(err);
  }
});
