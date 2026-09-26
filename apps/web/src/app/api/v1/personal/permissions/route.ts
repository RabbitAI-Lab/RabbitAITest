import { toResponse, okResponse, withAuth } from '@/server/guard';
import { permissionSetFor } from '@/server/rbac';

export const GET = withAuth(async (ctx, req: Request) => {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get('projectId');
    let orgId: string | undefined;
    if (projectId) {
      const { prisma } = await import('@rabbit/db');
      const p = await prisma.project.findFirst({ where: { id: projectId }, select: { orgId: true } });
      orgId = p?.orgId;
    }
    const scoped = await permissionSetFor(ctx.userId, { orgId, projectId: projectId ?? undefined });
    const global = await permissionSetFor(ctx.userId);
    return okResponse({ scoped: [...scoped], global: [...global] });
  } catch (err) { return toResponse(err); }
});
