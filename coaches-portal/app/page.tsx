"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SCHEDULE, gameLabel, defaultGameDate } from "@/lib/schedule";

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

// The two squads. A/B each hold the player ids carried on that team.
type Squads = {
  A: string[];
  B: string[];
};

// A defensive assignment for each inning: position -> player id.
type Defense = Record<string, string>[];

// A batting assignment for each inning: slot ("1".."12") -> player id. The
// order continues across innings (9 bat per inning); subbing a bench player into
// a slot mid-game changes who owns that slot from that inning forward.
type Batting = Record<string, string>[];

// A per-game plan for one squad: defensive rotation + batting lineup grid.
type GamePlan = {
  defense: Defense; // one entry per inning
  batting: Batting; // one entry per inning
};

// Each game carries a plan per squad: one for the A team, one for the B team.
type Side = "A" | "B";
type GamePlanAB = Record<Side, GamePlan>;

// A coach's per-game proposal is itself an A/B pair.
type Proposal = GamePlanAB;
// coach name -> their proposal, within a single week
type WeekProposals = Record<string, Proposal>;
// week key (YYYY-MM-DD) -> that week's per-coach proposals
type Proposals = Record<string, WeekProposals>;
// week key (YYYY-MM-DD) -> that week's team plan (A/B)
type GamePlans = Record<string, GamePlanAB>;
// week key (YYYY-MM-DD) -> shared coaches note for that game
type Notes = Record<string, string>;

