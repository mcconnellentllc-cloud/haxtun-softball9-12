# Haxtun Bulldogs Softball — 2026 Site

A small Jekyll site for the Haxtun Bulldogs 9-12 girls softball team:
schedule, roster, league rules, NFHS reference, practices, standings,
announcements, and a one-tap "Add Schedule to Calendar" download.

**Live site:** https://mcconnellentllc-cloud.github.io/haxtun-softball9-12/

## Stack

- Jekyll 4 (GitHub Pages)
- Plugins: `jekyll-feed`, `jekyll-seo-tag`
- Fonts: Bebas Neue (display) + Manrope (body) via Google Fonts
- PWA: `manifest.json` + `service-worker.js` (Add to Home Screen, offline-friendly)

## Deploy

Already wired. Repo Settings → Pages → Source: deploy from branch →
`main` → root. Pushes to `main` build and publish in ~90 seconds.

## Before going live

Replace the placeholder roster in `_data/roster.yml` with real
**first name + last initial** only — no full last names, no DOBs, no
photos, no contact info.

## How to update content

| Edit | File |
|---|---|
| Game results, schedule changes | `_data/schedule.yml` |
| Standings | `_data/standings.yml` |
| Roster | `_data/roster.yml` |
| Practice plan | `practices.html` |
| Announcements | `_posts/YYYY-MM-DD-slug.md` |
| League rules wording | `league-rules.html` |
| NFHS summary | `nfhs-rules.html` |
| Coaches list | `_config.yml` (`head_coach`, `assistant_coaches`) |

## Adding an announcement

Create `_posts/2026-05-15-rainout-makeup.md`:

```markdown
---
layout: post
title: "Rainout: Tuesday makeup details"
date: 2026-05-15
---

Tuesday's game is rescheduled for Thursday at 6:00 PM.
Bring rain layers — field could be soft.
```

## Updating game results

Edit `_data/schedule.yml`, set the `result` field on the game:

```yaml
- date: 2026-05-19
  opponent: "Sidney"
  home: true
  result: "W 12-4"   # leave empty before the game
```

Commit + push. The schedule table picks it up automatically.

## Updating the iPhone calendar file

Whenever `_data/schedule.yml` changes, regenerate the `.ics`:

```bash
pip install pyyaml
python3 build_ics.py
```

That writes `assets/calendar/haxtun-bulldogs-2026.ics`. Commit it.
The download button on `/schedule/` and the home-page card both link
to that file.

## File structure

```
_config.yml
_data/
  schedule.yml
  roster.yml
  standings.yml
_layouts/
  default.html
  post.html
_includes/
  header.html
  footer.html
_posts/
  2026-05-01-welcome-to-the-2026-season.md
assets/
  css/style.css
  calendar/haxtun-bulldogs-2026.ics
  img/icon-192.png
  img/icon-512.png
index.html
schedule.html
roster.html
league-rules.html
nfhs-rules.html
practices.html
standings.html
news.html
404.html
manifest.json
service-worker.js
build_ics.py
Gemfile
.gitignore
README.md
```

## Privacy policy

- Roster shows **first name + last initial only**. No DOBs, addresses,
  phone numbers, or photos beside player names.
- Photos of any 9-12 player are posted only after a signed parental
  media release is on file. Contact the head coach to opt in or out.
- No analytics, no third-party trackers. Only external resource is
  Google Fonts (Bebas Neue + Manrope).
