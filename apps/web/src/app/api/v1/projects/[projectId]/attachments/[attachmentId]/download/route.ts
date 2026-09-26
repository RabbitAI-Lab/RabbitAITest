import { toResponse, withProjectScope } from '@/server/guard';
import { readObject } from '@/server/storage';
import * as svc from '@/server/domains/bug/bug.service';

export const GET = withProjectScope(async (ctx, _req, seg) => {
  try {
    ctx.requirePerm('PROJECT_BUG:READ');
    const { attachmentId } = await (seg as { params: Promise<{ attachmentId: string }> }).params;
    const a = await svc.getAttachment(ctx.projectId, attachmentId);
    const buffer = await readObject(a.storageKey);
    const res = new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': a.mime ?? 'application/octet-stream',
        'Content-Disposition': "attachment; filename=" + JSON.stringify(a.name),
      },
    });
    return res as unknown as import('next/server').NextResponse;
  } catch (err) { return toResponse(err); }
});
