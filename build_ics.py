#!/usr/bin/env python3
"""
Generate assets/calendar/haxtun-bulldogs-2026.ics from _data/schedule.yml.

Usage:
    pip install pyyaml
    python3 build_ics.py

Output is RFC 5545 iCalendar 2.0 with:
  - VTIMEZONE for America/Denver (DST + standard rules)
  - VEVENT per non-BYE regular-season game (90 min, TZID=America/Denver)
    each with two VALARMs: -P1D and -PT2H (DISPLAY)
  - All-day VEVENT per postseason entry with one -P1D VALARM
  - Stable UIDs (md5 of seed string)
  - CRLF line endings, RFC 5545 line folding (75 octets)
"""

from __future__ import annotations

import hashlib
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write("Missing dependency: pip install pyyaml\n")
    sys.exit(1)

REPO = Path(__file__).resolve().parent
SCHEDULE_YML = REPO / "_data" / "schedule.yml"
PRACTICES_YML = REPO / "_data" / "practices.yml"
CONFIG_YML = REPO / "_config.yml"
OUT_PATH = REPO / "assets" / "calendar" / "haxtun-bulldogs-2026.ics"

PRODID = "-//Haxtun Bulldogs Softball//9-12 Schedule//EN"
TZID = "America/Denver"
HOME_LOCATION = "Haxtun Baseball Field, Haxtun, CO"

GAME_DURATION = timedelta(minutes=90)

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11,
    "december": 12,
}


def fold(line: str) -> str:
    """RFC 5545 line folding: max 75 octets per line, continuation with space."""
    raw = line.encode("utf-8")
    if len(raw) <= 75:
        return line
    out = []
    i = 0
    first = True
    while i < len(raw):
        chunk_size = 75 if first else 74
        j = min(i + chunk_size, len(raw))
        # don't break a multibyte UTF-8 char
        while j < len(raw) and (raw[j] & 0xC0) == 0x80:
            j -= 1
        out.append(raw[i:j].decode("utf-8"))
        i = j
        first = False
    return "\r\n ".join(out)


def escape_text(s: str) -> str:
    return (
        s.replace("\\", "\\\\")
         .replace(";", "\\;")
         .replace(",", "\\,")
         .replace("\n", "\\n")
    )


def stable_uid(seed: str) -> str:
    return hashlib.md5(seed.encode("utf-8")).hexdigest() + "@haxtun-bulldogs"


def parse_time_hhmm(t: str) -> tuple[int, int]:
    """Parse '6:00 PM' style time. Returns (hour_24, minute)."""
    t = t.strip()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$", t)
    if not m:
        raise ValueError(f"unrecognized time: {t!r}")
    hh = int(m.group(1))
    mm = int(m.group(2))
    ampm = m.group(3).upper()
    if ampm == "AM":
        if hh == 12:
            hh = 0
    else:
        if hh != 12:
            hh += 12
    return hh, mm


def parse_postseason_dates(s: str) -> tuple[date, date]:
    """
    Parse 'June 22-24, 2026' or 'June 28, 2026'. Returns (start, end_inclusive).
    """
    s = s.strip()
    m = re.match(r"^([A-Za-z]+)\s+(\d{1,2})(?:-(\d{1,2}))?,\s*(\d{4})$", s)
    if not m:
        raise ValueError(f"unrecognized postseason date_range: {s!r}")
    month_name = m.group(1).lower()
    if month_name not in MONTHS:
        raise ValueError(f"unknown month: {month_name}")
    month = MONTHS[month_name]
    d1 = int(m.group(2))
    d2 = int(m.group(3)) if m.group(3) else d1
    year = int(m.group(4))
    return date(year, month, d1), date(year, month, d2)


