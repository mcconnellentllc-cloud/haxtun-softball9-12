import { NextResponse } from "next/server";
import { getState } from "@/lib/airtable";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getState();
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
