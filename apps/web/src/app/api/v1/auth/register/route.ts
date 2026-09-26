import { NextResponse } from "next/server";
import { z } from "zod";
import { ok } from "@rabbit/shared";
import { toResponse } from "@/server/guard";
import { registerUser, audit } from "@/server/domains/system/auth.service";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().email().max(256),
  password: z.string().min(8).max(128),
});

export async function POST(req: Request) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { code: 20422, message: parsed.error.issues[0]?.message ?? "参数校验失败", data: null },
        { status: 422 },
      );
    }
    const { user, projectId } = await registerUser(parsed.data.email, parsed.data.password);
    const session = await getSession();
    session.userId = user.id;
    session.email = user.email;
    await session.save();
    await audit(user.id, "register", "user", user.id);
    return NextResponse.json(ok({ userId: user.id, projectId }), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
