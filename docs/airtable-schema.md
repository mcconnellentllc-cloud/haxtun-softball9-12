# Airtable schema — `Practices` table

The coaches portal stores the propose/confirm/cancel workflow in a dedicated
`Practices` table in the existing base. A scheduled GitHub Action
(`.github/workflows/sync-practices.yml`) reads **confirmed** practices and
publishes a public-safe projection to `_data/practices.yml`.

Kyle creates this table manually (the agent has no Airtable access). After
creating it, paste the table ID and field IDs into the table below.

## Table: `Practices`

| Field | Type | Notes |
|---|---|---|
| `id` | Formula | `"prac-" & DATETIME_FORMAT(Date, 'YYYY-MM-DD') & "-" & SUBSTITUTE(StartTime, ":", "")` → e.g. `prac-2026-04-15-1730` |
| `Date` | Date | ISO (YYYY-MM-DD) |
| `StartTime` | Single line text | 24-hour `"17:30"` |
| `EndTime` | Single line text | 24-hour `"19:00"` |
| `Location` | Single line text | |
| `Focus` | Single line text | |
| `Notes` | Long text | private — never published |
| `ProposedBy` | Single select | `kyle`, `emily`, `jordan` |
| `Status` | Single select | `proposed`, `confirmed`, `cancelled` |
| `Confirmations` | Multiple select | `kyle`, `emily`, `jordan` (proposer auto-excluded by the portal UI) |
| `CreatedAt` | Created time | |
| `UpdatedAt` | Last modified time | |

> The `Status` and `ProposedBy`/`Confirmations` single/multiple-select options
> must be exactly the lowercase coach ids the portal sends (`kyle`, `emily`,
> `jordan`) and statuses (`proposed`, `confirmed`, `cancelled`).

### IDs (fill in after creating the table)

- Base ID: `app…` (same base as Players/State)
- `Practices` table ID: `tbl…`
- (field IDs optional — the portal and sync script address fields by name)

## What's public vs private

- **Public** (`_data/practices.yml`, only `Status = confirmed`): `id`, `date`,
  `start_time`, `end_time`, `location`, `focus`.
- **Private** (Airtable only, never committed): `Notes`, `ProposedBy`,
  `Confirmations`, `Status`, and any `proposed`/`cancelled` rows.

## Secrets for the GitHub Action (repo → Settings → Secrets → Actions)

- `AIRTABLE_TOKEN` — Airtable personal access token, **read-only** on this base
  (scope: `data.records:read`, access: this base only)
- `AIRTABLE_BASE_ID` — `app…`
- `AIRTABLE_PRACTICES_TABLE` — `Practices` (or the table ID)

The portal (Vercel) reads/writes the table with its existing
`AIRTABLE_API_KEY` + `AIRTABLE_BASE_ID`; set `AIRTABLE_PRACTICES_TABLE` in
Vercel too if you name the table anything other than `Practices`.

## Limitation: confirmation is honor-system, not authenticated

The portal logs in with a single **shared password**; "who you are" is just a
name you pick on the device (stored in `localStorage`) and sent as the `x-coach`
header. So `ProposedBy` and `Confirmations` record *the selected name*, not a
verified identity — anyone with the password could pick any name. The
"a different coach must confirm" rule is therefore an honor-system check.

That's fine for the three coaches today (they know each other). If the team
grows, or you ever need real accountability (audit trail of who proposed /
confirmed / cancelled), the prerequisite is **per-coach authenticated logins**
instead of the shared password — that's the architectural change to make first.
