import type {
  CircadianUtcPayload,
  MaterialLeadSurvivalPayload,
  QuantAppendixPayload,
  RoastPayload,
  TerminalThinkZPayload,
} from "@/types/roast";

/** Long-form native tooltip for hover (desktop); tap targets can use same title on mobile. */
export const PEARSON_HOUR_WIN_TOOLTIP =
  "Pearson correlation (r) between UTC end hour (0–23) and a binary win flag per game. " +
  "It measures how well a straight line fits: near 0 means hour barely predicts wins; " +
  "negative suggests later hours align with fewer wins. " +
  "This is descriptive only—not causal (we do not know your sleep schedule).";

export const SPEARMAN_HOUR_WIN_TOOLTIP =
  "Spearman correlation uses ranks instead of raw hour, so it still works when the " +
  "relationship is monotonic but not perfectly linear. " +
  "Interpret the sign like Pearson (negative → later hours tend to pair with fewer wins), " +
  "but do not read small values as proof of anything strong.";

export function survivalSignificance(
  m: MaterialLeadSurvivalPayload,
): string {
  const n = m.n_episodes;
  if (n < 3) {
    return "Too few +3-advantage episodes in this sample to draw a strong conclusion.";
  }
  const failRate = m.n_failures / Math.max(1, n);
  if (failRate >= 0.6) {
    return "After you reach a full-piece lead, outcomes in this window skew toward giving the advantage back or not converting—worth reviewing critical games.";
  }
  if (failRate <= 0.35) {
    return "Once you are up a full piece, you usually bank the point or keep the edge through the end in this sample.";
  }
  return "Mixed picture: some clean conversions, some blown leads—typical of online chess over a short horizon.";
}

export function overallWinRatePct(c: CircadianUtcPayload): number | null {
  let w = 0,
    l = 0,
    d = 0;
  for (const b of c.bars) {
    w += b.wins;
    l += b.losses;
    d += b.draws;
  }
  const t = w + l + d;
  if (t <= 0) return null;
  return (100 * w) / t;
}

/** One short read on what the two correlation numbers imply together (rule-based). */
export function correlationPairMeaning(c: CircadianUtcPayload): string | null {
  const p = c.pearson_hour_vs_win;
  const s = c.spearman_hour_vs_win;
  if (p == null && s == null) return null;
  const ap = p != null ? Math.abs(p) : 0;
  const as = s != null ? Math.abs(s) : 0;
  const bothWeak =
    (p == null || ap < 0.06) && (s == null || as < 0.06);
  if (bothWeak) {
    return "What this usually means: both values near zero say UTC end hour is not lining up with wins/losses in a clear way here—clock time isn’t acting like a simple dial for results.";
  }
  const pNeg = p != null && p <= -0.08;
  const sNeg = s != null && s <= -0.08;
  const pPos = p != null && p >= 0.08;
  const sPos = s != null && s >= 0.08;
  if (pNeg || sNeg) {
    return "What this usually means: negative coefficients point toward slightly fewer wins when games finish in later UTC hours on average—still descriptive, not proof you were tired.";
  }
  if (pPos || sPos) {
    return "What this usually means: positive coefficients point toward slightly more wins in later UTC hours in this slice—unusual and still not causal.";
  }
  if (
    s != null &&
    s <= -0.05 &&
    s > -0.12 &&
    (p == null || Math.abs(p) < 0.06)
  ) {
    return "What this usually means: Spearman is a touch more negative than Pearson—think a mild ‘later hours go a bit worse’ shape that doesn’t look like a perfect straight line.";
  }
  return "What this usually means: the signal is small; Pearson (straight-line fit) and Spearman (rank-based) can disagree a bit when the pattern isn’t a perfect line.";
}

/** Shown under the technical survival definition — not the same as “win % from here.” */
export const SURVIVAL_CURVE_LAYMAN =
  "In layman terms: the curve is the estimated share of +3-lead episodes that have not “failed” yet " +
  "(you have not dropped below +1 on the board and have not lost or drawn) at each half-move count after " +
  "the lead first appears. It is not the same thing as your live win rate from the position—wins while still " +
  "clearly ahead count as still surviving through the end.";

export function circadianSignificance(c: CircadianUtcPayload): string {
  if (c.n_games_timed < 15) {
    return "Sample size by hour is thin; hourly win rates and correlations are indicative only.";
  }
  const p = c.pearson_hour_vs_win;
  const s = c.spearman_hour_vs_win;
  const strongNeg =
    (p != null && p <= -0.12) || (s != null && s <= -0.12);
  const weak =
    (p == null || Math.abs(p) < 0.07) &&
    (s == null || Math.abs(s) < 0.07);

  const overall = overallWinRatePct(c);
  const late = c.late_night_win_rate_pct;
  const lateN = c.late_night_games;
  const lateDrag =
    late != null &&
    overall != null &&
    lateN >= 12 &&
    late < overall - 8;

  if (strongNeg || lateDrag) {
    return "There is enough structure here that late-night UTC buckets underperform your overall win rate or line up with a negative hour–win association—worth sanity-checking when you queue.";
  }
  if (weak) {
    return "Hour of day and win/loss are largely unrelated in this slice—no clear circadian penalty in the data.";
  }
  return "Some hourly variation appears, but linear and rank correlations are modest—treat as exploratory, not definitive.";
}

