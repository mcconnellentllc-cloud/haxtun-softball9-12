"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SCHEDULE, gameLabel, defaultGameDate, expandGames, type Game } from "@/lib/schedule";

/* ----------------------------- Types ----------------------------- */

type Player = {
  id: string;
  firstName: string;
  lastName: string;
  jersey: number | null;
  active: boolean;
};

// position -> ordered list of player ids (depth order, starter first)
type DepthChart = Record<string, string[]>;
// coach name -> that coach's overall (persistent) depth chart
type CoachDepths = Record<string, DepthChart>;

// A defensive assignment for each inning: position -> player id.
type Defense = Record<string, string>[];

// A batting assignment for each inning: slot ("1".."12") -> player id. The
// order continues across innings (9 bat per inning); subbing a bench player into
// a slot mid-game changes who owns that slot from that inning forward.
type Batting = Record<string, string>[];

// A defensive substitution that takes effect after a specific batter in an
// inning (league rule: rotate outfielders every 3 batters — RF+CF at home,
// LF+CF on the road). playerId "" = slot left blank.
type MidInningSub = {
  afterBatter: number; // 1..8 (the 9th batter ends the half-inning)
  position: string;    // POSITIONS member
  playerId: string;
};

// One list of mid-inning subs per inning, in batter order.
type Subs = MidInningSub[][];

// A per-game plan for one lineup: defensive rotation + batting lineup grid
// + mid-inning defensive subs.
type GamePlan = {
  defense: Defense; // one entry per inning
  batting: Batting; // one entry per inning
  subs: Subs;       // one list per inning
};

// Each game carries two independent lineups (UI: "Lineup 1" / "Lineup 2").
// The internal keys stay "A"/"B"; see sideLabel() for the display names.
type Side = "A" | "B";
type GamePlanAB = Record<Side, GamePlan>;

// A coach's per-game proposal is itself a Lineup 1 / Lineup 2 pair.
type Proposal = GamePlanAB;
// coach name -> their proposal, within a single week
type WeekProposals = Record<string, Proposal>;
// week key (YYYY-MM-DD) -> that week's per-coach proposals
type Proposals = Record<string, WeekProposals>;
// week key (YYYY-MM-DD) -> that week's two lineups
type GamePlans = Record<string, GamePlanAB>;
// week key (YYYY-MM-DD) -> shared coaches note for that game
type Notes = Record<string, string>;

/* ---------------------------- Constants -------------------------- */

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
// Head coach first.
const COACHES = ["Emily", "Jordan", "Kyle"] as const;
const INNINGS = 5;
const BATTING_SLOTS = 12;
const SLOTS = Array.from({ length: BATTING_SLOTS }, (_, i) => String(i + 1));
const TABS = ["roster", "depth", "calendar", "compare", "plan", "stats"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  roster: "Roster",
  depth: "Depth Chart",
  calendar: "Calendar",
  compare: "Propose",
  stats: "Stats",
  plan: "Game Plan",
};

// Playing-time minimum: every girl should get either 2 field innings + 1
// at-bat, or 2 at-bats + 1 field inning.
function meetsMinimum(field: number, atBats: number): boolean {
  return (field >= 2 && atBats >= 1) || (atBats >= 2 && field >= 1);
}

const COACH_KEY = "bulldogs-coach";

// Quick link to the team's stats page on the public site. Override with
// NEXT_PUBLIC_STATS_URL if it ever moves.
const STATS_URL =
  process.env.NEXT_PUBLIC_STATS_URL ??
  "https://mcconnellentllc-cloud.github.io/haxtun-softball9-12/stats/";

/* ---------------------------- Helpers ---------------------------- */

function normalizeDepth(raw: unknown): DepthChart {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: DepthChart = {};
  for (const pos of POSITIONS) {
    const v = src[pos];
    out[pos] = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  }
  return out;
}

function asIdList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function normalizeCoachDepths(raw: unknown): CoachDepths {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: CoachDepths = {};
  for (const coach of COACHES) out[coach] = normalizeDepth(src[coach]);
  return out;
}

function normalizeGamePlanAB(raw: unknown): GamePlanAB {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return { A: normalizeGamePlan(src.A), B: normalizeGamePlan(src.B) };
}

function normalizeProposal(raw: unknown): Proposal {
  return normalizeGamePlanAB(raw);
}

function normalizeWeek(raw: unknown): WeekProposals {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: WeekProposals = {};
  for (const coach of COACHES) out[coach] = normalizeProposal(src[coach]);
  return out;
}

function normalizeProposals(raw: unknown): Proposals {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: Proposals = {};
  for (const key of Object.keys(src)) {
    if (src[key] && typeof src[key] === "object") out[key] = normalizeWeek(src[key]);
  }
  return out;
}

function normalizeDefense(raw: unknown): Record<string, string>[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: Record<string, string>[] = [];
  for (let i = 0; i < INNINGS; i++) {
    const src = (arr[i] && typeof arr[i] === "object" && !Array.isArray(arr[i])
      ? arr[i]
      : {}) as Record<string, unknown>;
    const inning: Record<string, string> = {};
    for (const pos of POSITIONS) {
      const v = src[pos];
      if (typeof v === "string" && v) inning[pos] = v;
    }
    out.push(inning);
  }
  return out;
}

function normalizeBatting(raw: unknown, legacyOrder?: unknown): Batting {
  const arr = Array.isArray(raw) ? raw : [];
  // Legacy migration: older plans stored a flat `order` list. Seed every inning
  // with that lineup so existing proposals/plans aren't lost.
  const legacy = arr.length === 0 ? asIdList(legacyOrder).slice(0, BATTING_SLOTS) : [];
  const out: Batting = [];
  for (let i = 0; i < INNINGS; i++) {
    const src = (arr[i] && typeof arr[i] === "object" && !Array.isArray(arr[i])
      ? arr[i]
      : {}) as Record<string, unknown>;
    const inning: Record<string, string> = {};
    for (const slot of SLOTS) {
      const v = src[slot];
      if (typeof v === "string" && v) inning[slot] = v;
    }
    legacy.forEach((id, idx) => {
      inning[String(idx + 1)] = id;
    });
    out.push(inning);
  }
  return out;
}

function normalizeSubs(raw: unknown): Subs {
  const out: Subs = Array.from({ length: INNINGS }, () => []);
  if (!Array.isArray(raw)) return out;
  for (let i = 0; i < INNINGS; i++) {
    const inn = raw[i];
    if (!Array.isArray(inn)) continue;
    const valid: MidInningSub[] = [];
    for (const s of inn) {
      if (!s || typeof s !== "object") continue;
      const sub = s as Record<string, unknown>;
      const afterBatter = Number(sub.afterBatter);
      const position = typeof sub.position === "string" ? sub.position : "";
      const playerId = typeof sub.playerId === "string" ? sub.playerId : "";
      if (
        Number.isInteger(afterBatter) &&
        afterBatter >= 1 &&
        afterBatter <= 8 &&
        (POSITIONS as readonly string[]).includes(position)
      ) {
        valid.push({ afterBatter, position, playerId });
      }
    }
    valid.sort((a, b) => a.afterBatter - b.afterBatter);
    out[i] = valid;
  }
  return out;
}

function normalizeGamePlan(raw: unknown): GamePlan {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    defense: normalizeDefense(p.defense),
    batting: normalizeBatting(p.batting, p.order),
    subs: normalizeSubs(p.subs),
  };
}

function normalizeGamePlans(raw: unknown): GamePlans {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: GamePlans = {};
  for (const key of Object.keys(src)) {
    if (src[key] && typeof src[key] === "object") {
      out[key] = normalizeGamePlanAB(src[key]);
    }
  }
  return out;
}

function normalizeNotes(raw: unknown): Notes {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: Notes = {};
  for (const key of Object.keys(src)) {
    if (typeof src[key] === "string") out[key] = src[key] as string;
  }
  return out;
}

async function putState(path: string, body: unknown, coach: string | null) {
  const res = await fetch(path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(coach ? { "x-coach": coach } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => null);
    throw new Error(msg?.error ?? `Save failed (${res.status})`);
  }
}

/* --------------------------- Component --------------------------- */

