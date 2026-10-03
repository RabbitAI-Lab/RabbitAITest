/** AGENT-001 技能上传（POST multipart .zip → 解压 → 创建目录技能）。 */
import { NextResponse } from "next/server";
import { toResponse, okResponse, withProjectScope } from "@/server/guard";
import { recordAudit, flushAudit } from "@/server/domains/system/audit.service";
import { extractSkillZip, createDirectorySkill } from "@/server/domains/agent/skill-upload.service";

export const runtime = "nodejs";

export const POST = withProjectScope(async (ctx, req) => {
  try {
    ctx.requirePerm("PROJECT_AGENT:CREATE");
    ctx.requireWritable();

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { code: 70623, message: "缺少 file 字段（multipart/form-data）", data: null },
        { status: 422 },
      );
    }
    if (!file.name.endsWith(".zip")) {
      return NextResponse.json(
        { code: 70623, message: "仅支持 .zip 文件", data: null },
        { status: 422 },
      );
    }

    const zipBuffer = Buffer.from(await file.arrayBuffer());
    const parsed = await extractSkillZip(ctx.projectId, zipBuffer, file.name);
    const skill = await createDirectorySkill(ctx.projectId, ctx.userId, parsed);

    recordAudit({
      userId: ctx.userId,
      scope: "project",
      projectId: ctx.projectId,
      action: "agent_skill.upload",
      objectType: "agent_skill",
      objectId: skill.id,
      detail: { name: parsed.name, files: parsed.files.length, format: "directory" },
    });
    void flushAudit();

    return okResponse(
      {
        id: skill.id,
        name: parsed.name,
        description: parsed.description,
        format: "directory",
        files: parsed.files,
      },
      201,
    );
  } catch (err) {
    return toResponse(err);
  }
});
