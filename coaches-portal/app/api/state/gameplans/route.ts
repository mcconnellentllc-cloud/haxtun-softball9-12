import { NextRequest, NextResponse } from "next/server";
import { setStateValue, logActivity } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

// Body is the full game plans object (every week's defense grid + lineup).
// Replaces the stored Value.
export const PUT = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be the full game plans object" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  await setStateValue("gameplans", body);
  await logActivity(req.headers.get("x-coach") ?? "Unknown", "update_gameplans");
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});
