import { NextRequest, NextResponse } from "next/server";
import { listActivePlayers, createPlayer, logActivity } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export const GET = withErrorHandling(async () => {
  const players = await listActivePlayers();
  return NextResponse.json({ players }, { headers: noStore });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    firstName?: string;
    lastName?: string;
    jersey?: number | string | null;
  } | null;

  const firstName = body?.firstName?.trim();
  const lastName = body?.lastName?.trim();
  if (!firstName || !lastName) {
    return NextResponse.json(
      { error: "firstName and lastName are required" },
      { status: 400, headers: noStore },
    );
  }

  const jersey =
    body?.jersey == null || body.jersey === "" ? null : Number(body.jersey);
  if (jersey != null && Number.isNaN(jersey)) {
    return NextResponse.json(
      { error: "jersey must be a number" },
      { status: 400, headers: noStore },
    );
  }

  const player = await createPlayer({ firstName, lastName, jersey });
  await logActivity(
    req.headers.get("x-coach") ?? "Unknown",
    "add_player",
    `${player.firstName} ${player.lastName}`,
  );
  return NextResponse.json({ player }, { status: 201, headers: noStore });
});
