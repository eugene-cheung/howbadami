"use client";

import { CaptureHeatmap } from "@/components/CaptureHeatmap";
import { CircadianWinChart } from "@/components/CircadianWinChart";
import { OpeningBars } from "@/components/OpeningBars";
import { RatingJourneyChart } from "@/components/RatingJourneyChart";
import { SurvivalStepChart } from "@/components/SurvivalStepChart";
import { RoastProgress } from "@/components/RoastProgress";
import { normalizeRoastError } from "@/lib/errors";
import { getJob, startRoast, warmupBackend } from "@/lib/api";
import { loadingLineForProgress } from "@/lib/loadingSnark";
import { formatSecondsHuman } from "@/lib/formatDuration";
import { redZoneWinRateRoast } from "@/lib/psychRoasts";
import {
  formatClockToll,
  roastSummary,
} from "@/lib/roastCopy";
import {
  PEARSON_HOUR_WIN_TOOLTIP,
  QUANT_FALLBACK_NO_SMOKING_GUN,
  SPEARMAN_HOUR_WIN_TOOLTIP,
  SURVIVAL_CURVE_LAYMAN,
  circadianSignificance,
  correlationPairMeaning,
  hasQuantCharts,
  quantVerdict,
  survivalSignificance,
  terminalLayman,
  terminalSignificance,
} from "@/lib/quantNarrative";
import { captureHeatmapBullets } from "@/lib/captureHeatmapInsights";
import { DEFAULT_TIMELINE, TIMELINE_OPTIONS } from "@/lib/timeline";
import type {
  HallOfShameEntry,
  HallOfShamePayload,
  JobProgress,
  RoastPayload,
} from "@/types/roast";
import { useCallback, useEffect, useRef, useState } from "react";

type HallSlotKey =
  | "mouse_slip"
  | "accidental_pacifist"
  | "charity_donor"
  | "scholars_victim"
  | "mutual_cowardice"
  | "stubborn_mule";

const HALL_VACANT_LABELS: Record<HallSlotKey, string> = {
  mouse_slip: "Mouse slip tragedy",
  accidental_pacifist: "Accidental pacifist",
  charity_donor: "Charity donor",
  scholars_victim: "Scholar's victim",
  mutual_cowardice: "Mutual cowardice",
  stubborn_mule: "Stubborn mule",
};

/** Native hover (title) — matches roast_mvp hall-of-shame heuristics. */
const HALL_SLOT_TOOLTIPS: Record<HallSlotKey, string> = {
  mouse_slip:
    "Not a real mouse sensor. We flag games where PGN clock tags show you spent under 1s on one of your moves, then resigned — a proxy for a catastrophic mis-click or panic tap. Needs %clk data.",
  accidental_pacifist:
    "You stalemated your opponent while still ahead by at least +5 material (P=1, minor piece=3, rook=5, queen=9 on the final board).",
  charity_donor:
    "You ran out of time while at least +3 material ahead on the final position.",
  scholars_victim:
    "You were checkmated in 10 full moves or fewer with a listed rating of 1800+.",
  mutual_cowardice:
    "Agreed draw in fewer than 30 half-moves (15 full moves).",
  stubborn_mule:
    "You were checkmated after more than 60 full moves — a very long loss.",
};

