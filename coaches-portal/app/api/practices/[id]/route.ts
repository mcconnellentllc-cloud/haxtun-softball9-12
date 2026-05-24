import { NextRequest, NextResponse } from "next/server";
import { getPractice, updatePractice, logActivity } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

// Confirm or cancel a practice. Body: { action: "confirm" | "cancel", reason? }
export const PATCH = withErrorHandling(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  const coach = req.headers.get("x-coach")?.trim();
  if (!coach) {
    return NextResponse.json(
      { error: "Pick your name (coach) first" },
      { status: 400, headers: noStore },
    );
  }

  const body = (await req.json().catch(() => null)) as {
    action?: string;
    reason?: string;
  } | null;
  const action = body?.action;

  const current = await getPractice(id);

  if (action === "confirm") {
    if (current.proposed_by === coach) {
      return NextResponse.json(
        { error: "The proposer can't confirm their own practice" },
        { status: 400, headers: noStore },
      );
    }
    const confirmations = current.confirmations.includes(coach)
      ? current.confirmations
      : [...current.confirmations, coach];
    // ≥1 confirmation from a non-proposer publishes the practice.
    const status = confirmations.length >= 1 ? "confirmed" : current.status;
    const practice = await updatePractice(id, { confirmations, status });
    await logActivity(coach, "confirm_practice", current.id);
    return NextResponse.json({ practice }, { headers: noStore });
  }

  if (action === "cancel") {
    const reason = body?.reason?.trim();
    if (!reason) {
      return NextResponse.json(
        { error: "A cancellation reason is required" },
        { status: 400, headers: noStore },
      );
    }
    const notes =
      (current.notes ? current.notes + "\n" : "") +
      `Cancelled by ${coach}: ${reason}`;
    const practice = await updatePractice(id, { status: "cancelled", notes });
    await logActivity(coach, "cancel_practice", current.id);
    return NextResponse.json({ practice }, { headers: noStore });
  }

  return NextResponse.json(
    { error: "action must be 'confirm' or 'cancel'" },
    { status: 400, headers: noStore },
  );
});
