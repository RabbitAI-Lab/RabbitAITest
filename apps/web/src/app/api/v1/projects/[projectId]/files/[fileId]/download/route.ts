import { NextResponse } from "next/server";
import { withProjectScope, toResponse } from "@/server/guard";
import { downloadFile } from "@/server/domains/project/file.service";

export const runtime = "nodejs";

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm("PROJECT_FILE:READ");
    const { fileId } = await (seg as { params: Promise<{ fileId: string }> }).params;
    const d = await downloadFile(ctx.projectId, fileId);
    return new NextResponse(new Uint8Array(d.buffer), {
      headers: {
        "Content-Type": d.mime,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(d.name)}`,
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});
