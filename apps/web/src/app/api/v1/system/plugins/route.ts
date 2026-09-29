import { NextResponse } from "next/server";
import { DomainError, ErrCode, pluginListQuerySchema, pluginScopeSchema } from "@rabbit/shared";
import { toResponse, okResponse, withSystemPerm } from "@/server/guard";
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

/** orgScope 解析：ALL | JSON 数组 | 带引号 JSON 串 | 单 orgId（multipart 表单值与 JSON 字段共用）。
 * 非法值 → DomainError 70002（422）而非 ZodError 裸抛 500（rules §4.5；S-future 演示录制暴露：
 * 前端 FormData 发 JSON.stringify("ALL")='"ALL"' 曾落 uuid 分支 500——UI 上传两处潜伏缺陷之一） */
function parseScope(raw: FormDataEntryValue | string | undefined | null): "ALL" | string[] {
  if (typeof raw !== "string" || !raw.trim()) return "ALL";
  const t = raw.trim();
  let v: unknown = t;
  if (t.startsWith("[") || t.startsWith('"')) {
    try {
      v = JSON.parse(t);
    } catch {
      v = t; // 按原文落入下方校验（统一 422 出口）
    }
  }
  const result =
    v === "ALL"
      ? { success: true as const, data: "ALL" as const }
      : pluginScopeSchema.safeParse(Array.isArray(v) ? v : [v]);
  if (!result.success) {
    throw new DomainError(
      ErrCode.PLUGIN_PACKAGE_INVALID,
      "orgScope 非法（ALL / orgId 数组 / 单 orgId）",
    );
  }
  return result.data;
}

/**
 * PLUG-001：上传插件包。两种形态：
 * - multipart/form-data（file 字段，前端 FormData / curl -F）
 * - application/json {filename, contentBase64, orgScope}（JMeter 用——Next 不认 JMeter 原生
 *   multipart 的边界实现，S3 PROJ-004 教训；二进制 tarball 无法手写边界，故补 base64 形态）
 */
export const POST = withSystemPerm("SYSTEM_PLUGIN:UPDATE")(async (_ctx, req) => {
  try {
    let buffer: Buffer;
    let orgScope: "ALL" | string[];
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json(
          { code: 70002, message: "缺少 file 字段（tarball）", data: null },
          { status: 422 },
        );
      }
      buffer = Buffer.from(await file.arrayBuffer());
      orgScope = parseScope(form.get("orgScope"));
    } else {
      // JSON 形态 {filename, contentBase64, orgScope}——JMeter 用（Next 不认 JMeter 原生 multipart，
      // S3 PROJ-004 教训；二进制 tarball 无法手写边界，故补 base64 形态）。text/plain 亦按 JSON 解析。
      const body = (await req.json().catch(() => null)) as {
        filename?: string;
        contentBase64?: string;
        orgScope?: string;
      } | null;
      if (!body?.filename || !body?.contentBase64) {
        return NextResponse.json(
          {
            code: 70002,
            message: "缺少 filename/contentBase64（或 file multipart 字段）",
            data: null,
          },
          { status: 422 },
        );
      }
      buffer = Buffer.from(body.contentBase64, "base64");
      orgScope = parseScope(body.orgScope);
    }
    const { id, manifest } = await svc.uploadPlugin(buffer, orgScope);
    return okResponse({ id, manifest }, 201);
  } catch (err) {
    return toResponse(err);
  }
});
