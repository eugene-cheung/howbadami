import type { JobProgress } from "@/types/roast";

type Props = { progress: JobProgress | null | undefined };

export function RoastProgress({ progress }: Props) {
  if (progress == null) {
    return (
      <div className="mt-6 space-y-3 text-left">
        <div className="h-3 w-full overflow-hidden rounded-full bg-hb-inset shadow-hb-ring">
          <div className="hb-progress-indeterminate relative h-full w-full">
            <div className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-hb-accent to-hb-gold" />
          </div>
        </div>
        <p className="text-sm text-hb-fg/50">
          Queued or starting — first progress update arrives in a moment.
        </p>
      </div>
    );
  }

  const games = progress.games_parsed ?? 0;
  const months = progress.months_scanned ?? 0;
  const totalMonths = progress.archive_months_total ?? 0;
  const pct =
    typeof progress.percent === "number" && !Number.isNaN(progress.percent)
      ? Math.min(100, Math.max(0, progress.percent))
      : null;
  const determinate = pct != null;
  const label =
    progress.mode === "rolling"
      ? "Scanning recent archives (stops when the whole month is older than your cutoff)"
      : progress.mode === "all"
        ? "Walking every published archive month"
        : progress.mode === "single_month"
          ? "Parsing the selected month"
          : "Working…";

  return (
    <div className="mt-6 space-y-3 text-left">
      <div className="h-3 w-full overflow-hidden rounded-full bg-hb-inset shadow-hb-ring">
        {determinate ? (
          <div
            className="h-full rounded-full bg-gradient-to-r from-hb-accent to-hb-gold transition-[width] duration-300 ease-out"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className="hb-progress-indeterminate relative h-full w-full">
            <div className="absolute inset-y-0 w-2/5 rounded-full bg-gradient-to-r from-hb-accent to-hb-gold" />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <p className="text-hb-fg/55">{label}</p>
        {determinate && (
          <span className="font-mono text-hb-fg">{pct.toFixed(0)}%</span>
        )}
      </div>
      <p className="font-mono text-xs text-hb-fg/50">
        <span className="text-hb-fg">{games.toLocaleString()}</span> games
        parsed
        {totalMonths > 0 && (
          <>
            {" · "}
            <span className="text-hb-fg">{months}</span> /{" "}
            {totalMonths} archive months touched
          </>
        )}
      </p>
    </div>
  );
}
