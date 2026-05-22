// GameChanger CSV → _data/stats.yml converter.
//
// Usage (run from coaches-portal/):
//   node scripts/import-gamechanger.mjs scripts/imports/export.csv
//
// The GameChanger season export is one wide sheet with three sections on row 1
// ("Batting", "Pitching", "Fielding" header cells), column headers on row 2,
// one row per player, then a "Totals" row and a "Glossary" row. We parse by
// locating the section header columns, then mapping row-2 header names within
// each section's column range — so repeated headers (GP, H, BB...) resolve to
// the right section.
//
// Privacy: jersey numbers in WITHHELD are name-withheld on the PUBLIC site. We
// emit only "#<jersey>" + hidden:true for them — their real name is never written
// to this (public) repo. The private coaches portal shows their name by joining
// the jersey to the Airtable roster.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "..", "_data", "stats.yml");

// Jerseys withheld on the public site.
const WITHHELD = new Set([23]);

/* ------------------------------ CSV parse ------------------------------ */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ----------------------------- Field reads ----------------------------- */

const cell = (row, idx) => (idx == null ? "" : (row[idx] ?? "").trim());
const int = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};
const flt = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
// Rate/percentage strings are kept verbatim (".000", "10.50", "-") for display.
const str = (v) => (v === "" ? "-" : v);

function displayName(jersey, first, last) {
  if (WITHHELD.has(jersey)) return `#${jersey}`;
  const li = (last || "").trim().charAt(0).toUpperCase();
  return li ? `${first.trim()} ${li}.` : first.trim();
}

/* ------------------------------- Convert ------------------------------- */

function convert(csvText) {
  const rows = parseCSV(csvText);
  const sectionRow = rows[0];
  const headerRow = rows[1];

  const sec = {};
  sectionRow.forEach((v, i) => {
    const t = (v || "").trim();
    if (t === "Batting" || t === "Pitching" || t === "Fielding") sec[t] = i;
  });
  if (sec.Batting == null || sec.Pitching == null || sec.Fielding == null) {
    throw new Error("Could not find Batting/Pitching/Fielding section headers");
  }

  // Map header name -> column index, restricted to a section's column range.
  const mapFor = (start, end) => {
    const m = {};
    for (let i = start; i < end; i++) {
      const h = (headerRow[i] || "").trim();
      if (h && !(h in m)) m[h] = i;
    }
    return m;
  };
  const bat = mapFor(sec.Batting, sec.Pitching);
  const pit = mapFor(sec.Pitching, sec.Fielding);
  const fld = mapFor(sec.Fielding, headerRow.length);

  const players = rows
    .slice(2)
    .filter((r) => /^\d+$/.test((r[0] || "").trim()))
    .map((r) => ({
      jersey: int(r[0]),
      first: cell(r, 2),
      last: cell(r, 1),
      r,
    }));

  const batting = [];
  const pitching = [];
  const fielding = [];

  for (const p of players) {
    const { jersey, r } = p;
    const name = displayName(jersey, p.first, p.last);
    const hidden = WITHHELD.has(jersey);
    const b = (k) => cell(r, bat[k]);
    const pi = (k) => cell(r, pit[k]);
    const f = (k) => cell(r, fld[k]);

    batting.push({
      jersey,
      name,
      ...(hidden ? { hidden: true } : {}),
      gp: int(b("GP")),
      pa: int(b("PA")),
      ab: int(b("AB")),
      avg: str(b("AVG")),
      obp: str(b("OBP")),
      ops: str(b("OPS")),
      slg: str(b("SLG")),
      h: int(b("H")),
      doubles: int(b("2B")),
      triples: int(b("3B")),
      hr: int(b("HR")),
      rbi: int(b("RBI")),
      r: int(b("R")),
      bb: int(b("BB")),
      so: int(b("SO")),
      hbp: int(b("HBP")),
      sb: int(b("SB")),
      sb_pct: str(b("SB%")),
      qab: int(b("QAB")),
      qab_pct: str(b("QAB%")),
    });

    if (flt(pi("IP")) > 0) {
      pitching.push({
        jersey,
        name,
        ...(hidden ? { hidden: true } : {}),
        ip: str(pi("IP")),
        gp: int(pi("GP")),
        gs: int(pi("GS")),
        bf: int(pi("BF")),
        pitches: int(pi("#P")),
        w: int(pi("W")),
        l: int(pi("L")),
        h_allowed: int(pi("H")),
        r_allowed: int(pi("R")),
        er: int(pi("ER")),
        bb: int(pi("BB")),
        so: int(pi("SO")),
        hbp: int(pi("HBP")),
        era: str(pi("ERA")),
        whip: str(pi("WHIP")),
        baa: str(pi("BAA")),
        k_per_bb: str(pi("K/BB")),
        fps_pct: str(pi("FPS%")),
      });
    }

    fielding.push({
      jersey,
      name,
      ...(hidden ? { hidden: true } : {}),
      tc: int(f("TC")),
      a: int(f("A")),
      po: int(f("PO")),
      fpct: str(f("FPCT")),
      e: int(f("E")),
      dp: int(f("DP")),
      inn_total: flt(f("Total")),
      positions: {
        p: flt(f("P")),
        c: flt(f("C")),
        "1b": flt(f("1B")),
        "2b": flt(f("2B")),
        "3b": flt(f("3B")),
        ss: flt(f("SS")),
        lf: flt(f("LF")),
        cf: flt(f("CF")),
        rf: flt(f("RF")),
        sf: flt(f("SF")),
      },
    });
  }

  const byJersey = (a, b) => a.jersey - b.jersey;
  batting.sort(byJersey);
  pitching.sort(byJersey);
  fielding.sort(byJersey);

  const gamesPlayed = batting.reduce((m, p) => Math.max(m, p.gp), 0);

  // Glossary comment block (deduped, in sheet order).
  const glossRow = rows.find((r) => (r[0] || "").trim() === "Glossary") || [];
  const seen = new Set();
  const glossary = glossRow
    .map((c) => (c || "").trim())
    .filter((c) => c.includes("=") && !seen.has(c) && seen.add(c));

  return { batting, pitching, fielding, gamesPlayed, glossary };
}

