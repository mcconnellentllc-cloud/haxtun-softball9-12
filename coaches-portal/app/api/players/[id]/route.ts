import { NextRequest, NextResponse } from "next/server";
import {
  updatePlayer,
  getState,
  setStateValue,
  logActivity,
} from "@/lib/airtable";
import { stripFromDepth, stripFromLineups } from "@/lib/lineup-cleanup";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string;
    lastName?: string;
    jersey?: number | string | null;
  };

  const patch: Parameters<typeof updatePlayer>[1] = {};
  if (body.firstName !== undefined) patch.firstName = body.firstName.trim();
  if (body.lastName !== undefined) patch.lastName = body.lastName.trim();
  if (body.jersey !== undefined) {
    patch.jersey =
      body.jersey === null || body.jersey === "" ? null : Number(body.jersey);
    if (patch.jersey != null && Number.isNaN(patch.jersey)) {
      return NextResponse.json(
        { error: "jersey must be a number" },
        { status: 400, headers: noStore },
      );
    }
  }

  const player = await updatePlayer(id, patch);
  await logActivity(
    req.headers.get("x-coach") ?? "Unknown",
    "edit_player",
    `${player.firstName} ${player.lastName}`,
  );
  return NextResponse.json({ player }, { headers: noStore });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Soft delete the player...
  await updatePlayer(id, { active: false });

  // ...then scrub them from the depth chart and every lineup slot.
  const state = await getState();
  await setStateValue("depth_chart", stripFromDepth(state.depth_chart, id));
  await setStateValue("lineups", stripFromLineups(state.lineups, id));

  await logActivity(
    req.headers.get("x-coach") ?? "Unknown",
    "remove_player",
    id,
  );
  return NextResponse.json({ ok: true }, { headers: noStore });
}
