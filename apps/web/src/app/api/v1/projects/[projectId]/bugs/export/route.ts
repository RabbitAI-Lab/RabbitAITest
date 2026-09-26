import { toResponse, withProjectScope } from '@/server/guard';
import * as svc from '@/server/domains/bug/bug.service';

export const POST = withProjectScope(async (ctx) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { buffer, filename, contentType } = await svc.exportBugs(ctx.projectId);
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: { 'Content-Type': contentType, 'Content-Disposition': "attachment; filename=" + JSON.stringify(encodeURIComponent(filename)) },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
