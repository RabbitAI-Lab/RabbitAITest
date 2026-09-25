import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** liveness。 */
export async function GET() {
  return NextResponse.json({ code: 0, message: 'ok', data: { status: 'UP' } });
}
