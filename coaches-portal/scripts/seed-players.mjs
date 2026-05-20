#!/usr/bin/env node
// Seed the Airtable Players table from scripts/players.json.
//
// Usage:
//   AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... node scripts/seed-players.mjs
//
// Reads env from the shell. If you keep a .env file, export it first:
//   set -a; source .env; set +a; node scripts/seed-players.mjs
//
// Idempotency: skips a player if an active record with the same First+Last
// already exists, so it's safe to re-run.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const API = "https://api.airtable.com/v0";

const KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!KEY || !BASE) {
  console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the environment.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
const playersUrl = `${API}/${BASE}/Players`;

async function existingNames() {
  const set = new Set();
  let offset;
  do {
    const url = new URL(playersUrl);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`list failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) {
      set.add(`${r.fields["First Name"]}|${r.fields["Last Name"]}`.toLowerCase());
    }
    offset = data.offset;
  } while (offset);
  return set;
}

async function createPlayer(p) {
  const fields = { "First Name": p.firstName, "Last Name": p.lastName, Active: true };
  if (p.jersey != null) fields["Jersey"] = p.jersey;
  const res = await fetch(playersUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`create failed: ${res.status} ${await res.text()}`);
}

// Prefer scripts/players.json (gitignored, real names). Fall back to the
// committed public-safe example if it isn't present.
import { existsSync } from "node:fs";
const realPath = join(__dirname, "players.json");
const seedPath = existsSync(realPath) ? realPath : join(__dirname, "players.example.json");
if (seedPath.endsWith("players.example.json")) {
  console.warn("players.json not found — seeding from players.example.json (first-initial names).");
}
const players = JSON.parse(readFileSync(seedPath, "utf8"));
const have = await existingNames();

let created = 0;
let skipped = 0;
for (const p of players) {
  const k = `${p.firstName}|${p.lastName}`.toLowerCase();
  if (have.has(k)) {
    skipped++;
    console.log(`skip  ${p.firstName} ${p.lastName} (exists)`);
    continue;
  }
  await createPlayer(p);
  created++;
  console.log(`add   ${p.firstName} ${p.lastName}`);
}
console.log(`\nDone. ${created} created, ${skipped} skipped.`);
