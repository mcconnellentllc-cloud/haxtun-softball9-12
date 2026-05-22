# Bulldogs Coaches Portal — Setup

Password-protected PWA for the coaches to manage the roster, depth chart,
A/B team squads, and per-game defense rotations + batting lineups, with
per-coach proposals. Backend = Airtable. Hosted on Vercel.
**Separate from the public site repo.**

---

## 1. Create the Airtable base

Make a base named **Bulldogs Coaches** with three tables.

### Table: `Players`
| Field | Type | Notes |
|---|---|---|
| First Name | Single line text | required |
| Last Name | Single line text | required |
| Jersey | Number (integer) | optional |
| Active | Checkbox | default checked (soft-delete flag) |
| Created | Created time | auto |

### Table: `State`
| Field | Type |
|---|---|
| Key | Single line text (primary) |
| Value | Long text |
| Updated | Last modified time |

Add two rows:
- `Key = depth_chart`, `Value = {}`
- `Key = squads`, `Value = {}`

(If you skip this, the app creates them on first write.)

### Table: `ActivityLog` (optional but recommended)
| Field | Type |
|---|---|
| Coach | Single select: `Emily`, `Jordan`, `Kyle` |
| Action | Single line text |
| Detail | Long text |
| Timestamp | Created time |

---

## 2. Airtable token

