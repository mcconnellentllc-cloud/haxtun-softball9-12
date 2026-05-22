"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

type Choice = "A" | "B";
type Lineups = {
  A: string[]; // batting order, player ids
  B: string[];
};

// One coach's idea of the starting alignment: a starter at each field
// position, plus their preferred batting order.
type Proposal = {
  positions: Record<string, string>; // position -> player id (one starter per spot)
  order: string[]; // batting order, player ids
};
// coach name -> their proposal
type Proposals = Record<string, Proposal>;

/* ---------------------------- Constants -------------------------- */

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const COACHES = ["Mike", "Kyle", "Jordan", "Emily"] as const;
const TABS = ["roster", "depth", "lineups", "compare"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  roster: "Roster",
  depth: "Depth Chart",
  lineups: "Lineups",
  compare: "Compare",
};

const COACH_KEY = "bulldogs-coach";

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

function normalizeLineups(raw: unknown): Lineups {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  return { A: asIdList(src.A), B: asIdList(src.B) };
}

function normalizeProposals(raw: unknown): Proposals {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out: Proposals = {};
  for (const coach of COACHES) {
    const p = (src[coach] && typeof src[coach] === "object"
      ? src[coach]
      : {}) as Record<string, unknown>;
    const posSrc = (p.positions && typeof p.positions === "object"
      ? p.positions
      : {}) as Record<string, unknown>;
    const positions: Record<string, string> = {};
    for (const pos of POSITIONS) {
      const v = posSrc[pos];
      if (typeof v === "string" && v) positions[pos] = v;
    }
    out[coach] = { positions, order: asIdList(p.order) };
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
  const [lineups, setLineups] = useState<Lineups>({ A: [], B: [] });
  const [proposals, setProposals] = useState<Proposals>(() =>
    normalizeProposals({}),
  );
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
        setLineups(normalizeLineups(sData.lineups));
        setProposals(normalizeProposals(sData.proposals));
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

  // Persist lineups; roll back on failure.
  const saveLineups = useCallback(
    async (next: Lineups) => {
      const prev = lineups;
      setLineups(next);
      try {
        await putState("/api/state/lineups", next, coach);
      } catch (err) {
        setLineups(prev);
        setError(err instanceof Error ? err.message : "Save failed");
      }
    },
    [lineups, coach],
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

  return (
    <main className="mx-auto max-w-3xl p-5 sm:p-8">
      <Header coach={coach} onChooseCoach={chooseCoach} />

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
          <DepthPanel
            players={players}
            byId={byId}
            depth={depth}
            onChange={saveDepth}
          />
        ) : tab === "lineups" ? (
          <LineupsPanel
            players={players}
            byId={byId}
            lineups={lineups}
            onChange={saveLineups}
          />
        ) : (
          <ComparePanel
            players={players}
            byId={byId}
            coach={coach}
            proposals={proposals}
            onChooseCoach={chooseCoach}
            onChange={saveProposals}
          />
        )}
      </div>
    </main>
  );
}

/* ----------------------------- Header ---------------------------- */

