import { NextRequest, NextResponse } from "next/server";
import { setStateValue, logActivity } from "@/lib/airtable";

export const dynamic = "force-dynamic";

// Body is the full depth_chart JSON object. Replaces the stored Value.
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Body must be the full depth_chart object" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  await setStateValue("depth_chart", body);
  await logActivity(req.headers.get("x-coach") ?? "Unknown", "update_depth");
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
