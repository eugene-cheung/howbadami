import type { PlayerStatsPayload, PsychometricsPayload } from "@/types/roast";

/** Which live Chess.com mode has the most finished games (blitz / rapid / bullet). */
function dominantLiveMode(
  playerStats: PlayerStatsPayload | null | undefined,
): "blitz" | "bullet" | "rapid" | null {
  if (!playerStats?.modes) return null;
  let best: { mode: "blitz" | "bullet" | "rapid"; n: number } | null = null;
  for (const key of ["blitz", "bullet", "rapid"] as const) {
    const m = playerStats.modes[key];
    if (!m || typeof m !== "object") continue;
    const w = Number((m as { wins?: unknown }).wins ?? 0);
    const l = Number((m as { losses?: unknown }).losses ?? 0);
    const d = Number((m as { draws?: unknown }).draws ?? 0);
    const n = w + l + d;
    if (n > (best?.n ?? 0)) best = { mode: key, n };
  }
  return best && best.n > 0 ? best.mode : null;
}

/**
 * When win rate under heavy time pressure is low, add a human punchline
 * (speed-chess players are expected to flag better).
 */
export function redZoneWinRateRoast(
  psych: PsychometricsPayload,
  playerStats: PlayerStatsPayload | null | undefined,
): string | null {
  const wr = psych.red_zone.win_rate_pct;
  const g = psych.red_zone.games_with_red;
  if (wr == null || g < 6) return null;
  if (wr >= 38) return null;

  const mode = dominantLiveMode(playerStats);
  const opener =
    mode === "blitz"
      ? "You play a lot of blitz"
      : mode === "bullet"
        ? "You play a lot of bullet"
        : mode === "rapid"
          ? "You play a lot of rapid"
          : "In faster time controls";

  return `${opener}, so squeezing wins when you’re under 10% on the clock ought to be a core skill — instead you won ${wr.toFixed(1)}% of those games here. Maybe fewer hero takes, more “find the premove to the flag.”`;
}
