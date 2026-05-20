import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as {
    password?: string;
  } | null;
  const password = body?.password ?? "";

  const expected = process.env.PORTAL_PASSWORD;
  if (!expected) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }
  if (password !== expected) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  const token = await createSessionToken();
  const res = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
