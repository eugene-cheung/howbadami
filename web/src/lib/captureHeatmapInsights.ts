const CENTER_CORE = new Set(["d4", "d5", "e4", "e5"]);

function rankNum(sq: string): number {
  const r = sq.charAt(1);
  const n = parseInt(r, 10);
  return Number.isFinite(n) ? n : 0;
}

function fileChar(sq: string): string {
  return sq.charAt(0).toLowerCase();
}

/** Aggregate counts from PGN capture destinations (both colors, all games in slice). */
export function captureHeatmapBullets(
  heatmap: Record<string, number>,
): string[] {
  const entries: [string, number][] = [];
  let total = 0;
  for (const [sq, raw] of Object.entries(heatmap)) {
    if (typeof raw !== "number" || raw <= 0) continue;
    if (!/^[a-h][1-8]$/.test(sq)) continue;
    entries.push([sq.toLowerCase(), raw]);
    total += raw;
  }
  if (total < 1) {
    return ["No captures with a known destination square in this slice."];
  }

  let coreSum = 0;
  let kingSum = 0;
  let queenSum = 0;
  let edgeRankSum = 0;

  for (const [sq, v] of entries) {
    if (CENTER_CORE.has(sq)) coreSum += v;
    const f = fileChar(sq);
    if (f >= "e" && f <= "h") kingSum += v;
    if (f >= "a" && f <= "d") queenSum += v;
    const r = rankNum(sq);
    if (r <= 2 || r >= 7) edgeRankSum += v;
  }

  const corePct = Math.round((100 * coreSum) / total);
  const kingPct = Math.round((100 * kingSum) / total);
  const queenPct = Math.round((100 * queenSum) / total);
  const edgeRankPct = Math.round((100 * edgeRankSum) / total);

  const lines: string[] = [];
  lines.push(
    `About ${corePct}% of all capture events in this period landed on the d4–e5 core. That glow is normal—chess fights magnetize to the center—so the useful read is the *shape* around it (wings, one-sided fire, back-rank trades).`,
  );

  const imb = Math.abs(kingPct - queenPct);
  if (imb >= 10) {
    lines.push(
      `Capture traffic tilts ${kingPct > queenPct ? "king-side (e–h)" : "queen-side (a–d)"} (${Math.max(kingPct, queenPct)}% vs ${Math.min(kingPct, queenPct)}%), so your games tend to blow up more on that wing.`,
    );
  } else {
    lines.push(
      `King-side vs queen-side share is fairly even (${kingPct}% vs ${queenPct}%) — fights aren’t all stacked on one flank.`,
    );
  }

  const outside = [...entries]
    .filter(([sq]) => !CENTER_CORE.has(sq))
    .sort((a, b) => b[1] - a[1]);
  const top = outside[0];
  if (top && top[1] >= Math.max(3, Math.floor(0.08 * total))) {
    lines.push(
      `Outside the four center squares, the busiest landing zone is square ${top[0]} (${top[1]} captures) — worth noticing if you keep steering the same structures there.`,
    );
  }

  if (edgeRankPct >= 42) {
    lines.push(
      `${edgeRankPct}% of captures sit on the 1st, 2nd, 7th, or 8th rank — more endgame / back-rank contact than a middlegame-only brawl.`,
    );
  } else if (edgeRankPct <= 28) {
    lines.push(
      `Only ${edgeRankPct}% of captures are on the first two or last two ranks; most violence stays in the “field” ranks — typical of open, central play in this batch.`,
    );
  }

  return lines.slice(0, 4);
}
