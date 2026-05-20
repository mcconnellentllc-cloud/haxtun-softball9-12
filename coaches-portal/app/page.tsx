// Placeholder home. The roster / depth-chart / A-B lineup / voting UI gets
// ported here from bulldogs-lineup.jsx. Backend + auth are already wired.

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="mx-auto max-w-2xl p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600">
        Haxtun Bulldogs
      </p>
      <h1 className="font-display text-6xl leading-none">Coaches Portal</h1>

      <div className="mt-8 rounded border border-neutral-800 bg-neutral-900 p-6">
        <p className="text-neutral-300">
          Backend + auth scaffold is live. The roster, depth chart, A/B lineups,
          and coach voting UI will be ported from{" "}
          <code className="text-red-400">bulldogs-lineup.jsx</code> into this
          page.
        </p>
        <ul className="mt-4 list-disc pl-5 text-sm text-neutral-400">
          <li>Auth: signed cookie session, enforced in middleware</li>
          <li>Data: Airtable — Players, State, ActivityLog</li>
          <li>
            API: <code>/api/players</code>, <code>/api/state</code>,{" "}
            <code>/api/state/depth</code>, <code>/api/state/lineups</code>
          </li>
        </ul>
        <a
          href="/api/auth/logout"
          className="mt-6 inline-block rounded bg-red-600 px-4 py-2 font-display tracking-wider"
        >
          Log out
        </a>
      </div>
    </main>
  );
}
