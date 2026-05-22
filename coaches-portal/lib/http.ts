import { NextResponse } from "next/server";

const noStore = { "Cache-Control": "no-store" };

// Wraps a route handler so a thrown error becomes a JSON 500 carrying the real
// message, instead of an opaque HTML error page. Without this, a failed
// Airtable call (missing env var, bad token scope, unknown field, etc.) reaches
// the client as "Unexpected end of JSON input" with no hint of the cause. The
// error is also logged so it still shows up in the platform's runtime logs.
export function withErrorHandling<A extends unknown[]>(
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      console.error("API route error:", message);
      return NextResponse.json(
        { error: message },
        { status: 500, headers: noStore },
      );
    }
  };
}
