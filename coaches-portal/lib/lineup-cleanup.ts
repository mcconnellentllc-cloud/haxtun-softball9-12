// Removes a player id from the depth_chart JSON blob when the player is
// soft-deleted. Defensive about shape.

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
