"""
Statistical appendix: Kaplan–Meier-style lead survival, UTC circadian rates,
and stratified / within-game z-scores for terminal thinks.
"""

from __future__ import annotations

import math
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

import chess
import chess.pgn


def _rm():
    import roast_mvp as rm  # noqa: WPS433 — break circular import at load time

    return rm


def user_material_lead(board: chess.Board, user_color: chess.Color) -> int:
    rm = _rm()
    return rm._material_mobility(board, user_color) - rm._material_mobility(
        board, not user_color
    )


def extract_survival_episodes(
    game: chess.pgn.Game, username_lower: str
) -> list[tuple[int, bool]]:
    """
    (duration half-moves after first +3 lead, censored).
    censored True: user won without dropping below +1 after the advantage.
    censored False: dropped below +1 on the board, or game ended loss/draw.
    """
    rm = _rm()
    hdr = dict(game.headers)
    uc, ures = rm._user_color_and_result(hdr, username_lower)
    if uc is None or ures is None:
        return []

    board = game.board()
    node = game
    ply = 0
    in_ep = False
    origin = 0
    out: list[tuple[int, bool]] = []

    while not node.is_end():
        nxt = node.variation(0)
        ply += 1
        board.push(nxt.move)

        lead = user_material_lead(board, uc)
        if not in_ep and lead >= 3:
            in_ep = True
            origin = ply
        elif in_ep:
            g_over = board.is_game_over()
            if lead < 1:
                out.append((ply - origin, False))
                in_ep = False
            elif g_over:
                out.append((ply - origin, ures == 1))
                in_ep = False
        node = nxt

    if in_ep:
        out.append((ply - origin, ures == 1))

    return out


def kaplan_meier(
    observations: list[tuple[int, bool]],
    *,
    max_t_display: int = 120,
) -> tuple[list[dict[str, Any]], Optional[float], int]:
    """
    observations: (time, censored) censored True => no failure at that time.
    Returns (curve_points, median_failure_plies, n_episodes).
    curve: [{t, s, n_at_risk}, ...] step at failure times + t=0.
    """
    n_ep = len(observations)
    if n_ep == 0:
        return [], None, 0

    failures = [t for t, c in observations if not c]
    if not failures:
        mx = max(int(t) for t, _ in observations)
        curve = [
            {"t": 0.0, "s": 1.0, "n_at_risk": float(n_ep)},
            {"t": float(min(mx, max_t_display)), "s": 1.0, "n_at_risk": 0.0},
        ]
        return curve, None, n_ep

    uniq_t = sorted({int(t) for t in failures if t <= max_t_display})
    s = 1.0
    curve_pts: list[dict[str, Any]] = [{"t": 0.0, "s": 1.0, "n_at_risk": float(n_ep)}]

    for t in uniq_t:
        at_risk = sum(1 for tt, _ in observations if int(tt) >= t)
        if at_risk <= 0:
            break
        d = sum(1 for tt, c in observations if int(tt) == t and not c)
        if d <= 0:
            continue
        s *= 1.0 - (d / float(at_risk))
        curve_pts.append({"t": float(t), "s": float(s), "n_at_risk": float(at_risk)})

    median: Optional[float] = None
    if len(curve_pts) >= 2:
        prev_t, prev_s = float(curve_pts[0]["t"]), float(curve_pts[0]["s"])
        for i in range(1, len(curve_pts)):
            t = float(curve_pts[i]["t"])
            sv = float(curve_pts[i]["s"])
            if sv <= 0.5 < prev_s and prev_s > sv:
                median = prev_t + ((prev_s - 0.5) / (prev_s - sv)) * (t - prev_t)
                break
            prev_t, prev_s = t, sv

    return curve_pts, median, n_ep


