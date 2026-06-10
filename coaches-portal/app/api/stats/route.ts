import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { withErrorHandling } from "@/lib/http";

// Always pull the latest _data/stats.yml from main. Coaches expect a new
// Game-N import to appear in the portal Stats tab immediately on refresh,
// not after a 10-minute revalidate window. Traffic is light (a handful of
// coaches) so the fetch hit per request is fine; raw.githubusercontent.com
// handles this load easily.
export const dynamic = "force-dynamic";

// Same _data/stats.yml the public Jekyll page reads. Override with
// STATS_YML_URL if the source ever moves.
const STATS_URL =
  process.env.STATS_YML_URL ??
  "https://raw.githubusercontent.com/mcconnellentllc-cloud/haxtun-softball9-12/main/_data/stats.yml";

export const GET = withErrorHandling(async () => {
  const res = await fetch(STATS_URL, { cache: "no-store" });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Failed to load stats (${res.status})` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const text = await res.text();
  const data = (yaml.load(text) ?? {}) as Record<string, unknown>;

  return NextResponse.json(
    {
      last_updated: data.last_updated ?? null,
      games_played: data.games_played ?? null,
      batting: Array.isArray(data.batting) ? data.batting : [],
      pitching: Array.isArray(data.pitching) ? data.pitching : [],
      fielding: Array.isArray(data.fielding) ? data.fielding : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
