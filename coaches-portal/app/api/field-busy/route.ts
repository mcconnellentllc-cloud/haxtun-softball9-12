import { NextResponse } from "next/server";
import yaml from "js-yaml";
import { withErrorHandling } from "@/lib/http";

// Cache the upstream YAML for 10 minutes.
export const revalidate = 600;

// Field/school unavailability from other orgs (portal-only). Same _data file
// Kyle maintains; override with FIELD_BUSY_YML_URL if it ever moves.
const URL_ =
  process.env.FIELD_BUSY_YML_URL ??
  "https://raw.githubusercontent.com/mcconnellentllc-cloud/haxtun-softball9-12/main/_data/field_busy.yml";

export const GET = withErrorHandling(async () => {
  try {
    const res = await fetch(URL_, { next: { revalidate: 600 } });
    if (!res.ok) return NextResponse.json({ busy: [] }, { headers: { "Cache-Control": "no-store" } });
    const text = await res.text();
    const data = yaml.load(text);
    const busy = Array.isArray(data) ? data : [];
    return NextResponse.json({ busy }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Optional aid — never break the calendar if the file is missing/unparseable.
    return NextResponse.json({ busy: [] }, { headers: { "Cache-Control": "no-store" } });
  }
});