def vtimezone_block() -> list[str]:
    return [
        "BEGIN:VTIMEZONE",
        f"TZID:{TZID}",
        "X-LIC-LOCATION:America/Denver",
        "BEGIN:DAYLIGHT",
        "DTSTART:19700308T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
        "TZOFFSETFROM:-0700",
        "TZOFFSETTO:-0600",
        "TZNAME:MDT",
        "END:DAYLIGHT",
        "BEGIN:STANDARD",
        "DTSTART:19701101T020000",
        "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
        "TZOFFSETFROM:-0600",
        "TZOFFSETTO:-0700",
        "TZNAME:MST",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]


def game_event(g: dict, season: str, head_coach: str, dtstamp: str) -> list[str]:
    if g.get("opponent") == "BYE":
        return []
    g_date = g["date"]
    if isinstance(g_date, str):
        g_date = datetime.strptime(g_date, "%Y-%m-%d").date()
    home = bool(g.get("home"))
    opponent = g["opponent"]
    summary = f"Bulldogs {'vs' if home else '@'} {opponent}"
    location = HOME_LOCATION if home else (g.get("location") or "")
    desc_parts = [f"Bulldogs Softball - {season} Season"]
    if g.get("notes"):
        desc_parts.append(g["notes"])
    if head_coach:
        desc_parts.append(f"Coach {head_coach}")
    description = " | ".join(desc_parts)
    uid = stable_uid(f"game-{g_date.isoformat()}-{opponent}-{home}")

    time = (g.get("time") or "").strip()
    # No set time yet (e.g. a TBD tournament day) → all-day event. The 2-hour
    # reminder needs a clock time, so all-day gets only the 1-day reminder.
    if not time or time.upper() == "TBD":
        end_excl = g_date + timedelta(days=1)
        return [
            "BEGIN:VEVENT",
            f"UID:{uid}",
            f"DTSTAMP:{dtstamp}",
            f"DTSTART;VALUE=DATE:{g_date.strftime('%Y%m%d')}",
            f"DTEND;VALUE=DATE:{end_excl.strftime('%Y%m%d')}",
            f"SUMMARY:{escape_text(summary)}",
            f"LOCATION:{escape_text(location)}",
            f"DESCRIPTION:{escape_text(description)}",
            "STATUS:CONFIRMED",
            "TRANSP:TRANSPARENT",
            "BEGIN:VALARM",
            "ACTION:DISPLAY",
            f"DESCRIPTION:{escape_text(summary)} - 1 day reminder",
            "TRIGGER:-P1D",
            "END:VALARM",
            "END:VEVENT",
        ]

    hh, mm = parse_time_hhmm(time)
    start = datetime(g_date.year, g_date.month, g_date.day, hh, mm)
    end = start + GAME_DURATION
    return [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={TZID}:{start.strftime('%Y%m%dT%H%M%S')}",
        f"DTEND;TZID={TZID}:{end.strftime('%Y%m%dT%H%M%S')}",
        f"SUMMARY:{escape_text(summary)}",
        f"LOCATION:{escape_text(location)}",
        f"DESCRIPTION:{escape_text(description)}",
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text(summary)} - 1 day reminder",
        "TRIGGER:-P1D",
        "END:VALARM",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text(summary)} - 2 hour reminder",
        "TRIGGER:-PT2H",
        "END:VALARM",
        "END:VEVENT",
    ]


def parse_time_24(t: str) -> tuple[int, int]:
    """Parse '17:30' 24-hour time. Returns (hour, minute)."""
    m = re.match(r"^(\d{1,2}):(\d{2})$", t.strip())
    if not m:
        raise ValueError(f"unrecognized practice time: {t!r}")
    return int(m.group(1)), int(m.group(2))


