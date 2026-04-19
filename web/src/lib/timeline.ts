/** Must match `VALID_TIMELINES` / `TIMELINE_WINDOWS` in `roast_mvp.py`. */
export const TIMELINE_OPTIONS: { id: string; label: string }[] = [
  { id: "1d", label: "Last day" },
  { id: "1w", label: "Last week" },
  { id: "1m", label: "Last month" },
  { id: "2m", label: "Last 2 months" },
  { id: "3m", label: "Last 3 months" },
  { id: "4m", label: "Last 4 months" },
  { id: "5m", label: "Last 5 months" },
  { id: "6m", label: "Last 6 months" },
  { id: "7m", label: "Last 7 months" },
  { id: "8m", label: "Last 8 months" },
  { id: "9m", label: "Last 9 months" },
  { id: "10m", label: "Last 10 months" },
  { id: "11m", label: "Last 11 months" },
  { id: "1y", label: "Last year" },
  { id: "all", label: "All time" },
];

export const DEFAULT_TIMELINE = "1m";
