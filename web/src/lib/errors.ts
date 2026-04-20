export function normalizeRoastError(raw: string): string {
  const t = raw.toLowerCase();
  if (
    t.includes("cannot reach the analysis server") ||
    t.includes("failed to fetch") ||
    t.includes("networkerror") ||
    t.includes("network request failed")
  ) {
    return raw;
  }
  if (t.includes("no chess.com player found")) {
    return "Chess.com has no record of this user. Typo, alt account, or the site is pretending not to know you.";
  }
  if (t.includes("no published monthly archives")) {
    return "No published games on Chess.com yet. Hang a piece, come back, we'll be waiting.";
  }
  if (t.includes("unknown timeline")) {
    return raw;
  }
  return raw;
}
