// Publish CONFIRMED practices from the Airtable `Practices` table to
// _data/practices.yml (public-safe: only the 6 whitelisted fields). Run by the
// sync-practices GitHub Action. Proposed/cancelled practices and all coach
// identities (proposer, confirmations, notes, status) stay in Airtable and
// never enter git.
//
// Env: AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_PRACTICES_TABLE

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "_data", "practices.yml");

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE = process.env.AIRTABLE_BASE_ID;
const TABLE = process.env.AIRTABLE_PRACTICES_TABLE || "Practices";

if (!TOKEN || !BASE) {
  // Not yet configured (secrets not added). No-op so the scheduled run is green.
  console.log("AIRTABLE_TOKEN/AIRTABLE_BASE_ID not set — skipping practice sync.");
  process.exit(0);
}

async function fetchConfirmed() {
  const rows = [];
  let offset;
  do {
    const url = new URL(
      `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(TABLE)}`,
    );
    url.searchParams.set("pageSize", "100");
    url.searchParams.set("filterByFormula", "{Status}='confirmed'");
    for (const f of ["id", "Date", "StartTime", "EndTime", "Location", "Focus"]) {
      url.searchParams.append("fields[]", f);
    }
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (!res.ok) {
      throw new Error(`Airtable ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    rows.push(...data.records);
    offset = data.offset;
  } while (offset);
  return rows;
}

const q = (s) => JSON.stringify(String(s ?? ""));

function toYaml(records) {
  const items = records
    .map((r) => r.fields)
    .filter((f) => f.Date && f.StartTime)
    .map((f) => ({
      id: String(f.id ?? `prac-${f.Date}-${String(f.StartTime).replace(":", "")}`),
      date: String(f.Date).slice(0, 10),
      start_time: String(f.StartTime),
      end_time: String(f.EndTime ?? ""),
      location: String(f.Location ?? ""),
      focus: String(f.Focus ?? ""),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  const lines = [
    "# Confirmed practices, published automatically from the coaches portal",
    "# (Airtable) by the sync-practices GitHub Action. Public-safe: no coach",
    "# names, no proposer, no status/notes. Do not hand-edit.",
    "",
  ];
  if (items.length === 0) lines.push("[]");
  for (const it of items) {
    lines.push(`- id: ${it.id}`);
    lines.push(`  date: ${it.date}`);
    lines.push(`  start_time: ${q(it.start_time)}`);
    lines.push(`  end_time: ${q(it.end_time)}`);
    lines.push(`  location: ${q(it.location)}`);
    lines.push(`  focus: ${q(it.focus)}`);
  }
  return lines.join("\n") + "\n";
}

const records = await fetchConfirmed();
const next = toYaml(records);
const prev = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

if (next === prev) {
  console.log("practices.yml unchanged — no commit needed");
  process.exit(0);
}
writeFileSync(OUT, next, "utf8");
console.log(`Wrote ${OUT} (${records.length} confirmed practices)`);
