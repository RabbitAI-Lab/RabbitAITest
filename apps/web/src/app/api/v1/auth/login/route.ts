import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ok } from '@rabbit/shared';
import { toResponse } from '@/server/guard';
import { loginUser, audit } from '@/server/domains/system/auth.service';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ code: 20422, message: '参数校验失败', data: null }, { status: 422 });
    }
    const { userId, email } = await loginUser(parsed.data.email, parsed.data.password);
    const session = await getSession();
    session.userId = userId;
    session.email = email;
    await session.save();
    await audit(userId, 'login', 'user', userId);
    return NextResponse.json(ok({ userId, email }));
  } catch (err) {
    return toResponse(err);
  }
}
