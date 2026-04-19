"""
Rule + template snark layer over a completed roast payload.
Templates live in data/roast_templates.json (strings with {placeholders}).
"""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

_TEMPLATE_PATH = Path(__file__).resolve().parent / "data" / "roast_templates.json"
_bank: Optional[Dict[str, Any]] = None


def _load_bank() -> Dict[str, Any]:
    global _bank
    if _bank is None:
        with open(_TEMPLATE_PATH, encoding="utf-8") as f:
            _bank = json.load(f)
    return _bank


class _SafeDict(dict):
    def __missing__(self, key: str) -> str:
        return "?"


def _fmt(tmpl: str, ctx: Dict[str, Any]) -> str:
    try:
        return tmpl.format_map(_SafeDict(ctx))
    except Exception:
        return tmpl


def _ctx_from_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
    heat = (payload.get("spatial_comedy") or {}).get("capture_heatmap") or {}
    ct = payload.get("clock_trauma") or {}
    beh = payload.get("behavior_stats") or {}
    ps = payload.get("player_stats") or {}
    g = int(payload.get("games_parsed") or 0)
    center = sum(int(heat.get(sq, 0) or 0) for sq in ("d4", "d5", "e4", "e5"))
    pk = ps.get("peak_story") if isinstance(ps.get("peak_story"), dict) else {}
    mtp = ps.get("max_timeout_percent")
    ptg = ps.get("paper_tiger_gap")
    th = ps.get("tactics_highest")
    ml = ps.get("max_live_rating")
    raw_mode = pk.get("mode") if isinstance(pk.get("mode"), str) else "blitz"
    peak_mode_nice = raw_mode.replace("_", " ").strip().title() or "Blitz"
    oed = ct.get("overthink_eval_drop")
    psy = payload.get("psychometrics")
    if not isinstance(psy, dict):
        psy = {}
    rz = psy.get("red_zone") if isinstance(psy.get("red_zone"), dict) else {}
    tilt = psy.get("tilt") if isinstance(psy.get("tilt"), dict) else {}
    ap = psy.get("autopilot") if isinstance(psy.get("autopilot"), dict) else {}
    rz_wr = rz.get("win_rate_pct")
    rz_win_f = float(rz_wr) if isinstance(rz_wr, (int, float)) else 0.0
    ta = tilt.get("avg_queue_sec_after_loss")
    tilt_q = float(ta) if isinstance(ta, (int, float)) else 0.0
    oh = psy.get("opening_hhi")
    hhi_f = float(oh) if isinstance(oh, (int, float)) else 0.0
    mos = ap.get("mean_opening5_std_sec")
    mos_f = float(mos) if isinstance(mos, (int, float)) else 0.0
    tourn = ps.get("tournament") if isinstance(ps.get("tournament"), dict) else {}
    _tc_raw = tourn.get("count")
    tournament_count = (
        int(_tc_raw) if isinstance(_tc_raw, (int, float)) else 0
    )
    if tournament_count < 0:
        tournament_count = 0
    _thf = tourn.get("highest_finish")
    tournament_highest_finish = (
        int(_thf) if isinstance(_thf, (int, float)) else None
    )
    if tournament_count == 1:
        tournament_tries_phrase = "1 try"
    elif tournament_count > 1:
        tournament_tries_phrase = f"{tournament_count} tries"
    else:
        tournament_tries_phrase = ""
    return {
        "games_parsed": g,
        "overthink_seconds": float(ct.get("overthinker_sec") or 0),
        "overthink_san": ct.get("overthinker_san") or "that move",
        "overthink_eval_drop": float(oed) if isinstance(oed, (int, float)) else 0.0,
        "center_total": center,
        "botez_games": int(beh.get("botez_eventful_games") or beh.get("botez_clean_games") or 0),
        "botez_clean_games": int(beh.get("botez_clean_games") or 0),
        "brain_freeze_games": int(beh.get("brain_freeze_games") or 0),
        "spite_checks": int(beh.get("spite_checks") or 0),
        "dirty_flags": int(beh.get("dirty_flags") or 0),
        "french_games": int(beh.get("meme_french_sufferer") or 0),
        "london_games": int(beh.get("meme_london_spam") or 0),
        "bongcloud_games": int(beh.get("meme_bongcloud") or 0),
        "wayward_queen_games": int(beh.get("meme_wayward_queen") or 0),
        "scholars_games": int(beh.get("meme_scholars_pressure") or 0),
        "sicilian_games": int(beh.get("meme_sicilian") or 0),
        "scandi_games": int(beh.get("meme_scandinavian") or 0),
        "peak_drop": int(pk.get("drop") or 0),
        "peak_best": pk.get("best"),
        "peak_last": pk.get("last"),
        "peak_mode": peak_mode_nice,
        "paper_tiger_gap": int(ptg) if isinstance(ptg, (int, float)) else 0,
        "tactics_hi": int(th) if isinstance(th, (int, float)) else 0,
        "max_live_rating": int(ml) if isinstance(ml, (int, float)) else 0,
        "max_timeout_percent": float(mtp) if isinstance(mtp, (int, float)) else None,
        "timeout_pct_display": round(float(mtp) * 100, 2) if isinstance(mtp, (int, float)) else None,
        "unranked_fide": bool(ps.get("unranked_fide")),
        "fide_rating": ps.get("fide_rating"),
        "tournament_count": tournament_count,
        "tournament_highest_finish": tournament_highest_finish,
        "tournament_tries_phrase": tournament_tries_phrase,
        # Psychometrics (see roast_mvp.finalize_psychometrics)
        "rz_moves": int(rz.get("moves_total") or 0),
        "rz_games": int(rz.get("games_with_red") or 0),
        "rz_win_rate": rz_win_f,
        "choke_showcase": bool(rz.get("choke_showcase")),
        "tilt_max_loss_streak": int(tilt.get("max_session_loss_streak") or 0),
        "tilt_avg_queue": tilt_q,
        "rage_queue_showcase": bool(tilt.get("rage_queue_showcase")),
        "opening_hhi": hhi_f,
        "one_trick_pony": bool(psy.get("one_trick_pony")),
        "mean_opening5_std": mos_f,
        "autopilot_showcase": bool(ap.get("autopilot_showcase")),
        "games_full_clk5": int(ap.get("games_with_full_clk5") or 0),
    }


