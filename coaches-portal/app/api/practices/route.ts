import { NextRequest, NextResponse } from "next/server";
import { listPractices, createPractice, logActivity } from "@/lib/airtable";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export const GET = withErrorHandling(async () => {
  const practices = await listPractices();
  return NextResponse.json({ practices }, { headers: noStore });
});

export const POST = withErrorHandling(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as {
    date?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    focus?: string;
    notes?: string;
  } | null;

  const date = body?.date?.trim();
  const start_time = body?.start_time?.trim();
  const end_time = body?.end_time?.trim();
  const location = body?.location?.trim();
  const focus = body?.focus?.trim();
  const proposed_by = req.headers.get("x-coach")?.trim();

  if (!date || !start_time || !end_time || !location || !focus) {
    return NextResponse.json(
      { error: "date, start_time, end_time, location, and focus are required" },
      { status: 400, headers: noStore },
    );
  }
  if (!proposed_by) {
    return NextResponse.json(
      { error: "Pick your name (coach) before proposing a practice" },
      { status: 400, headers: noStore },
    );
  }

  const practice = await createPractice({
    date,
    start_time,
    end_time,
    location,
    focus,
    notes: body?.notes?.trim() ?? "",
    proposed_by,
  });
  await logActivity(proposed_by, "propose_practice", `${date} ${start_time}`);
  return NextResponse.json({ practice }, { status: 201, headers: noStore });
});
