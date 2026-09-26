import { toResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/case/caseIo.service';

export const GET = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm('PROJECT_CASE:READ');
    const { buffer, filename, contentType } = await svc.buildTemplate(ctx.projectId, ctx.orgId);
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': "attachment; filename=" + JSON.stringify(encodeURIComponent(filename)) },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