export default function Home() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [depth, setDepth] = useState<DepthChart>(() => normalizeDepth({}));
  const [coachDepths, setCoachDepths] = useState<CoachDepths>(() =>
    normalizeCoachDepths({}),
  );
  const [proposals, setProposals] = useState<Proposals>(() =>
    normalizeProposals({}),
  );
  const [gameplans, setGameplans] = useState<GamePlans>(() =>
    normalizeGamePlans({}),
  );
  const [notes, setNotes] = useState<Notes>(() => normalizeNotes({}));
  const [tab, setTab] = useState<Tab>("roster");
  const [coach, setCoach] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load coach identity from the browser.
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem(COACH_KEY) : null;
    if (saved && (COACHES as readonly string[]).includes(saved)) setCoach(saved);
  }, []);

  // Initial data load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [pRes, sRes] = await Promise.all([
          fetch("/api/players", { cache: "no-store" }),
          fetch("/api/state", { cache: "no-store" }),
        ]);
        if (!pRes.ok) throw new Error(`Players load failed (${pRes.status})`);
        if (!sRes.ok) throw new Error(`State load failed (${sRes.status})`);
        const pData = await pRes.json();
        const sData = await sRes.json();
        if (cancelled) return;
        setPlayers(Array.isArray(pData.players) ? pData.players : []);
        setDepth(normalizeDepth(sData.depth_chart));
        setCoachDepths(normalizeCoachDepths(sData.coach_depth));
        setProposals(normalizeProposals(sData.proposals));
        setGameplans(normalizeGamePlans(sData.gameplans));
        setNotes(normalizeNotes(sData.notes));
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, Player>();
    for (const p of players) m.set(p.id, p);
    return m;
  }, [players]);

  const chooseCoach = useCallback((name: string) => {
    setCoach(name);
    try {
      window.localStorage.setItem(COACH_KEY, name);
    } catch {
      /* ignore storage errors */
    }
  }, []);

  // Persist depth chart; roll back on failure.
  const saveDepth = useCallback(
    async (next: DepthChart) => {
      const prev = depth;
      setDepth(next);
      try {
        await putState("/api/state/depth", next, coach);
      } catch (err) {
        setDepth(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [depth, coach],
  );

  // Persist per-coach overall depth charts; roll back on failure.
  const saveCoachDepths = useCallback(
    async (next: CoachDepths) => {
      const prev = coachDepths;
      setCoachDepths(next);
      try {
        await putState("/api/state/coach_depth", next, coach);
      } catch (err) {
        setCoachDepths(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [coachDepths, coach],
  );

  // Persist coach proposals; roll back on failure.
  const saveProposals = useCallback(
    async (next: Proposals) => {
      const prev = proposals;
      setProposals(next);
      try {
        await putState("/api/state/proposals", next, coach);
      } catch (err) {
        setProposals(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [proposals, coach],
  );

  // Persist the team game plans; roll back on failure.
  const saveGameplans = useCallback(
    async (next: GamePlans) => {
      const prev = gameplans;
      setGameplans(next);
      try {
        await putState("/api/state/gameplans", next, coach);
      } catch (err) {
        setGameplans(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [gameplans, coach],
  );

  // Persist per-game coaches notes; roll back on failure.
  const saveNote = useCallback(
    async (week: string, text: string) => {
      const prev = notes;
      const next = { ...notes, [week]: text };
      setNotes(next);
      try {
        await putState("/api/state/notes", next, coach);
      } catch (err) {
        setNotes(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [notes, coach],
  );

  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8">
      <Header />

      <nav className="mt-6 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "rounded px-4 py-2 font-display text-lg tracking-wider transition-colors " +
              (tab === t
                ? "bg-red-600 text-white"
                : "border border-neutral-800 bg-neutral-900 text-neutral-300 hover:border-neutral-600")
            }
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </nav>

      {error && (
        <div className="mt-4 flex items-center justify-between gap-3 rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="font-display tracking-wider text-red-400 hover:text-red-200"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mt-6">
        {loading ? (
          <p className="text-neutral-400">Loading…</p>
        ) : tab === "roster" ? (
          <RosterPanel players={players} />
        ) : tab === "depth" ? (
          <DepthTab
            players={players}
            byId={byId}
            coach={coach}
            depth={depth}
            coachDepths={coachDepths}
            onChooseCoach={chooseCoach}
            onSaveTeam={saveDepth}
            onSaveCoach={(name, next) =>
              saveCoachDepths({ ...coachDepths, [name]: next })
            }
          />
        ) : tab === "calendar" ? (
          <CalendarPanel coach={coach} onChooseCoach={chooseCoach} />
        ) : tab === "compare" ? (
          <ComparePanel
            players={players}
            byId={byId}
            coach={coach}
            depth={depth}
            coachDepths={coachDepths}
            proposals={proposals}
            gameplans={gameplans}
            notes={notes}
            onChooseCoach={chooseCoach}
            onChange={saveProposals}
            onSaveNote={saveNote}
          />
        ) : tab === "plan" ? (
          <GamePlanPanel
            players={players}
            byId={byId}
            depth={depth}
            coachDepths={coachDepths}
            gameplans={gameplans}
            proposals={proposals}
            coach={coach}
            notes={notes}
            onChange={saveGameplans}
            onSaveNote={saveNote}
          />
        ) : (
          <StatsPanel players={players} />
        )}
      </div>
    </main>
  );
}

/* ----------------------------- Header ---------------------------- */

function Header() {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">
          Haxtun Bulldogs
        </p>
        <h1 className="font-display text-5xl leading-none sm:text-6xl">
          Coaches Portal
        </h1>
      </div>
      <div className="flex items-center gap-2">
        {STATS_URL && (
          <a
            href={STATS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 font-display text-sm tracking-wider text-neutral-200 hover:border-red-600"
          >
            Stats
          </a>
        )}
        <a
          href="/api/auth/logout"
          className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider hover:bg-red-500"
        >
          Log out
        </a>
      </div>
    </header>
  );
}

/* ------------------------- Shared widgets ------------------------ */

function jerseyTag(p: Player) {
  return p.jersey != null ? `#${p.jersey}` : "#—";
}

function PlayerName({ p }: { p: Player | undefined }) {
  if (!p) return <span className="text-neutral-500">Unknown player</span>;
  return (
    <span>
      <span className="font-display tracking-wider text-red-500">
        {jerseyTag(p)}
      </span>{" "}
      {p.firstName} {p.lastName}
    </span>
  );
}

// Dropdown that adds a player not already in `exclude`.
function AddPlayer({
  players,
  exclude,
  onAdd,
  label = "Add player…",
}: {
  players: Player[];
  exclude: Set<string>;
  onAdd: (id: string) => void;
  label?: string;
}) {
  const options = players.filter((p) => !exclude.has(p.id));
  if (options.length === 0)
    return <p className="text-xs text-neutral-600">All players assigned.</p>;
  return (
    <select
      value=""
      onChange={(e) => {
        if (e.target.value) onAdd(e.target.value);
      }}
      className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-red-600"
    >
      <option value="">{label}</option>
      {options.map((p) => (
        <option key={p.id} value={p.id}>
          {jerseyTag(p)} {p.firstName} {p.lastName}
        </option>
      ))}
    </select>
  );
}

/* ----------------------------- Roster ---------------------------- */

function RosterPanel({ players }: { players: Player[] }) {
  if (players.length === 0) {
    return (
      <div className="rounded border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
        No players yet. Seed the roster with{" "}
        <code className="text-red-400">npm run seed</code> from a machine with
        Airtable access.
      </div>
    );
  }
  return (
    <section>
      <h2 className="font-display text-2xl tracking-wider text-neutral-200">
        Roster <span className="text-neutral-500">({players.length})</span>
      </h2>
      <ul className="mt-3 divide-y divide-neutral-800 overflow-hidden rounded border border-neutral-800">
        {players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 bg-neutral-900 px-4 py-2.5"
          >
            <span className="w-12 font-display text-xl tracking-wider text-red-500">
              {jerseyTag(p)}
            </span>
            <span className="text-neutral-100">
              {p.firstName} {p.lastName}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------- Depth chart -------------------------- */

function DepthPanel({
  players,
  byId,
  depth,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  depth: DepthChart;
  onChange: (next: DepthChart) => void;
}) {
  if (players.length === 0)
    return <EmptyRoster what="depth chart" />;

  const add = (pos: string, id: string) => {
    if (depth[pos]?.includes(id)) return;
    onChange({ ...depth, [pos]: [...(depth[pos] ?? []), id] });
  };
  const remove = (pos: string, id: string) => {
    onChange({ ...depth, [pos]: (depth[pos] ?? []).filter((x) => x !== id) });
  };
  const move = (pos: string, idx: number, dir: -1 | 1) => {
    const list = [...(depth[pos] ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    onChange({ ...depth, [pos]: list });
  };

  return (
    <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {POSITIONS.map((pos) => {
          const list = depth[pos] ?? [];
          return (
            <div
              key={pos}
              className="rounded border border-neutral-800 bg-neutral-900 p-3"
            >
              <h3 className="font-display text-2xl tracking-wider text-red-500">
                {pos}
              </h3>
              <ol className="mt-2 space-y-1">
                {list.length === 0 && (
                  <li className="text-xs text-neutral-600">No one assigned</li>
                )}
                {list.map((id, idx) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1 text-sm"
                  >
                    <span className="truncate">
                      <span className="text-neutral-500">{idx + 1}.</span>{" "}
                      <PlayerName p={byId.get(id)} />
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <IconBtn label="Up" onClick={() => move(pos, idx, -1)}>
                        ↑
                      </IconBtn>
                      <IconBtn label="Down" onClick={() => move(pos, idx, 1)}>
                        ↓
                      </IconBtn>
                      <IconBtn
                        label="Remove"
                        onClick={() => remove(pos, id)}
                        danger
                      >
                        ×
                      </IconBtn>
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-2">
                <AddPlayer
                  players={players}
                  exclude={new Set(list)}
                  onAdd={(id) => add(pos, id)}
                />
              </div>
            </div>
          );
        })}
      </section>

      <PositionCounts players={players} depth={depth} />
    </>
  );
}

// Shows, per player, how many positions they're listed at on the depth chart
// (some girls can play several spots) plus which ones. Sorted most-versatile
// first so unplaced players surface at the bottom.
function PositionCounts({
  players,
  depth,
}: {
  players: Player[];
  depth: DepthChart;
}) {
  const rows = players
    .map((p) => {
      const at = POSITIONS.filter((pos) => (depth[pos] ?? []).includes(p.id));
      return { player: p, positions: at, count: at.length };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        (a.player.jersey ?? 9999) - (b.player.jersey ?? 9999),
    );

  return (
    <section className="mt-6 rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-display text-2xl tracking-wider text-neutral-100">
        Position coverage
      </h2>
      <ul className="mt-3 divide-y divide-neutral-800">
        {rows.map(({ player, positions, count }) => (
          <li
            key={player.id}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              <PlayerName p={player} />
            </span>
            <span className="flex shrink-0 items-center gap-3">
              <span className="text-neutral-400">
                {count === 0 ? (
                  <span className="text-neutral-600">unplaced</span>
                ) : (
                  positions.join(", ")
                )}
              </span>
              <span
                className={
                  "w-6 text-right font-display text-lg tracking-wider " +
                  (count === 0 ? "text-neutral-600" : "text-red-500")
                }
              >
                {count}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// Depth Chart tab: switch between the shared team chart and each coach's own
// overall depth chart, then a starters comparison across coaches.
function DepthTab({
  players,
  byId,
  coach,
  depth,
  coachDepths,
  onChooseCoach,
  onSaveTeam,
  onSaveCoach,
}: {
  players: Player[];
  byId: Map<string, Player>;
  coach: string | null;
  depth: DepthChart;
  coachDepths: CoachDepths;
  onChooseCoach: (name: string) => void;
  onSaveTeam: (next: DepthChart) => void;
  onSaveCoach: (name: string, next: DepthChart) => void;
}) {
  const [target, setTarget] = useState<string>("team");

  if (players.length === 0) return <EmptyRoster what="depth chart" />;

  const isTeam = target === "team";
  const current = isTeam ? depth : coachDepths[target] ?? normalizeDepth({});
  const onChange = isTeam
    ? onSaveTeam
    : (next: DepthChart) => onSaveCoach(target, next);

  const choices = ["team", ...COACHES];

  return (
    <section className="space-y-5">
      <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-display text-lg tracking-wider text-neutral-200">
            Editing
          </span>
          {choices.map((c) => (
            <button
              key={c}
              onClick={() => setTarget(c)}
              className={
                "rounded px-3 py-1 text-sm tracking-wider transition-colors " +
                (target === c
                  ? "bg-red-600 text-white"
                  : "border border-neutral-700 bg-black/40 text-neutral-300 hover:border-red-600")
              }
            >
              {c === "team" ? "Team" : c}
            </button>
          ))}
          {!isTeam && coach !== target && (
            <button
              onClick={() => onChooseCoach(target)}
              className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
            >
              (you&rsquo;re editing {target}&rsquo;s chart)
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {isTeam
            ? "Shared team depth chart — also drives the Game Plan auto-draft."
            : `${target}'s overall depth chart.`}
        </p>
      </div>

      <DepthPanel
        players={players}
        byId={byId}
        depth={current}
        onChange={onChange}
      />

      <DepthCompare byId={byId} depth={depth} coachDepths={coachDepths} />
    </section>
  );
}

// Per-position starter comparison across coaches (with the team chart shown as
// a reference).
function DepthCompare({
  byId,
  depth,
  coachDepths,
}: {
  byId: Map<string, Player>;
  depth: DepthChart;
  coachDepths: CoachDepths;
}) {
  const any = COACHES.some((c) =>
    POSITIONS.some((pos) => (coachDepths[c]?.[pos] ?? []).length > 0),
  );
  const rows = POSITIONS.map((pos) => {
    const starters = COACHES.map((c) => coachDepths[c]?.[pos]?.[0]);
    return { pos, starters, team: depth[pos]?.[0], status: rowStatus(starters) };
  });
  const agree = rows.filter((r) => r.status === "agree").length;
  const differ = rows.filter((r) => r.status === "differ").length;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Starters compared
        </h2>
        <p className="text-sm">
          <span className="text-emerald-400">{agree} agree</span>
          <span className="text-neutral-600"> · </span>
          <span className="text-red-400">{differ} differ</span>
        </p>
      </div>
      {!any ? (
        <p className="mt-2 text-sm text-neutral-400">
          No coach depth charts yet. Pick a coach above to fill one in.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ pos, starters, team, status }) => {
            const badge = STATUS_BADGE[status];
            return (
              <CompareCell key={pos} status={status}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl tracking-wider text-red-500">
                    {pos}
                  </h3>
                  <span className={"text-xs " + badge.cls}>{badge.label}</span>
                </div>
                <ul className="mt-1">
                  <li className="flex items-center justify-between gap-2 py-0.5 text-sm">
                    <span className="text-neutral-500">Team</span>
                    {team ? (
                      <span className="truncate text-neutral-300">
                        <PlayerName p={byId.get(team)} />
                      </span>
                    ) : (
                      <span className="text-neutral-600">—</span>
                    )}
                  </li>
                  {COACHES.map((c, i) => (
                    <CoachPick key={c} coach={c} p={byId.get(starters[i] ?? "")} />
                  ))}
                </ul>
              </CompareCell>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------- Plans, compare & game plan ---------------- */

function emptyDefense(): Defense {
  return Array.from({ length: INNINGS }, () => ({}));
}

function emptyBatting(): Batting {
  return Array.from({ length: INNINGS }, () => ({}));
}

function emptySubs(): Subs {
  return Array.from({ length: INNINGS }, () => []);
}

function emptyGamePlan(): GamePlan {
  return { defense: emptyDefense(), batting: emptyBatting(), subs: emptySubs() };
}

// Outfield rotation pair under our league's "every 3 batters" rule.
// Home: RF + CF rotate. Away: LF + CF rotate.
function rotationPair(isHome: boolean): readonly [string, string] {
  return isHome ? ["RF", "CF"] : ["LF", "CF"];
}

// Empty rotation-rule stubs for one inning — two sub events at batters 3 and 6,
// each covering both rotating positions. Coach fills in the bench players.
function rotationStubs(isHome: boolean): MidInningSub[] {
  const [p1, p2] = rotationPair(isHome);
  return [
    { afterBatter: 3, position: p1, playerId: "" },
    { afterBatter: 3, position: p2, playerId: "" },
    { afterBatter: 6, position: p1, playerId: "" },
    { afterBatter: 6, position: p2, playerId: "" },
  ];
}

function emptyGamePlanAB(): GamePlanAB {
  return { A: emptyGamePlan(), B: emptyGamePlan() };
}

// Game picker, sourced from the season schedule. The selected game date is the
// storage key for that game's proposals and plan.
function GameSelect({
  date,
  onSelect,
}: {
  date: string;
  onSelect: (d: string) => void;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-display text-lg tracking-wider text-neutral-200">
          Game
        </span>
        <select
          value={date}
          onChange={(e) => onSelect(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-red-600"
        >
          {SCHEDULE.map((g) => (
            <option key={g.date} value={g.date}>
              {gameLabel(g)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function formatWeek(key: string): string {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Has anything been entered in this plan/proposal?
function hasPlan(p: GamePlan | undefined): boolean {
  if (!p) return false;
  return (
    p.defense.some((inn) => Object.keys(inn).length > 0) ||
    p.batting.some((inn) => Object.keys(inn).length > 0) ||
    p.subs.some((inn) => inn.some((s) => s.playerId !== ""))
  );
}

// Field innings = number of innings a girl is assigned a field position.
function fieldInningsOf(defense: Defense, id: string): number {
  return defense.reduce(
    (n, inn) => n + (Object.values(inn).includes(id) ? 1 : 0),
    0,
  );
}

// At-bats ≈ the number of innings a girl is in the batting lineup.
function atBatsOf(plan: GamePlan, id: string): number {
  return plan.batting.reduce(
    (n, inn) => n + (Object.values(inn).includes(id) ? 1 : 0),
    0,
  );
}

type RowStatus = "agree" | "differ" | "single" | "none";

// Compare a set of per-coach picks (player id or undefined) for one slot.
function rowStatus(picks: (string | undefined)[]): RowStatus {
  const given = picks.filter((x): x is string => !!x);
  if (given.length === 0) return "none";
  const distinct = new Set(given);
  if (distinct.size === 1) return given.length >= 2 ? "agree" : "single";
  return "differ";
}

function ComparePanel({
  players,
  byId,
  coach,
  depth,
  coachDepths,
  proposals,
  gameplans,
  notes,
  onChooseCoach,
  onChange,
  onSaveNote,
}: {
  players: Player[];
  byId: Map<string, Player>;
  coach: string | null;
  depth: DepthChart;
  coachDepths: CoachDepths;
  proposals: Proposals;
  gameplans: GamePlans;
  notes: Notes;
  onChooseCoach: (name: string) => void;
  onChange: (next: Proposals) => void;
  onSaveNote: (week: string, text: string) => void;
}) {
  const [week, setWeek] = useState<string>(() => defaultGameDate());
  const [side, setSide] = useState<Side>("A");
  // Active = roster-wide active flag (mirrors GamePlanPanel). Used by the
  // "Import Agreed Positions" button so a coach drafting their proposal can
  // also seed from cross-coach consensus, not just their own depth chart.
  const activeIds = useMemo(
    () => new Set(players.filter((p) => p.active).map((p) => p.id)),
    [players],
  );

  if (players.length === 0) return <EmptyRoster what="comparison" />;

  const weekProps: WeekProposals = proposals[week] ?? {};
  // Each coach's plan for the selected squad.
  const sideProps: Record<string, GamePlan> = {};
  for (const c of COACHES) sideProps[c] = weekProps[c]?.[side] ?? emptyGamePlan();

  // A coach drafts from their own overall depth chart, falling back to the
  // shared team chart if they haven't built one.
  const myDepth =
    coach && POSITIONS.some((pos) => (coachDepths[coach]?.[pos] ?? []).length > 0)
      ? coachDepths[coach]
      : depth;

  const myAB = (coach ? weekProps[coach] : undefined) ?? emptyGamePlanAB();

  return (
    <section className="space-y-5">
      <CoachSelect coach={coach} onChoose={onChooseCoach} />
      <GameSelect date={week} onSelect={setWeek} />
      <SideToggle side={side} onSelect={setSide} />

      <NotesCard
        key={week}
        week={week}
        note={notes[week] ?? ""}
        onSave={(text) => onSaveNote(week, text)}
      />

      {coach ? (
        <div className="space-y-5">
          <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="font-display text-2xl tracking-wider text-neutral-100">
              Your proposal — {sideLabel(side)}
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Entering as <span className="text-neutral-100">{coach}</span>{" "}
              for the game on{" "}
              <span className="text-neutral-100">{formatWeek(week)}</span>
            </p>
          </div>
          <PlanEditor
            players={players}
            byId={byId}
            draftDepth={myDepth}
            draftLabel="Draft from my depth chart"
            plan={myAB[side]}
            week={week}
            side={side}
            coach={coach}
            proposals={proposals}
            gameplans={gameplans}
            consensus={{ coachDepths, activeIds }}
            onChange={(mine) =>
              onChange({
                ...proposals,
                [week]: {
                  ...weekProps,
                  [coach]: { ...myAB, [side]: mine },
                },
              })
            }
          />
        </div>
      ) : (
        <div className="rounded border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
          Pick your name up top to start your proposal.
        </div>
      )}

      <DefenseCompare byId={byId} side={side} plans={sideProps} />
      <BattingCompare byId={byId} side={side} plans={sideProps} />
    </section>
  );
}

// Coach identity picker for the Propose tab. Always visible and tappable so any
// coach can switch to themselves on a shared device; the choice is remembered
// per device (localStorage, via onChoose).
function CoachSelect({
  coach,
  onChoose,
}: {
  coach: string | null;
  onChoose: (name: string) => void;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg tracking-wider text-neutral-200">
          I am
        </span>
        {COACHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChoose(c)}
            aria-pressed={coach === c}
            className={
              "rounded px-4 py-2 font-display text-lg tracking-wider transition-colors " +
              (coach === c
                ? "bg-red-600 text-white"
                : "border border-neutral-700 bg-black/40 text-neutral-300 hover:border-red-600")
            }
          >
            {c}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-neutral-500">
        {coach ? (
          <>
            Entering as{" "}
            <span className="text-neutral-300">{coach}</span> — tap a name to
            switch. Saved on this device.
          </>
        ) : (
          <span className="text-amber-300">
            Tap your name so your proposal is saved under you.
          </span>
        )}
      </p>
    </div>
  );
}

// User-facing name for a lineup side. The internal keys stay "A"/"B".
function sideLabel(s: Side): string {
  return s === "A" ? "Lineup 1" : "Lineup 2";
}

// Lineup 1 / Lineup 2 toggle (two independent per-game lineups).
function SideToggle({
  side,
  onSelect,
}: {
  side: Side;
  onSelect: (s: Side) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-lg tracking-wider text-neutral-200">
        Lineup
      </span>
      {(["A", "B"] as const).map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className={
            "rounded px-4 py-1.5 font-display text-lg tracking-wider transition-colors " +
            (side === s
              ? "bg-red-600 text-white"
              : "border border-neutral-700 bg-black/40 text-neutral-300 hover:border-red-600")
          }
        >
          {sideLabel(s)}
        </button>
      ))}
    </div>
  );
}

// Shared per-game coaches note. Saves on blur to avoid a write per keystroke.
function NotesCard({
  week,
  note,
  onSave,
}: {
  week: string;
  note: string;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(note);
  useEffect(() => setDraft(note), [note, week]);

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-display text-2xl tracking-wider text-neutral-100">
        Coaches notes
      </h2>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== note) onSave(draft);
        }}
        rows={3}
        placeholder="Notes for this game (matchups, reminders, who's out…)"
        className="mt-2 w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-red-600"
      />
      <p className="mt-1 text-xs text-neutral-600">
        Shared by all coaches · saved when you click away.
      </p>
    </div>
  );
}

// Editor for a defense + lineup + subs. Shared by the per-coach proposal and
// the team game plan, since they're the same shape.
// Small abbreviation key shown under a chart/table so the shorthand is clear.
function Legend({ items }: { items: [string, string][] }) {
  return (
    <p className="mt-2 text-xs text-neutral-500">
      {items.map(([k, v], i) => (
        <span key={k}>
          {i > 0 ? " · " : ""}
          <span className="text-neutral-300">{k}</span> {v}
        </span>
      ))}
    </p>
  );
}

/* ----------------- Import from a previous game ------------------ */

type ImportField = "defense" | "batting";
type ImportSource = { plan: GamePlan; label: string };

// Prior scheduled games (before `week`), most recent first.
function priorGames(week: string): Game[] {
  return SCHEDULE.filter((g) => g.date < week).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
}

// Does this plan have content in the requested grid?
function hasField(p: GamePlan | undefined, field: ImportField): boolean {
  if (!p) return false;
  const grid = field === "defense" ? p.defense : p.batting;
  return grid.some((inn) => Object.keys(inn).length > 0);
}

function cloneInnings(
  grid: Record<string, string>[],
): Record<string, string>[] {
  return grid.map((inn) => ({ ...inn }));
}

// Most recent prior finalized team plan with the requested grid for `side`.
function lastFinalSource(
  week: string,
  side: Side,
  field: ImportField,
  gameplans: GamePlans,
): ImportSource | null {
  for (const g of priorGames(week)) {
    const plan = gameplans[g.date]?.[side];
    if (hasField(plan, field)) return { plan: plan!, label: gameLabel(g) };
  }
  return null;
}

// Most recent prior proposal by `coach` with the requested grid for `side`.
function lastMineSource(
  week: string,
  side: Side,
  field: ImportField,
  coach: string | null,
  proposals: Proposals,
): ImportSource | null {
  if (!coach) return null;
  for (const g of priorGames(week)) {
    const plan = proposals[g.date]?.[coach]?.[side];
    if (hasField(plan, field)) return { plan: plan!, label: gameLabel(g) };
  }
  return null;
}

function importItemCls(enabled: boolean): string {
  return (
    "block w-full rounded px-2 py-1.5 text-left tracking-wider transition-colors " +
    (enabled
      ? "text-neutral-200 hover:bg-neutral-800"
      : "cursor-not-allowed text-neutral-600")
  );
}
function importChipCls(enabled: boolean): string {
  return (
    "rounded px-2 py-0.5 text-xs tracking-wider transition-colors " +
    (enabled
      ? "border border-neutral-700 bg-black/40 text-neutral-200 hover:border-red-600"
      : "cursor-not-allowed border border-neutral-800 text-neutral-600")
  );
}

// "Import from previous game" control. Pulls one grid (defense OR batting) for
// the current squad from a prior game's finalized plan or the coach's proposal.
function ImportControl({
  field,
  week,
  side,
  coach,
  proposals,
  gameplans,
  onImport,
}: {
  field: ImportField;
  week: string;
  side: Side;
  coach: string | null;
  proposals: Proposals;
  gameplans: GamePlans;
  onImport: (source: ImportSource) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);

  const priors = priorGames(week);
  const disabled = priors.length === 0;
  const lastFinal = lastFinalSource(week, side, field, gameplans);
  const lastMine = lastMineSource(week, side, field, coach, proposals);

  const choose = (src: ImportSource | null) => {
    if (!src) return;
    onImport(src);
    setOpen(false);
    setPicking(false);
  };

  return (
    <div className="mb-3">
      <button
        type="button"
        disabled={disabled}
        title={disabled ? "No prior games yet." : undefined}
        onClick={() => setOpen((o) => !o)}
        className={
          "rounded border px-3 py-1.5 text-sm tracking-wider transition-colors " +
          (disabled
            ? "cursor-not-allowed border-neutral-800 bg-neutral-900 text-neutral-600"
            : "border-neutral-700 bg-black/40 text-neutral-200 hover:border-red-600")
        }
      >
        Import from previous game ▾
      </button>

      {open && !disabled && (
        <div className="mt-2 rounded border border-neutral-700 bg-neutral-950 p-2 text-sm">
          <button
            type="button"
            disabled={!lastFinal}
            onClick={() => choose(lastFinal)}
            className={importItemCls(!!lastFinal)}
          >
            Last finalized Game Plan
            <span className="block text-xs text-neutral-500">
              {lastFinal ? lastFinal.label : "none yet"}
            </span>
          </button>
          <button
            type="button"
            disabled={!lastMine}
            onClick={() => choose(lastMine)}
            className={importItemCls(!!lastMine)}
          >
            My last proposal
            <span className="block text-xs text-neutral-500">
              {coach
                ? lastMine
                  ? lastMine.label
                  : "none yet"
                : "pick your name first"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPicking((p) => !p)}
            className={importItemCls(true)}
          >
            Pick a specific game…
          </button>

          {picking && (
            <div className="mt-1 max-h-60 space-y-1 overflow-y-auto border-t border-neutral-800 pt-1">
              {priors.map((g) => {
                const final = gameplans[g.date]?.[side];
                const mine = coach
                  ? proposals[g.date]?.[coach]?.[side]
                  : undefined;
                const finalOk = hasField(final, field);
                const mineOk = hasField(mine, field);
                return (
                  <div key={g.date} className="rounded bg-black/30 px-2 py-1">
                    <div className="text-xs text-neutral-300">
                      {gameLabel(g)}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      <button
                        type="button"
                        disabled={!finalOk}
                        onClick={() =>
                          choose(
                            finalOk
                              ? { plan: final!, label: gameLabel(g) }
                              : null,
                          )
                        }
                        className={importChipCls(finalOk)}
                      >
                        Finalized
                      </button>
                      <button
                        type="button"
                        disabled={!mineOk}
                        onClick={() =>
                          choose(
                            mineOk ? { plan: mine!, label: gameLabel(g) } : null,
                          )
                        }
                        className={importChipCls(mineOk)}
                      >
                        My proposal
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PlanEditor({
  players,
  byId,
  draftDepth,
  draftLabel,
  plan,
  onChange,
  week,
  side,
  coach,
  proposals,
  gameplans,
  consensus,
}: {
  players: Player[];
  byId: Map<string, Player>;
  draftDepth: DepthChart;
  draftLabel: string;
  plan: GamePlan;
  onChange: (next: GamePlan) => void;
  week: string;
  side: Side;
  coach: string | null;
  proposals: Proposals;
  gameplans: GamePlans;
  // When set, the Defense draft button imports agreed positions from the coach
  // depth charts (Game Plan tab) instead of auto-drafting from one chart.
  consensus?: { coachDepths: CoachDepths; activeIds: Set<string> };
}) {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Cells filled by the last consensus import; the highlight fades as the head
  // coach edits each cell. Reset whenever the selected game/side changes.
  const [importedCells, setImportedCells] = useState<Set<string>>(
    () => new Set(),
  );
  const [confirmImport, setConfirmImport] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    setImportedCells(new Set());
  }, [week, side]);

  const runConsensusImport = () => {
    if (!consensus) return;
    setImporting(true);
    // Brief loading beat, then fill — the work itself is instant.
    setTimeout(() => {
      const { defense, cells, filled } = consensusDefense(
        consensus.coachDepths,
        consensus.activeIds,
      );
      onChange({ ...plan, defense });
      setImportedCells(cells);
      const none = POSITIONS.length - filled;
      setToast(
        `Imported ${filled} of ${POSITIONS.length} positions from coach consensus.` +
          (none > 0 ? ` ${none} had no 2-of-3 majority — fill those manually.` : ""),
      );
      setImporting(false);
      setConfirmImport(false);
    }, 250);
  };

  const clearImported = (inning: number, pos: string) => {
    setImportedCells((prev) => {
      if (!prev.has(`${inning}:${pos}`)) return prev;
      const next = new Set(prev);
      next.delete(`${inning}:${pos}`);
      return next;
    });
  };

  const importField = (field: ImportField, src: ImportSource) => {
    if (field === "defense") {
      onChange({ ...plan, defense: cloneInnings(src.plan.defense) });
      setToast(`Defense replaced with ${src.label}`);
    } else {
      onChange({ ...plan, batting: cloneInnings(src.plan.batting) });
      setToast(`Batting replaced with ${src.label}`);
    }
  };

  // The league's outfield rotation rule depends on home/away; default to a home
  // game if the date isn't on the schedule (shouldn't happen — the picker is
  // schedule-backed).
  const isHome = SCHEDULE.find((g) => g.date === week)?.home ?? true;

  const autoDraft = () => {
    const defense = draftDefense(players, draftDepth);
    // Seed the batting grid with a default lineup the first time, so the at-bat
    // minimum is covered out of the gate. Leave an in-progress grid alone.
    const battingEmpty = plan.batting.every(
      (inn) => Object.keys(inn).length === 0,
    );
    const batting = battingEmpty ? draftBatting(players) : plan.batting;
    onChange({ ...plan, defense, batting });
  };

  return (
    <>
      {confirmImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded border border-neutral-700 bg-neutral-900 p-5 shadow-xl">
            <h3 className="font-display text-xl tracking-wider text-neutral-100">
              Import agreed positions?
            </h3>
            <p className="mt-2 text-sm text-neutral-400">
              This will overwrite any existing inning assignments in the Defense
              grid. Continue?
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmImport(false)}
                disabled={importing}
                className="rounded border border-neutral-700 bg-black/40 px-3 py-1.5 font-display text-sm tracking-wider text-neutral-300 hover:border-red-600 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={runConsensusImport}
                disabled={importing}
                className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500 disabled:opacity-60"
              >
                {importing ? "Importing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div className="rounded border border-emerald-900 bg-emerald-950/40 px-4 py-2 text-sm text-emerald-300">
          {toast}
        </div>
      )}
      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl tracking-wider text-neutral-100">
            Defense{" "}
            <span className="text-sm text-neutral-500">({INNINGS} innings)</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={autoDraft}
              className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500"
            >
              {draftLabel}
            </button>
            {consensus && (
              <button
                onClick={() => setConfirmImport(true)}
                disabled={importing}
                className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500 disabled:opacity-60"
              >
                {importing ? "Importing…" : "Import Agreed Positions"}
              </button>
            )}
          </div>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          {consensus
            ? `"${draftLabel}" leans on one depth chart; "Import Agreed Positions" fills positions where 2 of 3 coaches agree (innings 1–${CONSENSUS_INNINGS}, active players only). Adjust any cell below.`
            : "Drafts a fair rotation, then leans extra innings toward the strongest players. Adjust any cell below."}
        </p>
        <ImportControl
          field="defense"
          week={week}
          side={side}
          coach={coach}
          proposals={proposals}
          gameplans={gameplans}
          onImport={(src) => importField("defense", src)}
        />
        <DefenseGrid
          players={players}
          defense={plan.defense}
          onChange={(defense) => onChange({ ...plan, defense })}
          importedCells={consensus ? importedCells : undefined}
          onCellTouched={consensus ? clearImported : undefined}
        />
      </div>

      <MidInningSubsSection
        players={players}
        defense={plan.defense}
        subs={plan.subs}
        isHome={isHome}
        onChange={(subs) => onChange({ ...plan, subs })}
      />

      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl tracking-wider text-neutral-100">
            Batting lineup{" "}
            <span className="text-sm text-neutral-500">
              ({BATTING_SLOTS} slots × {INNINGS} innings)
            </span>
          </h2>
          <button
            onClick={() => {
              const inn1 = plan.batting[0] ?? {};
              if (Object.keys(inn1).length === 0) {
                setToast(
                  "Inning 1 is empty — fill it first, then click to autofill the rest.",
                );
                return;
              }
              const batting = plan.batting.map((_, i) =>
                i === 0 ? { ...inn1 } : { ...inn1 },
              );
              onChange({ ...plan, batting });
              setToast("Innings 2–5 filled from Inning 1.");
            }}
            className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500"
          >
            Autofill from Inning 1
          </button>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          The order carries across innings — 9 bat per inning, so slot 10 leads
          off the next inning. By default the same lineup bats all game; swap a
          bench player into an inning to plan a sub from that inning on.
        </p>
        <ImportControl
          field="batting"
          week={week}
          side={side}
          coach={coach}
          proposals={proposals}
          gameplans={gameplans}
          onImport={(src) => importField("batting", src)}
        />
        <BattingGrid
          players={players}
          batting={plan.batting}
          onChange={(batting) => onChange({ ...plan, batting })}
        />
      </div>

      <PlayingTime players={players} byId={byId} plan={plan} />
    </>
  );
}

// The 5-inning defense grid (positions x innings) editor.
function DefenseGrid({
  players,
  defense,
  onChange,
  importedCells,
  onCellTouched,
}: {
  players: Player[];
  defense: Defense;
  onChange: (next: Defense) => void;
  // Cells filled by a consensus import, keyed "inning:pos" — tinted until edited.
  importedCells?: Set<string>;
  onCellTouched?: (inning: number, pos: string) => void;
}) {
  const setCell = (inning: number, pos: string, id: string) => {
    const next = defense.map((d, i) => (i === inning ? { ...d } : d));
    if (id) next[inning][pos] = id;
    else delete next[inning][pos];
    onChange(next);
    onCellTouched?.(inning, pos);
  };

  return (
    <>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[620px] border-collapse text-sm">
        <thead>
          <tr className="text-neutral-400">
            <th className="px-2 py-1 text-left font-display tracking-wider">
              Pos
            </th>
            {Array.from({ length: INNINGS }, (_, i) => (
              <th
                key={i}
                className="px-2 py-1 text-left font-display tracking-wider"
              >
                Inn {i + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {POSITIONS.map((pos) => (
            <tr key={pos} className="border-t border-neutral-800">
              <th className="px-2 py-1 text-left font-display text-lg tracking-wider text-red-500">
                {pos}
              </th>
              {Array.from({ length: INNINGS }, (_, inning) => {
                const current = defense[inning]?.[pos] ?? "";
                const used = new Set(
                  Object.entries(defense[inning] ?? {})
                    .filter(([k]) => k !== pos)
                    .map(([, v]) => v),
                );
                const options = players.filter(
                  (p) => p.id === current || !used.has(p.id),
                );
                const imported = importedCells?.has(`${inning}:${pos}`);
                return (
                  <td key={inning} className="px-1 py-1">
                    <select
                      value={current}
                      onChange={(e) => setCell(inning, pos, e.target.value)}
                      className={
                        "w-full rounded border px-1 py-1 text-sm outline-none transition-colors focus:border-red-600 " +
                        (imported
                          ? "border-sky-600 bg-sky-950/50"
                          : "border-neutral-700 bg-neutral-900")
                      }
                    >
                      <option value="">—</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {jerseyTag(p)} {p.firstName}
                        </option>
                      ))}
                    </select>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <Legend
      items={[
        ["P", "pitcher"],
        ["C", "catcher"],
        ["1B/2B/3B", "first/second/third base"],
        ["SS", "shortstop"],
        ["LF/CF/RF", "left/center/right field"],
        ["Inn", "inning"],
      ]}
    />
    </>
  );
}

// The batting-order grid (slots x innings), mirroring the defense grid. The
// order continues across innings; changing a cell pushes that player into the
// slot from that inning forward (over the run of whoever held it), so planning a
// sub is one click. Cells that differ from the previous inning are highlighted
// to mark where a sub enters.
function BattingGrid({
  players,
  batting,
  onChange,
}: {
  players: Player[];
  batting: Batting;
  onChange: (next: Batting) => void;
}) {
  const setCell = (inning: number, slot: string, id: string) => {
    const next = batting.map((b) => ({ ...b }));
    const oldVal = next[inning]?.[slot] ?? "";
    // Forward-fill only over the contiguous run of the player being replaced, so
    // a sub planned in a later inning is preserved.
    for (let j = inning; j < INNINGS; j++) {
      if (j !== inning && (next[j]?.[slot] ?? "") !== oldVal) break;
      if (!id) {
        delete next[j][slot];
        continue;
      }
      // Don't create a duplicate within a later inning.
      const dupe = Object.entries(next[j] ?? {}).some(
        ([k, v]) => k !== slot && v === id,
      );
      if (dupe && j !== inning) break;
      next[j][slot] = id;
    }
    onChange(next);
  };

  // Bench = squad players not in the starting (inning 1) lineup.
  const starters = new Set(Object.values(batting[0] ?? {}));
  const bench = players.filter((p) => !starters.has(p.id));

  return (
    <>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead>
            <tr className="text-neutral-400">
              <th className="px-2 py-1 text-left font-display tracking-wider">
                Slot
              </th>
              {Array.from({ length: INNINGS }, (_, i) => (
                <th
                  key={i}
                  className="px-2 py-1 text-left font-display tracking-wider"
                >
                  Inn {i + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot} className="border-t border-neutral-800">
                <th className="px-2 py-1 text-left font-display text-lg tracking-wider text-red-500">
                  {slot}
                </th>
                {Array.from({ length: INNINGS }, (_, inning) => {
                  const current = batting[inning]?.[slot] ?? "";
                  const used = new Set(
                    Object.entries(batting[inning] ?? {})
                      .filter(([k]) => k !== slot)
                      .map(([, v]) => v),
                  );
                  const options = players.filter(
                    (p) => p.id === current || !used.has(p.id),
                  );
                  const prev =
                    inning > 0 ? batting[inning - 1]?.[slot] ?? "" : current;
                  const changed = inning > 0 && !!current && current !== prev;
                  return (
                    <td key={inning} className="px-1 py-1">
                      <select
                        value={current}
                        onChange={(e) => setCell(inning, slot, e.target.value)}
                        className={
                          "w-full rounded border bg-neutral-900 px-1 py-1 text-sm outline-none focus:border-red-600 " +
                          (changed
                            ? "border-amber-500 text-amber-300"
                            : "border-neutral-700")
                        }
                      >
                        <option value="">—</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {jerseyTag(p)} {p.firstName}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <BenchPool bench={bench} />
      <Legend
        items={[
          ["Slot", "batting-order spot"],
          ["Inn", "inning"],
          ["amber cell", "a sub enters that inning"],
        ]}
      />
    </>
  );
}

// Per-inning mid-inning defensive subs editor. The league rule is "rotate the
// outfielders every 3 batters" — RF + CF at home, LF + CF on the road — so the
// "Apply rotation rule" button stubs the four sub events (after batters 3 and
// 6, both rotating positions) for the coach to fill with bench players.
function MidInningSubsSection({
  players,
  defense,
  subs,
  isHome,
  onChange,
}: {
  players: Player[];
  defense: Defense;
  subs: Subs;
  isHome: boolean;
  onChange: (next: Subs) => void;
}) {
  const [pos1, pos2] = rotationPair(isHome);
  const venue = isHome ? "Home" : "Away";
  const active = players.filter((p) => p.active);

  // Players on the field at the moment a given sub fires: starters for the
  // inning, with any earlier same-inning subs already applied (sorted by
  // afterBatter, then by order in the list).
  const onFieldAt = (inning: number, idx: number): Set<string> => {
    const positionToId: Record<string, string> = {
      ...(defense[inning] ?? {}),
    };
    const ordered = subs[inning]
      .map((s, i) => ({ s, i }))
      .sort((a, b) => a.s.afterBatter - b.s.afterBatter || a.i - b.i);
    for (const { s, i } of ordered) {
      if (i === idx) break;
      if (s.playerId) positionToId[s.position] = s.playerId;
    }
    return new Set(Object.values(positionToId).filter((v) => !!v));
  };

  const updateInning = (i: number, next: MidInningSub[]) => {
    onChange(subs.map((arr, idx) => (idx === i ? next : arr)));
  };
  const addSub = (i: number) =>
    updateInning(i, [
      ...subs[i],
      { afterBatter: 3, position: pos1, playerId: "" },
    ]);
  const applyRotation = (i: number) =>
    updateInning(i, rotationStubs(isHome));
  const swapAllInfield = (i: number) => {
    const infield = ["P", "C", "1B", "2B", "3B", "SS"];
    const stubs: MidInningSub[] = infield.map((position) => ({
      afterBatter: 3,
      position,
      playerId: "",
    }));
    // Append to whatever's already there so an outfield rotation set earlier
    // isn't blown away.
    updateInning(i, [...subs[i], ...stubs]);
  };
  const removeSub = (i: number, j: number) =>
    updateInning(i, subs[i].filter((_, k) => k !== j));
  const editSub = (i: number, j: number, patch: Partial<MidInningSub>) => {
    const next = subs[i].map((s, k) => (k === j ? { ...s, ...patch } : s));
    next.sort((a, b) => a.afterBatter - b.afterBatter);
    updateInning(i, next);
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-display text-2xl tracking-wider text-neutral-100">
        Mid-inning subs
      </h2>
      <p className="mt-0.5 text-xs text-neutral-500">
        League rule: after every 3 batters, {pos1} and {pos2} change. ({venue})
      </p>
      <div className="mt-3 space-y-3">
        {subs.map((innSubs, i) => (
          <div
            key={i}
            className="rounded border border-neutral-800 bg-black/40 p-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-display text-sm tracking-wider text-neutral-300">
                Inning {i + 1}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => applyRotation(i)}
                  className="rounded border border-neutral-700 bg-black/40 px-2 py-1 font-display text-xs tracking-wider text-neutral-300 hover:border-red-600"
                >
                  Apply rotation rule
                </button>
                <button
                  onClick={() => swapAllInfield(i)}
                  className="rounded border border-neutral-700 bg-black/40 px-2 py-1 font-display text-xs tracking-wider text-neutral-300 hover:border-red-600"
                >
                  Swap all infield
                </button>
                <button
                  onClick={() => addSub(i)}
                  className="rounded border border-neutral-700 bg-black/40 px-2 py-1 font-display text-xs tracking-wider text-neutral-300 hover:border-red-600"
                >
                  + Add sub
                </button>
              </div>
            </div>
            {innSubs.length === 0 ? (
              <p className="mt-2 text-xs text-neutral-600">
                No mid-inning subs.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {innSubs.map((s, j) => (
                  <li
                    key={j}
                    className="flex flex-wrap items-center gap-2 text-sm"
                  >
                    <span className="text-neutral-500">After batter</span>
                    <select
                      value={s.afterBatter}
                      onChange={(e) =>
                        editSub(i, j, {
                          afterBatter: Number(e.target.value),
                        })
                      }
                      className="rounded border border-neutral-700 bg-black/40 px-2 py-1 text-sm text-neutral-200"
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <select
                      value={s.position}
                      onChange={(e) =>
                        editSub(i, j, { position: e.target.value })
                      }
                      className="rounded border border-neutral-700 bg-black/40 px-2 py-1 text-sm text-neutral-200"
                    >
                      {POSITIONS.map((pos) => (
                        <option key={pos} value={pos}>
                          {pos}
                        </option>
                      ))}
                    </select>
                    <span className="text-neutral-500">→</span>
                    <select
                      value={s.playerId}
                      onChange={(e) =>
                        editSub(i, j, { playerId: e.target.value })
                      }
                      className="min-w-[12rem] rounded border border-neutral-700 bg-black/40 px-2 py-1 text-sm text-neutral-200"
                    >
                      <option value="">— pick player —</option>
                      {(() => {
                        const onField = onFieldAt(i, j);
                        return active
                          .filter(
                            (p) => !onField.has(p.id) || p.id === s.playerId,
                          )
                          .map((p) => (
                        <option key={p.id} value={p.id}>
                          {jerseyTag(p)} {p.firstName} {p.lastName}
                        </option>
                          ));
                      })()}
                    </select>
                    <button
                      onClick={() => removeSub(i, j)}
                      className="ml-auto rounded border border-neutral-700 bg-black/40 px-2 py-1 text-xs text-neutral-400 hover:border-red-600"
                      aria-label="Remove sub"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// The bench pool below the batting grid: squad players not in the starting
// lineup, available to sub into an inning column above.
function BenchPool({ bench }: { bench: Player[] }) {
  return (
    <div className="mt-3 rounded border border-neutral-800 bg-black/30 p-3">
      <h3 className="font-display text-lg tracking-wider text-neutral-200">
        Bench <span className="text-sm text-neutral-500">({bench.length})</span>
      </h3>
      <p className="mt-0.5 text-xs text-neutral-500">
        Not in the starting lineup. Pick one in an inning column above to sub
        them into that slot from that inning on.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {bench.length === 0 ? (
          <span className="text-xs text-neutral-600">Everyone&rsquo;s starting.</span>
        ) : (
          bench.map((p) => (
            <span
              key={p.id}
              className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200"
            >
              <span className="font-display tracking-wider text-red-500">
                {jerseyTag(p)}
              </span>{" "}
              {p.firstName} {p.lastName}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

// Playing-time tally for a plan: field innings + at-bats per girl, flagging
// anyone below the minimum.
function PlayingTime({
  players,
  byId,
  plan,
}: {
  players: Player[];
  byId: Map<string, Player>;
  plan: GamePlan;
}) {
  const stats = players
    .map((p) => {
      const field = fieldInningsOf(plan.defense, p.id);
      const atBats = atBatsOf(plan, p.id);
      return { p, field, atBats, ok: meetsMinimum(field, atBats) };
    })
    .sort(
      (a, b) =>
        Number(a.ok) - Number(b.ok) ||
        b.field + b.atBats - (a.field + a.atBats) ||
        (a.p.jersey ?? 9999) - (b.p.jersey ?? 9999),
    );
  const okCount = stats.filter((s) => s.ok).length;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Playing time
        </h2>
        <p className="text-sm">
          <span
            className={
              okCount === stats.length ? "text-emerald-400" : "text-red-400"
            }
          >
            {okCount}/{stats.length} meet the minimum
          </span>
        </p>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        Target: 2 field innings + 1 at-bat, or 2 at-bats + 1 field inning.
      </p>
      <ul className="mt-3 divide-y divide-neutral-800">
        {stats.map(({ p, field, atBats, ok }) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span className="min-w-0 truncate">
              <PlayerName p={p} />
            </span>
            <span className="flex shrink-0 items-center gap-4">
              <span className="text-neutral-400">
                <span className="text-neutral-100">{field}</span> field
              </span>
              <span className="text-neutral-400">
                <span className="text-neutral-100">{atBats}</span> AB
              </span>
              <span
                className={
                  "w-16 text-right font-display text-xs tracking-wider " +
                  (ok ? "text-emerald-400" : "text-red-400")
                }
              >
                {ok ? "OK" : "Short"}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Legend
        items={[
          ["field", "innings on defense"],
          ["AB", "at-bats"],
          ["OK / Short", "meets / misses the playing-time minimum"],
        ]}
      />
    </div>
  );
}

const STATUS_BADGE: Record<RowStatus, { label: string; cls: string }> = {
  agree: { label: "Agree", cls: "text-emerald-400" },
  differ: { label: "Differs", cls: "text-red-400" },
  single: { label: "1 coach", cls: "text-neutral-500" },
  none: { label: "—", cls: "text-neutral-600" },
};

function CompareCell({
  status,
  children,
}: {
  status: RowStatus;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "rounded border bg-black/40 p-3 " +
        (status === "differ"
          ? "border-red-900/70"
          : status === "agree"
            ? "border-emerald-900/60"
            : "border-neutral-800")
      }
    >
      {children}
    </div>
  );
}

// One coach's single pick (used by the batting-order comparison).
function CoachPick({ coach, p }: { coach: string; p: Player | undefined }) {
  return (
    <li className="flex items-center justify-between gap-2 py-0.5 text-sm">
      <span className="text-neutral-400">{coach}</span>
      {p ? (
        <span className="truncate text-neutral-100">
          <PlayerName p={p} />
        </span>
      ) : (
        <span className="text-neutral-600">—</span>
      )}
    </li>
  );
}

function DefenseCompare({
  byId,
  side,
  plans,
}: {
  byId: Map<string, Player>;
  side: Side;
  plans: Record<string, GamePlan>;
}) {
  const any = COACHES.some((c) => hasPlan(plans[c]));
  let agree = 0;
  let differ = 0;
  const innings = Array.from({ length: INNINGS }, (_, i) => {
    const cells = POSITIONS.map((pos) => {
      const picks = COACHES.map((c) => plans[c]?.defense?.[i]?.[pos]);
      const status = rowStatus(picks);
      if (status === "agree") agree++;
      else if (status === "differ") differ++;
      return { pos, picks, status };
    });
    return { inning: i, cells };
  });

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Defense — {sideLabel(side)}
        </h2>
        <p className="text-sm">
          <span className="text-emerald-400">{agree} agree</span>
          <span className="text-neutral-600"> · </span>
          <span className="text-red-400">{differ} differ</span>
        </p>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        Agree/Differs is per position, per inning, across coaches.
      </p>
      <Legend
        items={[
          ["P", "pitcher"],
          ["C", "catcher"],
          ["1B/2B/3B", "first/second/third base"],
          ["SS", "shortstop"],
          ["LF/CF/RF", "left/center/right field"],
        ]}
      />
      {!any ? (
        <p className="mt-2 text-sm text-neutral-400">
          No proposals for this game yet. Enter yours above to start the
          comparison.
        </p>
      ) : (
        innings.map(({ inning, cells }) => (
          <div key={inning} className="mt-4">
            <h3 className="font-display text-lg tracking-wider text-neutral-200">
              Inning {inning + 1}
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cells.map(({ pos, picks, status }) => {
                const badge = STATUS_BADGE[status];
                return (
                  <CompareCell key={pos} status={status}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-lg tracking-wider text-red-500">
                        {pos}
                      </h4>
                      <span className={"text-xs " + badge.cls}>
                        {badge.label}
                      </span>
                    </div>
                    <ul className="mt-1">
                      {COACHES.map((c, i) => (
                        <CoachPick
                          key={c}
                          coach={c}
                          p={byId.get(picks[i] ?? "")}
                        />
                      ))}
                    </ul>
                  </CompareCell>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function BattingCompare({
  byId,
  side,
  plans,
}: {
  byId: Map<string, Player>;
  side: Side;
  plans: Record<string, GamePlan>;
}) {
  const any = COACHES.some((c) => hasPlan(plans[c]));
  let agree = 0;
  let differ = 0;
  const innings = Array.from({ length: INNINGS }, (_, i) => {
    const cells = SLOTS.map((slot) => {
      const picks = COACHES.map((c) => plans[c]?.batting?.[i]?.[slot]);
      const status = rowStatus(picks);
      if (status === "agree") agree++;
      else if (status === "differ") differ++;
      return { slot, picks, status };
    });
    return { inning: i, cells };
  });

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Batting order — {sideLabel(side)}
        </h2>
        <p className="text-sm">
          <span className="text-emerald-400">{agree} agree</span>
          <span className="text-neutral-600"> · </span>
          <span className="text-red-400">{differ} differ</span>
        </p>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        Agree/Differs is per batting slot, per inning, across coaches.
      </p>
      <Legend items={[["Slot", "batting-order spot"], ["Inn", "inning"]]} />
      {!any ? (
        <p className="mt-2 text-sm text-neutral-400">
          No proposals for this game yet. Enter yours above to start the
          comparison.
        </p>
      ) : (
        innings.map(({ inning, cells }) => (
          <div key={inning} className="mt-4">
            <h3 className="font-display text-lg tracking-wider text-neutral-200">
              Inning {inning + 1}
            </h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {cells.map(({ slot, picks, status }) => {
                const badge = STATUS_BADGE[status];
                return (
                  <CompareCell key={slot} status={status}>
                    <div className="flex items-center justify-between">
                      <h4 className="font-display text-lg tracking-wider text-red-500">
                        {slot}
                      </h4>
                      <span className={"text-xs " + badge.cls}>
                        {badge.label}
                      </span>
                    </div>
                    <ul className="mt-1">
                      {COACHES.map((c, i) => (
                        <CoachPick
                          key={c}
                          coach={c}
                          p={byId.get(picks[i] ?? "")}
                        />
                      ))}
                    </ul>
                  </CompareCell>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

/* ---------------------------- Game plan -------------------------- */

// Auto-build a fair 5-inning defense from a depth chart. Everyone is pushed to
// the field-inning floor first (so all girls meet the minimum), then the extra
// innings go to the strongest players (those highest on each position's depth
// list).
// Default batting grid: the first 12 squad players bat in roster order, the same
// lineup every inning (no subs planned yet).
function draftBatting(players: Player[]): Batting {
  const starters = players.slice(0, BATTING_SLOTS).map((p) => p.id);
  return Array.from({ length: INNINGS }, () => {
    const inn: Record<string, string> = {};
    starters.forEach((id, i) => {
      inn[String(i + 1)] = id;
    });
    return inn;
  });
}

// How many leading innings a consensus pick fills; the rest stay blank for the
// head coach to set rotation.
const CONSENSUS_INNINGS = 3;

// A coach's top-ranked ACTIVE player at a position. Skips picks who aren't
// active for this game — the "fall through to the next ranked active player"
// rule — so an absent #1 doesn't block the position.
function topActivePick(
  list: string[] | undefined,
  activeIds: Set<string>,
): string | undefined {
  for (const id of list ?? []) if (activeIds.has(id)) return id;
  return undefined;
}

// The agreed starter at a position: the player who is the top active pick for a
// majority of coaches (2-of-3, or 2-of-2 when only two coaches have a chart).
// Returns undefined when no majority exists.
function consensusStarter(
  pos: string,
  coachDepths: CoachDepths,
  activeIds: Set<string>,
): string | undefined {
  const picks = COACHES.map((c) =>
    topActivePick(coachDepths[c]?.[pos], activeIds),
  ).filter((x): x is string => !!x);
  if (picks.length < 2) return undefined;
  const counts = new Map<string, number>();
  for (const id of picks) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best: string | undefined;
  let bestN = 0;
  for (const [id, n] of counts) {
    if (n > bestN) {
      best = id;
      bestN = n;
    }
  }
  return bestN >= 2 ? best : undefined;
}

// Build a defense grid from coach consensus. Each agreed starter fills innings
// 1–CONSENSUS_INNINGS of its position; innings after that — and positions with
// no majority — stay blank for the head coach. Returns the grid, the set of
// filled "inning:pos" cell keys (for the imported-cell highlight), and how many
// positions were filled.
function consensusDefense(
  coachDepths: CoachDepths,
  activeIds: Set<string>,
): { defense: Defense; cells: Set<string>; filled: number } {
  const defense: Defense = Array.from({ length: INNINGS }, () => ({}));
  const cells = new Set<string>();
  let filled = 0;
  for (const pos of POSITIONS) {
    const id = consensusStarter(pos, coachDepths, activeIds);
    if (!id) continue;
    filled++;
    for (let inn = 0; inn < Math.min(CONSENSUS_INNINGS, INNINGS); inn++) {
      defense[inn][pos] = id;
      cells.add(`${inn}:${pos}`);
    }
  }
  return { defense, cells, filled };
}

function draftDefense(players: Player[], depth: DepthChart): Defense {
  const FLOOR = 2;
  const ids = new Set(players.map((p) => p.id));
  const field = new Map<string, number>(players.map((p) => [p.id, 0]));
  const rankOf = (pos: string, id: string) => {
    const i = (depth[pos] ?? []).indexOf(id);
    return i === -1 ? 1e6 : i;
  };

  const innings: Record<string, string>[] = [];
  for (let inning = 0; inning < INNINGS; inning++) {
    const used = new Set<string>();
    const cell: Record<string, string> = {};
    // Fill the scarcest positions (fewest depth options) first.
    const ordered = [...POSITIONS].sort(
      (a, b) => (depth[a]?.length ?? 0) - (depth[b]?.length ?? 0),
    );
    for (const pos of ordered) {
      const fromDepth = (depth[pos] ?? []).filter(
        (id) => ids.has(id) && !used.has(id),
      );
      const pool = fromDepth.length
        ? fromDepth
        : players.map((p) => p.id).filter((id) => !used.has(id));
      if (pool.length === 0) continue;
      const pick = [...pool].sort((a, b) => {
        const belowA = (field.get(a) ?? 0) < FLOOR ? 0 : 1;
        const belowB = (field.get(b) ?? 0) < FLOOR ? 0 : 1;
        if (belowA !== belowB) return belowA - belowB; // below floor first
        if (belowA === 0) {
          const c = (field.get(a) ?? 0) - (field.get(b) ?? 0);
          if (c !== 0) return c; // spread fairly toward the floor
          return rankOf(pos, a) - rankOf(pos, b); // tiebreak: stronger first
        }
        return rankOf(pos, a) - rankOf(pos, b); // extra innings to the strongest
      })[0];
      cell[pos] = pick;
      used.add(pick);
      field.set(pick, (field.get(pick) ?? 0) + 1);
    }
    innings.push(cell);
  }
  return innings;
}

// Build a plain-text, SMS-friendly version of the game plan for copy-paste.
// Format mirrors the print view: header, batting order, defense by inning,
// mid-inning subs (if any), and the game note (if any).
function buildGamePlanText(
  plan: GamePlan,
  byId: Map<string, Player>,
  game: Game | undefined,
  side: Side,
  note: string,
): string {
  const lines: string[] = [];
  const firstName = (id: string) => byId.get(id)?.firstName ?? "—";
  const jerseyName = (id: string) => {
    const p = byId.get(id);
    if (!p) return "—";
    const j = p.jersey != null ? `#${p.jersey} ` : "";
    return `${j}${p.firstName} ${p.lastName}`;
  };

  lines.push(`HAXTUN BULLDOGS — ${sideLabel(side)}`);
  const matchup = game ? `${game.home ? "vs" : "@"} ${game.opponent}` : "Game";
  const dateStr = game ? formatWeek(game.date) : "";
  const venue = game ? (game.home ? "Home" : "Away") : "";
  const headLine = [dateStr, matchup, venue].filter(Boolean).join(" · ");
  if (headLine) lines.push(headLine);
  lines.push("");

  lines.push("BATTING ORDER");
  for (const slot of SLOTS) {
    const id = plan.batting[0]?.[slot] ?? "";
    lines.push(`${slot.padStart(2, " ")}. ${jerseyName(id)}`);
  }
  lines.push("");

  lines.push("DEFENSE BY INNING (> marks a sub in)");
  for (let i = 0; i < INNINGS; i++) {
    const parts = POSITIONS.map((pos) => {
      const cur = plan.defense[i]?.[pos] ?? "";
      const prev = i > 0 ? (plan.defense[i - 1]?.[pos] ?? "") : "";
      const changed = i > 0 && cur !== "" && cur !== prev;
      return `${changed ? ">" : ""}${pos}-${firstName(cur)}`;
    });
    lines.push(`Inn ${i + 1}: ${parts.join(", ")}`);
  }

  // Group mid-inning subs by (inning, afterBatter) so co-located swaps share a line.
  const subEntries: Array<{
    inning: number;
    batter: number;
    subs: MidInningSub[];
  }> = [];
  for (let i = 0; i < INNINGS; i++) {
    const innSubs = plan.subs[i].filter((s) => s.playerId);
    if (innSubs.length === 0) continue;
    const byBatter = new Map<number, MidInningSub[]>();
    for (const s of innSubs) {
      const arr = byBatter.get(s.afterBatter) ?? [];
      arr.push(s);
      byBatter.set(s.afterBatter, arr);
    }
    for (const [batter, subs] of [...byBatter.entries()].sort(
      (a, b) => a[0] - b[0],
    )) {
      subEntries.push({ inning: i, batter, subs });
    }
  }
  if (subEntries.length > 0) {
    lines.push("");
    lines.push("MID-INNING SUBS");
    for (const e of subEntries) {
      const parts = e.subs.map(
        (s) => `${firstName(s.playerId)} → ${s.position}`,
      );
      lines.push(
        `Inn ${e.inning + 1} after batter ${e.batter} — ${parts.join(", ")}`,
      );
    }
  }

  if (note.trim()) {
    lines.push("");
    lines.push("NOTES");
    lines.push(note.trim());
  }

  return lines.join("\n");
}

// Print-only render of the selected game plan. Hidden on screen, visible only
// when the user prints (see .printable-gameplan rules in globals.css). Defense
// fills one page; batting starts on a new page (the back of the sheet). The
// goal is a clean front-and-back hand-off to the bookkeeper / GameChanger
// operator / announcer, replacing the 4-page browser print of the editor UI.
function PrintableGamePlan({
  plan,
  byId,
  game,
  side,
  note,
}: {
  plan: GamePlan;
  byId: Map<string, Player>;
  game: Game | undefined;
  side: Side;
  note: string;
}) {
  const fmt = (id: string) => {
    if (!id) return <span className="print-empty">—</span>;
    const p = byId.get(id);
    if (!p) return <span className="print-empty">—</span>;
    const j = p.jersey != null ? `#${p.jersey} ` : "";
    return `${j}${p.firstName} ${p.lastName}`;
  };
  const matchup = game
    ? `${game.home ? "vs" : "@"} ${game.opponent}`
    : "Game";
  const venue = game ? (game.home ? "Home" : "Away") : "";
  const dateStr = game ? formatWeek(game.date) : "";
  const meta = [matchup, dateStr, venue, sideLabel(side)]
    .filter(Boolean)
    .join(" · ");
  const hasSubs = plan.subs.some((inn) =>
    inn.some((s) => s.playerId !== ""),
  );
  // A cell is a "change" when a new player enters that position/slot vs the
  // previous inning. Inning 1 is the starting lineup, so no comparison.
  const changedDefense = (pos: string, i: number) => {
    if (i === 0) return false;
    const cur = plan.defense[i]?.[pos] ?? "";
    return cur !== "" && cur !== (plan.defense[i - 1]?.[pos] ?? "");
  };
  const changedBatting = (slot: string, i: number) => {
    if (i === 0) return false;
    const cur = plan.batting[i]?.[slot] ?? "";
    return cur !== "" && cur !== (plan.batting[i - 1]?.[slot] ?? "");
  };
  return (
    <div className="printable-gameplan">
      <section className="print-page">
        <header>
          <h1>Haxtun Bulldogs — Defense</h1>
          <p className="print-meta">{meta}</p>
        </header>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              {Array.from({ length: INNINGS }, (_, i) => (
                <th key={i}>Inn {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POSITIONS.map((pos) => (
              <tr key={pos}>
                <th scope="row">{pos}</th>
                {plan.defense.map((inn, i) => (
                  <td
                    key={i}
                    className={changedDefense(pos, i) ? "print-change" : undefined}
                  >
                    {fmt(inn[pos] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {hasSubs && (
          <>
            <h2>Mid-inning subs</h2>
            <ul>
              {plan.subs.flatMap((innSubs, i) =>
                innSubs
                  .filter((s) => s.playerId)
                  .map((s, j) => (
                    <li key={`${i}-${j}`}>
                      Inning {i + 1}, after batter {s.afterBatter}:{" "}
                      {fmt(s.playerId)} → {s.position}
                    </li>
                  )),
              )}
            </ul>
          </>
        )}
        {note.trim() && (
          <>
            <h2>Notes</h2>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{note}</p>
          </>
        )}
      </section>
      <section className="print-page">
        <header>
          <h1>Haxtun Bulldogs — Batting Order</h1>
          <p className="print-meta">{meta}</p>
        </header>
        <table>
          <thead>
            <tr>
              <th>Slot</th>
              {Array.from({ length: INNINGS }, (_, i) => (
                <th key={i}>Inn {i + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SLOTS.map((slot) => (
              <tr key={slot}>
                <th scope="row">{slot}</th>
                {plan.batting.map((inn, i) => (
                  <td
                    key={i}
                    className={changedBatting(slot, i) ? "print-change" : undefined}
                  >
                    {fmt(inn[slot] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function GamePlanPanel({
  players,
  byId,
  depth,
  coachDepths,
  gameplans,
  proposals,
  coach,
  notes,
  onChange,
  onSaveNote,
}: {
  players: Player[];
  byId: Map<string, Player>;
  depth: DepthChart;
  coachDepths: CoachDepths;
  gameplans: GamePlans;
  proposals: Proposals;
  coach: string | null;
  notes: Notes;
  onChange: (next: GamePlans) => void;
  onSaveNote: (week: string, text: string) => void;
}) {
  const [week, setWeek] = useState<string>(() => defaultGameDate());
  const [side, setSide] = useState<Side>("A");

  // Active = roster-wide active flag. The portal has no per-game availability,
  // so absent players still need to be cleared by hand after import.
  const activeIds = useMemo(
    () => new Set(players.filter((p) => p.active).map((p) => p.id)),
    [players],
  );

  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );

  if (players.length === 0) return <EmptyRoster what="game plan" />;

  const ab: GamePlanAB = gameplans[week] ?? emptyGamePlanAB();
  const game = SCHEDULE.find((g) => g.date === week);
  const note = notes[week] ?? "";

  const copyAsText = async () => {
    const text = buildGamePlanText(ab[side], byId, game, side, note);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    setTimeout(() => setCopyStatus("idle"), 2000);
  };

  return (
    <section className="space-y-5">
      <GameSelect date={week} onSelect={setWeek} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SideToggle side={side} onSelect={setSide} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={copyAsText}
            title="Copy a SMS-friendly text version of this game plan to your clipboard"
            className="rounded border border-neutral-700 bg-black/40 px-3 py-1.5 font-display text-sm tracking-wider text-neutral-200 hover:border-red-600"
          >
            {copyStatus === "copied"
              ? "Copied ✓"
              : copyStatus === "error"
                ? "Copy failed"
                : "📋 Copy to text"}
          </button>
          <button
            onClick={() => window.print()}
            title="Print a one-page front-and-back: defense on the front, batting order on the back"
            className="rounded border border-neutral-700 bg-black/40 px-3 py-1.5 font-display text-sm tracking-wider text-neutral-200 hover:border-red-600"
          >
            🖨 Print Game Plan
          </button>
        </div>
      </div>

      <NotesCard
        key={week}
        week={week}
        note={notes[week] ?? ""}
        onSave={(text) => onSaveNote(week, text)}
      />

      <PlanEditor
        players={players}
        byId={byId}
        draftDepth={depth}
        draftLabel="Auto-draft from depth chart"
        plan={ab[side]}
        week={week}
        side={side}
        coach={coach}
        proposals={proposals}
        gameplans={gameplans}
        consensus={{ coachDepths, activeIds }}
        onChange={(next) =>
          onChange({ ...gameplans, [week]: { ...ab, [side]: next } })
        }
      />

      <PrintableGamePlan
        plan={ab[side]}
        byId={byId}
        game={game}
        side={side}
        note={note}
      />
    </section>
  );
}

/* ---------------------------- Calendar ---------------------------- */

type Practice = {
  recordId: string;
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  focus: string;
  notes: string;
  proposed_by: string;
  status: "proposed" | "confirmed" | "cancelled";
  confirmations: string[];
};

type FieldBusy = {
  id?: string;
  date: string;
  start_time: string;
  end_time: string;
  location: string;
  label: string;
  source?: string;
};

// Does [aStart,aEnd) overlap [bStart,bEnd)? 24h "HH:MM" strings compare lexically.
function timesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Tailwind classes per event kind/status (matches the public color scheme).
function eventChipCls(kind: "game" | Practice["status"]): string {
  switch (kind) {
    case "game":
      return "bg-red-600 text-white";
    case "confirmed":
      return "bg-emerald-700 text-white";
    case "proposed":
      return "border border-dashed border-amber-500 bg-amber-500/10 text-amber-300";
    case "cancelled":
      return "bg-neutral-800 text-neutral-500 line-through";
  }
}

// Practice-location accent colors. Keep in sync with _data/locations.yml
// (the public /calendar/) and the Propose-form Location dropdown.
const LOCATION_COLORS: Record<string, string> = {
  "Haxtun Baseball Field": "#3b82f6",
  "Behind the School": "#f97316",
  "Little Gym at School": "#a855f7",
};
function locationColor(loc: string | undefined): string | undefined {
  return loc ? LOCATION_COLORS[loc.trim()] : undefined;
}
// A left accent stripe layered on top of the status color, by location.
function locationAccent(loc: string | undefined): React.CSSProperties {
  const c = locationColor(loc);
  return c ? { borderLeft: `4px solid ${c}` } : {};
}

function CalendarPanel({
  coach,
  onChooseCoach,
}: {
  coach: string | null;
  onChooseCoach: (name: string) => void;
}) {
  const [practices, setPractices] = useState<Practice[]>([]);
  const [busy, setBusy] = useState<FieldBusy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"month" | "list">("month");
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${defaultGameDate()}T00:00:00`);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<
    | { kind: "game"; game: Game }
    | { kind: "practice"; practice: Practice }
    | { kind: "busy"; busy: FieldBusy }
    | null
  >(null);
  const [proposeDate, setProposeDate] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/practices", { cache: "no-store" });
      if (!res.ok) throw new Error(`Practices load failed (${res.status})`);
      const d = await res.json();
      setPractices(Array.isArray(d.practices) ? d.practices : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load practices");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Field-busy blocks are an internal aid; load best-effort, never block the UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/field-busy", { cache: "no-store" });
        const d = await res.json();
        if (!cancelled) setBusy(Array.isArray(d.busy) ? d.busy : []);
      } catch {
        /* ignore — busy blocks are optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const busyByDate = useMemo(() => {
    const m = new Map<string, FieldBusy[]>();
    for (const b of busy) {
      const k = b.date.slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(b);
    }
    return m;
  }, [busy]);

  const practiceByDate = useMemo(() => {
    const m = new Map<string, Practice[]>();
    for (const p of practices) {
      const k = p.date.slice(0, 10);
      (m.get(k) ?? m.set(k, []).get(k)!).push(p);
    }
    return m;
  }, [practices]);
  const gameByDate = useMemo(() => {
    const m = new Map<string, Game[]>();
    for (const g of expandGames()) (m.get(g.date) ?? m.set(g.date, []).get(g.date)!).push(g);
    return m;
  }, []);

  // Returns null on success, or an error message the caller can surface.
  const mutate = async (
    path: string,
    method: string,
    body: unknown,
  ): Promise<string | null> => {
    if (!coach) return "Pick your name up top first.";
    try {
      const res = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", "x-coach": coach },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        return j?.error ?? `Request failed (${res.status})`;
      }
      setSelected(null);
      setProposeDate(null);
      await reload();
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "Request failed";
    }
  };

  if (loading) return <p className="text-neutral-400">Loading…</p>;

  return (
    <section className="space-y-4">
      <CoachSelect coach={coach} onChoose={onChooseCoach} />

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {(["month", "list"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={
                "rounded px-3 py-1.5 font-display text-sm tracking-wider transition-colors " +
                (view === v
                  ? "bg-red-600 text-white"
                  : "border border-neutral-700 bg-black/40 text-neutral-300 hover:border-red-600")
              }
            >
              {v === "month" ? "Month" : "List"}
            </button>
          ))}
        </div>
        {view === "month" && (
          <div className="flex items-center gap-2">
            <IconBtn label="Previous month" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() - 1, 1))}>
              ←
            </IconBtn>
            <span className="min-w-[8rem] text-center font-display text-lg tracking-wider text-neutral-100">
              {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
            <IconBtn label="Next month" onClick={() => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + 1, 1))}>
              →
            </IconBtn>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3 text-xs text-neutral-400">
        <span><span className="inline-block h-3 w-3 rounded-sm bg-red-600 align-middle"></span> Game</span>
        <span><span className="inline-block h-3 w-3 rounded-sm bg-emerald-700 align-middle"></span> Confirmed</span>
        <span><span className="inline-block h-3 w-3 rounded-sm border border-dashed border-amber-500 align-middle"></span> Proposed</span>
        <span><span className="inline-block h-3 w-3 rounded-sm bg-neutral-800 align-middle"></span> Cancelled</span>
        <span><span className="inline-block h-3 w-3 rounded-sm border border-neutral-600 bg-neutral-800/60 align-middle"></span> Field busy (other org)</span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-neutral-400">
        <span className="text-neutral-500">Practice location:</span>
        {Object.entries(LOCATION_COLORS).map(([name, color]) => (
          <span key={name}>
            <span
              className="inline-block h-3 w-3 rounded-sm align-middle"
              style={{ background: color }}
            />{" "}
            {name}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}

      {view === "month" ? (
        <MonthGrid
          cursor={cursor}
          gameByDate={gameByDate}
          practiceByDate={practiceByDate}
          busyByDate={busyByDate}
          onGame={(g) => setSelected({ kind: "game", game: g })}
          onPractice={(p) => setSelected({ kind: "practice", practice: p })}
          onBusy={(b) => setSelected({ kind: "busy", busy: b })}
          onEmptyDay={(d) => {
            setSelected(null);
            setProposeDate(d);
          }}
        />
      ) : (
        <CalendarList
          gameByDate={gameByDate}
          practices={practices}
          busy={busy}
          onGame={(g) => setSelected({ kind: "game", game: g })}
          onPractice={(p) => setSelected({ kind: "practice", practice: p })}
          onBusy={(b) => setSelected({ kind: "busy", busy: b })}
        />
      )}

      {selected?.kind === "game" && (
        <GameDetail game={selected.game} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === "busy" && (
        <BusyDetail busy={selected.busy} onClose={() => setSelected(null)} />
      )}
      {selected?.kind === "practice" && (
        <PracticeDetail
          practice={selected.practice}
          coach={coach}
          onClose={() => setSelected(null)}
          onConfirm={async (p) => {
            const e = await mutate(`/api/practices/${p.recordId}`, "PATCH", { action: "confirm" });
            if (e) setError(e);
          }}
          onCancel={async (p, reason) => {
            const e = await mutate(`/api/practices/${p.recordId}`, "PATCH", { action: "cancel", reason });
            if (e) setError(e);
          }}
        />
      )}
      {proposeDate != null && (
        <ProposeForm
          date={proposeDate}
          coach={coach}
          busy={busy}
          onClose={() => setProposeDate(null)}
          onSubmit={(form) => mutate("/api/practices", "POST", form)}
        />
      )}
    </section>
  );
}

function MonthGrid({
  cursor,
  gameByDate,
  practiceByDate,
  busyByDate,
  onGame,
  onPractice,
  onBusy,
  onEmptyDay,
}: {
  cursor: Date;
  gameByDate: Map<string, Game[]>;
  practiceByDate: Map<string, Practice[]>;
  busyByDate: Map<string, FieldBusy[]>;
  onGame: (g: Game) => void;
  onPractice: (p: Practice) => void;
  onBusy: (b: FieldBusy) => void;
  onEmptyDay: (date: string) => void;
}) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const lead = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[640px] grid-cols-7 gap-1">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-1 py-1 text-center font-display text-xs tracking-wider text-neutral-500">
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <div key={i} className="min-h-[84px] rounded bg-transparent" />;
          const date = ymd(new Date(year, month, day));
          const games = gameByDate.get(date) ?? [];
          const pracs = practiceByDate.get(date) ?? [];
          const busies = busyByDate.get(date) ?? [];
          const empty = games.length === 0 && pracs.length === 0 && busies.length === 0;
          return (
            <div key={i} className="min-h-[84px] rounded border border-neutral-800 bg-neutral-900 p-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-neutral-500">{day}</span>
                <button
                  onClick={() => onEmptyDay(date)}
                  title="Propose a practice"
                  className="h-4 w-4 rounded text-xs leading-none text-neutral-600 hover:bg-neutral-700 hover:text-white"
                >
                  +
                </button>
              </div>
              <div className="mt-1 space-y-1">
                {games.map((g, gi) => (
                  <button
                    key={`g${gi}`}
                    onClick={() => onGame(g)}
                    className={"block w-full truncate rounded px-1 py-0.5 text-left text-[11px] " + eventChipCls("game")}
                  >
                    {g.home ? "vs" : "@"} {g.opponent}{g.gameNo ? ` (G${g.gameNo})` : ""}
                  </button>
                ))}
                {pracs.map((p) => (
                  <button
                    key={p.recordId}
                    onClick={() => onPractice(p)}
                    style={locationAccent(p.location)}
                    className={"block w-full truncate rounded px-1 py-0.5 text-left text-[11px] " + eventChipCls(p.status)}
                  >
                    {p.start_time} {p.focus || "Practice"}
                  </button>
                ))}
                {busies.map((b, bi) => (
                  <button
                    key={`b${bi}`}
                    onClick={() => onBusy(b)}
                    title={b.label}
                    className="block w-full truncate rounded border border-neutral-700 bg-neutral-800/60 px-1 py-0.5 text-left text-[10px] text-neutral-400"
                  >
                    🚫 {b.label}
                  </button>
                ))}
                {empty && <span className="sr-only">No events</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarList({
  gameByDate,
  practices,
  onGame,
  onPractice,
  busy,
  onBusy,
}: {
  gameByDate: Map<string, Game[]>;
  practices: Practice[];
  busy: FieldBusy[];
  onGame: (g: Game) => void;
  onPractice: (p: Practice) => void;
  onBusy: (b: FieldBusy) => void;
}) {
  type Row = { date: string; sort: string; el: React.ReactNode };
  const rows: Row[] = [];
  for (const g of expandGames()) {
    rows.push({
      date: g.date,
      sort: g.date + " 0" + (g.gameNo ?? 0),
      el: (
        <button
          key={`g-${g.date}-${g.opponent}-${g.gameNo ?? 0}`}
          onClick={() => onGame(g)}
          className={"block w-full rounded px-3 py-2 text-left text-sm " + eventChipCls("game")}
        >
          {gameLabel(g)} · {g.location}
        </button>
      ),
    });
  }
  for (const p of practices) {
    rows.push({
      date: p.date.slice(0, 10),
      sort: p.date.slice(0, 10) + " 1" + p.start_time,
      el: (
        <button
          key={p.recordId}
          onClick={() => onPractice(p)}
          style={locationAccent(p.location)}
          className={"block w-full rounded px-3 py-2 text-left text-sm " + eventChipCls(p.status)}
        >
          {p.start_time} Practice — {p.focus || "TBD"} · {p.location}
          {p.status !== "confirmed" ? ` (${p.status})` : ""}
        </button>
      ),
    });
  }
  for (const b of busy) {
    const d = b.date.slice(0, 10);
    rows.push({
      date: d,
      // sort key "2" → field-busy sits after our own events on the same day.
      sort: d + " 2" + b.start_time,
      el: (
        <button
          key={`busy-${b.id ?? d + b.start_time}`}
          onClick={() => onBusy(b)}
          className="block w-full truncate rounded border border-neutral-700 bg-neutral-800/60 px-3 py-2 text-left text-xs text-neutral-400"
        >
          🚫 {b.start_time}–{b.end_time} {b.label} · {b.location}
        </button>
      ),
    });
  }
  rows.sort((a, b) => a.sort.localeCompare(b.sort));
  if (rows.length === 0) return <p className="text-neutral-400">Nothing scheduled.</p>;
  return <div className="space-y-1">{rows.map((r) => r.el)}</div>;
}

function BusyDetail({ busy, onClose }: { busy: FieldBusy; onClose: () => void }) {
  return (
    <DetailCard title="Field busy (other org)" onClose={onClose}>
      <p className="text-sm text-neutral-200">{busy.label}</p>
      <p className="mt-1 text-sm text-neutral-400">
        {formatWeek(busy.date.slice(0, 10))} · {busy.start_time}–{busy.end_time}
      </p>
      <p className="mt-1 text-sm text-neutral-400">{busy.location}</p>
      {busy.source && (
        <p className="mt-2 text-xs text-neutral-600">Source: {busy.source}</p>
      )}
      <p className="mt-2 text-xs text-neutral-600">
        Internal scheduling note — not shown on the public site.
      </p>
    </DetailCard>
  );
}

function GameDetail({ game, onClose }: { game: Game; onClose: () => void }) {
  return (
    <DetailCard title={`${game.home ? "vs" : "@"} ${game.opponent}${game.gameNo ? ` (G${game.gameNo})` : ""}`} onClose={onClose}>
      <p className="text-sm text-neutral-300">{gameLabel(game)}</p>
      {game.time && <p className="mt-1 text-sm text-neutral-300">{game.time}</p>}
      <p className="mt-1 text-sm text-neutral-400">{game.location}</p>
      <p className="mt-1 text-xs text-neutral-600">Games are read-only (from the season schedule).</p>
    </DetailCard>
  );
}

function PracticeDetail({
  practice: p,
  coach,
  onClose,
  onConfirm,
  onCancel,
}: {
  practice: Practice;
  coach: string | null;
  onClose: () => void;
  onConfirm: (p: Practice) => void;
  onCancel: (p: Practice, reason: string) => void;
}) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const canConfirm =
    p.status === "proposed" &&
    !!coach &&
    coach !== p.proposed_by &&
    !p.confirmations.includes(coach);

  return (
    <DetailCard
      title={`Practice — ${p.focus || "TBD"}`}
      onClose={onClose}
    >
      <p className="text-sm text-neutral-300">
        {formatWeek(p.date.slice(0, 10))} · {p.start_time}–{p.end_time}
      </p>
      <p className="mt-1 text-sm text-neutral-400">
        {locationColor(p.location) && (
          <span
            className="mr-1.5 inline-block h-3 w-3 rounded-sm align-middle"
            style={{ background: locationColor(p.location) }}
          />
        )}
        {p.location}
      </p>
      <p className="mt-2 text-xs text-neutral-500">
        Status: <span className="text-neutral-300">{p.status}</span> · Proposed by{" "}
        <span className="text-neutral-300">{p.proposed_by}</span>
        {p.confirmations.length > 0 && (
          <> · Confirmed by {p.confirmations.join(", ")}</>
        )}
      </p>
      {p.notes && <p className="mt-2 text-sm text-neutral-400">{p.notes}</p>}

      {p.status !== "cancelled" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canConfirm && (
            <button
              onClick={() => onConfirm(p)}
              className="rounded bg-emerald-700 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-emerald-600"
            >
              Confirm
            </button>
          )}
          {!cancelling ? (
            <button
              onClick={() => setCancelling(true)}
              className="rounded border border-neutral-700 bg-black/40 px-3 py-1.5 text-sm tracking-wider text-neutral-200 hover:border-red-600"
            >
              Cancel…
            </button>
          ) : (
            <div className="flex w-full flex-wrap items-center gap-2">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (required)"
                className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-red-600"
              />
              <button
                onClick={() => reason.trim() && onCancel(p, reason.trim())}
                disabled={!reason.trim()}
                className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500 disabled:opacity-50"
              >
                Confirm cancel
              </button>
            </div>
          )}
        </div>
      )}
      {p.status === "proposed" && !canConfirm && coach === p.proposed_by && (
        <p className="mt-2 text-xs text-neutral-600">You proposed this — another coach must confirm it.</p>
      )}
    </DetailCard>
  );
}

// 12-hour time entry with an explicit AM/PM dropdown. Value in/out is a 24-hour
// "HH:MM" string (matches Airtable StartTime/EndTime), so no freeform parsing.
function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (hhmm24: string) => void;
}) {
  const [h, m] = value.split(":").map((n) => parseInt(n, 10));
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const mm = String(Number.isFinite(m) ? m : 0).padStart(2, "0");

  const update = (nh12: number, nmm: string, nAmPm: string) => {
    let h24 = nh12 % 12;
    if (nAmPm === "PM") h24 += 12;
    onChange(`${String(h24).padStart(2, "0")}:${nmm}`);
  };

  const hours = Array.from({ length: 12 }, (_, i) => i + 1);
  const baseMins = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
  const mins = baseMins.includes(mm) ? baseMins : [...baseMins, mm].sort();
  const sel =
    "rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-red-600";

  return (
    <div className="mt-1 flex items-center gap-1">
      <select className={sel} value={h12} onChange={(e) => update(Number(e.target.value), mm, ampm)} aria-label="Hour">
        {hours.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <span className="text-neutral-500">:</span>
      <select className={sel} value={mm} onChange={(e) => update(h12, e.target.value, ampm)} aria-label="Minute">
        {mins.map((x) => (
          <option key={x} value={x}>{x}</option>
        ))}
      </select>
      <select className={sel} value={ampm} onChange={(e) => update(h12, mm, e.target.value)} aria-label="AM or PM">
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  );
}

function ProposeForm({
  date,
  coach,
  busy,
  onClose,
  onSubmit,
}: {
  date: string;
  coach: string | null;
  busy: FieldBusy[];
  onClose: () => void;
  onSubmit: (form: {
    date: string;
    start_time: string;
    end_time: string;
    location: string;
    focus: string;
    notes: string;
  }) => Promise<string | null>;
}) {
  const [form, setForm] = useState({
    date,
    start_time: "17:30",
    end_time: "19:00",
    location: "Haxtun Baseball Field",
    focus: "",
    notes: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Button only gates on the five visible required fields (Notes optional).
  const fieldsFilled = Boolean(
    form.date && form.start_time && form.end_time && form.location && form.focus.trim(),
  );
  // 24-hour "HH:MM" strings compare correctly lexicographically.
  const timeOrderOk = form.start_time < form.end_time;

  // Soft overlap with another org's field-busy block at the same location.
  const conflict = busy.find(
    (b) =>
      b.date.slice(0, 10) === form.date &&
      b.location.trim().toLowerCase() === form.location.trim().toLowerCase() &&
      timesOverlap(form.start_time, form.end_time, b.start_time, b.end_time),
  );

  const submit = async () => {
    // Diagnostic: confirms the click reaches JS, with the exact form state.
    console.log("propose:clicked", {
      coach,
      date: form.date,
      start: form.start_time,
      end: form.end_time,
      location: form.location,
      focus: form.focus,
    });
    setError(null);

    // Validate on click (button is always clickable) so every click gives
    // feedback — no more silent no-op.
    const missing: string[] = [];
    if (!form.date) missing.push("date");
    if (!form.start_time) missing.push("start time");
    if (!form.end_time) missing.push("end time");
    if (!form.location.trim()) missing.push("location");
    if (!form.focus.trim()) missing.push("focus");
    if (missing.length) {
      setError(`Please fill in: ${missing.join(", ")}.`);
      return;
    }
    if (!coach) {
      setError("Pick your name up top first, then propose.");
      return;
    }
    if (form.start_time >= form.end_time) {
      setError("End time must be after start time.");
      return;
    }

    setSubmitting(true);
    try {
      const err = await onSubmit(form);
      if (err) setError(err);
      // On success the parent closes the form.
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong submitting.");
    } finally {
      setSubmitting(false);
    }
  };

  const field =
    "w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-red-600";
  return (
    <DetailCard title="Propose a practice" onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-neutral-400">Date
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className={field} />
        </label>
        <label className="text-xs text-neutral-400">Location
          <select value={form.location} onChange={(e) => set("location", e.target.value)} className={field}>
            <option value="Haxtun Baseball Field">Haxtun Baseball Field</option>
            <option value="Behind the School">Behind the School</option>
            <option value="Little Gym at School">Little Gym at School</option>
          </select>
        </label>
        <div className="text-xs text-neutral-400">Start
          <TimeSelect value={form.start_time} onChange={(v) => set("start_time", v)} />
        </div>
        <div className="text-xs text-neutral-400">End
          <TimeSelect value={form.end_time} onChange={(v) => set("end_time", v)} />
        </div>
        <label className="text-xs text-neutral-400 sm:col-span-2">Focus
          <input value={form.focus} onChange={(e) => set("focus", e.target.value)} placeholder="Hitting + baserunning" className={field} />
        </label>
        <label className="text-xs text-neutral-400 sm:col-span-2">Notes
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} className={field} />
        </label>
      </div>

      {fieldsFilled && !timeOrderOk && (
        <p className="mt-2 text-xs text-amber-300">End time must be after start time.</p>
      )}
      {conflict && (
        <p className="mt-2 rounded border border-amber-600/50 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-300">
          ⚠ Field is in use by {conflict.label} from {conflict.start_time}–{conflict.end_time}. You can still propose; please confirm.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {!coach && (
        <p className="mt-2 text-xs text-amber-300">
          Pick your name up top so the proposal is recorded under you.
        </p>
      )}

      <div className="mt-3">
        <button
          onClick={submit}
          disabled={submitting}
          className="rounded bg-red-600 px-4 py-2 font-display text-sm tracking-wider text-white hover:bg-red-500 disabled:opacity-50"
        >
          {submitting ? "Proposing…" : "Propose"}
        </button>
      </div>
    </DetailCard>
  );
}

function DetailCard({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-neutral-700 bg-neutral-900 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-xl tracking-wider text-neutral-100">{title}</h3>
        <button onClick={onClose} aria-label="Close" className="text-neutral-400 hover:text-white">
          ✕
        </button>
      </div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

/* ----------------------------- Stats ----------------------------- */

type RawBat = {
  jersey?: number;
  name?: string;
  pa?: number;
  ab?: number;
  h?: number;
  rbi?: number;
  bb?: number;
  so?: number;
  hbp?: number;
  avg?: string | number;
  obp?: string | number;
  ops?: string | number;
};
type RawPitch = {
  jersey?: number;
  name?: string;
  gp?: number;
  ip?: string | number;
  so?: number;
  bb?: number;
  era?: string | number;
  whip?: string | number;
};
type RawField = {
  jersey?: number;
  name?: string;
  inn_total?: number;
  tc?: number;
  po?: number;
  a?: number;
  e?: number;
  fpct?: string | number;
};
type StatsData = {
  last_updated: string | null;
  games_played: number | null;
  batting: RawBat[];
  pitching: RawPitch[];
  fielding: RawField[];
};

// Parse a stat that may arrive as a number or a string like ".667" / "10.50" /
// "—". Non-numbers (dashes, blanks) become 0.
function statNum(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

// Display name: the data is already first-name + last-initial; the name-withheld
// player has an empty name, so fall back to a dash (her jersey shows in the # column).
function statName(name: unknown): string {
  const s = String(name ?? "").trim();
  return s || "—";
}

type Ranked<T> = { row: T; score: number; active: boolean; rank: number | null };

// Composite ranking: each metric is normalized to the roster's max (0–1), the
// composite is their average, and active players sort above inactive ones.
function rankRows<T>(
  rows: T[],
  metrics: ((r: T) => number)[],
  isActive: (r: T) => boolean,
): Ranked<T>[] {
  const maxes = metrics.map((m) => Math.max(0, ...rows.map((r) => m(r))));
  const scored: Ranked<T>[] = rows.map((row) => {
    const parts = metrics.map((m, i) => (maxes[i] > 0 ? m(row) / maxes[i] : 0));
    const score = parts.reduce((a, b) => a + b, 0) / (metrics.length || 1);
    return { row, score, active: isActive(row), rank: null };
  });
  scored.sort(
    (a, b) => Number(b.active) - Number(a.active) || b.score - a.score,
  );
  let r = 0;
  for (const s of scored) if (s.active) s.rank = ++r;
  return scored;
}

// "Lower is better" → biggest inverse, with a 0 value (e.g. a perfect 0.00 ERA)
// treated as the roster best rather than dividing by zero.
function invMetric(
  rows: { v: number; active: boolean }[],
): (i: number) => number {
  const finite = rows.filter((r) => r.active && r.v > 0).map((r) => 1 / r.v);
  const max = finite.length ? Math.max(...finite) : 1;
  return (i) => {
    const r = rows[i];
    if (!r.active) return 0;
    return r.v > 0 ? 1 / r.v : max;
  };
}

function StatsPanel({ players }: { players: Player[] }) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Resolve display names from the private Airtable roster by jersey, so the
  // name-withheld player (#23, "#23" in the public file) shows her real name
  // here in the private portal without her name ever entering the public repo.
  const nameByJersey = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of players) {
      if (p.jersey != null) {
        const li = p.lastName.trim().charAt(0).toUpperCase();
        m.set(p.jersey, li ? `${p.firstName} ${li}.` : p.firstName);
      }
    }
    return m;
  }, [players]);
  const nameFor = (jersey: number | undefined, fallback: unknown) =>
    (jersey != null && nameByJersey.get(jersey)) || statName(fallback);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/stats", { cache: "no-store" });
        if (!res.ok) throw new Error(`Stats load failed (${res.status})`);
        const d = (await res.json()) as StatsData;
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Failed to load stats");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p className="text-neutral-400">Loading…</p>;
  if (error)
    return (
      <div className="rounded border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    );
  if (!data) return null;

  const batting = rankRows(
    data.batting ?? [],
    [
      (b) => statNum(b.avg),
      (b) => statNum(b.obp),
      (b) => statNum(b.h),
      (b) => statNum(b.rbi),
    ],
    (b) => statNum(b.ab) > 0,
  );

  const pitchRows = data.pitching ?? [];
  const pActive = pitchRows.map((p) => statNum(p.ip) > 0);
  const invEra = invMetric(
    pitchRows.map((p, i) => ({ v: statNum(p.era), active: pActive[i] })),
  );
  const invWhip = invMetric(
    pitchRows.map((p, i) => ({ v: statNum(p.whip), active: pActive[i] })),
  );
  const pitching = rankRows(
    pitchRows.map((p, i) => ({ p, i })),
    [(x) => invEra(x.i), (x) => statNum(x.p.so), (x) => invWhip(x.i)],
    (x) => pActive[x.i],
  );

  const fielding = rankRows(
    data.fielding ?? [],
    [
      (f) => statNum(f.fpct),
      (f) => statNum(f.po),
      (f) => statNum(f.a),
      (f) => 1 / (statNum(f.e) + 1),
    ],
    (f) => statNum(f.inn_total) > 0,
  );

  const updated = data.last_updated
    ? String(data.last_updated).slice(0, 10)
    : null;

  return (
    <section className="space-y-5">
      <p className="text-sm text-neutral-400">
        Ranked by a composite score — each stat normalized to the roster&rsquo;s
        best (0–1), then averaged. Players with no game action sort to the
        bottom.
        {data.games_played != null && (
          <>
            {" "}
            Through{" "}
            <span className="text-neutral-200">
              {data.games_played} game{data.games_played === 1 ? "" : "s"}
            </span>
            {updated && (
              <>
                {" "}
                · updated <span className="text-neutral-200">{updated}</span>
              </>
            )}
            .
          </>
        )}
      </p>

      <StatTable
        title="Batting"
        headers={["Rank", "#", "Player", "PA", "AB", "H", "RBI", "BB", "HBP", "K", "AVG", "OBP", "OPS", "Score"]}
        empty={batting.length === 0 ? "No batting stats yet. Updated after each game." : null}
        legend={[
          ["PA", "plate appearances (AB + BB + HBP + SF + SH)"],
          ["AB", "at-bats"],
          ["H", "hits"],
          ["RBI", "runs batted in"],
          ["BB", "base on balls (walks)"],
          ["HBP", "hit by pitch"],
          ["K", "strikeouts"],
          ["AVG", "batting average"],
          ["OBP", "on-base percentage"],
          ["OPS", "on-base plus slugging"],
          ["Score", "composite ranking (0–1)"],
        ]}
      >
        {batting.map(({ row, score, active, rank }, idx) => (
          <StatRow key={`${row.jersey}-${idx}`} active={active} rank={rank} num={row.jersey} name={nameFor(row.jersey, row.name)} score={active ? score : null}>
            <StatCell>{statNum(row.pa)}</StatCell>
            <StatCell>{statNum(row.ab)}</StatCell>
            <StatCell>{statNum(row.h)}</StatCell>
            <StatCell>{statNum(row.rbi)}</StatCell>
            <StatCell>{statNum(row.bb)}</StatCell>
            <StatCell>{statNum(row.hbp)}</StatCell>
            <StatCell>{statNum(row.so)}</StatCell>
            <StatCell>{String(row.avg ?? "—")}</StatCell>
            <StatCell>{String(row.obp ?? "—")}</StatCell>
            <StatCell>{String(row.ops ?? "—")}</StatCell>
          </StatRow>
        ))}
      </StatTable>

      <StatTable
        title="Pitching"
        headers={["Rank", "#", "Player", "GP", "IP", "K", "BB", "ERA", "WHIP", "Score"]}
        empty={pitching.length === 0 ? "No pitching stats yet. Updated after each game." : null}
        legend={[
          ["GP", "games played"],
          ["IP", "innings pitched"],
          ["K", "strikeouts"],
          ["BB", "base on balls (walks)"],
          ["ERA", "earned run average"],
          ["WHIP", "walks + hits per inning"],
          ["Score", "composite ranking (0–1)"],
        ]}
      >
        {pitching.map(({ row: { p }, score, active, rank }, idx) => (
          <StatRow key={`${p.jersey}-${idx}`} active={active} rank={rank} num={p.jersey} name={nameFor(p.jersey, p.name)} score={active ? score : null}>
            <StatCell>{statNum(p.gp)}</StatCell>
            <StatCell>{String(p.ip ?? "—")}</StatCell>
            <StatCell>{statNum(p.so)}</StatCell>
            <StatCell>{statNum(p.bb)}</StatCell>
            <StatCell>{String(p.era ?? "—")}</StatCell>
            <StatCell>{String(p.whip ?? "—")}</StatCell>
          </StatRow>
        ))}
      </StatTable>

      <StatTable
        title="Fielding"
        headers={["Rank", "#", "Player", "TC", "PO", "A", "E", "FPCT", "Score"]}
        empty={fielding.length === 0 ? "No fielding stats yet. Updated after each game." : null}
        legend={[
          ["TC", "total chances"],
          ["PO", "putouts"],
          ["A", "assists"],
          ["E", "errors"],
          ["FPCT", "fielding percentage"],
          ["Score", "composite ranking (0–1)"],
        ]}
      >
        {fielding.map(({ row, score, active, rank }, idx) => (
          <StatRow key={`${row.jersey}-${idx}`} active={active} rank={rank} num={row.jersey} name={nameFor(row.jersey, row.name)} score={active ? score : null}>
            <StatCell>{statNum(row.tc)}</StatCell>
            <StatCell>{statNum(row.po)}</StatCell>
            <StatCell>{statNum(row.a)}</StatCell>
            <StatCell>{statNum(row.e)}</StatCell>
            <StatCell>{String(row.fpct ?? "—")}</StatCell>
          </StatRow>
        ))}
      </StatTable>
    </section>
  );
}

function StatTable({
  title,
  headers,
  empty,
  legend,
  children,
}: {
  title: string;
  headers: string[];
  empty: string | null;
  legend: [string, string][];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-display text-2xl tracking-wider text-neutral-100">
        {title}
      </h2>
      {empty ? (
        <p className="mt-2 text-sm text-neutral-400">{empty}</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="text-neutral-400">
                  {headers.map((h, i) => (
                    <th
                      key={h}
                      className={
                        "px-2 py-1 font-display tracking-wider " +
                        (i >= 3 ? "text-right" : "text-left")
                      }
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>{children}</tbody>
            </table>
          </div>
          <Legend items={legend} />
        </>
      )}
    </div>
  );
}

function StatRow({
  active,
  rank,
  num,
  name,
  score,
  children,
}: {
  active: boolean;
  rank: number | null;
  num?: number;
  name?: string;
  score: number | null;
  children: React.ReactNode;
}) {
  return (
    <tr
      className={
        "border-t border-neutral-800 " +
        (active ? "" : "text-neutral-600")
      }
    >
      <td className="px-2 py-1 text-left font-display tracking-wider text-neutral-400">
        {rank ?? "—"}
      </td>
      <td className="px-2 py-1 text-left font-display tracking-wider text-red-500">
        {num ?? "—"}
      </td>
      <td className="px-2 py-1 text-left">{statName(name)}</td>
      {children}
      <td className="px-2 py-1 text-right font-display tracking-wider text-red-400">
        {score == null ? "—" : score.toFixed(2)}
      </td>
    </tr>
  );
}

function StatCell({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-1 text-right tabular-nums">{children}</td>;
}

/* ------------------------- Small helpers ------------------------- */

function IconBtn({
  children,
  onClick,
  label,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={
        "h-6 w-6 rounded text-sm leading-none transition-colors " +
        (danger
          ? "text-neutral-400 hover:bg-red-600 hover:text-white"
          : "text-neutral-400 hover:bg-neutral-700 hover:text-white")
      }
    >
      {children}
    </button>
  );
}

function EmptyRoster({ what }: { what: string }) {
  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
      Seed the roster before building the {what}.
    </div>
  );
}