/* ---------------------------- Constants -------------------------- */

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const COACHES = ["Kyle", "Jordan", "Emily"] as const;
const INNINGS = 5;
const BATTING_SLOTS = 12;
const SLOTS = Array.from({ length: BATTING_SLOTS }, (_, i) => String(i + 1));
const TABS = ["roster", "teams", "depth", "compare", "plan"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  roster: "Roster",
  teams: "Teams",
  depth: "Depth Chart",
  compare: "Propose",
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

function normalizeSquads(raw: unknown): Squads {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return { A: asIdList(src.A), B: asIdList(src.B) };
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

function normalizeGamePlan(raw: unknown): GamePlan {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return {
    defense: normalizeDefense(p.defense),
    batting: normalizeBatting(p.batting, p.order),
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
  const [squads, setSquads] = useState<Squads>({ A: [], B: [] });
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
        setSquads(normalizeSquads(sData.squads));
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

  // Persist squad rosters; roll back on failure.
  const saveSquads = useCallback(
    async (next: Squads) => {
      const prev = squads;
      setSquads(next);
      try {
        await putState("/api/state/squads", next, coach);
      } catch (err) {
        setSquads(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [squads, coach],
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
        ) : tab === "teams" ? (
          <SquadPanel
            players={players}
            byId={byId}
            squads={squads}
            onChange={saveSquads}
          />
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
        ) : tab === "compare" ? (
          <ComparePanel
            players={players}
            byId={byId}
            coach={coach}
            depth={depth}
            coachDepths={coachDepths}
            squads={squads}
            proposals={proposals}
            notes={notes}
            onChooseCoach={chooseCoach}
            onChange={saveProposals}
            onSaveNote={saveNote}
          />
        ) : (
          <GamePlanPanel
            players={players}
            byId={byId}
            depth={depth}
            squads={squads}
            gameplans={gameplans}
            notes={notes}
            onChange={saveGameplans}
            onSaveNote={saveNote}
          />
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

/* ----------------------------- Teams ----------------------------- */

// Split the roster into an A team and a B team. A player belongs to at most one
// squad; assigning them to one removes them from the other.
function SquadPanel({
  players,
  byId,
  squads,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  squads: Squads;
  onChange: (next: Squads) => void;
}) {
  if (players.length === 0) return <EmptyRoster what="teams" />;

  const onEither = new Set([...squads.A, ...squads.B]);
  const unassigned = players.filter((p) => !onEither.has(p.id));

  const assign = (team: Side, id: string) => {
    const other: Side = team === "A" ? "B" : "A";
    onChange({
      ...squads,
      [team]: [...squads[team].filter((x) => x !== id), id],
      [other]: squads[other].filter((x) => x !== id),
    });
  };
  const removeFrom = (team: Side, id: string) =>
    onChange({ ...squads, [team]: squads[team].filter((x) => x !== id) });

  return (
    <section className="space-y-4">
      <p className="text-sm text-neutral-400">
        Sort every girl onto the A team or the B team. These rosters drive who
        you can pick in each game&rsquo;s lineup and outfield rotation.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {(["A", "B"] as const).map((team) => {
          const list = squads[team];
          const other: Side = team === "A" ? "B" : "A";
          return (
            <div
              key={team}
              className="rounded border border-neutral-800 bg-neutral-900 p-3"
            >
              <h3 className="font-display text-2xl tracking-wider text-neutral-100">
                <span className="text-red-500">{team}</span> Team{" "}
                <span className="text-base text-neutral-500">
                  ({list.length})
                </span>
              </h3>
              <ul className="mt-2 space-y-1">
                {list.length === 0 && (
                  <li className="text-xs text-neutral-600">No players yet</li>
                )}
                {list.map((id) => (
                  <li
                    key={id}
                    className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1 text-sm"
                  >
                    <span className="truncate">
                      <PlayerName p={byId.get(id)} />
                    </span>
                    <span className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => assign(other, id)}
                        title={`Move to ${other} team`}
                        className="rounded px-1.5 text-xs tracking-wider text-neutral-400 hover:bg-neutral-700 hover:text-white"
                      >
                        → {other}
                      </button>
                      <IconBtn
                        label="Remove"
                        onClick={() => removeFrom(team, id)}
                        danger
                      >
                        ×
                      </IconBtn>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2">
                <AddPlayer
                  players={players}
                  exclude={onEither}
                  onAdd={(id) => assign(team, id)}
                  label={`Add to ${team} team…`}
                />
              </div>
            </div>
          );
        })}
      </div>
      {unassigned.length > 0 && (
        <div className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-400">
          <span className="text-neutral-300">
            {unassigned.length} unassigned:
          </span>{" "}
          {unassigned.map((p) => `${p.firstName} ${p.lastName}`).join(", ")}
        </div>
      )}
    </section>
  );
}

/* --------------------- Plans, compare & game plan ---------------- */

function emptyDefense(): Defense {
  return Array.from({ length: INNINGS }, () => ({}));
}

function emptyBatting(): Batting {
  return Array.from({ length: INNINGS }, () => ({}));
}

function emptyGamePlan(): GamePlan {
  return { defense: emptyDefense(), batting: emptyBatting() };
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
    p.batting.some((inn) => Object.keys(inn).length > 0)
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
  squads,
  proposals,
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
  squads: Squads;
  proposals: Proposals;
  notes: Notes;
  onChooseCoach: (name: string) => void;
  onChange: (next: Proposals) => void;
  onSaveNote: (week: string, text: string) => void;
}) {
  const [week, setWeek] = useState<string>(() => defaultGameDate());
  const [side, setSide] = useState<Side>("A");

  if (players.length === 0) return <EmptyRoster what="comparison" />;

  // Only the chosen squad's players can be slotted into this game's plan.
  const sidePlayers = players.filter((p) => squads[side].includes(p.id));

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
      <GameSelect date={week} onSelect={setWeek} />
      <SideToggle side={side} onSelect={setSide} />

      <NotesCard
        key={week}
        week={week}
        note={notes[week] ?? ""}
        onSave={(text) => onSaveNote(week, text)}
      />

      {sidePlayers.length === 0 ? (
        <div className="rounded border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
          No players on the {side} team yet. Assign them on the{" "}
          <span className="text-neutral-200">Teams</span> tab first.
        </div>
      ) : coach ? (
        <div className="space-y-5">
          <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="font-display text-2xl tracking-wider text-neutral-100">
              Your proposal — {side} team
            </h2>
            <p className="mt-1 text-sm text-neutral-400">
              Entering as <span className="text-neutral-100">{coach}</span>{" "}
              for the game on{" "}
              <span className="text-neutral-100">{formatWeek(week)}</span>
            </p>
          </div>
          <PlanEditor
            players={sidePlayers}
            byId={byId}
            draftDepth={myDepth}
            draftLabel="Draft from my depth chart"
            plan={myAB[side]}
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
        <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="font-display text-xl tracking-wider text-neutral-200">
            Your proposal
          </h3>
          <p className="mt-1 text-sm text-neutral-400">
            Pick which coach you are to propose a defense and lineup:
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {COACHES.map((c) => (
              <button
                key={c}
                onClick={() => onChooseCoach(c)}
                className="rounded border border-neutral-700 bg-black/40 px-3 py-1.5 text-sm hover:border-red-600"
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}

      {sidePlayers.length > 0 && (
        <>
          <DefenseCompare byId={byId} side={side} plans={sideProps} />
          <BattingCompare byId={byId} side={side} plans={sideProps} />
        </>
      )}
    </section>
  );
}

// A team / B team squad toggle.
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
        Squad
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
          {s} Team
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
function PlanEditor({
  players,
  byId,
  draftDepth,
  draftLabel,
  plan,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  draftDepth: DepthChart;
  draftLabel: string;
  plan: GamePlan;
  onChange: (next: GamePlan) => void;
}) {
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
      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-2xl tracking-wider text-neutral-100">
            Defense{" "}
            <span className="text-sm text-neutral-500">({INNINGS} innings)</span>
          </h2>
          <button
            onClick={autoDraft}
            className="rounded bg-red-600 px-3 py-1.5 font-display text-sm tracking-wider text-white hover:bg-red-500"
          >
            {draftLabel}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-neutral-500">
          Drafts a fair rotation, then leans extra innings toward the strongest
          players. Adjust any cell below.
        </p>
        <DefenseGrid
          players={players}
          defense={plan.defense}
          onChange={(defense) => onChange({ ...plan, defense })}
        />
      </div>

      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Batting lineup{" "}
          <span className="text-sm text-neutral-500">
            ({BATTING_SLOTS} slots × {INNINGS} innings)
          </span>
        </h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          The order carries across innings — 9 bat per inning, so slot 10 leads
          off the next inning. By default the same lineup bats all game; swap a
          bench player into an inning to plan a sub from that inning on.
        </p>
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
}: {
  players: Player[];
  defense: Defense;
  onChange: (next: Defense) => void;
}) {
  const setCell = (inning: number, pos: string, id: string) => {
    const next = defense.map((d, i) => (i === inning ? { ...d } : d));
    if (id) next[inning][pos] = id;
    else delete next[inning][pos];
    onChange(next);
  };

  return (
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
                return (
                  <td key={inning} className="px-1 py-1">
                    <select
                      value={current}
                      onChange={(e) => setCell(inning, pos, e.target.value)}
                      className="w-full rounded border border-neutral-700 bg-neutral-900 px-1 py-1 text-sm outline-none focus:border-red-600"
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
    </>
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
          Defense — {side} team
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
          Batting order — {side} team
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

function GamePlanPanel({
  players,
  byId,
  depth,
  squads,
  gameplans,
  notes,
  onChange,
  onSaveNote,
}: {
  players: Player[];
  byId: Map<string, Player>;
  depth: DepthChart;
  squads: Squads;
  gameplans: GamePlans;
  notes: Notes;
  onChange: (next: GamePlans) => void;
  onSaveNote: (week: string, text: string) => void;
}) {
  const [week, setWeek] = useState<string>(() => defaultGameDate());
  const [side, setSide] = useState<Side>("A");

  if (players.length === 0) return <EmptyRoster what="game plan" />;

  const sidePlayers = players.filter((p) => squads[side].includes(p.id));
  const ab: GamePlanAB = gameplans[week] ?? emptyGamePlanAB();

  return (
    <section className="space-y-5">
      <GameSelect date={week} onSelect={setWeek} />
      <SideToggle side={side} onSelect={setSide} />

      <NotesCard
        key={week}
        week={week}
        note={notes[week] ?? ""}
        onSave={(text) => onSaveNote(week, text)}
      />

      {sidePlayers.length === 0 ? (
        <div className="rounded border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
          No players on the {side} team yet. Assign them on the{" "}
          <span className="text-neutral-200">Teams</span> tab first.
        </div>
      ) : (
        <PlanEditor
          players={sidePlayers}
          byId={byId}
          draftDepth={depth}
          draftLabel="Auto-draft from depth chart"
          plan={ab[side]}
          onChange={(next) =>
            onChange({ ...gameplans, [week]: { ...ab, [side]: next } })
          }
        />
      )}
    </section>
  );
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
