import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { getSession } from "@/lib/session";
import { audit } from "@/server/domains/system/auth.service";

export const runtime = "nodejs";

export async function POST() {
  const session = await getSession();
  const userId = session.userId ?? null;
  session.destroy();
  if (userId) await audit(userId, "logout", "user", userId);
  return NextResponse.json(ok(null));
}
