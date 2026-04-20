/** Snark lines tied to coarse progress for long-running roasts. */

const BY_PERCENT: { max: number; text: string }[] = [
  { max: 12, text: "Consulting a chess engine’s dramatic cousin…" },
  { max: 35, text: "Teaching the knights about emotional boundaries…" },
  { max: 55, text: "Counting missed mates in one (conservatively)…" },
  { max: 75, text: "Cross-referencing your trauma with opening taboos…" },
  { max: 92, text: "Drafting your apology letter to Garry Kasparov…" },
  { max: 101, text: "Almost there — resist clicking this bar like a panic button." },
];

export function loadingLineForProgress(
  percent: number | null | undefined,
  gamesParsed: number | undefined,
): string {
  let p = percent;
  if (p == null || Number.isNaN(p)) {
    const g = gamesParsed ?? 0;
    p = Math.min(88, 12 + Math.log10(1 + Math.max(0, g)) * 28);
  }
  const x = Math.min(100, Math.max(0, p));
  for (const row of BY_PERCENT) {
    if (x <= row.max) return row.text;
  }
  return BY_PERCENT[BY_PERCENT.length - 1].text;
}
