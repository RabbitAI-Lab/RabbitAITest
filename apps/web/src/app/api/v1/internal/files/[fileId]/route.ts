import { NextResponse } from "next/server";
import { withInternalToken, toResponse } from "@/server/guard";
import { internalReadFile } from "@/server/domains/project/file.service";

export const runtime = "nodejs";

/** engine 内部读文件（X-Internal-Token）：字节流 + 元信息头。 */
export const GET = withInternalToken(async (_req, seg) => {
  try {
    const { fileId } = await (seg as { params: Promise<{ fileId: string }> }).params;
    const d = await internalReadFile(fileId);
    return new NextResponse(new Uint8Array(d.buffer), {
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(d.name),
        "X-File-Mime": d.mime,
      },
    });
  } catch (err) {
    return toResponse(err);
  }
});
