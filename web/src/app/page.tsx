"use client";

import { CaptureHeatmap } from "@/components/CaptureHeatmap";
import { OpeningBars } from "@/components/OpeningBars";
import { RatingJourneyChart } from "@/components/RatingJourneyChart";
import { RoastProgress } from "@/components/RoastProgress";
import { normalizeRoastError } from "@/lib/errors";
import { getJob, startRoast } from "@/lib/api";
import { loadingLineForProgress } from "@/lib/loadingSnark";
import {
  formatClockToll,
  roastScore,
  roastSummary,
} from "@/lib/roastCopy";
import { DEFAULT_TIMELINE, TIMELINE_OPTIONS } from "@/lib/timeline";
import type {
  HallOfShameEntry,
  HallOfShamePayload,
  JobProgress,
  RoastPayload,
} from "@/types/roast";
import { useCallback, useEffect, useRef, useState } from "react";

const HALL_VACANT_LABELS: Record<
  | "mouse_slip"
  | "accidental_pacifist"
  | "charity_donor"
  | "scholars_victim"
  | "mutual_cowardice"
  | "stubborn_mule",
  string
> = {
  mouse_slip: "Mouse slip tragedy",
  accidental_pacifist: "Accidental pacifist",
  charity_donor: "Charity donor",
  scholars_victim: "Scholar's victim",
  mutual_cowardice: "Mutual cowardice",
  stubborn_mule: "Stubborn mule",
};

const LOADING_LINES = [
  "Counting ways you ignored development…",
  "Cross-referencing your tragedies with opening theory…",
  "Asking the pawns how they really feel…",
  "Measuring clock trauma in human seconds…",
  "Building a heatmap of your poor life choices…",
];