RuleFn = Callable[[Dict[str, Any]], bool]


def _rules() -> List[Tuple[str, int, RuleFn]]:
    """(headline_template, priority, predicate). Higher priority wins headline."""

    def r_overthink(ctx: Dict[str, Any]) -> bool:
        return ctx["overthink_seconds"] >= 75

    def r_eval_plunge(ctx: Dict[str, Any]) -> bool:
        return ctx["overthink_seconds"] >= 50 and ctx["overthink_eval_drop"] >= 2.0

    def r_center(ctx: Dict[str, Any]) -> bool:
        return ctx["center_total"] >= 120 and ctx["games_parsed"] >= 5

    def r_paper_tiger(ctx: Dict[str, Any]) -> bool:
        return (
            ctx["paper_tiger_gap"] >= 200
            and ctx["max_live_rating"] >= 1000
            and ctx["tactics_hi"] >= 1400
        )

    def r_peaked_hs(ctx: Dict[str, Any]) -> bool:
        return (
            ctx["peak_drop"] >= 80
            and ctx["peak_best"] is not None
            and ctx["peak_last"] is not None
        )

    def r_chronic_timeout(ctx: Dict[str, Any]) -> bool:
        m = ctx["max_timeout_percent"]
        return isinstance(m, (int, float)) and float(m) >= 0.04

    def r_fide_who(ctx: Dict[str, Any]) -> bool:
        return ctx["unranked_fide"] and ctx["games_parsed"] >= 20

    def r_brain_freeze(ctx: Dict[str, Any]) -> bool:
        return ctx["brain_freeze_games"] >= 2

    def r_botez(ctx: Dict[str, Any]) -> bool:
        return ctx["botez_games"] >= 1

    def r_spite(ctx: Dict[str, Any]) -> bool:
        return ctx["spite_checks"] >= 3

    def r_dirty(ctx: Dict[str, Any]) -> bool:
        return ctx["dirty_flags"] >= 1

    def r_bong(ctx: Dict[str, Any]) -> bool:
        return ctx["bongcloud_games"] >= 2

    def r_london(ctx: Dict[str, Any]) -> bool:
        return ctx["london_games"] >= 8

    def r_french(ctx: Dict[str, Any]) -> bool:
        return ctx["french_games"] >= 10

    def r_choke_red_zone(ctx: Dict[str, Any]) -> bool:
        return bool(ctx["choke_showcase"]) and ctx["games_parsed"] >= 15

    def r_rage_queue(ctx: Dict[str, Any]) -> bool:
        return bool(ctx["rage_queue_showcase"]) and ctx["games_parsed"] >= 20

    def r_one_trick_hhi(ctx: Dict[str, Any]) -> bool:
        return bool(ctx["one_trick_pony"]) and ctx["games_parsed"] >= 12

    def r_autopilot_opening(ctx: Dict[str, Any]) -> bool:
        return bool(ctx["autopilot_showcase"]) and ctx["games_parsed"] >= 15

    return [
        (
            "Tactics peak at {tactics_hi}, but live chess tops out around {max_live_rating}. "
            "You are a tactical genius in a vacuum; the clock turns it to soup.",
            98,
            r_paper_tiger,
        ),
        (
            "Your {peak_mode} peak was {peak_best}; you're sitting at {peak_last} now. "
            "You've been coasting on the memory of that one good streak for years.",
            97,
            r_peaked_hs,
        ),
        (
            "You played the Bongcloud {bongcloud_games} times. FIDE is drafting a restraining order.",
            96,
            r_bong,
        ),
        (
            "About {timeout_pct_display}% of your decided games end in timeout. "
            "You don't get checkmated — you ghost the board and let the clock file the paperwork.",
            95,
            r_chronic_timeout,
        ),
        (
            "{botez_games} games with queen-hang theater — {botez_clean_games} textbook donations, "
            "the rest are improv. Botez siblings are taking notes.",
            94,
            r_botez,
        ),
        (
            "{brain_freeze_games} games where you burned a minute thinking, then deleted ~3 pawns of eval in one tap. "
            "Main character energy, supporting plot armor.",
            93,
            r_brain_freeze,
        ),
        (
            "FIDE rating: not found. After {games_parsed} games in this slice, the international record still "
            "swipes left on your existence.",
            92,
            r_fide_who,
        ),
        (
            "The London came out {london_games} times. Your f4 bishop pays rent in your head.",
            88,
            r_london,
        ),
        (
            "{spite_checks} spite-checks before you resigned. You lost the game but won the attitude.",
            78,
            r_spite,
        ),
        (
            "{dirty_flags} wins on the clock while structurally bankrupt. The material imbalance sends regards.",
            84,
            r_dirty,
        ),
        (
            "{overthink_eval_drop:.1f} pawns of eval walked off a cliff after {overthink_seconds}s on {overthink_san}. "
            "The think was a documentary; the move was a blooper reel.",
            91,
            r_eval_plunge,
        ),
        (
            "You stared at {overthink_san} for {overthink_seconds}s then did THAT. Ferrari brain, bicycle brakes.",
            72,
            r_overthink,
        ),
        (
            "The center saw {center_total} captures. At this point d4 is a war crime scene with seating.",
            66,
            r_center,
        ),
        (
            "{french_games} French games. The e6 pawn has seen things.",
            58,
            r_french,
        ),
        (
            "You treat the clock like a gentle suggestion until under 10% remains, then panic sets in. "
            "{rz_moves} red-zone moves across {games_parsed} games but only {rz_win_rate:.0f}% wins once you're "
            "living on the increment — the clock is a contract, not a vibe.",
            87,
            r_choke_red_zone,
        ),
        (
            "Your emotional resilience is made of wet paper. Max {tilt_max_loss_streak} losses in one sitting, "
            "and after a loss you queue the next game in about {tilt_avg_queue:.1f}s on average. "
            "Close the tab; the pieces will still be there tomorrow.",
            86,
            r_rage_queue,
        ),
        (
            "Opening concentration (HHI) is about {opening_hhi:.0f} on a 0–10k scale — that's a monopoly, not a "
            "repertoire. Opponents can skip prep and just wait for your homework to end.",
            85,
            r_one_trick_hhi,
        ),
        (
            "First-five move clock std dev averages {mean_opening5_std:.2f}s — basically metronome mode — and you "
            "still snap-reply to weird sidelines. You're not reacting; you're rehearsing muscle memory at strangers.",
            84,
            r_autopilot_opening,
        ),
    ]


