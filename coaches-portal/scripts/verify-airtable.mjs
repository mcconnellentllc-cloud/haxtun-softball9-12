#!/usr/bin/env node
// Read-only Airtable connection + schema check. Makes NO writes.
//
// Usage:
//   AIRTABLE_API_KEY=pat... AIRTABLE_BASE_ID=app... node scripts/verify-airtable.mjs
//
// Phase 1 (connection): confirms the token works, the configured base is
// reachable, and prints the base id + table list.
// Phase 2 helper (schema): prints a read-only comparison of the live base
// against the schema documented in SETUP.md. It never modifies the base.
//
// Exit code is 0 only when the connection + base lookup succeed. The schema
// comparison is informational and does not change the exit code, so Phase 1
// can pass even if Phase 2 surfaces drift to discuss.

const API = "https://api.airtable.com/v0";

const KEY = process.env.AIRTABLE_API_KEY;
const BASE = process.env.AIRTABLE_BASE_ID;
if (!KEY || !BASE) {
  console.error("Set AIRTABLE_API_KEY and AIRTABLE_BASE_ID in the environment.");
  process.exit(1);
}

const headers = { Authorization: `Bearer ${KEY}` };

async function get(url) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  if (!res.ok) {
    // Never echo the token; surface status + Airtable's error body only.
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return JSON.parse(text);
}

// Expected schema, mirroring coaches-portal/SETUP.md + the field labels used
// in lib/airtable.ts. Optional fields/tables are flagged so their absence is
// reported as a note, not a failure.
const EXPECTED = {
  Players: {
    optional: false,
    fields: {
      "First Name": "singleLineText",
      "Last Name": "singleLineText",
      Jersey: "number",
      Active: "checkbox",
      Created: "createdTime",
    },
  },
  State: {
    optional: false,
    fields: {
      Key: "singleLineText",
      Value: "multilineText",
      Updated: "lastModifiedTime",
    },
  },
  ActivityLog: {
    optional: true,
    fields: {
      Coach: "singleSelect",
      Action: "singleLineText",
      Detail: "multilineText",
      Timestamp: "createdTime",
    },
  },
};

function compareSchema(liveTables) {
  const byName = new Map(liveTables.map((t) => [t.name, t]));
  const issues = [];
  const notes = [];

  for (const [tableName, spec] of Object.entries(EXPECTED)) {
    const live = byName.get(tableName);
    if (!live) {
      (spec.optional ? notes : issues).push(
        `Missing table: ${tableName}${spec.optional ? " (optional)" : ""}`,
      );
      continue;
    }
    const liveFields = new Map(live.fields.map((f) => [f.name, f.type]));
    for (const [fieldName, expectedType] of Object.entries(spec.fields)) {
      if (!liveFields.has(fieldName)) {
        issues.push(`${tableName}: missing field "${fieldName}"`);
        continue;
      }
      const actualType = liveFields.get(fieldName);
      if (actualType !== expectedType) {
        // Type drift is a note, not a hard failure — some types are
        // interchangeable in practice (e.g. multilineText vs richText).
        notes.push(
          `${tableName}.${fieldName}: type is "${actualType}", expected "${expectedType}"`,
        );
      }
    }
  }
  return { issues, notes };
}

async function main() {
  console.log("== Phase 1: connection ==");

  // Lists every base the token can see. Requires schema.bases:read scope.
  const { bases } = await get(`${API}/meta/bases`);
  console.log(`Token OK. Accessible bases: ${bases.length}`);

  const target = bases.find((b) => b.id === BASE);
  if (!target) {
    console.error(
      `\nConfigured AIRTABLE_BASE_ID (${BASE}) is not in the token's accessible bases.`,
    );
    console.error("Bases this token can reach:");
    for (const b of bases) console.log(`  - ${b.id}  ${b.name} (${b.permissionLevel})`);
    process.exit(1);
  }
  console.log(`Base: ${target.id}  "${target.name}"  (${target.permissionLevel})`);

  const { tables } = await get(`${API}/meta/bases/${BASE}/tables`);
  console.log(`Tables (${tables.length}):`);
  for (const t of tables) {
    console.log(`  - ${t.name}  [${t.fields.length} fields]`);
    for (const f of t.fields) console.log(`      ${f.name} : ${f.type}`);
  }

  console.log("\n== Phase 2 helper: schema vs SETUP.md (read-only) ==");
  const { issues, notes } = compareSchema(tables);
  if (issues.length === 0 && notes.length === 0) {
    console.log("Schema matches SETUP.md. No issues.");
  } else {
    if (issues.length) {
      console.log("Mismatches (would block seeding):");
      for (const i of issues) console.log(`  ! ${i}`);
    }
    if (notes.length) {
      console.log("Notes (review, not necessarily blocking):");
      for (const n of notes) console.log(`  ~ ${n}`);
    }
  }
  console.log("\nNo changes were made to the base.");
}

main().catch((err) => {
  console.error(`\nVerification failed: ${err.message}`);
  process.exit(1);
});
