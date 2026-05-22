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
  votes: Record<string, Choice>; // coach name -> chosen lineup
};

/* ---------------------------- Constants -------------------------- */

const POSITIONS = ["P", "C", "1B", "2B", "3B", "SS", "LF", "CF", "RF"] as const;
const COACHES = ["Mike", "Kyle", "Jordan", "Emily"] as const;
const TABS = ["roster", "depth", "lineups", "vote"] as const;
type Tab = (typeof TABS)[number];

const TAB_LABELS: Record<Tab, string> = {
  roster: "Roster",
  depth: "Depth Chart",
  lineups: "Lineups",
  vote: "Vote",
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
  const votesSrc = (src.votes && typeof src.votes === "object"
    ? src.votes
    : {}) as Record<string, unknown>;
  const votes: Record<string, Choice> = {};
  for (const coach of COACHES) {
    const v = votesSrc[coach];
    if (v === "A" || v === "B") votes[coach] = v;
  }
  return { A: asIdList(src.A), B: asIdList(src.B), votes };
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
  const [lineups, setLineups] = useState<Lineups>({ A: [], B: [], votes: {} });
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

  // Persist lineups (+ votes); roll back on failure.
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
          <VotePanel
            coach={coach}
            lineups={lineups}
            onChooseCoach={chooseCoach}
            onChange={saveLineups}
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
                    <IconBtn label="Remove" onClick={() => remove(pos, id)} danger>
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

/* ------------------------------ Vote ----------------------------- */

function VotePanel({
  coach,
  lineups,
  onChooseCoach,
  onChange,
}: {
  coach: string | null;
  lineups: Lineups;
  onChooseCoach: (name: string) => void;
  onChange: (next: Lineups) => void;
}) {
  const votes = lineups.votes;
  const tallyA = COACHES.filter((c) => votes[c] === "A").length;
  const tallyB = COACHES.filter((c) => votes[c] === "B").length;
  const active: Choice | null =
    tallyA > tallyB ? "A" : tallyB > tallyA ? "B" : null;

  const vote = (choice: Choice) => {
    if (!coach) return;
    onChange({ ...lineups, votes: { ...votes, [coach]: choice } });
  };

  return (
    <section className="space-y-5">
      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="font-display text-2xl tracking-wider text-neutral-100">
          Active lineup
        </h2>
        {active ? (
          <p className="mt-1 text-neutral-300">
            Coaches favor{" "}
            <span className="font-display text-3xl tracking-wider text-red-500">
              Lineup {active}
            </span>{" "}
            <span className="text-neutral-500">
              ({tallyA}–{tallyB})
            </span>
          </p>
        ) : (
          <p className="mt-1 text-neutral-400">
            {tallyA + tallyB === 0
              ? "No votes yet."
              : `Tied ${tallyA}–${tallyB}.`}
          </p>
        )}
      </div>

      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="font-display text-xl tracking-wider text-neutral-200">
          Cast your vote
        </h3>
        {coach ? (
          <>
            <p className="mt-1 text-sm text-neutral-400">
              Voting as <span className="text-neutral-100">{coach}</span>
            </p>
            <div className="mt-3 flex gap-2">
              {(["A", "B"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => vote(c)}
                  className={
                    "flex-1 rounded px-4 py-3 font-display text-2xl tracking-wider transition-colors " +
                    (votes[coach] === c
                      ? "bg-red-600 text-white"
                      : "border border-neutral-700 bg-black/40 text-neutral-200 hover:border-red-600")
                  }
                >
                  Lineup {c}
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-neutral-400">
              Pick which coach you are to vote:
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
      </div>

      <div className="rounded border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="font-display text-xl tracking-wider text-neutral-200">
          Tally
        </h3>
        <ul className="mt-2 divide-y divide-neutral-800">
          {COACHES.map((c) => (
            <li key={c} className="flex items-center justify-between py-2 text-sm">
              <span className="text-neutral-200">{c}</span>
              {votes[c] ? (
                <span className="font-display tracking-wider text-red-500">
                  Lineup {votes[c]}
                </span>
              ) : (
                <span className="text-neutral-600">—</span>
              )}
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-neutral-800 pt-3 text-sm">
          <span className="text-neutral-400">
            A: <span className="text-neutral-100">{tallyA}</span>
          </span>
          <span className="text-neutral-400">
            B: <span className="text-neutral-100">{tallyB}</span>
          </span>
        </div>
      </div>
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
