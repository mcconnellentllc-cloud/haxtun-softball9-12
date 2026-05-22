import { NextRequest, NextResponse } from "next/server";
import { setStateValue, logActivity } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

// Body is the full squads object ({ A: ids, B: ids }). Replaces Value.
export const PUT = withErrorHandling(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be the full squads object" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  await setStateValue("squads", body);
  await logActivity(req.headers.get("x-coach") ?? "Unknown", "update_squads");
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
});