Create a **personal access token** at <https://airtable.com/create/tokens>:
- Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`
- Access: **only** the Bulldogs Coaches base

Copy the token (`pat...`) and the base ID (`app...`, from the base URL or
the API docs page).

---

## 3. Seed the 16 players

`scripts/players.json` already holds the real roster (full names, jersey
`null` until designed). From the repo root:

```bash
export AIRTABLE_API_KEY=patXXXX
export AIRTABLE_BASE_ID=appXXXX
npm run seed
```

The seed is idempotent — re-running skips players that already exist.
Update jersey numbers in Airtable (or in `players.json` then re-seed) once
they're designed.

---

## 4. Required environment variables

The portal needs five variables. **Four are app env vars** (set them in
local `.env` *and* on Vercel). **One is CLI-only** and must never become an
app env var.

### App env vars — local `.env` + Vercel (Project → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `AIRTABLE_API_KEY` | Airtable personal access token, scoped to the Bulldogs base only |
| `AIRTABLE_BASE_ID` | The target base (`app...`) |
| `PORTAL_PASSWORD` | Shared coach login password — the portal's only real access control |
| `SESSION_SECRET` | Signing key for the session cookie; generate with `openssl rand -hex 32` |

`PORTAL_PASSWORD` and `SESSION_SECRET` are **both required**, not optional:

- Without `SESSION_SECRET`, **every route returns 500** — the middleware
  verifies the session cookie on each request (`lib/auth.ts`).
- Without `PORTAL_PASSWORD`, login returns `500 Server not configured`
  (`app/api/auth/login/route.ts`).

```
AIRTABLE_API_KEY=patXXXX
AIRTABLE_BASE_ID=appXXXX
PORTAL_PASSWORD=<the shared coaches password>
SESSION_SECRET=<openssl rand -hex 32>
```

Copy `.env.example` to `.env` for local dev and fill these in. Pick a
`PORTAL_PASSWORD` the coaches remember but outsiders won't guess. Never
commit `.env` (it's gitignored).

### CLI-only — never an app env var

| Variable | Purpose |
|---|---|
| `VERCEL_TOKEN` | Authenticates `npx vercel` for deploys. Used by the CLI only — do **not** add it to the Vercel project's env vars. |

### Vercel deploy specifics (details in section 6)

- Project **Root Directory = `coaches-portal`** — so Vercel builds the
  Next.js app, not the Jekyll site.
- After the first deploy, paste the production URL into the public site's
  `_config.yml` → `coaches_portal_url`.

---

## 5. Run locally

```bash
npm install
npm run dev
# http://localhost:3000  → redirects to /login
```

(`next-pwa` is disabled in dev; the service worker only builds in production.)

---

## 6. Deploy to Vercel

This app lives in the `coaches-portal/` subfolder of the public site repo
(`mcconnellentllc-cloud/haxtun-softball9-12`), so there's no separate repo to
create. In Vercel:

1. <https://vercel.com/new> → **Import** the `haxtun-softball9-12` repo.
2. **Root Directory** → set to **`coaches-portal`** (the key step — this tells
   Vercel to build the Next.js app, not the Jekyll site).
3. Framework preset: Next.js (auto-detected).
4. Add the four env vars (step 4) — including `PORTAL_PASSWORD`.
5. Deploy. Default URL: `haxtun-softball9-12.vercel.app` (rename in settings if
   you like).
6. Paste that URL into the public site's `_config.yml` → `coaches_portal_url:`
   so the red "H" logo links to the portal.

HTTPS is automatic. `robots.txt` + the global `X-Robots-Tag: noindex`
header keep it out of search engines.

> The portal source is public (it's in the public repo), but that's fine — all
> security is the password + Airtable token, which live only in Vercel env
> vars and are never committed. No player full names are committed here either.

---

## 7. Install on phones

Open the URL in Safari (iPhone) or Chrome (Android) → Add to Home Screen.
Launches full-screen with the red theme.

---

## Architecture

```
middleware.ts            Auth gate. Verifies signed cookie on every route
                         except /login and /api/auth/*. 401 for /api, redirect
                         to /login for pages.
lib/auth.ts              jose JWT: createSessionToken / verifySessionToken.
lib/airtable.ts          fetch-based Airtable client (players + state + log).
lib/lineup-cleanup.ts    Strips a removed player from depth_chart + squads.
lib/schedule.ts          Season game list; drives the per-game picker.

app/login/page.tsx       Password field → POST /api/auth/login.
app/page.tsx             The portal UI: roster, teams, depth, propose, plan.

app/api/auth/login       POST: verify password, set signed cookie.
app/api/auth/logout      POST (JSON) / GET (redirect): clear cookie.
app/api/players          GET list active, POST add.
app/api/players/[id]     PATCH edit, DELETE soft-delete + scrub from state.
app/api/state            GET { depth_chart, coach_depth, squads, proposals,
                         gameplans, notes }.
app/api/state/depth      PUT full depth_chart JSON.
app/api/state/squads     PUT full squads JSON (A/B team rosters).
app/api/state/proposals  PUT full proposals JSON (per-coach, per-game plans).
app/api/state/gameplans  PUT full gameplans JSON (the team plan, per game).
```

### State JSON shapes
```jsonc
// depth_chart  — position -> ordered player ids
{ "P": ["recXXX"], "C": [], "1B": [] }

// squads  — the A team / B team rosters
{ "A": ["recXXX"], "B": ["recYYY"] }

// gameplans  — game date -> per-squad plan (proposals share this per-coach).
// defense/batting are each a 5-element array (one per inning); defense maps
// position -> player, batting maps batting slot ("1".."12") -> player.
{
  "2026-05-26": {
    "A": {
      "defense": [ { "P": "recXXX" } ],
      "batting": [ { "1": "recXXX", "2": "recYYY" } ]
    },
    "B": { "defense": [], "batting": [] }
  }
}
```
`recXXX` = the Airtable record ID of the player. Game keys come from
`lib/schedule.ts`.

Coach identity is per-device (`localStorage`), chosen inline on the Propose
tab; mutations send an `X-Coach: <name>` header so ActivityLog can attribute
changes.

---

## Stats data (`_data/stats.yml`)

`_data/stats.yml` is **generated from a GameChanger CSV export** by
`scripts/import-gamechanger.mjs` — don't hand-edit it; re-run the importer after
each game (see "Updating stats after a game" below). It has three sections —
`batting:`, `pitching:`, `fielding:` — keyed by `jersey`, with snake_case stat
keys (rate stats quoted as strings so they display as `.938`, not `0.938`).

Both the public `/stats/` page and the portal **Stats** tab read this same file
(the portal fetches it from the public repo's raw GitHub URL, cached ~10 min via
`app/api/stats/route.ts`; override the source with `STATS_YML_URL`). The public
page is sorted by jersey; the portal ranks each table by a composite score
(every stat normalized 0–1 against the roster max, then averaged):

- Batting: average of normalized **AVG, OBP, H, RBI**
- Pitching: average of normalized **1/ERA, K, 1/WHIP**
- Fielding: average of normalized **FPCT, PO, A, 1/(E+1)**

**Privacy:** jersey **#23** is name-withheld on the public site. The importer
writes only `name: "#23"` + `hidden: true` for her — her real name never enters
this public repo. The public page renders her as "—"; the private portal shows
her real name by joining the jersey to the Airtable roster.

---

## Updating stats after a game

1. In GameChanger, export the **season stats** as CSV.
2. Save it under `coaches-portal/scripts/imports/` (gitignored — raw exports are
   never committed; the folder is kept by a `.gitkeep`).
3. From `coaches-portal/`, run the importer:
   ```bash
   node scripts/import-gamechanger.mjs scripts/imports/your-export.csv
   ```
   This regenerates `_data/stats.yml` (batting + pitching + fielding, with the
   GameChanger glossary as a comment block at the top).
4. Commit the updated `_data/stats.yml`.
5. Push: the public site auto-deploys (GitHub Pages), and the portal Stats tab
   reads the same file on its next load. No code changes needed per game.

---

## Concurrency
State blobs are last-write-wins, which is fine for 3 coaches. To harden,
send `If-Match` with the prior `Updated` timestamp and reject on mismatch.
