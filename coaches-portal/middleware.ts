import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const ok = await verifySessionToken(token);
  if (ok) return NextResponse.next();

  const { pathname } = req.nextUrl;
  // API routes get a 401; page routes get redirected to /login.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Protect everything except the login page, the auth endpoints, Next
  // internals, and PWA/static assets.
  matcher: [
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|manifest.json|robots.txt|sw.js|workbox-|icons/).*)",
  ],
};
