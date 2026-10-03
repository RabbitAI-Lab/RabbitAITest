/** AGENT-001 技能模板下载（GET → zip 文件流）。 */
import { NextResponse } from "next/server";
import { withProjectScope } from "@/server/guard";
import { buildSkillTemplateZip } from "@/server/domains/agent/skill-upload.service";

export const runtime = "nodejs";

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:READ");
    const zipBuffer = await buildSkillTemplateZip();
    return new NextResponse(new Uint8Array(zipBuffer), {
      headers: {
        "content-type": "application/zip",
        "content-disposition": 'attachment; filename="skill-template.zip"',
        "content-length": String(zipBuffer.length),
      },
    }) as unknown as NextResponse;
  } catch {
    return NextResponse.json(
      { code: 50000, message: "模板生成失败", data: null },
      { status: 500 },
    );
  }
});
