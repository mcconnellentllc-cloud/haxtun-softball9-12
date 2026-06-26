import { NextRequest, NextResponse } from "next/server";
import yaml from "js-yaml";
import { withErrorHandling } from "@/lib/http";

// Always pull the latest stats from GitHub raw. Coaches expect a new
// Game-N import to appear in the portal Stats tab immediately on refresh,
// not after a 10-minute revalidate window. Traffic is light (a handful of
// coaches) so the fetch hit per request is fine.
export const dynamic = "force-dynamic";

// Current-season stats source. Override with STATS_YML_URL if it moves.
const CURRENT_URL =
  process.env.STATS_YML_URL ??
  "https://raw.githubusercontent.com/mcconnellentllc-cloud/haxtun-softball9-12/main/_data/stats.yml";

// Past-season stats source. {year} is replaced. Override with SEASON_YML_URL_TEMPLATE.
const SEASON_URL_TEMPLATE =
  process.env.SEASON_YML_URL_TEMPLATE ??
  "https://raw.githubusercontent.com/mcconnellentllc-cloud/haxtun-softball9-12/main/_data/seasons/{year}.yml";

export const GET = withErrorHandling(async (req: NextRequest) => {
  const season = req.nextUrl.searchParams.get("season");
  const url =
    season && /^\d{4}$/.test(season)
      ? SEASON_URL_TEMPLATE.replace("{year}", season)
      : CURRENT_URL;

  const res = await fetch(url, { cache: "no-store" });
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
      season: season ?? "current",
      last_updated: data.last_updated ?? null,
      games_played: data.games_played ?? null,
      team_record: data.team_record ?? null,
      batting: Array.isArray(data.batting) ? data.batting : [],
      pitching: Array.isArray(data.pitching) ? data.pitching : [],
      fielding: Array.isArray(data.fielding) ? data.fielding : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
