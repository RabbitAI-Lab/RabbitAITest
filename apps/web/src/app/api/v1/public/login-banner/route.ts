import { NextResponse } from 'next/server';
import { ok } from '@rabbit/shared';
import { publicLoginBanner } from '@/server/domains/system/param.service';

export async function GET(): Promise<NextResponse> {
  // 公开端点：登录页未登录可读（无敏感信息，仅 base.loginBanner）
  const banner = await publicLoginBanner().catch(() => '');
  return NextResponse.json(ok({ banner }));
}
