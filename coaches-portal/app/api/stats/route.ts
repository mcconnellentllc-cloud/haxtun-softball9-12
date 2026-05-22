import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { withErrorHandling } from "@/lib/http";

// Cache the upstream YAML for 10 minutes so we don't hit GitHub on every load.
export const revalidate = 600;

// Same _data/stats.yml the public Jekyll page reads. Override with
// STATS_YML_URL if the source ever moves.
const STATS_URL =
  process.env.STATS_YML_URL ??
  "https://raw.githubusercontent.com/mcconnellentllc-cloud/haxtun-softball9-12/main/_data/stats.yml";

export const GET = withErrorHandling(async () => {
  const res = await fetch(STATS_URL, { next: { revalidate: 600 } });
  if (!res.ok) {
    return NextResponse.json(
      { error: `Failed to load stats (${res.status})` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const text = await res.text();
  const data = (yaml.load(text) ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    last_updated: data.last_updated ?? null,
    games_played: data.games_played ?? null,
    batting: Array.isArray(data.batting) ? data.batting : [],
    pitching: Array.isArray(data.pitching) ? data.pitching : [],
    fielding: Array.isArray(data.fielding) ? data.fielding : [],
  });
});
