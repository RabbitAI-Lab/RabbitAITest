import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withInternalToken, toResponse } from "@/server/guard";
import { putFileObject } from "@/server/storage";
import { prisma } from "@rabbit/db";

export const runtime = "nodejs";

/** engine 内部写文件（X-Internal-Token）：截图等执行产物落 FileItem（S11 UIT-002）。
 *  复用文件管理存储命名空间（data/files），moduleId=null（引擎产物不入文件管理模块树）。 */
export const POST = withInternalToken(async (req) => {
  try {
    const form = await req.formData();
    const file = form.get("file");
    const projectId = String(form.get("projectId") ?? "");
    if (!(file instanceof File) || !projectId) {
      return NextResponse.json(
        { code: 50001, message: "缺少 file 或 projectId", data: null },
        { status: 422 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const storageKey = await putFileObject(buffer);
    const record = await prisma.fileItem.create({
      data: {
        projectId,
        moduleId: null,
        name: (file.name || "screenshot.jpeg").slice(0, 256),
        storageKey,
        size: buffer.byteLength,
        mime: file.type || "image/jpeg",
        jarEnabled: false,
      },
      select: { id: true },
    });
    return NextResponse.json(ok({ fileId: record.id }), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
});
