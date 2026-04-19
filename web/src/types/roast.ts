export type JobStatus = "pending" | "running" | "completed" | "failed";

export interface JobCreate {
  job_id: string;
  status_url: string;
}

/** Live fields from `GET /api/roast/jobs/{id}` while status is pending/running. */
export interface JobProgress {
  stage?: string;
  mode?: string;
  timeline?: string;
  games_parsed?: number;
  months_scanned?: number;
  archive_months_total?: number;
  /** 0–100 when known (single-month and all-time); omitted for rolling timelines. */
  percent?: number;
}

export interface ClockTrauma {
  overthinker_ply: number | null;
  overthinker_san: string | null;
  overthinker_sec: number | null;
  /** Pawns of eval lost on the overthink move (when PGN has %eval). */
  overthink_eval_drop?: number | null;
  premove_ply: number | null;
  premove_san: string | null;
  premove_sec: number | null;
}

/** Summary from Chess.com `pub/player/{username}/stats`. */
export interface PlayerStatsPayload {
  fide_rating: number | null;
  unranked_fide: boolean;
  modes: Record<
    string,
    {
      last_rating: number | null;
      best_rating: number | null;
      peak_drop: number | null;
      timeout_percent: number | null;
      wins?: unknown;
      losses?: unknown;
      draws?: unknown;
    }
  >;
  tactics_highest: number | null;
  max_live_rating: number | null;
  paper_tiger_gap: number | null;
  peak_story: {
    mode: string;
    best: number;
    last: number;
    drop: number;
  } | null;
  max_timeout_percent: number | null;
  /** Chess.com stats `tournament` block when present. */
  tournament?: {
    count: number;
    withdraw: number;
    points: number;
    highest_finish: number | null;
  };
}

export interface RoastWindow {
  timeline: string;
  cutoff_utc: string | null;
  months_scanned: number;
}

export interface SnarkBlock {
  headline: string;
  taglines: string[];
  badges: { id: string; label: string; priority: number }[];
  headline_priority?: number;
}

/** Archive-derived heuristics: red zone, tilt/session, opening HHI, autopilot. */
export interface PsychometricsPayload {
  red_zone: {
    moves_total: number;
    games_with_red: number;
    wins: number;
    losses: number;
    draws: number;
    win_rate_pct: number | null;
    choke_showcase: boolean;
  };
  tilt: {
    max_session_loss_streak: number;
    avg_queue_sec_after_loss: number | null;
    loss_to_next_samples: number;
    rage_queue_showcase: boolean;
  };
  opening_hhi: number | null;
  one_trick_pony: boolean;
  autopilot: {
    mean_opening5_std_sec: number | null;
    games_with_full_clk5: number;
    games_touching_rare: number;
    rare_opp_moves_total: number;
    rare_instant_games: number;
    autopilot_showcase: boolean;
  };
}

/** One of four archive-backed comedy disasters. */
export interface HallOfShameEntry {
  id: string;
  title: string;
  subtitle: string;
  roast: string;
  date_display?: string;
  opponent?: string;
  half_moves?: number;
  full_moves?: number;
  display_move?: number;
  user_elo?: number;
  spend_seconds?: number;
  san?: string;
  /** Piece-value lead (P=1,N=B=3,R=5,Q=9) on terminal position. */
  material_lead?: number;
}

export interface HallOfShamePayload {
  mutual_cowardice: HallOfShameEntry | null;
  stubborn_mule: HallOfShameEntry | null;
  scholars_victim: HallOfShameEntry | null;
  mouse_slip: HallOfShameEntry | null;
  accidental_pacifist: HallOfShameEntry | null;
  charity_donor: HallOfShameEntry | null;
  entries: HallOfShameEntry[];
  snark_lines: string[];
}

/** Worst rated loss to a lower-posted opponent (archive `white`/`black` JSON). */
export interface EgoCheckPayload {
  found: boolean;
  elo_diff?: number;
  full_moves?: number;
  opponent?: string;
  end_time_unix?: number | null;
  date_display?: string;
  user_elo?: number;
  opponent_elo?: number;
  /** You were listed higher and still lost (ego catastrophe). */
  upset_favorite?: boolean;
  snark_lines: string[];
}

/** Archive-derived listed rating trajectory (PGN WhiteElo/BlackElo + end time). */
export interface WorstDailySpiral {
  delta_r: number;
  date_display: string;
  games_that_day: number;
}

export interface RatingJourneyPayload {
  series: { t: number; r: number }[];
  bands: { band_lo: number; games: number }[];
  games_with_rating: number;
  games_total: number;
  coverage_pct: number;
  first_r: number;
  last_r: number;
  delta_r: number;
  longest_band_lo: number;
  longest_band_games: number;
  snark_lines: string[];
  worst_daily_spiral?: WorstDailySpiral | null;
}

/** Cumulative user-move time from [%clk] deltas across the slice. */
export interface ExistentialTollPayload {
  user_clock_spend_sec: number;
  games_with_clk_spend: number;
}

export interface RoastPayload {
  username: string;
  /** Present when a single archive month was requested (API `month` query). */
  archive_month_url?: string;
  /** Present for rolling `timeline` runs. */
  window?: RoastWindow;
  games_parsed: number;
  /** Games dropped (960, bughouse, etc.); not counted in `games_parsed`. */
  skipped_non_traditional_games?: number;
  ego_check?: EgoCheckPayload | null;
  hall_of_shame?: HallOfShamePayload | null;
  rating_journey?: RatingJourneyPayload | null;
  player_stats?: PlayerStatsPayload | null;
  psychometrics?: PsychometricsPayload | null;
  clock_trauma: ClockTrauma | null;
  spatial_comedy: { capture_heatmap: Record<string, number> };
  openings: {
    top_openings: {
      opening: string;
      games: number;
      wins?: number;
      losses?: number;
      draws?: number;
      /** Wins / (wins+losses+draws) among games with a recorded result, % */
      win_rate_pct?: number | null;
    }[];
  };
  /** Aggregated pattern counters (games with queen hang, meme openings, etc.). */
  behavior_stats?: Record<string, number>;
  /** Rule + template narrative from `snark_engine`. */
  snark?: SnarkBlock;
  existential_toll?: ExistentialTollPayload | null;
}

export interface JobState {
  job_id: string;
  status: JobStatus;
  result: RoastPayload | null;
  error: string | null;
  progress?: JobProgress | null;
}