export function terminalLayman(w: TerminalThinkZPayload["worst_terminal_think"]): string {
  const z = w.z_stratified;
  const spend = w.spend_sec;
  const mu = w.stratum_mu;
  const pool = w.stratum_label ?? "this time-control";
  if (z == null || mu == null) {
    return "In layman terms: we compared your last think on these losses to your usual pace in the same time control, but the baseline wasn’t reliable enough for a clean ratio here.";
  }
  const ratio = spend / Math.max(mu, 0.5);
  const useRatioPhrase = z >= 2 || ratio >= 1.35;
  if (useRatioPhrase) {
    return `In layman terms: that last think on your losses was roughly ${ratio.toFixed(1)}× your typical spend in the ${pool} pool compared with how you normally move.`;
  }
  return `In layman terms: on your losses, that last think was a bit longer than your typical spend in the ${pool} pool compared with how you normally move.`;
}

export function terminalSignificance(w: TerminalThinkZPayload): string {
  const z = w.worst_terminal_think.z_stratified;
  if (z == null) return "Stratum z-score unavailable for this highlight.";
  if (z >= 4) return "That terminal think is a large outlier versus your own move-time distribution in the same time control.";
  if (z >= 2.5) return "Meaningfully slower than your usual in that stratum before the game ended—not noise.";
  return "Elevated versus your baseline, but not an extreme tail event.";
}

/** Shown when the backend did not attach charts (thin data) or appendix is missing. */
export const QUANT_FALLBACK_NO_SMOKING_GUN =
  "After all this, we really tried statistical analysis to prove that you do suck, " +
  "but unfortunately for us we were unable to. You might be a decent player.";

export type QuantVerdictKind = "suck" | "dont" | "mixed";

export interface QuantVerdict {
  kind: QuantVerdictKind;
  /** One-line “In conclusion” */
  line: string;
}

export function hasQuantCharts(qa: QuantAppendixPayload | null | undefined): boolean {
  if (!qa) return false;
  const surv =
    qa.material_lead_survival != null &&
    qa.material_lead_survival.curve.length > 0;
  const circ = qa.circadian_utc != null && qa.circadian_utc.bars.length > 0;
  const term = qa.terminal_think_z?.worst_terminal_think != null;
  return surv || circ || term;
}

export function quantVerdict(
  qa: QuantAppendixPayload | null | undefined,
  payload: RoastPayload,
): QuantVerdict {
  if (!hasQuantCharts(qa)) {
    return {
      kind: "dont",
      line: "In conclusion (highly scientific™): You don’t suck on this appendix — we didn’t get enough charts out of your slice to argue otherwise.",
    };
  }

  let bad = 0;
  let good = 0;

  const m = qa!.material_lead_survival;
  if (m && m.n_episodes >= 4) {
    const fr = m.n_failures / m.n_episodes;
    if (fr >= 0.55) bad++;
    if (fr <= 0.32) good++;
  }

  const c = qa!.circadian_utc;
  if (c && c.n_games_timed >= 20) {
    const p = c.pearson_hour_vs_win;
    const s = c.spearman_hour_vs_win;
    if ((p != null && p <= -0.1) || (s != null && s <= -0.1)) bad++;
    const overall = overallWinRatePct(c);
    if (
      c.late_night_win_rate_pct != null &&
      overall != null &&
      c.late_night_games >= 12 &&
      c.late_night_win_rate_pct < overall - 10
    ) {
      bad++;
    }
    if (
      (p == null || Math.abs(p) < 0.055) &&
      (s == null || Math.abs(s) < 0.055) &&
      c.n_games_timed >= 30
    ) {
      good++;
    }
  }

  const t = qa!.terminal_think_z?.worst_terminal_think;
  if (t?.z_stratified != null) {
    if (t.z_stratified >= 3.25) bad++;
    if (t.z_stratified < 1.8) good++;
  }

  const spiral = payload.rating_journey?.worst_daily_spiral?.delta_r;
  if (spiral != null && spiral <= -75) bad++;
  const rz = payload.psychometrics?.red_zone.win_rate_pct;
  if (rz != null && rz < 40 && (payload.psychometrics?.red_zone.moves_total ?? 0) >= 8) {
    bad++;
  }

  if (bad >= 2 && good <= 0) {
    return {
      kind: "suck",
      line: "In conclusion (highly scientific™): You suck — at least on the signals we actually measured here.",
    };
  }
  if (good >= 2 && bad === 0) {
    return {
      kind: "dont",
      line: "In conclusion (highly scientific™): You don’t suck on these metrics—either you’re solid or the data never got spicy enough to indict you.",
    };
  }
  return {
    kind: "mixed",
    line: "In conclusion (highly scientific™): You kind of suck, kind of don’t suck — mixed evidence across the charts above.",
  };
}
