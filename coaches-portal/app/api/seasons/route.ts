import { NextResponse } from "next/server";
import { withErrorHandling } from "@/lib/http";

export const dynamic = "force-dynamic";

// Lists archived seasons available under _data/seasons/ on main. Uses GitHub
// Contents API so adding _data/seasons/2027.yml automatically appears in the
// portal dropdown without a code change.
const REPO_API =
  process.env.SEASONS_DIR_API_URL ??
  "https://api.github.com/repos/mcconnellentllc-cloud/haxtun-softball9-12/contents/_data/seasons?ref=main";

export const GET = withErrorHandling(async () => {
  const res = await fetch(REPO_API, {
    cache: "no-store",
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) {
    // Hard fallback so the dropdown still works if GitHub API rate-limits us
    // (60 req/hr unauth'd; portal traffic is light but be safe).
    return NextResponse.json(
      { seasons: ["2026"], fallback: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const entries = (await res.json()) as Array<{ name: string; type: string }>;
  const seasons = entries
    .filter((e) => e.type === "file" && /^\d{4}\.ya?ml$/.test(e.name))
    .map((e) => e.name.replace(/\.ya?ml$/, ""))
    .sort()
    .reverse();
  return NextResponse.json(
    { seasons },
    { headers: { "Cache-Control": "no-store" } },
  );
});
