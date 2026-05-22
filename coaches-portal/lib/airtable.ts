// Thin Airtable REST client using fetch (no SDK). All reads are no-store.

const API = "https://api.airtable.com/v0";

function baseId(): string {
  const id = process.env.AIRTABLE_BASE_ID;
  if (!id) throw new Error("AIRTABLE_BASE_ID is not set");
  return id;
}

function tableUrl(table: string): string {
  return `${API}/${baseId()}/${encodeURIComponent(table)}`;
}

function authHeaders(): HeadersInit {
  const key = process.env.AIRTABLE_API_KEY;
  if (!key) throw new Error("AIRTABLE_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

async function at<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Airtable ${res.status} ${res.statusText}: ${body}`);
  }
  return (await res.json()) as T;
}

/* ----------------------------- Players ----------------------------- */

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  jersey: number | null;
  active: boolean;
}

function toPlayer(r: AirtableRecord): Player {
  const j = r.fields["Jersey"];
  return {
    id: r.id,
    firstName: String(r.fields["First Name"] ?? ""),
    lastName: String(r.fields["Last Name"] ?? ""),
    jersey: typeof j === "number" ? j : null,
    active: r.fields["Active"] !== false,
  };
}

export async function listActivePlayers(): Promise<Player[]> {
  const url =
    `${tableUrl("Players")}?pageSize=100&filterByFormula=` +
    encodeURIComponent("{Active}=TRUE()");
  const data = await at<{ records: AirtableRecord[] }>(url);
  return data.records
    .map(toPlayer)
    .sort(
      (a, b) =>
        (a.jersey ?? 9999) - (b.jersey ?? 9999) ||
        a.firstName.localeCompare(b.firstName),
    );
}

export async function createPlayer(p: {
  firstName: string;
  lastName: string;
  jersey?: number | null;
}): Promise<Player> {
  const fields: Record<string, unknown> = {
    "First Name": p.firstName,
    "Last Name": p.lastName,
    Active: true,
  };
  if (p.jersey != null) fields["Jersey"] = p.jersey;
  const rec = await at<AirtableRecord>(tableUrl("Players"), {
    method: "POST",
    body: JSON.stringify({ fields }),
  });
  return toPlayer(rec);
}

export async function updatePlayer(
  id: string,
  p: Partial<{
    firstName: string;
    lastName: string;
    jersey: number | null;
    active: boolean;
  }>,
): Promise<Player> {
  const fields: Record<string, unknown> = {};
  if (p.firstName !== undefined) fields["First Name"] = p.firstName;
  if (p.lastName !== undefined) fields["Last Name"] = p.lastName;
  if (p.jersey !== undefined) fields["Jersey"] = p.jersey;
  if (p.active !== undefined) fields["Active"] = p.active;
  const rec = await at<AirtableRecord>(`${tableUrl("Players")}/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  return toPlayer(rec);
}

/* ------------------------------ State ------------------------------ */

export interface PortalState {
  depth_chart: Record<string, unknown>;
  lineups: Record<string, unknown>;
  proposals: Record<string, unknown>;
}

const STATE_KEYS = ["depth_chart", "lineups", "proposals"] as const;
type StateKey = (typeof STATE_KEYS)[number];

function safeParse(s: unknown): Record<string, unknown> {
  if (typeof s !== "string") return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

export async function getState(): Promise<PortalState> {
  const data = await at<{ records: AirtableRecord[] }>(
    `${tableUrl("State")}?pageSize=10`,
  );
  const map: Record<string, unknown> = {};
  for (const r of data.records) {
    map[String(r.fields["Key"])] = r.fields["Value"];
  }
  return {
    depth_chart: safeParse(map["depth_chart"]),
    lineups: safeParse(map["lineups"]),
    proposals: safeParse(map["proposals"]),
  };
}

async function findStateRecord(key: StateKey): Promise<AirtableRecord | null> {
  const url =
    `${tableUrl("State")}?pageSize=1&filterByFormula=` +
    encodeURIComponent(`{Key}="${key}"`);
  const data = await at<{ records: AirtableRecord[] }>(url);
  return data.records[0] ?? null;
}

export async function setStateValue(
  key: StateKey,
  value: unknown,
): Promise<void> {
  const json = JSON.stringify(value ?? {});
  const existing = await findStateRecord(key);
  if (existing) {
    await at(`${tableUrl("State")}/${existing.id}`, {
      method: "PATCH",
      body: JSON.stringify({ fields: { Value: json } }),
    });
  } else {
    await at(tableUrl("State"), {
      method: "POST",
      body: JSON.stringify({ fields: { Key: key, Value: json } }),
    });
  }
}

/* --------------------------- ActivityLog --------------------------- */
// Optional table. Logging never blocks a mutation.

export async function logActivity(
  coach: string,
  action: string,
  detail = "",
): Promise<void> {
  try {
    await at(tableUrl("ActivityLog"), {
      method: "POST",
      body: JSON.stringify({
        fields: { Coach: coach || "Unknown", Action: action, Detail: detail },
      }),
    });
  } catch {
    // ActivityLog may not exist or coach may not be a valid select option —
    // never fail the underlying request because of logging.
  }
}
