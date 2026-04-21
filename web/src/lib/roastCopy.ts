import { TIMELINE_OPTIONS } from "@/lib/timeline";
import type { RoastPayload } from "@/types/roast";

function timelineLabel(id: string): string {
  return TIMELINE_OPTIONS.find((o) => o.id === id)?.label ?? id;
}

/** Human-readable duration from seconds (for cumulative clock toll). */
export function formatClockToll(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 1) {
    return `${h}h ${m}m`;
  }
  if (m >= 1) {
    return `${m}m`;
  }
  return `${s}s`;
}

export function roastSummary(payload: RoastPayload): string {
  const g = payload.games_parsed;
  if (g <= 0) {
    return "Play more games before asking for an analysis, coward.";
  }
  const toll = payload.existential_toll?.user_clock_spend_sec;
  const tollNote =
    toll != null && toll >= 120
      ? ` Time you spent on your own moves in this period (from the clocks saved in the games): about ${formatClockToll(toll)}.`
      : "";
  const slice =
    payload.window != null
      ? timelineLabel(payload.window.timeline)
      : payload.archive_month_url != null
        ? "that one calendar month"
        : "this period";
  return `Across ${g} games — ${slice}.${tollNote}`.trim();
}
