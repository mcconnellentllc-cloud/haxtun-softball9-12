// Season game schedule. The coaches portal deploys from this folder only, so
// the schedule is kept here as a self-contained list. Keep in sync with the
// public site's _data/schedule.yml (BYE weeks and post-season are omitted).

export type Game = {
  date: string; // YYYY-MM-DD — also the storage key for that game's plans
  day: string;
  opponent: string;
  home: boolean;
  location: string;
  time?: string; // first-pitch, e.g. "5:30 PM" (display only)
  doubleheader?: boolean; // two back-to-back games, same opponent & location
  game2_time?: string; // required when doubleheader; second game's first-pitch
  gameNo?: 1 | 2; // set only on expanded doubleheader tiles (see expandGames)
};

export const SCHEDULE: Game[] = [
  { date: "2026-05-19", day: "Tue", opponent: "Sidney", home: true, location: "Haxtun Baseball Field" },
  { date: "2026-05-21", day: "Thu", opponent: "Holyoke", home: false, location: "Holyoke, CO" },
  { date: "2026-05-26", day: "Tue", opponent: "Imperial", home: true, location: "Haxtun Baseball Field" },
  { date: "2026-05-28", day: "Thu", opponent: "Oshkosh", home: true, location: "Haxtun Baseball Field" },
  { date: "2026-06-02", day: "Tue", opponent: "Ogallala", home: true, location: "Haxtun Baseball Field" },
  { date: "2026-06-04", day: "Thu", opponent: "Sedgwick County", home: false, location: "Julesburg, CO" },
  { date: "2026-06-09", day: "Tue", opponent: "Grant", home: true, location: "Haxtun Baseball Field" },
  { date: "2026-06-16", day: "Tue", opponent: "Yuma", home: false, location: "Yuma, CO" },
  { date: "2026-06-18", day: "Thu", opponent: "Sidney", home: false, location: "Sidney, NE" },
  { date: "2026-06-22", day: "Mon", opponent: "League Tournament", home: false, location: "Holyoke, CO" },
  { date: "2026-06-23", day: "Tue", opponent: "League Tournament", home: false, location: "Holyoke, CO" },
  { date: "2026-06-24", day: "Wed", opponent: "League Tournament", home: false, location: "Holyoke, CO" },
];

// e.g. "Thu May 21 · at Holyoke" (doubleheader tiles get a " (G1)"/" (G2)" tag)
export function gameLabel(g: Game): string {
  const d = new Date(`${g.date}T00:00:00`);
  const md = Number.isNaN(d.getTime())
    ? g.date
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const suffix = g.gameNo ? ` (G${g.gameNo})` : "";
  return `${g.day} ${md} · ${g.home ? "vs" : "at"} ${g.opponent}${suffix}`;
}

// Expand doubleheaders into two ordered tiles (G1 then G2); single games pass
// through unchanged. Use this for calendar rendering only — GameSelect and the
// per-game plans key off the raw one-entry-per-date SCHEDULE list and must stay
// unaffected.
export function expandGames(games: Game[] = SCHEDULE): Game[] {
  const out: Game[] = [];
  for (const g of games) {
    if (g.doubleheader && g.game2_time) {
      out.push({ ...g, gameNo: 1 });
      out.push({ ...g, gameNo: 2, time: g.game2_time });
    } else {
      out.push(g);
    }
  }
  return out;
}

export function gameByDate(date: string): Game | undefined {
  return SCHEDULE.find((g) => g.date === date);
}

// Default selection: the next game on/after today, otherwise the last game.
export function defaultGameDate(today = new Date()): string {
  const t = today.toISOString().slice(0, 10);
  const upcoming = SCHEDULE.find((g) => g.date >= t);
  return (upcoming ?? SCHEDULE[SCHEDULE.length - 1]).date;
}