def pearson_r(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 8 or n != len(ys):
        return None
    mx = statistics.mean(xs)
    my = statistics.mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx < 1e-12 or dy < 1e-12:
        return None
    return float(num / (dx * dy))


def spearman_r(xs: list[float], ys: list[float]) -> Optional[float]:
    n = len(xs)
    if n < 8 or n != len(ys):
        return None

    def ranks(vals: list[float]) -> list[float]:
        indexed = sorted(enumerate(vals), key=lambda iv: iv[1])
        r = [0.0] * n
        i = 0
        while i < n:
            j = i
            while j + 1 < n and indexed[j + 1][1] == indexed[i][1]:
                j += 1
            avg_rank = 1 + (i + j) / 2.0
            for k in range(i, j + 1):
                r[indexed[k][0]] = avg_rank
            i = j + 1
        return r

    rx = ranks(xs)
    ry = ranks(ys)
    return pearson_r(rx, ry)


def tc_bucket(initial_sec: Optional[float]) -> str:
    if initial_sec is None or initial_sec <= 0:
        return "unknown"
    if initial_sec < 180:
        return "bullet"
    if initial_sec < 480:
        return "blitz"
    if initial_sec < 1500:
        return "rapid"
    return "classical"


def _game_end_hour_utc(
    game: chess.pgn.Game, end_ts_from_api: Optional[int]
) -> Optional[int]:
    rm = _rm()
    _st, end_ts = rm.parse_game_start_end_ts(game, end_ts_from_api)
    if end_ts is not None:
        return datetime.fromtimestamp(int(end_ts), tz=timezone.utc).hour
    return None


def _terminal_loss_mate_or_resign(game: chess.pgn.Game) -> bool:
    hdr = dict(game.headers)
    res = (hdr.get("Result") or "*").strip()
    if res not in ("0-1", "1-0"):
        return False
    term = (hdr.get("Termination") or "").lower()
    if "mate" in term or "checkmated" in term:
        return True
    if "resign" in term:
        return True
    return False


@dataclass
class DSAccumulator:
    survival_rows: list[tuple[int, bool]] = field(default_factory=list)
    circadian_w: list[int] = field(default_factory=lambda: [0] * 24)
    circadian_l: list[int] = field(default_factory=lambda: [0] * 24)
    circadian_d: list[int] = field(default_factory=lambda: [0] * 24)
    circ_hours: list[float] = field(default_factory=list)
    circ_win01: list[float] = field(default_factory=list)
    spends_by_bucket: dict[str, list[float]] = field(
        default_factory=lambda: defaultdict(list)
    )
    terminal_candidates: list[dict[str, Any]] = field(default_factory=list)

    def merge_game(
        self, game: chess.pgn.Game, username_lower: str, end_ts: Optional[int]
    ) -> None:
        rm = _rm()
        hdr = dict(game.headers)
        uc, ures = rm._user_color_and_result(hdr, username_lower)
        if uc is None:
            return

        for row in extract_survival_episodes(game, username_lower):
            self.survival_rows.append(row)

        hour = _game_end_hour_utc(game, end_ts)
        if hour is not None and 0 <= hour <= 23 and ures is not None:
            if ures == 1:
                self.circadian_w[hour] += 1
            elif ures == -1:
                self.circadian_l[hour] += 1
            else:
                self.circadian_d[hour] += 1
            self.circ_hours.append(float(hour))
            self.circ_win01.append(1.0 if ures == 1 else 0.0)

        initial = rm.parse_time_control_initial_sec(hdr)
        bucket = tc_bucket(initial)
        clocks = rm._clocks_from_game(game)
        game_user_spends: list[float] = []
        for i in range(1, len(clocks)):
            spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
            if spend <= 0 or spend > 600:
                continue
            ply = clocks[i].ply
            mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
            if mover == uc:
                game_user_spends.append(float(spend))
                self.spends_by_bucket[bucket].append(float(spend))

        if (
            ures == -1
            and _terminal_loss_mate_or_resign(game)
            and len(clocks) >= 2
        ):
            last_user: Optional[tuple[float, int, str]] = None
            for i in range(1, len(clocks)):
                spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
                if spend <= 0 or spend > 600:
                    continue
                ply = clocks[i].ply
                mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
                if mover == uc:
                    last_user = (float(spend), int(ply), clocks[i].san)
            if last_user is not None:
                spend, ply, san = last_user
                dt = rm._utc_dt_from_headers(hdr, "UTCDate", "UTCTime")
                if dt is None:
                    dt = rm._utc_dt_from_headers(hdr, "Date", "UTCTime")
                date_lbl = dt.strftime("%Y-%m-%d") if dt else None
                gspends = [x for x in game_user_spends if x > 0]
                mu_g = statistics.mean(gspends) if gspends else None
                sd_g = (
                    statistics.pstdev(gspends)
                    if len(gspends) >= 2
                    else None
                )
                z_game: Optional[float] = None
                if (
                    mu_g is not None
                    and sd_g is not None
                    and sd_g > 1e-6
                ):
                    z_game = (spend - mu_g) / sd_g
                self.terminal_candidates.append(
                    {
                        "spend_sec": spend,
                        "ply": ply,
                        "san": san,
                        "tc_bucket": bucket,
                        "date_display": date_lbl,
                        "z_game": z_game,
                        "game_spends_n": len(gspends),
                    }
                )


def _bucket_stats(
    spends_by_bucket: dict[str, list[float]],
) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    for b, vals in spends_by_bucket.items():
        if len(vals) < 3:
            continue
        mu = statistics.mean(vals)
        sd = statistics.pstdev(vals) if len(vals) >= 2 else 0.0
        if sd > 1e-6:
            out[b] = {"mu": float(mu), "sigma": float(sd), "n_moves": float(len(vals))}
    pooled = [v for vals in spends_by_bucket.values() for v in vals]
    if len(pooled) >= 10:
        mu = statistics.mean(pooled)
        sd = statistics.pstdev(pooled)
        if sd > 1e-6:
            out["__pooled__"] = {
                "mu": float(mu),
                "sigma": float(sd),
                "n_moves": float(len(pooled)),
            }
    return out


def finalize_ds_payload(acc: DSAccumulator) -> Optional[dict[str, Any]]:
    has_spends = any(bool(v) for v in acc.spends_by_bucket.values())
    if (
        not acc.survival_rows
        and not acc.circ_hours
        and not (acc.terminal_candidates and has_spends)
    ):
        return None

    survival_block: Optional[dict[str, Any]] = None
    if acc.survival_rows:
        curve, median, n_ep = kaplan_meier(acc.survival_rows)
        failures = sum(1 for _, c in acc.survival_rows if not c)
        survival_block = {
            "n_episodes": n_ep,
            "n_failures": failures,
            "median_failure_plies": median,
            "curve": curve,
            "lead_ge": 3,
            "fail_below": 1,
            "definition": (
                "Episodes start the first half-move your piece-value lead is ≥3 "
                "(P=1,N=B=3,R=5,Q=9). Failure is lead <1 on the board or any "
                "loss/draw. Censored is a win while still ≥+1."
            ),
        }

    circ_block: Optional[dict[str, Any]] = None
    if acc.circ_hours:
        bars = []
        for h in range(24):
            w, l, d = acc.circadian_w[h], acc.circadian_l[h], acc.circadian_d[h]
            denom = w + l + d
            wr = (w / denom * 100.0) if denom else None
            bars.append(
                {
                    "hour": h,
                    "wins": w,
                    "losses": l,
                    "draws": d,
                    "games": denom,
                    "win_rate_pct": round(wr, 2) if wr is not None else None,
                }
            )
        pear = pearson_r(acc.circ_hours, acc.circ_win01)
        spear = spearman_r(acc.circ_hours, acc.circ_win01)
        late = list(range(1, 5))
        late_games = sum(
            acc.circadian_w[h] + acc.circadian_l[h] + acc.circadian_d[h] for h in late
        )
        late_w = sum(acc.circadian_w[h] for h in late)
        late_l = sum(acc.circadian_l[h] for h in late)
        late_wr = (late_w / (late_w + late_l) * 100.0) if (late_w + late_l) else None
        circ_block = {
            "timezone_note": "UTC hour of game end (Chess.com end_time when present).",
            "bars": bars,
            "n_games_timed": len(acc.circ_hours),
            "pearson_hour_vs_win": round(pear, 4) if pear is not None else None,
            "spearman_hour_vs_win": round(spear, 4) if spear is not None else None,
            "late_night_hours_utc": late,
            "late_night_games": late_games,
            "late_night_win_rate_pct": round(late_wr, 2) if late_wr is not None else None,
        }

    z_block: Optional[dict[str, Any]] = None
    if acc.terminal_candidates and has_spends:
        bstats = _bucket_stats(acc.spends_by_bucket)
        best: Optional[dict[str, Any]] = None
        best_key = (float("-inf"), float("-inf"))
        for c in acc.terminal_candidates:
            b = str(c.get("tc_bucket") or "unknown")
            st = bstats.get(b) or bstats.get("__pooled__")
            spend = float(c["spend_sec"])
            z_strat: Optional[float] = None
            if st:
                z_strat = (spend - st["mu"]) / st["sigma"]
            zg = c.get("z_game")
            zgv = float(zg) if isinstance(zg, (int, float)) else float("-inf")
            zs = float(z_strat) if z_strat is not None else float("-inf")
            key = (zs, zgv)
            if key > best_key:
                best_key = key
                best = {
                    **c,
                    "z_stratified": round(zs, 3) if zs > float("-inf") else None,
                    "z_game": round(zgv, 3) if zgv > float("-inf") else None,
                    "stratum_mu": st["mu"] if st else None,
                    "stratum_sigma": st["sigma"] if st else None,
                    "stratum_n_moves": int(st["n_moves"]) if st else None,
                    "stratum_label": b if st else None,
                }

        strat_stats_out: dict[str, Any] = {
            k: {"mu": v["mu"], "sigma": v["sigma"], "n_moves": int(v["n_moves"])}
            for k, v in bstats.items()
            if not k.startswith("__")
        }
        if "__pooled__" in bstats:
            strat_stats_out["pooled"] = {
                "mu": bstats["__pooled__"]["mu"],
                "sigma": bstats["__pooled__"]["sigma"],
                "n_moves": int(bstats["__pooled__"]["n_moves"]),
            }

        if best is not None:
            z_block = {
                "definition": (
                    "Among losses ending in mate/resign on the scoresheet, your last "
                    "clocked move’s think time vs stratum (time-control bucket) mean/SD, "
                    "with pooled fallback when a bucket is thin."
                ),
                "stratum_stats": strat_stats_out,
                "worst_terminal_think": best,
                "n_candidate_games": len(acc.terminal_candidates),
            }

    if survival_block is None and circ_block is None and z_block is None:
        return None
    return {
        "material_lead_survival": survival_block,
        "circadian_utc": circ_block,
        "terminal_think_z": z_block,
    }
