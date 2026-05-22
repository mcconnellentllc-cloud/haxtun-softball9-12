// Season game schedule. The coaches portal deploys from this folder only, so
// the schedule is kept here as a self-contained list. Keep in sync with the
// public site's _data/schedule.yml (BYE weeks and post-season are omitted).

export type Game = {
  date: string; // YYYY-MM-DD — also the storage key for that game's plans
  day: string;
  opponent: string;
  home: boolean;
  location: string;
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
];

// e.g. "Thu May 21 · at Holyoke"
export function gameLabel(g: Game): string {
  const d = new Date(`${g.date}T00:00:00`);
  const md = Number.isNaN(d.getTime())
    ? g.date
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${g.day} ${md} · ${g.home ? "vs" : "at"} ${g.opponent}`;
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
