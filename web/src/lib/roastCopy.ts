import { TIMELINE_OPTIONS } from "@/lib/timeline";
import type { RoastPayload } from "@/types/roast";

function timelineLabel(id: string): string {
  return TIMELINE_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

/** Lightweight “score” for the dashboard hero (heuristic, not chess truth). */
export function roastScore(payload: RoastPayload): number {
  const g = payload.games_parsed;
  const over = payload.clock_trauma?.overthinker_sec ?? 0;
  const heat = payload.spatial_comedy.capture_heatmap;
  const center =
    (heat["d4"] ?? 0) +
    (heat["d5"] ?? 0) +
    (heat["e4"] ?? 0) +
    (heat["e5"] ?? 0);
  const base = Math.min(35, Math.floor(g / 8));
  const chaos = Math.min(40, Math.floor(over / 4) + Math.floor(center / 40));
  const variety = Math.min(25, (payload.openings.top_openings?.length ?? 0) * 2);
  const ps = payload.player_stats;
  let statSpice = 0;
  if (ps != null) {
    if ((ps.peak_story?.drop ?? 0) >= 80) statSpice += 4;
    if ((ps.paper_tiger_gap ?? 0) >= 200) statSpice += 3;
    if (ps.max_timeout_percent != null && ps.max_timeout_percent >= 0.04) {
      statSpice += 3;
    }
    statSpice = Math.min(8, statSpice);
  }
  return Math.min(100, Math.max(1, base + chaos + variety + statSpice));
}

export function roastSummary(payload: RoastPayload, score: number): string {
  const g = payload.games_parsed;
  if (g <= 0) {
    return "Play more games before asking for an analysis, coward.";
  }
  const san = payload.clock_trauma?.overthinker_san;
  const sec = payload.clock_trauma?.overthinker_sec;
  const think =
    san && sec != null
      ? ` You once stared at ${san} for ${sec.toFixed(1)}s. The pieces felt awkward.`
      : "";
  const slice =
    payload.window != null
      ? `${timelineLabel(payload.window.timeline)} (${payload.window.months_scanned} archive months scanned)`
      : payload.archive_month_url != null
        ? "that archive month"
        : "this slice";
  return `Roast score ${score}/100 across ${g} games — ${slice}.${think}`;
}