/* -------------------------------- Emit --------------------------------- */

const NEEDS_QUOTE_KEY = /[^a-z_]/i; // quote keys like "1b"
function key(k) {
  return NEEDS_QUOTE_KEY.test(k) ? JSON.stringify(k) : k;
}
function val(v) {
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(String(v)); // strings always quoted
}
function flow(obj) {
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      parts.push(`${key(k)}: { ${Object.entries(v).map(([kk, vv]) => `${key(kk)}: ${val(vv)}`).join(", ")} }`);
    } else {
      parts.push(`${key(k)}: ${val(v)}`);
    }
  }
  return `{ ${parts.join(", ")} }`;
}

function emit({ batting, pitching, fielding, gamesPlayed, glossary }) {
  const today = new Date().toISOString().slice(0, 10);
  const lines = [];
  lines.push("# Haxtun Bulldogs — season stats");
  lines.push("# Generated from a GameChanger CSV export by");
  lines.push("# coaches-portal/scripts/import-gamechanger.mjs — do not hand-edit;");
  lines.push("# re-run the importer after each game (see coaches-portal/SETUP.md).");
  lines.push("#");
  lines.push("# Jersey #23 is name-withheld on the public site (hidden: true). Do not");
  lines.push("# add a real name here — the private coaches portal resolves it from Airtable.");
  lines.push("#");
  lines.push("# GameChanger glossary:");
  for (const g of glossary) lines.push(`#   ${g}`);
  lines.push("");
  lines.push(`last_updated: ${today}`);
  lines.push(`games_played: ${gamesPlayed}`);
  lines.push("");
  lines.push("batting:");
  for (const p of batting) lines.push(`  - ${flow(p)}`);
  lines.push("");
  lines.push("pitching:");
  for (const p of pitching) lines.push(`  - ${flow(p)}`);
  lines.push("");
  lines.push("fielding:");
  for (const p of fielding) lines.push(`  - ${flow(p)}`);
  lines.push("");
  return lines.join("\n");
}

/* -------------------------------- Main --------------------------------- */

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node scripts/import-gamechanger.mjs <path-to-export.csv>");
  process.exit(1);
}
const csvText = readFileSync(resolve(process.cwd(), inputPath), "utf8");
const data = convert(csvText);
writeFileSync(OUT, emit(data), "utf8");
console.log(
  `Wrote ${OUT}\n  batting: ${data.batting.length}  pitching: ${data.pitching.length}  fielding: ${data.fielding.length}  games: ${data.gamesPlayed}`,
);