function useRoastJob() {
  const [phase, setPhase] = useState<"idle" | "loading" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RoastPayload | null>(null);
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null);
  const [lineIdx, setLineIdx] = useState(0);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (phase !== "loading") return;
    const t = setInterval(() => {
      setLineIdx((i) => (i + 1) % LOADING_LINES.length);
    }, 2200);
    return () => clearInterval(t);
  }, [phase]);

  const run = useCallback(async (username: string, timeline: string) => {
    cancelRef.current = false;
    setPhase("loading");
    setError(null);
    setPayload(null);
    setJobProgress(null);
    try {
      const { job_id } = await startRoast(username, timeline);
      const pollMs = 650;
      for (;;) {
        if (cancelRef.current) return;
        const job = await getJob(job_id);
        setJobProgress(job.progress ?? null);
        if (job.status === "completed" && job.result) {
          setPayload(job.result);
          setJobProgress(null);
          setPhase("done");
          return;
        }
        if (job.status === "failed") {
          setError(normalizeRoastError(job.error ?? "Job failed."));
          setJobProgress(null);
          setPhase("error");
          return;
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    } catch (e) {
      setJobProgress(null);
      setError(
        normalizeRoastError(
          e instanceof Error ? e.message : String(e),
        ),
      );
      setPhase("error");
    }
  }, []);

  const reset = useCallback(() => {
    cancelRef.current = true;
    setPhase("idle");
    setError(null);
    setPayload(null);
    setJobProgress(null);
  }, []);

  const progressAwareLine =
    jobProgress != null && (jobProgress.games_parsed ?? 0) > 0
      ? loadingLineForProgress(
          jobProgress.percent,
          jobProgress.games_parsed,
        )
      : LOADING_LINES[lineIdx];

  const loadingAside =
    jobProgress != null && (jobProgress.games_parsed ?? 0) > 0
      ? LOADING_LINES[lineIdx]
      : null;

  return {
    phase,
    error,
    payload,
    jobProgress,
    run,
    reset,
    loadingLine: progressAwareLine,
    loadingAside,
  };
}

export default function Home() {
  const {
    phase,
    error,
    payload,
    jobProgress,
    run,
    reset,
    loadingLine,
    loadingAside,
  } = useRoastJob();
  const [username, setUsername] = useState("");
  const [timeline, setTimeline] = useState(DEFAULT_TIMELINE);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) return;
    void run(u, timeline);
  };

  const chartRows =
    payload?.openings?.top_openings?.map((o) => ({
      line: o.opening,
      games: o.games,
      wins: o.wins,
      losses: o.losses,
      draws: o.draws,
      win_rate_pct: o.win_rate_pct,
    })) ?? [];

  const score = payload ? roastScore(payload) : 0;
  const summary = payload ? roastSummary(payload, score) : "";
  const ledgerUpset =
    payload?.ego_check?.found === true &&
    (payload.ego_check.upset_favorite === true ||
      (payload.ego_check.elo_diff != null && payload.ego_check.elo_diff > 0));

  return (
    <div className="relative min-h-screen">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[min(42rem,55vh)] bg-gradient-to-b from-hb-accent/10 via-hb-base to-hb-base"
        aria-hidden
      />
      <div className="relative mx-auto flex max-w-3xl flex-col gap-12 px-4 py-14 sm:px-6 lg:max-w-4xl">
        <header className="space-y-4 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-hb-accent">
            howbadami
          </p>
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.08] tracking-display text-hb-fg sm:text-5xl">
            Chess.com roast lab
          </h1>
          <p className="max-w-prose font-serif text-lg leading-relaxed text-hb-fg/60">
            Rolling timelines (Chess.com{" "}
            <code className="rounded-md bg-hb-raised px-1.5 py-0.5 font-mono text-sm text-hb-fg shadow-hb-ring">
              end_time
            </code>
            ), zero databases, maximum judgment. Point this at your FastAPI backend
            via{" "}
            <code className="rounded-md bg-hb-raised px-1.5 py-0.5 font-mono text-sm text-hb-fg shadow-hb-ring">
              NEXT_PUBLIC_API_URL
            </code>
            .
          </p>
        </header>

        <form
          onSubmit={onSubmit}
          className="flex flex-col gap-5 rounded-[10px] border border-hb-fg/10 bg-hb-panel/90 p-6 shadow-hb-card backdrop-blur-sm sm:p-8"
        >
          <label className="block text-left text-sm font-medium text-hb-fg/80">
            Chess.com username
            <input
              className="mt-2 w-full rounded-lg border border-hb-fg/10 bg-hb-inset px-4 py-3 text-lg text-hb-fg shadow-hb-soft outline-none transition focus:border-hb-accent/40 focus:shadow-hb-focus"
              placeholder="e.g. TheEugenius"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              disabled={phase === "loading"}
            />
          </label>
          <label className="block text-left text-sm font-medium text-hb-fg/80">
            Timeline
            <select
              className="mt-2 w-full rounded-lg border border-hb-fg/10 bg-hb-inset px-4 py-3 text-sm text-hb-fg shadow-hb-soft outline-none transition focus:border-hb-accent/40 focus:shadow-hb-focus"
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              disabled={phase === "loading"}
            >
              {TIMELINE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="submit"
              disabled={phase === "loading" || !username.trim()}
              className="rounded-lg bg-hb-raised px-6 py-3 text-sm font-semibold text-hb-fg shadow-hb-ring transition hover:text-hb-crimson focus-visible:shadow-hb-focus disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "loading" ? "Roasting…" : "Run analysis"}
            </button>
            {phase !== "idle" && (
              <button
                type="button"
                onClick={reset}
                className="rounded-full border border-hb-fg/10 bg-hb-panel/80 px-5 py-3 text-sm text-hb-fg/70 transition hover:border-hb-fg/20 hover:text-hb-crimson"
              >
                Reset
              </button>
            )}
          </div>
        </form>

        {phase === "loading" && (
          <div className="rounded-[10px] border border-dashed border-hb-fg/15 bg-hb-panel/60 px-6 py-10 shadow-hb-soft sm:px-8">
            <p className="text-center text-lg font-medium text-hb-fg">
              {loadingLine}
            </p>
            {loadingAside && (
              <p className="mt-2 text-center font-serif text-sm italic text-hb-fg/50">
                {loadingAside}
              </p>
            )}
            <p className="mt-3 text-center text-sm text-hb-fg/50">
              Status + progress update about every 0.65s while the job runs.
            </p>
            <RoastProgress progress={jobProgress} />
          </div>
        )}

        {phase === "error" && error && (
          <div
            className="rounded-[10px] border border-hb-crimson/30 bg-hb-crimson/10 px-6 py-5 text-hb-fg shadow-hb-soft"
            role="alert"
          >
            <p className="font-medium text-hb-crimson">Something went wrong</p>
            <p className="mt-2 text-sm text-hb-fg/80">{error}</p>
          </div>
        )}

        {phase === "done" && payload && (
          <section className="space-y-10 pb-16">
            <div className="rounded-[10px] border border-hb-fg/10 bg-gradient-to-br from-hb-raised via-hb-panel to-hb-base p-8 text-center shadow-hb-card sm:text-left">
              <div className="grid gap-6 sm:grid-cols-2">
                {payload.existential_toll != null &&
                  payload.existential_toll.user_clock_spend_sec >= 60 && (
                    <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/50 p-5 text-left">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hb-fg/50">
                        Time on your moves (slice)
                      </p>
                      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-hb-accent">
                        {formatClockToll(
                          payload.existential_toll.user_clock_spend_sec,
                        )}
                      </p>
                      <p className="mt-2 font-serif text-sm leading-relaxed text-hb-fg/60">
                        Cumulative clock on your own moves from %clk deltas in{" "}
                        {payload.existential_toll.games_with_clk_spend} games with
                        usable clocks.
                      </p>
                    </div>
                  )}
                {payload.rating_journey?.worst_daily_spiral != null && (
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/50 p-5 text-left">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hb-fg/50">
                      Worst daily spiral
                    </p>
                    <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-hb-crimson">
                      {payload.rating_journey.worst_daily_spiral.delta_r}{" "}
                      <span className="text-lg font-normal text-hb-fg/55">
                        listed Elo ·{" "}
                        {payload.rating_journey.worst_daily_spiral.date_display}
                      </span>
                    </p>
                    <p className="mt-2 font-serif text-sm leading-relaxed text-hb-fg/60">
                      Same UTC day: first → last listed pre-game rating (
                      {payload.rating_journey.worst_daily_spiral.games_that_day}{" "}
                      games).
                    </p>
                  </div>
                )}
              </div>
              <p className="mt-6 text-xs text-hb-fg/40">
                Roast score (heuristic spice):{" "}
                <span className="font-mono text-hb-fg/60">{score}</span>/100
              </p>
              {payload.snark && (
                <div className="mt-6 space-y-4 text-left">
                  <p className="text-xl font-semibold leading-snug tracking-section text-hb-fg">
                    {payload.snark.headline}
                  </p>
                  {payload.snark.badges.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {payload.snark.badges.map((b) => (
                        <span
                          key={b.id}
                          className="rounded-full border border-hb-fg/10 bg-hb-raised px-3 py-1 text-xs font-medium text-hb-fg/75"
                        >
                          {b.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(payload.skipped_non_traditional_games ?? 0) > 0 && (
                <p className="mt-6 max-w-prose font-serif text-sm leading-relaxed text-hb-fg/60">
                  By the way, I filtered out {payload.skipped_non_traditional_games}{" "}
                  {payload.skipped_non_traditional_games === 1 ? "game" : "games"}{" "}
                  because they&apos;re not <em>real chess</em>.
                </p>
              )}
            </div>

            {payload.player_stats && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 text-sm text-hb-fg/80 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Chess.com profile stats
                </h2>
                <p className="mt-1 font-serif text-xs text-hb-fg/50">
                  Live from{" "}
                  <code className="font-mono text-hb-accent/90">
                    pub/player/…/stats
                  </code>{" "}
                  (not the archive slice).
                </p>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                      FIDE (public field)
                    </dt>
                    <dd className="mt-1 font-mono text-base text-hb-fg">
                      {payload.player_stats.unranked_fide
                        ? "Not listed"
                        : payload.player_stats.fide_rating}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                      Tactics peak / live peak
                    </dt>
                    <dd className="mt-1 font-mono text-base text-hb-fg">
                      {payload.player_stats.tactics_highest ?? "—"} /{" "}
                      {payload.player_stats.max_live_rating ?? "—"}
                      {payload.player_stats.paper_tiger_gap != null &&
                        payload.player_stats.paper_tiger_gap >= 120 && (
                          <span className="ml-1 text-hb-accent">
                            (Δ {payload.player_stats.paper_tiger_gap})
                          </span>
                        )}
                    </dd>
                  </div>
                  {payload.player_stats.peak_story && (
                    <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4 sm:col-span-2">
                      <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                        Largest peak → now drop
                      </dt>
                      <dd className="mt-1 font-mono text-sm text-hb-fg sm:text-base">
                        {payload.player_stats.peak_story.mode}: best{" "}
                        {payload.player_stats.peak_story.best}, last{" "}
                        {payload.player_stats.peak_story.last} (Δ{" "}
                        {payload.player_stats.peak_story.drop})
                      </dd>
                    </div>
                  )}
                  {payload.player_stats.max_timeout_percent != null && (
                    <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                      <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                        Max timeout % (modes)
                      </dt>
                      <dd className="mt-1 font-mono text-base text-hb-fg">
                        {(payload.player_stats.max_timeout_percent > 1
                          ? payload.player_stats.max_timeout_percent
                          : payload.player_stats.max_timeout_percent * 100
                        ).toFixed(2)}
                        %
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )}

            {payload.ego_check && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Ego check
                </h2>
                <p className="mt-1 font-serif text-sm text-hb-fg/55">
                  David &amp; Goliath disaster: worst rated loss in this slice to
                  someone listed below you (post-game ratings from the archive JSON,
                  not live Elo math).
                </p>
                {payload.ego_check.found ? (
                  <>
                    <dl className="mt-5 grid gap-3 font-mono text-xs text-hb-fg/85 sm:grid-cols-2">
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4 sm:col-span-2">
                        <dt className="text-hb-fg/45">Signature L</dt>
                        <dd className="mt-1 text-sm text-hb-fg">
                          vs{" "}
                          <span className="text-hb-accent">
                            {payload.ego_check.opponent}
                          </span>
                          {payload.ego_check.date_display && (
                            <>
                              {" "}
                              ·{" "}
                              <span className="text-hb-fg/70">
                                {payload.ego_check.date_display}
                              </span>
                            </>
                          )}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                        <dt className="text-hb-fg/45">Ledger gap</dt>
                        <dd
                          className={
                            ledgerUpset
                              ? "mt-1 text-base text-hb-crimson"
                              : "mt-1 text-base text-hb-fg/85"
                          }
                        >
                          {payload.ego_check.elo_diff != null &&
                          payload.ego_check.elo_diff > 0
                            ? `+${payload.ego_check.elo_diff} pts (you listed higher)`
                            : payload.ego_check.elo_diff != null &&
                                payload.ego_check.elo_diff < 0
                              ? `${payload.ego_check.elo_diff} pts (listed lower — respectable loss)`
                              : `${payload.ego_check.elo_diff ?? "—"} pts`}
                        </dd>
                      </div>
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                        <dt className="text-hb-fg/45">Full moves</dt>
                        <dd className="mt-1 text-base text-hb-fg">
                          {payload.ego_check.full_moves}
                          {payload.ego_check.user_elo != null &&
                            payload.ego_check.opponent_elo != null && (
                              <span className="ml-2 text-xs text-hb-fg/50">
                                ({payload.ego_check.user_elo} vs{" "}
                                {payload.ego_check.opponent_elo})
                              </span>
                            )}
                        </dd>
                      </div>
                    </dl>
                    {payload.ego_check.snark_lines[0] && (
                      <p className="mt-5 font-serif text-sm italic leading-relaxed text-hb-fg/65">
                        {payload.ego_check.snark_lines[0]}
                      </p>
                    )}
                    {payload.ego_check.snark_lines.length > 1 && (
                      <ul className="mt-3 space-y-2 font-serif text-sm italic leading-relaxed text-hb-fg/60">
                        {payload.ego_check.snark_lines.slice(1).map((line, i) => (
                          <li key={i}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="mt-5 font-serif text-sm italic text-hb-fg/60">
                    {payload.ego_check.snark_lines[0] ??
                      "No ego catastrophe in this slice."}
                  </p>
                )}
              </div>
            )}

            {payload.hall_of_shame && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Hall of shame
                </h2>
                <p className="mt-1 font-serif text-sm text-hb-fg/55">
                  Six mathematically defensible disasters from this slice (standard
                  games in the archive). Empty plaques mean innocence or insufficient
                  evidence — not absolution.
                </p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(
                    [
                      "mouse_slip",
                      "accidental_pacifist",
                      "charity_donor",
                      "scholars_victim",
                      "mutual_cowardice",
                      "stubborn_mule",
                    ] as const
                  ).map((slotKey) => {
                    const hs = payload.hall_of_shame as HallOfShamePayload;
                    const raw = hs[slotKey];
                    const hit =
                      raw &&
                      typeof raw === "object" &&
                      "roast" in raw &&
                      typeof (raw as HallOfShameEntry).roast === "string"
                        ? (raw as HallOfShameEntry)
                        : null;
                    return (
                      <div
                        key={slotKey}
                        className={`flex min-h-[11rem] flex-col rounded-lg border p-4 ${
                          hit
                            ? "border-hb-crimson/25 bg-hb-crimson/[0.06]"
                            : "border-dashed border-hb-fg/12 bg-hb-inset/40"
                        }`}
                      >
                        {hit ? (
                          <>
                            <p className="text-xs font-semibold uppercase tracking-wide text-hb-fg/40">
                              {hit.subtitle}
                            </p>
                            <h3 className="mt-1 text-base font-semibold text-hb-fg">
                              {hit.title}
                            </h3>
                            <p className="mt-2 font-mono text-[11px] text-hb-fg/45">
                              {hit.date_display}
                              {hit.opponent && ` · vs ${hit.opponent}`}
                              {hit.spend_seconds != null && (
                                <>
                                  {" "}
                                  · {Number(hit.spend_seconds).toFixed(1)}s on{" "}
                                  {hit.san ?? "—"}
                                </>
                              )}
                              {hit.material_lead != null &&
                                (slotKey === "accidental_pacifist" ||
                                  slotKey === "charity_donor") && (
                                  <> · +{hit.material_lead} material (terminal)</>
                                )}
                              {hit.full_moves != null &&
                                slotKey !== "mouse_slip" &&
                                slotKey !== "accidental_pacifist" &&
                                slotKey !== "charity_donor" && (
                                  <>
                                    {" "}
                                    · {hit.full_moves} full moves
                                  </>
                                )}
                              {hit.user_elo != null && (
                                <> · listed ~{hit.user_elo}</>
                              )}
                            </p>
                            <p className="mt-3 flex-1 font-serif text-sm italic leading-relaxed text-hb-fg/70">
                              {hit.roast}
                            </p>
                          </>
                        ) : (
                          <>
                            <h3 className="text-sm font-semibold text-hb-fg/35">
                              {HALL_VACANT_LABELS[slotKey]}
                            </h3>
                            <p className="mt-3 flex-1 font-serif text-sm italic text-hb-fg/50">
                              Vacant plinth — no qualifying disaster in this slice.
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {payload.rating_journey && payload.rating_journey.series.length > 0 && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Listed rating arc
                </h2>
                <p className="mt-1 font-serif text-sm text-hb-fg/55">
                  Each point is your pre-game listed rating from the PGN (not
                  post-game). Bands count how many games in this slice showed that
                  rating bucket ({payload.rating_journey.coverage_pct}% of games in
                  the slice had usable headers).
                </p>
                <div className="mt-6 w-full min-w-0">
                  <RatingJourneyChart series={payload.rating_journey.series} />
                </div>
                <dl className="mt-6 grid gap-3 font-mono text-xs text-hb-fg/80 sm:grid-cols-3">
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                    <dt className="text-hb-fg/45">First → last (slice)</dt>
                    <dd className="mt-1 text-sm text-hb-fg">
                      {payload.rating_journey.first_r} →{" "}
                      {payload.rating_journey.last_r}
                      <span
                        className={
                          payload.rating_journey.delta_r > 0
                            ? " text-hb-success"
                            : payload.rating_journey.delta_r < 0
                              ? " text-hb-crimson"
                              : " text-hb-fg/50"
                        }
                      >
                        {" "}
                        (Δ {payload.rating_journey.delta_r > 0 ? "+" : ""}
                        {payload.rating_journey.delta_r})
                      </span>
                    </dd>
                  </div>
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3 sm:col-span-2">
                    <dt className="text-hb-fg/45">Longest stay (100-pt bucket)</dt>
                    <dd className="mt-1 text-sm text-hb-fg">
                      {payload.rating_journey.longest_band_games} games in the{" "}
                      {payload.rating_journey.longest_band_lo}–
                      {payload.rating_journey.longest_band_lo + 99} band
                    </dd>
                  </div>
                </dl>
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[280px] border-collapse text-left text-xs text-hb-fg/85">
                    <thead>
                      <tr className="border-b border-hb-fg/10 text-hb-fg/45">
                        <th className="py-2 pr-4 font-medium uppercase tracking-wide">
                          Band
                        </th>
                        <th className="py-2 font-medium uppercase tracking-wide">
                          Games
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {payload.rating_journey.bands.map((b) => (
                        <tr
                          key={b.band_lo}
                          className="border-b border-hb-fg/[0.06] font-mono"
                        >
                          <td className="py-1.5 pr-4">
                            {b.band_lo}–{b.band_lo + 99}
                          </td>
                          <td className="py-1.5 tabular-nums">{b.games}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {payload.rating_journey.snark_lines.length > 0 && (
                  <ul className="mt-5 space-y-2 font-serif text-sm italic leading-relaxed text-hb-fg/65">
                    {payload.rating_journey.snark_lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {(payload.psychometrics || payload.clock_trauma) && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 text-sm text-hb-fg/85 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Archive psychology & clock trauma
                </h2>
                <p className="mt-1 font-serif text-xs text-hb-fg/50">
                  Red zone, session tilt, opening HHI / clock variance, plus singular
                  overthink and blunder-rush moves — slice only.
                </p>
                <div className="mt-6 grid gap-8 lg:grid-cols-2">
                  {payload.psychometrics && (
                    <div>
                      <h3 className="text-sm font-semibold text-hb-fg/80">
                        Archive psychology
                      </h3>
                      <dl className="mt-4 grid gap-4 sm:grid-cols-1">
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Red zone (your moves under 10% time)
                          </dt>
                          <dd className="mt-1 font-mono text-hb-fg">
                            {payload.psychometrics.red_zone.moves_total} moves ·{" "}
                            {payload.psychometrics.red_zone.games_with_red} games
                            with red-zone play
                            {payload.psychometrics.red_zone.win_rate_pct != null && (
                              <>
                                {" "}
                                · win rate in those games{" "}
                                {payload.psychometrics.red_zone.win_rate_pct.toFixed(
                                  1,
                                )}
                                %
                              </>
                            )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Tilt / sessions
                          </dt>
                          <dd className="mt-1 font-mono text-sm text-hb-fg">
                            Max loss streak in one session (≤10m gaps):{" "}
                            {payload.psychometrics.tilt.max_session_loss_streak}
                            <br />
                            Avg gap loss → next start:{" "}
                            {payload.psychometrics.tilt.avg_queue_sec_after_loss !=
                            null
                              ? `${payload.psychometrics.tilt.avg_queue_sec_after_loss.toFixed(1)}s`
                              : "—"}{" "}
                            ({payload.psychometrics.tilt.loss_to_next_samples}{" "}
                            samples)
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Opening HHI (5-ply keys)
                          </dt>
                          <dd className="mt-1 font-mono text-hb-fg">
                            {payload.psychometrics.opening_hhi != null
                              ? payload.psychometrics.opening_hhi.toFixed(0)
                              : "—"}{" "}
                            {payload.psychometrics.one_trick_pony && (
                              <span className="text-hb-accent"> · concentrated</span>
                            )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Opening clock variance (first 5 moves with full %clk)
                          </dt>
                          <dd className="mt-1 font-mono text-sm text-hb-fg">
                            Mean σ of spend times:{" "}
                            {payload.psychometrics.autopilot.mean_opening5_std_sec !=
                            null
                              ? `${payload.psychometrics.autopilot.mean_opening5_std_sec.toFixed(3)}s`
                              : "—"}{" "}
                            · games:{" "}
                            {payload.psychometrics.autopilot.games_with_full_clk5} ·
                            instant replies to rare early SANs:{" "}
                            {payload.psychometrics.autopilot.rare_instant_games} /{" "}
                            {payload.psychometrics.autopilot.games_touching_rare}{" "}
                            games
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                  {payload.clock_trauma && (
                    <div>
                      <h3 className="text-sm font-semibold text-hb-fg/80">
                        Clock trauma
                      </h3>
                      <dl className="mt-4 grid gap-4 sm:grid-cols-1">
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Overthink peak
                          </dt>
                          <dd className="mt-1 text-hb-fg">
                            <span className="font-mono">
                              {payload.clock_trauma.overthinker_san ?? "—"}
                            </span>{" "}
                            (
                            {payload.clock_trauma.overthinker_sec != null
                              ? `${payload.clock_trauma.overthinker_sec.toFixed(1)}s`
                              : "—"}
                            )
                            {payload.clock_trauma.overthink_eval_drop != null &&
                              payload.clock_trauma.overthink_eval_drop > 0 && (
                                <span className="mt-2 block font-serif text-xs text-hb-accent">
                                  Eval drop on that move ≈{" "}
                                  {payload.clock_trauma.overthink_eval_drop.toFixed(
                                    1,
                                  )}{" "}
                                  pawns (if PGN had %eval)
                                </span>
                              )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Pre-move blunder rush
                          </dt>
                          <dd className="mt-1 font-mono text-hb-fg">
                            {payload.clock_trauma.premove_san ?? "—"}{" "}
                            {payload.clock_trauma.premove_sec != null
                              ? `(${payload.clock_trauma.premove_sec.toFixed(2)}s)`
                              : "(no eval-tagged blunders in slice)"}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
              <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                Opening volume
              </h2>
              <p className="mt-1 font-serif text-sm text-hb-fg/55">
                Named families from your first five half-moves (still keyed on the
                exact SAN string in the data). Expand a row to see the line. Hover
                the colored mix bar on desktop; tap the bar on touch devices for exact
                win/draw/loss percentages.
              </p>
              <div className="mt-5">
                <OpeningBars rows={chartRows} />
              </div>
            </div>

            <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
              <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                Capture heatmap
              </h2>
              <p className="mt-1 font-serif text-sm text-hb-fg/55">
                Destination square density — D3 sequential scale; brighter means more
                captures landed there.
              </p>
              <div className="mt-6 w-full min-w-0 overflow-x-auto">
                <CaptureHeatmap heatmap={payload.spatial_comedy.capture_heatmap} />
              </div>
            </div>

            <footer className="space-y-3 border-t border-hb-fg/10 pt-8">
              <p className="font-serif text-sm leading-relaxed text-hb-fg/70">
                {summary}
              </p>
              {payload.window?.cutoff_utc != null && (
                <p className="text-xs text-hb-fg/45">
                  Games with end at or after{" "}
                  <span className="font-mono text-hb-fg/65">
                    {payload.window.cutoff_utc}
                  </span>{" "}
                  UTC (rolling window).
                </p>
              )}
              {payload.window?.timeline === "all" && (
                <p className="text-xs text-hb-fg/45">
                  All published games across{" "}
                  <span className="font-mono text-hb-fg/65">
                    {payload.window.months_scanned}
                  </span>{" "}
                  archive months.
                </p>
              )}
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
