import { NextResponse } from "next/server";
import { getState } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

export const GET = withErrorHandling(async () => {
  const state = await getState();
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
});