def practice_event(p: dict, season: str, dtstamp: str) -> list[str]:
    """Confirmed practice. Public-safe fields only — no coach identities."""
    if not p.get("date") or not p.get("start_time"):
        return []
    p_date = p["date"]
    if isinstance(p_date, str):
        p_date = datetime.strptime(p_date, "%Y-%m-%d").date()
    sh, sm = parse_time_24(str(p["start_time"]))
    start = datetime(p_date.year, p_date.month, p_date.day, sh, sm)
    if p.get("end_time"):
        eh, em = parse_time_24(str(p["end_time"]))
        end = datetime(p_date.year, p_date.month, p_date.day, eh, em)
    else:
        end = start + timedelta(minutes=90)
    focus = (p.get("focus") or "").strip()
    summary = f"Bulldogs Practice — {focus}" if focus else "Bulldogs Practice"
    location = (p.get("location") or "").strip()
    description = f"Bulldogs Softball - {season} Season | Practice"
    uid = f"{p.get('id') or stable_uid('practice-' + p_date.isoformat())}@haxtun-bulldogs"
    return [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;TZID={TZID}:{start.strftime('%Y%m%dT%H%M%S')}",
        f"DTEND;TZID={TZID}:{end.strftime('%Y%m%dT%H%M%S')}",
        f"SUMMARY:{escape_text(summary)}",
        f"LOCATION:{escape_text(location)}",
        f"DESCRIPTION:{escape_text(description)}",
        "STATUS:CONFIRMED",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text(summary)} - 1 day reminder",
        "TRIGGER:-P1D",
        "END:VALARM",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text(summary)} - 2 hour reminder",
        "TRIGGER:-PT2H",
        "END:VALARM",
        "END:VEVENT",
    ]


def postseason_event(p: dict, season: str, dtstamp: str) -> list[str]:
    start, end_inclusive = parse_postseason_dates(p["date_range"])
    end_exclusive = end_inclusive + timedelta(days=1)  # DTEND VALUE=DATE is exclusive
    summary = p["event"]
    location = p.get("location") or ""
    desc_parts = [f"Bulldogs Softball - {season} Season"]
    if p.get("notes"):
        desc_parts.append(p["notes"])
    description = " | ".join(desc_parts)
    uid = stable_uid(f"postseason-{start.isoformat()}-{summary}")
    return [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{dtstamp}",
        f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}",
        f"DTEND;VALUE=DATE:{end_exclusive.strftime('%Y%m%d')}",
        f"SUMMARY:{escape_text(summary)}",
        f"LOCATION:{escape_text(location)}",
        f"DESCRIPTION:{escape_text(description)}",
        "STATUS:CONFIRMED",
        "TRANSP:TRANSPARENT",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        f"DESCRIPTION:{escape_text(summary)} - 1 day reminder",
        "TRIGGER:-P1D",
        "END:VALARM",
        "END:VEVENT",
    ]


def build() -> str:
    with open(SCHEDULE_YML, "r", encoding="utf-8") as f:
        schedule = yaml.safe_load(f)
    season = "2026"
    head_coach = "Emily Anderson"
    if CONFIG_YML.exists():
        try:
            with open(CONFIG_YML, "r", encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            season = str(cfg.get("season", season))
            head_coach = cfg.get("head_coach", head_coach)
        except Exception:
            pass

    dtstamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")

    lines: list[str] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        f"PRODID:{PRODID}",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Haxtun Bulldogs 9-12 Softball 2026",
        "X-WR-TIMEZONE:America/Denver",
        "X-WR-CALDESC:Haxtun Bulldogs 9-12 girls softball schedule, 2026 season.",
    ]
    practices = []
    if PRACTICES_YML.exists():
        try:
            with open(PRACTICES_YML, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f)
            if isinstance(loaded, list):
                practices = loaded
        except Exception:
            practices = []

    lines.extend(vtimezone_block())
    for g in schedule.get("games", []):
        lines.extend(game_event(g, season, head_coach, dtstamp))
    for p in practices:
        lines.extend(practice_event(p, season, dtstamp))
    for p in schedule.get("postseason", []):
        lines.extend(postseason_event(p, season, dtstamp))
    lines.append("END:VCALENDAR")

    folded = [fold(line) for line in lines]
    return "\r\n".join(folded) + "\r\n"


def main() -> int:
    text = build()
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_PATH, "wb") as f:
        f.write(text.encode("utf-8"))
    rel = os.path.relpath(OUT_PATH, REPO)
    print(f"wrote {rel} ({len(text)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