function Header({
  coach,
  onChooseCoach,
}: {
  coach: string | null;
  onChooseCoach: (name: string) => void;
}) {
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
        <label className="text-xs text-neutral-400">Coach</label>
        <select
          value={coach ?? ""}
          onChange={(e) => onChooseCoach(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-red-600"
        >
          <option value="" disabled>
            Who are you?
          </option>
          {COACHES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
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

/* ---------------------------- Lineups ---------------------------- */

function LineupsPanel({
  players,
  byId,
  lineups,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  lineups: Lineups;
  onChange: (next: Lineups) => void;
}) {
  if (players.length === 0) return <EmptyRoster what="lineups" />;
  return (
    <section className="grid gap-4 sm:grid-cols-2">
      {(["A", "B"] as const).map((team) => (
        <BattingOrder
          key={team}
          team={team}
          players={players}
          byId={byId}
          order={lineups[team]}
          onChange={(next) => onChange({ ...lineups, [team]: next })}
        />
      ))}
    </section>
  );
}

function BattingOrder({
  team,
  players,
  byId,
  order,
  onChange,
}: {
  team: Choice;
  players: Player[];
  byId: Map<string, Player>;
  order: string[];
  onChange: (next: string[]) => void;
}) {
  const add = (id: string) => {
    if (order.includes(id)) return;
    onChange([...order, id]);
  };
  const remove = (id: string) => onChange(order.filter((x) => x !== id));
  const move = (idx: number, dir: -1 | 1) => {
    const list = [...order];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    onChange(list);
  };

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-3">
      <h3 className="font-display text-2xl tracking-wider text-neutral-100">
        Lineup <span className="text-red-500">{team}</span>
      </h3>
      <ol className="mt-2 space-y-1">
        {order.length === 0 && (
          <li className="text-xs text-neutral-600">No batters yet</li>
        )}
        {order.map((id, idx) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1 text-sm"
          >
            <span className="truncate">
              <span className="inline-block w-5 text-neutral-500">
                {idx + 1}.
              </span>{" "}
              <PlayerName p={byId.get(id)} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <IconBtn label="Up" onClick={() => move(idx, -1)}>
                ↑
              </IconBtn>
              <IconBtn label="Down" onClick={() => move(idx, 1)}>
                ↓
              </IconBtn>
              <IconBtn label="Remove" onClick={() => remove(id)} danger>
                ×
              </IconBtn>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2">
        <AddPlayer
          players={players}
          exclude={new Set(order)}
          onAdd={add}
          label="Add batter…"
        />
      </div>
    </div>
  );
}

/* ----------------------------- Compare --------------------------- */

const EMPTY_PROPOSAL: Proposal = { positions: {}, order: [] };

// Which coaches have entered anything at all.
function submittedCoaches(proposals: Proposals): string[] {
  return COACHES.filter((c) => {
    const p = proposals[c];
    return p && (Object.keys(p.positions).length > 0 || p.order.length > 0);
  });
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
  proposals,
  onChooseCoach,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  coach: string | null;
  proposals: Proposals;
  onChooseCoach: (name: string) => void;
  onChange: (next: Proposals) => void;
}) {
  if (players.length === 0) return <EmptyRoster what="comparison" />;

  return (
    <section className="space-y-5">
      {coach ? (
        <MyProposalEditor
          players={players}
          byId={byId}
          coach={coach}
          proposal={proposals[coach] ?? EMPTY_PROPOSAL}
          onChange={(mine) => onChange({ ...proposals, [coach]: mine })}
        />
      ) : (
        <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
          <h3 className="font-display text-xl tracking-wider text-neutral-200">
            Your proposal
          </h3>
          <p className="mt-1 text-sm text-neutral-400">
            Pick which coach you are to enter where players should play:
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

      <PositionsCompare byId={byId} proposals={proposals} />
      <BattingCompare byId={byId} proposals={proposals} />
    </section>
  );
}

function MyProposalEditor({
  players,
  byId,
  coach,
  proposal,
  onChange,
}: {
  players: Player[];
  byId: Map<string, Player>;
  coach: string;
  proposal: Proposal;
  onChange: (next: Proposal) => void;
}) {
  // Assigning a player to a position removes them from any other position so a
  // coach's starting nine never lists the same girl twice.
  const setPosition = (pos: string, id: string) => {
    const positions: Record<string, string> = {};
    for (const [k, v] of Object.entries(proposal.positions)) {
      if (v !== id) positions[k] = v;
    }
    if (id) positions[pos] = id;
    else delete positions[pos];
    onChange({ ...proposal, positions });
  };

  const addBatter = (id: string) => {
    if (proposal.order.includes(id)) return;
    onChange({ ...proposal, order: [...proposal.order, id] });
  };
  const removeBatter = (id: string) =>
    onChange({ ...proposal, order: proposal.order.filter((x) => x !== id) });
  const moveBatter = (idx: number, dir: -1 | 1) => {
    const list = [...proposal.order];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    onChange({ ...proposal, order: list });
  };

  const taken = new Set(Object.values(proposal.positions));

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="font-display text-2xl tracking-wider text-neutral-100">
        Your proposal
      </h2>
      <p className="mt-1 text-sm text-neutral-400">
        Entering as <span className="text-neutral-100">{coach}</span>
      </p>

      <h3 className="mt-4 font-display text-lg tracking-wider text-neutral-200">
        Positions
      </h3>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {POSITIONS.map((pos) => {
          const current = proposal.positions[pos] ?? "";
          // Allow the player already in this slot plus anyone not taken.
          const options = players.filter(
            (p) => p.id === current || !taken.has(p.id),
          );
          return (
            <label
              key={pos}
              className="flex items-center gap-2 rounded bg-black/40 px-2 py-1.5"
            >
              <span className="w-8 shrink-0 font-display text-lg tracking-wider text-red-500">
                {pos}
              </span>
              <select
                value={current}
                onChange={(e) => setPosition(pos, e.target.value)}
                className="w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-red-600"
              >
                <option value="">—</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {jerseyTag(p)} {p.firstName} {p.lastName}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>

      <h3 className="mt-5 font-display text-lg tracking-wider text-neutral-200">
        Batting order
      </h3>
      <ol className="mt-2 space-y-1">
        {proposal.order.length === 0 && (
          <li className="text-xs text-neutral-600">No batters yet</li>
        )}
        {proposal.order.map((id, idx) => (
          <li
            key={id}
            className="flex items-center justify-between gap-2 rounded bg-black/40 px-2 py-1 text-sm"
          >
            <span className="truncate">
              <span className="inline-block w-5 text-neutral-500">
                {idx + 1}.
              </span>{" "}
              <PlayerName p={byId.get(id)} />
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <IconBtn label="Up" onClick={() => moveBatter(idx, -1)}>
                ↑
              </IconBtn>
              <IconBtn label="Down" onClick={() => moveBatter(idx, 1)}>
                ↓
              </IconBtn>
              <IconBtn label="Remove" onClick={() => removeBatter(id)} danger>
                ×
              </IconBtn>
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-2">
        <AddPlayer
          players={players}
          exclude={new Set(proposal.order)}
          onAdd={addBatter}
          label="Add batter…"
        />
      </div>
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

function CoachPick({
  coach,
  p,
}: {
  coach: string;
  p: Player | undefined;
}) {
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

function PositionsCompare({
  byId,
  proposals,
}: {
  byId: Map<string, Player>;
  proposals: Proposals;
}) {
  const submitted = submittedCoaches(proposals);
  const rows = POSITIONS.map((pos) => {
    const picks = COACHES.map((c) => proposals[c]?.positions?.[pos]);
    return { pos, picks, status: rowStatus(picks) };
  });
  const agree = rows.filter((r) => r.status === "agree").length;
  const differ = rows.filter((r) => r.status === "differ").length;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Positions
        </h2>
        <p className="text-sm">
          <span className="text-emerald-400">{agree} agree</span>
          <span className="text-neutral-600"> · </span>
          <span className="text-red-400">{differ} differ</span>
        </p>
      </div>
      {submitted.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">
          No proposals yet. Enter yours above to start the comparison.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ pos, picks, status }) => {
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
                  {COACHES.map((c, i) => (
                    <CoachPick key={c} coach={c} p={byId.get(picks[i] ?? "")} />
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

function BattingCompare({
  byId,
  proposals,
}: {
  byId: Map<string, Player>;
  proposals: Proposals;
}) {
  const submitted = submittedCoaches(proposals);
  const maxLen = Math.max(0, ...COACHES.map((c) => proposals[c]?.order.length ?? 0));
  const rows = Array.from({ length: maxLen }, (_, i) => {
    const picks = COACHES.map((c) => proposals[c]?.order?.[i]);
    return { slot: i, picks, status: rowStatus(picks) };
  });
  const agree = rows.filter((r) => r.status === "agree").length;
  const differ = rows.filter((r) => r.status === "differ").length;

  return (
    <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Batting order
        </h2>
        <p className="text-sm">
          <span className="text-emerald-400">{agree} agree</span>
          <span className="text-neutral-600"> · </span>
          <span className="text-red-400">{differ} differ</span>
        </p>
      </div>
      {submitted.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-400">
          No proposals yet. Enter yours above to start the comparison.
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map(({ slot, picks, status }) => {
            const badge = STATUS_BADGE[status];
            return (
              <CompareCell key={slot} status={status}>
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl tracking-wider text-red-500">
                    {slot + 1}
                  </h3>
                  <span className={"text-xs " + badge.cls}>{badge.label}</span>
                </div>
                <ul className="mt-1">
                  {COACHES.map((c, i) => (
                    <CoachPick key={c} coach={c} p={byId.get(picks[i] ?? "")} />
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
