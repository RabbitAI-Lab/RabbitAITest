import { NextResponse } from "next/server";
import { ok } from "@rabbit/shared";
import { withAuth, toResponse } from "@/server/guard";
import { listEnabledModelsForPicker } from "@/server/domains/ai/model.service";

export const runtime = "nodejs";

export const GET = withAuth(async (_ctx) => {
  try {
    return NextResponse.json(ok(await listEnabledModelsForPicker()));
  } catch (err) {
    return toResponse(err);
  }
});