const LOADING_LINES = [
  "Counting ways you ignored development…",
  "Cross-referencing your tragedies with opening theory…",
  "Asking the pawns how they really feel…",
  "Turning your time trouble into plain seconds…",
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

  useEffect(() => {
    warmupBackend();
  }, []);

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

  const summary = payload ? roastSummary(payload) : "";
  const redZoneRoastLine =
    payload?.psychometrics != null
      ? redZoneWinRateRoast(payload.psychometrics, payload.player_stats)
      : null;
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
          <h1 className="text-4xl font-semibold uppercase leading-none tracking-[0.12em] text-hb-accent sm:text-5xl sm:tracking-[0.14em] lg:text-6xl">
            elosurgery
          </h1>
          <p className="max-w-prose font-serif text-lg leading-relaxed text-hb-fg/60">
            Enter a public Chess.com username, pick how far back to look, and get a
            playful report from the games Chess.com already publishes. No logins, no
            uploads — just stats and jokes from what&apos;s on the site.
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
              placeholder="e.g. MagnusCarlsen, Hikaru"
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
              Progress updates about once a second while we crunch your games.
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
                        Time on your moves (this period)
                      </p>
                      <p className="mt-2 font-mono text-3xl font-semibold tabular-nums text-hb-accent">
                        {formatClockToll(
                          payload.existential_toll.user_clock_spend_sec,
                        )}
                      </p>
                      <p className="mt-2 font-serif text-sm leading-relaxed text-hb-fg/60">
                        Total time you spent on your own moves in this period (from
                        clock tags in the games).
                      </p>
                    </div>
                  )}
                {payload.rating_journey?.worst_daily_spiral != null && (
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/50 p-5 text-left">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-hb-fg/50">
                      Worst daily spiral
                    </p>
                    <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-hb-crimson sm:text-3xl">
                      {payload.rating_journey.worst_daily_spiral.delta_r > 0 ? "+" : ""}
                      {payload.rating_journey.worst_daily_spiral.delta_r} rating points ·{" "}
                      <span className="text-lg font-normal text-hb-fg/55">
                        {payload.rating_journey.worst_daily_spiral.date_display}
                      </span>
                    </p>
                  </div>
                )}
              </div>
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
                  Chess.com overall stats
                </h2>
                <p className="mt-1 font-serif text-xs text-hb-fg/50">
                  Pulled directly from your Chess.com profile.
                </p>
                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                    <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                      FIDE rating (if shown on profile)
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
                            (gap {payload.player_stats.paper_tiger_gap} pts)
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
                        {payload.player_stats.peak_story.last} (down{" "}
                        {payload.player_stats.peak_story.drop} since peak)
                      </dd>
                    </div>
                  )}
                  {payload.player_stats.max_timeout_percent != null &&
                    payload.player_stats.max_timeout_percent > 0.0005 && (
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                        <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                          Worst “lost on time” rate (any time control)
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
                  The worst loss in this period where you were listed as the
                  higher-rated player on the scoresheet — using the ratings stored with
                  each game, not live ratings.
                </p>
                {payload.ego_check.found ? (
                  <>
                    <dl className="mt-5 grid gap-3 font-mono text-xs text-hb-fg/85 sm:grid-cols-2">
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4 sm:col-span-2">
                        <dt className="text-hb-fg/45">The game</dt>
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
                        <dt className="text-hb-fg/45">On-paper rating gap</dt>
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
                        <dt className="text-hb-fg/45">How long the game ran</dt>
                        <dd className="mt-1 text-base text-hb-fg">
                          {payload.ego_check.full_moves}{" "}
                          <span className="text-xs text-hb-fg/50">
                            (each count = you and your opponent each moved once)
                          </span>
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
                      "Nothing that dramatic in this period."}
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
                  Six “highlight reel” lowlights from normal online games in this
                  period. An empty card means nothing dramatic showed up — not a
                  character reference. Pause on a card for how each label is defined
                  (it lifts slightly on hover).
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
                        title={HALL_SLOT_TOOLTIPS[slotKey]}
                        className={`flex min-h-[11rem] cursor-help flex-col rounded-lg border p-4 shadow-sm ring-0 ring-hb-accent/0 transition duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:shadow-md hover:ring-2 hover:ring-hb-accent/25 motion-reduce:transform-none motion-reduce:hover:shadow-sm motion-reduce:hover:ring-0 ${
                          hit
                            ? "border-hb-crimson/25 bg-hb-crimson/[0.06] hover:border-hb-accent/35"
                            : "border-dashed border-hb-fg/12 bg-hb-inset/40 hover:border-hb-fg/22"
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
                                  · {Number(hit.spend_seconds).toFixed(1)}s thinking
                                  on{" "}
                                  <span className="font-mono">
                                    {hit.san ?? "one move"}
                                  </span>
                                </>
                              )}
                              {hit.material_lead != null &&
                                (slotKey === "accidental_pacifist" ||
                                  slotKey === "charity_donor") && (
                                  <>
                                    {" "}
                                    · +{hit.material_lead} pieces ahead when the game
                                    ended
                                  </>
                                )}
                              {hit.full_moves != null &&
                                slotKey !== "mouse_slip" &&
                                slotKey !== "accidental_pacifist" &&
                                slotKey !== "charity_donor" && (
                                  <>
                                    {" "}
                                    · {hit.full_moves} rounds (both sides moved)
                                  </>
                                )}
                              {hit.user_elo != null && (
                                <> · you were listed near {hit.user_elo}</>
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
                              Nothing qualified for this category in this period.
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
                  Rating over time
                </h2>
                <p className="mt-1 font-serif text-sm text-hb-fg/55">
                  Each point is the rating shown before that game started (not the
                  rating after it ended). The table counts how many games fell in each
                  rating band (
                  {payload.rating_journey.coverage_pct}% of games here had a usable
                  rating on file).
                </p>
                <div className="mt-6 w-full min-w-0">
                  <RatingJourneyChart series={payload.rating_journey.series} />
                </div>
                <dl className="mt-6 grid gap-3 font-mono text-xs text-hb-fg/80 sm:grid-cols-3">
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                    <dt className="text-hb-fg/45">Start → end (this period)</dt>
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
                        (change{" "}
                        {payload.rating_journey.delta_r > 0 ? "+" : ""}
                        {payload.rating_journey.delta_r})
                      </span>
                    </dd>
                  </div>
                  <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3 sm:col-span-2">
                    <dt className="text-hb-fg/45">
                      Longest stretch in one rating band
                    </dt>
                    <dd className="mt-1 text-sm text-hb-fg">
                      {payload.rating_journey.longest_band_games} games between{" "}
                      {payload.rating_journey.longest_band_lo} and{" "}
                      {payload.rating_journey.longest_band_lo + 99} (100-point window)
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

            {(() => {
              const qa = payload.quant_appendix;
              const charts = hasQuantCharts(qa);
              const verdict = quantVerdict(qa, payload);
              const circCorrLine =
                charts && qa?.circadian_utc != null
                  ? correlationPairMeaning(qa.circadian_utc)
                  : null;
              return (
                <div className="rounded-[10px] border border-hb-accent/20 bg-hb-panel/80 p-6 shadow-hb-soft sm:p-8">
                  <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                    In case these stats aren&apos;t enough — here&apos;s analysis that
                    proves you suck (statistically)
                  </h2>
                  <p className="mt-1 font-serif text-sm text-hb-fg/55">
                    Lead survival (Kaplan–Meier style), win rate by UTC hour, and a
                    stratified z-score on your slowest last move before a decisive loss
                    — all from the same games as the rest of this report. The sentences
                    under each chart are simple rule-based reads of your numbers (no
                    model calls).
                  </p>

                  {!charts && (
                    <p className="mt-6 font-serif text-sm leading-relaxed text-hb-fg/70">
                      {QUANT_FALLBACK_NO_SMOKING_GUN}
                    </p>
                  )}

                  {charts &&
                    qa?.material_lead_survival != null &&
                    qa.material_lead_survival.curve.length > 0 && (
                      <div className="mt-8 space-y-3">
                        <h3 className="text-sm font-semibold text-hb-fg/85">
                          Holding a ≥+3 material lead
                        </h3>
                        <p className="font-serif text-xs leading-relaxed text-hb-fg/50">
                          {qa.material_lead_survival.definition}
                        </p>
                        <p className="font-serif text-sm leading-relaxed text-hb-fg/65">
                          {SURVIVAL_CURVE_LAYMAN}
                        </p>
                        <div className="w-full min-w-0">
                          <SurvivalStepChart
                            curve={qa.material_lead_survival.curve}
                          />
                        </div>
                        <p className="font-serif text-sm leading-relaxed text-hb-fg/65">
                          {survivalSignificance(qa.material_lead_survival)}
                        </p>
                        <dl className="grid gap-2 font-mono text-xs text-hb-fg/80 sm:grid-cols-3">
                          <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                            <dt className="text-hb-fg/45">Episodes tracked</dt>
                            <dd className="mt-1 tabular-nums text-hb-fg">
                              {qa.material_lead_survival.n_episodes}
                            </dd>
                          </div>
                          <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                            <dt className="text-hb-fg/45">Failures (blew lead / L / D)</dt>
                            <dd className="mt-1 tabular-nums text-hb-fg">
                              {qa.material_lead_survival.n_failures}
                            </dd>
                          </div>
                          <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                            <dt className="text-hb-fg/45">Median time to failure</dt>
                            <dd className="mt-1 tabular-nums text-hb-fg">
                              {qa.material_lead_survival.median_failure_plies != null
                                ? `${qa.material_lead_survival.median_failure_plies.toFixed(1)} plies`
                                : "— (too few failures)"}
                            </dd>
                          </div>
                        </dl>
                      </div>
                    )}

                  {charts && qa?.circadian_utc != null && qa.circadian_utc.bars.length > 0 && (
                    <div className="mt-10 space-y-3">
                      <h3 className="text-sm font-semibold text-hb-fg/85">
                        Win rate vs UTC hour
                      </h3>
                      <p className="font-serif text-xs leading-relaxed text-hb-fg/50">
                        {qa.circadian_utc.timezone_note} Games are binned by the UTC hour
                        when they ended (Chess.com end time when present). Your local
                        timezone is not applied, so treat late-hour effects as UTC-aligned
                        scheduling, not as proof of sleep loss or fatigue.
                      </p>
                      <div className="w-full min-w-0">
                        <CircadianWinChart bars={qa.circadian_utc.bars} />
                      </div>
                      <p className="font-serif text-sm leading-relaxed text-hb-fg/65">
                        {circadianSignificance(qa.circadian_utc)}
                      </p>
                      <dl className="grid gap-2 font-mono text-xs text-hb-fg/80 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                          <dt className="text-hb-fg/45">Games with end time</dt>
                          <dd className="mt-1 tabular-nums text-hb-fg">
                            {qa.circadian_utc.n_games_timed}
                          </dd>
                        </div>
                        <div
                          className="cursor-help rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3 shadow-sm ring-0 ring-hb-accent/0 transition duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:border-hb-accent/35 hover:shadow-md hover:ring-2 hover:ring-hb-accent/25 motion-reduce:transform-none motion-reduce:hover:shadow-sm motion-reduce:hover:ring-0"
                          title={PEARSON_HOUR_WIN_TOOLTIP}
                        >
                          <dt className="text-hb-fg/45">
                            Pearson hour vs win{" "}
                            <span className="text-[10px] font-normal text-hb-fg/35">
                              (hover)
                            </span>
                          </dt>
                          <dd className="mt-1 tabular-nums text-hb-fg">
                            {qa.circadian_utc.pearson_hour_vs_win != null
                              ? qa.circadian_utc.pearson_hour_vs_win.toFixed(3)
                              : "—"}
                          </dd>
                        </div>
                        <div
                          className="cursor-help rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3 shadow-sm ring-0 ring-hb-accent/0 transition duration-200 ease-out will-change-transform hover:-translate-y-0.5 hover:border-hb-accent/35 hover:shadow-md hover:ring-2 hover:ring-hb-accent/25 motion-reduce:transform-none motion-reduce:hover:shadow-sm motion-reduce:hover:ring-0"
                          title={SPEARMAN_HOUR_WIN_TOOLTIP}
                        >
                          <dt className="text-hb-fg/45">
                            Spearman hour vs win{" "}
                            <span className="text-[10px] font-normal text-hb-fg/35">
                              (hover)
                            </span>
                          </dt>
                          <dd className="mt-1 tabular-nums text-hb-fg">
                            {qa.circadian_utc.spearman_hour_vs_win != null
                              ? qa.circadian_utc.spearman_hour_vs_win.toFixed(3)
                              : "—"}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-3">
                          <dt className="text-hb-fg/45">
                            Win % · hours {qa.circadian_utc.late_night_hours_utc.join(", ")}{" "}
                            UTC
                          </dt>
                          <dd className="mt-1 tabular-nums text-hb-fg">
                            {qa.circadian_utc.late_night_win_rate_pct != null
                              ? `${qa.circadian_utc.late_night_win_rate_pct.toFixed(1)}% (${qa.circadian_utc.late_night_games} games)`
                              : "—"}
                          </dd>
                        </div>
                      </dl>
                      {circCorrLine != null && (
                        <p className="font-serif text-sm leading-relaxed text-hb-fg/65">
                          {circCorrLine}
                        </p>
                      )}
                    </div>
                  )}

                  {charts && qa?.terminal_think_z?.worst_terminal_think != null && (
                    <div className="mt-10 space-y-3">
                      <h3 className="text-sm font-semibold text-hb-fg/85">
                        Terminal think z-score (stratified)
                      </h3>
                      <p className="font-serif text-xs leading-relaxed text-hb-fg/50">
                        {qa.terminal_think_z.definition}
                      </p>
                      <p className="font-serif text-sm leading-relaxed text-hb-fg/70">
                        {terminalLayman(qa.terminal_think_z.worst_terminal_think)}
                      </p>
                      <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4 font-mono text-xs text-hb-fg/85">
                        <p>
                          <span className="text-hb-fg/45">Outlier move</span>{" "}
                          <span className="text-hb-accent">
                            {qa.terminal_think_z.worst_terminal_think.san}
                          </span>
                          {qa.terminal_think_z.worst_terminal_think.date_display && (
                            <>
                              {" "}
                              · {qa.terminal_think_z.worst_terminal_think.date_display}
                            </>
                          )}
                          {qa.terminal_think_z.worst_terminal_think.stratum_label && (
                            <>
                              {" "}
                              · {qa.terminal_think_z.worst_terminal_think.stratum_label}
                            </>
                          )}
                        </p>
                        <p className="mt-2">
                          Think time{" "}
                          <span className="tabular-nums text-hb-fg">
                            {qa.terminal_think_z.worst_terminal_think.spend_sec.toFixed(1)}s
                          </span>
                          {qa.terminal_think_z.worst_terminal_think.z_stratified != null && (
                            <>
                              {" "}
                              · z ={" "}
                              <span className="tabular-nums text-hb-crimson">
                                {qa.terminal_think_z.worst_terminal_think.z_stratified.toFixed(2)}
                              </span>{" "}
                              vs your stratum (
                              {qa.terminal_think_z.worst_terminal_think.stratum_mu != null &&
                              qa.terminal_think_z.worst_terminal_think.stratum_sigma != null
                                ? `μ=${qa.terminal_think_z.worst_terminal_think.stratum_mu.toFixed(2)}s, σ=${qa.terminal_think_z.worst_terminal_think.stratum_sigma.toFixed(2)}s`
                                : "—"}
                              )
                            </>
                          )}
                        </p>
                        {qa.terminal_think_z.worst_terminal_think.z_game != null && (
                          <p className="mt-2 text-hb-fg/55">
                            Within-game z on that move:{" "}
                            <span className="tabular-nums text-hb-fg">
                              {qa.terminal_think_z.worst_terminal_think.z_game.toFixed(2)}
                            </span>{" "}
                            (from {qa.terminal_think_z.worst_terminal_think.game_spends_n}{" "}
                            clocked user moves in that game).
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-hb-fg/40">
                          Candidate losses (mate/resign):{" "}
                          {qa.terminal_think_z.n_candidate_games}
                        </p>
                      </div>
                      <p className="font-serif text-sm leading-relaxed text-hb-fg/65">
                        {terminalSignificance(qa.terminal_think_z)}
                      </p>
                    </div>
                  )}

                  <p
                    className={`mt-10 border-t border-hb-fg/10 pt-6 font-serif text-base leading-relaxed ${
                      verdict.kind === "suck"
                        ? "text-hb-crimson"
                        : verdict.kind === "mixed"
                          ? "text-hb-fg/80"
                          : "text-hb-success"
                    }`}
                  >
                    {verdict.line}
                  </p>
                </div>
              );
            })()}

            {(payload.psychometrics || payload.clock_trauma) && (
              <div className="rounded-[10px] border border-hb-fg/10 bg-hb-panel/80 p-6 text-sm text-hb-fg/85 shadow-hb-soft sm:p-8">
                <h2 className="text-lg font-semibold tracking-section text-hb-fg">
                  Habits, time trouble & big moments
                </h2>
                <p className="mt-1 font-serif text-xs text-hb-fg/50">
                  Time pressure, streaks after losses, and a couple of “you really
                  thought about that move” highlights — all from this period only.
                </p>
                <div className="mt-6 grid gap-8 lg:grid-cols-2">
                  {payload.psychometrics && (
                    <div>
                      <h3 className="text-sm font-semibold text-hb-fg/80">
                        Patterns
                      </h3>
                      <dl className="mt-4 grid gap-4 sm:grid-cols-1">
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Moves with under 10% of your clock left
                          </dt>
                          <dd className="mt-1 space-y-2 text-sm leading-relaxed text-hb-fg/90">
                            <p>
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.red_zone.moves_total}
                              </span>{" "}
                              such moves, spread across{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.red_zone.games_with_red}
                              </span>{" "}
                              games.
                            </p>
                            {payload.psychometrics.red_zone.win_rate_pct != null && (
                              <p>
                                You won{" "}
                                <span className="font-mono tabular-nums text-hb-fg">
                                  {payload.psychometrics.red_zone.win_rate_pct.toFixed(
                                    1,
                                  )}
                                  %
                                </span>{" "}
                                of those games.
                              </p>
                            )}
                            {redZoneRoastLine && (
                              <p className="border-t border-hb-fg/10 pt-2 font-serif text-sm italic text-hb-fg/65">
                                {redZoneRoastLine}
                              </p>
                            )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            After a loss, how fast you hit “next game”
                          </dt>
                          <dd className="mt-1 space-y-2 text-sm leading-relaxed text-hb-fg/90">
                            <p>
                              Longest loss streak in one sitting (next game within 10
                              minutes):{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.tilt.max_session_loss_streak}
                              </span>
                            </p>
                            <p>
                              Average time before you started the next game after a
                              loss:{" "}
                              {payload.psychometrics.tilt.avg_queue_sec_after_loss !=
                              null ? (
                                <span className="font-mono tabular-nums text-hb-fg">
                                  {formatSecondsHuman(
                                    payload.psychometrics.tilt
                                      .avg_queue_sec_after_loss,
                                  )}
                                </span>
                              ) : (
                                "—"
                              )}
                              {payload.psychometrics.tilt.loss_to_next_samples > 0 && (
                                <>
                                  {" "}
                                  <span className="text-hb-fg/50">
                                    (from{" "}
                                    <span className="font-mono tabular-nums">
                                      {
                                        payload.psychometrics.tilt
                                          .loss_to_next_samples
                                      }
                                    </span>{" "}
                                    losses)
                                  </span>
                                </>
                              )}
                            </p>
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Opening: steady rhythm vs. chaos
                          </dt>
                          <dd className="mt-1 space-y-2 text-sm leading-relaxed text-hb-fg/90">
                            <p>
                              Typical swing in how long your first five moves take:{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.autopilot.mean_opening5_std_sec !=
                                null
                                  ? `${payload.psychometrics.autopilot.mean_opening5_std_sec.toFixed(2)}s`
                                  : "—"}
                              </span>
                            </p>
                            <p className="text-hb-fg/70">
                              Games with full timing for those moves:{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.autopilot.games_with_full_clk5}
                              </span>
                              . Very fast replies to unusual early lines:{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.autopilot.rare_instant_games}
                              </span>{" "}
                              /{" "}
                              <span className="font-mono tabular-nums text-hb-fg">
                                {payload.psychometrics.autopilot.games_touching_rare}
                              </span>{" "}
                              games.
                            </p>
                          </dd>
                        </div>
                      </dl>
                    </div>
                  )}
                  {payload.clock_trauma && (
                    <div>
                      <h3 className="text-sm font-semibold text-hb-fg/80">
                        Big clock moments
                      </h3>
                      {payload.clock_trauma.overthinker_sec != null &&
                        payload.clock_trauma.overthink_eval_drop != null &&
                        payload.clock_trauma.overthink_eval_drop >= 1.5 &&
                        payload.clock_trauma.overthinker_sec >= 35 && (
                          <div className="mt-4 rounded-lg border border-hb-crimson/25 bg-hb-crimson/[0.08] p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-hb-crimson/90">
                              Expensive thinking
                            </p>
                            <p className="mt-2 font-serif text-sm leading-relaxed text-hb-fg/80">
                              Roughly{" "}
                              <span className="font-mono text-hb-fg">
                                {payload.clock_trauma.overthinker_sec.toFixed(1)}s
                              </span>{" "}
                              on{" "}
                              <span className="font-mono text-hb-fg">
                                {payload.clock_trauma.overthinker_san ?? "one move"}
                              </span>
                              , then the position (where the file had grades) slid about{" "}
                              <span className="font-mono text-hb-fg">
                                {payload.clock_trauma.overthink_eval_drop.toFixed(1)}
                              </span>{" "}
                              pawns the wrong way — marathon think, sprint disaster.
                            </p>
                          </div>
                        )}
                      <dl className="mt-4 grid gap-4 sm:grid-cols-1">
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Longest think on one move
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
                                  Position looked about{" "}
                                  {payload.clock_trauma.overthink_eval_drop.toFixed(
                                    1,
                                  )}{" "}
                                  pawns worse after that move (only when the game
                                  file included engine-style grades)
                                </span>
                              )}
                          </dd>
                        </div>
                        <div className="rounded-lg border border-hb-fg/10 bg-hb-inset/90 p-4">
                          <dt className="text-xs font-medium uppercase tracking-wide text-hb-fg/45">
                            Very fast move, big swing
                          </dt>
                          <dd className="mt-1 font-mono text-hb-fg">
                            {payload.clock_trauma.premove_san ?? "—"}{" "}
                            {payload.clock_trauma.premove_sec != null
                              ? `(${payload.clock_trauma.premove_sec.toFixed(2)}s)`
                              : "(no graded blunders like this in this batch)"}
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
                We group games by the first few moves you played and give each group a
                friendly name when we recognize the line; otherwise you&apos;ll see{" "}
                <span className="text-hb-fg/70">Unmapped five-move line</span> until you
                expand the row for the raw SAN sequence. Hover the colored bar on a
                computer (or tap it on a phone) for win / draw / loss percentages.
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
                This is a <span className="text-hb-fg/70">spatial fingerprint</span> of
                where captures landed across your games in this period — not a skill
                grade. A hot center is expected (that&apos;s where the fight usually
                is). What&apos;s interesting is{" "}
                <span className="text-hb-fg/70">
                  left vs right balance, back-rank vs middlegame blood, and odd hot
                  squares off the e4–d5 core
                </span>{" "}
                that might match openings or habits you repeat.
              </p>
              <ul className="mt-4 space-y-2 font-serif text-sm leading-relaxed text-hb-fg/65">
                {captureHeatmapBullets(
                  payload.spatial_comedy.capture_heatmap,
                ).map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
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
                  Only games that finished on or after{" "}
                  <span className="font-mono text-hb-fg/65">
                    {payload.window.cutoff_utc}
                  </span>{" "}
                  (UTC) are in this rolling window.
                </p>
              )}
              {payload.window?.timeline === "all" && (
                <p className="text-xs text-hb-fg/45">
                  All published games we could open across{" "}
                  <span className="font-mono text-hb-fg/65">
                    {payload.window.months_scanned}
                  </span>{" "}
                  months of archives.
                </p>
              )}
            </footer>
          </section>
        )}
      </div>
    </div>
  );
}