def _badges(ctx: Dict[str, Any], bank: Dict[str, Any]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    if ctx["paper_tiger_gap"] >= 200 and ctx["max_live_rating"] >= 1000:
        out.append({"id": "paper_tiger", "label": "Paper Tiger (Puzzles)", "priority": 98})
    if ctx["peak_drop"] >= 80 and ctx["peak_best"] is not None:
        out.append({"id": "peaked_hs", "label": "Peaked in High School", "priority": 97})
    mtp = ctx["max_timeout_percent"]
    if isinstance(mtp, (int, float)) and float(mtp) >= 0.04:
        out.append({"id": "chronic_timeout", "label": "Chronic Timeout Artist", "priority": 95})
    if ctx["bongcloud_games"] >= 1:
        out.append({"id": "bongcloud", "label": "Bongcloud Certified", "priority": 96})
    if ctx["london_games"] >= 5:
        out.append({"id": "london_spam", "label": "London Spammer", "priority": 82})
    if ctx["french_games"] >= 4:
        out.append({"id": "french_main", "label": "French Defense Sufferer", "priority": 60})
    if ctx["sicilian_games"] >= 6:
        out.append({"id": "sicilian_spam", "label": "Sicilian Tourist", "priority": 62})
    if ctx["scandi_games"] >= 4:
        out.append({"id": "scandi_spam", "label": "Scandinavian Enjoyer", "priority": 58})
    if ctx["wayward_queen_games"] >= 3:
        out.append({"id": "wayward_queen", "label": "Wayward Queen Energy", "priority": 70})
    if ctx["scholars_games"] >= 2:
        out.append({"id": "scholars", "label": "Scholar's Mate Lobbyist", "priority": 64})
    if ctx["botez_games"] >= 1:
        out.append({"id": "botez", "label": "Botez Gambit Alumni", "priority": 94})
    if ctx["brain_freeze_games"] >= 1:
        out.append({"id": "brain_freeze", "label": "Brain-Freeze Blunderer", "priority": 93})
    if ctx["unranked_fide"] and ctx["games_parsed"] >= 10:
        out.append({"id": "fide_unknown", "label": "FIDE: Who?", "priority": 91})
    if ctx.get("choke_showcase"):
        out.append({"id": "choke_red", "label": "Red-Zone Choke Artist", "priority": 87})
    if ctx.get("rage_queue_showcase"):
        out.append({"id": "rage_queue", "label": "Rage-Queue Speedrunner", "priority": 86})
    if ctx.get("one_trick_pony"):
        out.append({"id": "one_trick", "label": "One-Trick Opening HHI", "priority": 85})
    if ctx.get("autopilot_showcase"):
        out.append({"id": "autopilot", "label": "Opening Autopilot", "priority": 84})
    if ctx["spite_checks"] >= 2:
        out.append({"id": "spite", "label": "Spite Check Enjoyer", "priority": 74})
    if ctx["dirty_flags"] >= 1:
        out.append({"id": "dirty_flag", "label": "Dirty Flag Connoisseur", "priority": 86})
    out.sort(key=lambda b: -b["priority"])
    return out[:6]


def _taglines(ctx: Dict[str, Any], bank: Dict[str, Any]) -> List[str]:
    t = bank.get("taglines") or {}
    lines: List[str] = []
    if ctx["center_total"] >= 80:
        pool = t.get("center_war") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["overthink_seconds"] >= 45:
        pool = t.get("time_absurd") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["botez_games"] >= 1:
        pool = t.get("botez_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["spite_checks"] >= 1:
        pool = t.get("spite_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["dirty_flags"] >= 1:
        pool = t.get("dirty_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["french_games"] >= 3:
        pool = t.get("french_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["london_games"] >= 4:
        pool = t.get("london_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["bongcloud_games"] >= 1:
        pool = t.get("bongcloud_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["paper_tiger_gap"] >= 150 and ctx["max_live_rating"] >= 900:
        pool = t.get("stats_paper_tiger") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["peak_drop"] >= 60 and ctx["peak_best"] is not None:
        pool = t.get("stats_peak_drop") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    mtp2 = ctx["max_timeout_percent"]
    if isinstance(mtp2, (int, float)) and float(mtp2) >= 0.03:
        pool = t.get("stats_timeout") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["unranked_fide"] and ctx["games_parsed"] >= 15:
        pool = t.get("stats_fide") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    tc = int(ctx.get("tournament_count") or 0)
    thf = ctx.get("tournament_highest_finish")
    if tc > 0 and isinstance(thf, int) and thf >= 1:
        if thf == 1 and ctx.get("tournament_tries_phrase"):
            pool = t.get("stats_tournament_first") or []
            if pool:
                lines.append(_fmt(random.choice(pool), ctx))
        elif thf == 2:
            pool = t.get("stats_tournament_second") or []
            if pool:
                lines.append(_fmt(random.choice(pool), ctx))
        elif thf == 3:
            pool = t.get("stats_tournament_third") or []
            if pool:
                lines.append(_fmt(random.choice(pool), ctx))
        else:
            pool = t.get("stats_tournament_field") or []
            if pool:
                lines.append(_fmt(random.choice(pool), ctx))
    if ctx["brain_freeze_games"] >= 1:
        pool = t.get("brain_freeze_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx["overthink_eval_drop"] >= 1.5 and ctx["overthink_seconds"] >= 40:
        pool = t.get("eval_plunge_arc") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx.get("choke_showcase"):
        pool = t.get("psy_red_zone") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx.get("rage_queue_showcase"):
        pool = t.get("psy_tilt") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx.get("one_trick_pony"):
        pool = t.get("psy_hhi") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    if ctx.get("autopilot_showcase"):
        pool = t.get("psy_autopilot") or []
        if pool:
            lines.append(_fmt(random.choice(pool), ctx))
    return lines[:9]


def build_snark(payload: Dict[str, Any]) -> Dict[str, Any]:
    bank = _load_bank()
    ctx = _ctx_from_payload(payload)
    g = ctx["games_parsed"]

    if g <= 0:
        z = (bank.get("edge_cases") or {}).get("zero_games") or []
        h = random.choice(z) if z else "No games in this slice."
        return {
            "headline": h,
            "taglines": [],
            "badges": [],
            "headline_priority": 999,
        }

    candidates: List[Tuple[int, str]] = []
    for tmpl, pri, pred in _rules():
        if pred(ctx):
            candidates.append((pri, _fmt(tmpl, ctx)))

    fb = bank.get("fallback_headlines") or []
    if candidates:
        headline = max(candidates, key=lambda x: x[0])[1]
        headline_pri = max(candidates, key=lambda x: x[0])[0]
    else:
        headline = random.choice(fb) if fb else "Roast payload loaded. Personality still TBD."
        headline_pri = 10

    badges = _badges(ctx, bank)
    if badges and badges[0]["priority"] > headline_pri:
        # Promote strongest badge copy as headline when it beats rule text.
        b0 = badges[0]
        if b0["id"] == "paper_tiger":
            headline = _fmt(
                "Puzzles at {tactics_hi}, over-the-board ceiling near {max_live_rating}. "
                "Different sport, same username.",
                ctx,
            )
        elif b0["id"] == "peaked_hs":
            headline = _fmt(
                "Your {peak_mode} peak was {peak_best}; you're printing {peak_last} today. "
                "Nostalgia is not a development plan.",
                ctx,
            )
        elif b0["id"] == "chronic_timeout":
            headline = _fmt(
                "Timeout ledger near {timeout_pct_display}% across time controls. "
                "The clock is your co-author and it's mean.",
                ctx,
            )
        elif b0["id"] == "bongcloud":
            headline = _fmt(
                "Bongcloud {bongcloud_games}× in the data. Opening theory called in sick.",
                ctx,
            )
        elif b0["id"] == "london_spam":
            headline = _fmt(
                "London System logged {london_games} times. d4 and Bf4 are your Roman Empire.",
                ctx,
            )
        headline_pri = badges[0]["priority"]

    taglines = _taglines(ctx, bank)
    hs = payload.get("hall_of_shame")
    if isinstance(hs, dict):
        extra_h = hs.get("snark_lines")
        if isinstance(extra_h, list):
            preph = [str(x) for x in extra_h if isinstance(x, str) and x.strip()]
            taglines = preph[:2] + taglines
    ej = payload.get("ego_check")
    if isinstance(ej, dict):
        extra_e = ej.get("snark_lines")
        if isinstance(extra_e, list):
            prepe = [str(x) for x in extra_e if isinstance(x, str) and x.strip()]
            taglines = prepe[:2] + taglines
    rj = payload.get("rating_journey")
    if isinstance(rj, dict):
        extra = rj.get("snark_lines")
        if isinstance(extra, list):
            prep = [str(x) for x in extra if isinstance(x, str) and x.strip()]
            taglines = prep[:2] + taglines
    return {
        "headline": headline,
        "taglines": taglines[:9],
        "badges": badges,
        "headline_priority": headline_pri,
    }


def attach_snark(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Mutates and returns payload for convenience."""
    payload["snark"] = build_snark(payload)
    return payload
