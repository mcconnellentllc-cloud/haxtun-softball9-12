// Removes a player id from the depth_chart and lineups JSON blobs when the
// player is soft-deleted. Defensive about shape — reconcile field/batting/votes
// keys with bulldogs-lineup.jsx if the prototype differs.

export function stripFromDepth(
  depth: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  if (!depth || typeof depth !== "object") return {};
  for (const team of Object.keys(depth)) {
    const positions = depth[team] as Record<string, unknown>;
    if (positions && typeof positions === "object") {
      for (const pos of Object.keys(positions)) {
        const arr = positions[pos];
        if (Array.isArray(arr)) {
          positions[pos] = arr.filter((p) => p !== id);
        }
      }
    }
  }
  return depth;
}

export function stripFromLineups(
  lineups: Record<string, unknown>,
  id: string,
): Record<string, unknown> {
  if (!lineups || typeof lineups !== "object") return {};
  for (const team of Object.keys(lineups)) {
    const innings = lineups[team] as Record<string, unknown>;
    if (!innings || typeof innings !== "object") continue;
    for (const inning of Object.keys(innings)) {
      const slot = innings[inning] as Record<string, unknown>;
      if (!slot || typeof slot !== "object") continue;

      // `field` is a position -> playerId map.
      dropIdFromMap(slot["field"], id);
      // `batting` is an ordered array of playerIds.
      slot["batting"] = dropIdFromArray(slot["batting"], id);

      const votes = slot["votes"] as Record<string, unknown> | undefined;
      if (votes && typeof votes === "object") {
        dropIdFromMap(votes["field"], id);
        votes["batting"] = dropIdFromArray(votes["batting"], id);
      }
    }
  }
  return lineups;
}

function dropIdFromMap(field: unknown, id: string): void {
  if (field && typeof field === "object" && !Array.isArray(field)) {
    const f = field as Record<string, unknown>;
    for (const pos of Object.keys(f)) {
      if (f[pos] === id) delete f[pos];
    }
  }
}

function dropIdFromArray(arr: unknown, id: string): unknown {
  return Array.isArray(arr) ? arr.filter((p) => p !== id) : arr;
}
