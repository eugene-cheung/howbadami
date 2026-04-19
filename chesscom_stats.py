"""
Chess.com public player stats (https://api.chess.com/pub/player/{username}/stats).
"""

from __future__ import annotations

import time
from typing import Any, Dict, Optional

import requests

STATS_URL = "https://api.chess.com/pub/player/{username}/stats"
LIVE_MODES = ("chess_blitz", "chess_rapid", "chess_bullet")
TIMEOUT_MODES = ("chess_blitz", "chess_rapid", "chess_bullet", "chess_daily", "chess960_daily")


def _http_get_stats(session: requests.Session, url: str) -> requests.Response:
    delay = 1.2
    last: Optional[Exception] = None
    for _ in range(8):
        try:
            r = session.get(url, timeout=30)
            if r.status_code == 404:
                return r
            if r.status_code in (429, 500, 502, 503):
                time.sleep(min(24.0, delay))
                delay *= 1.65
                continue
            return r
        except requests.RequestException as e:
            last = e
            time.sleep(min(18.0, delay))
            delay *= 1.55
    if last is not None:
        raise last
    raise RuntimeError("stats GET failed")


def fetch_chesscom_player_stats(session: requests.Session, username: str) -> Dict[str, Any]:
    url = STATS_URL.format(username=requests.utils.quote(username, safe=""))
    r = _http_get_stats(session, url)
    if r.status_code == 404:
        return {}
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, dict) else {}


def _rating(blob: Any, key: str) -> Optional[int]:
    if not isinstance(blob, dict):
        return None
    inner = blob.get(key)
    if not isinstance(inner, dict):
        return None
    r = inner.get("rating")
    return int(r) if isinstance(r, (int, float)) else None


def _timeout_pct(record: Any) -> Optional[float]:
    if not isinstance(record, dict):
        return None
    v = record.get("timeout_percent")
    if isinstance(v, (int, float)):
        x = float(v)
        # Chess.com may report either a fraction (0.06) or a percent (6.0).
        if x > 1.0:
            return x / 100.0
        return x
    return None


def normalize_chesscom_stats(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Compact, JSON-serializable summary for roasts + UI."""
    modes_out: Dict[str, Dict[str, Any]] = {}
    max_live: Optional[int] = None
    best_peak_drop = 0
    peak_story: Optional[Dict[str, Any]] = None

    for key in LIVE_MODES:
        m = raw.get(key)
        if not isinstance(m, dict):
            continue
        last_r = _rating(m, "last")
        best_r = _rating(m, "best")
        rec = m.get("record") if isinstance(m.get("record"), dict) else {}
        drop: Optional[int] = None
        if isinstance(best_r, int) and isinstance(last_r, int):
            drop = int(best_r) - int(last_r)
        modes_out[key.replace("chess_", "")] = {
            "last_rating": last_r,
            "best_rating": best_r,
            "peak_drop": drop,
            "timeout_percent": _timeout_pct(rec),
            "wins": rec.get("win"),
            "losses": rec.get("loss"),
            "draws": rec.get("draw"),
        }
        if isinstance(last_r, int):
            max_live = last_r if max_live is None else max(max_live, last_r)
        if drop is not None and drop > best_peak_drop:
            best_peak_drop = drop
            peak_story = {
                "mode": key.replace("chess_", ""),
                "best": best_r,
                "last": last_r,
                "drop": drop,
            }

    max_timeout: Optional[float] = None
    for key in TIMEOUT_MODES:
        m = raw.get(key)
        if not isinstance(m, dict):
            continue
        rec = m.get("record")
        tp = _timeout_pct(rec)
        if tp is not None:
            max_timeout = tp if max_timeout is None else max(max_timeout, tp)

    tactics = raw.get("tactics") if isinstance(raw.get("tactics"), dict) else {}
    tact_hi = _rating(tactics, "highest")

    paper_gap: Optional[int] = None
    if isinstance(tact_hi, int) and isinstance(max_live, int):
        paper_gap = int(tact_hi) - int(max_live)

    fide_raw = raw.get("fide")
    fide_rating: Optional[int] = None
    if isinstance(fide_raw, (int, float)) and int(fide_raw) > 0:
        fide_rating = int(fide_raw)

    tournament_out: Optional[Dict[str, Any]] = None
    tr = raw.get("tournament")
    if isinstance(tr, dict):
        def _i(key: str) -> Optional[int]:
            v = tr.get(key)
            return int(v) if isinstance(v, (int, float)) else None

        tc = _i("count")
        tw = _i("withdraw")
        tp = _i("points")
        thf = _i("highest_finish")
        if any(x is not None for x in (tc, tw, tp, thf)):
            tournament_out = {
                "count": tc if tc is not None and tc >= 0 else 0,
                "withdraw": tw if tw is not None and tw >= 0 else 0,
                "points": tp if tp is not None and tp >= 0 else 0,
                "highest_finish": thf,
            }

    out: Dict[str, Any] = {
        "fide_rating": fide_rating,
        "unranked_fide": fide_rating is None,
        "modes": modes_out,
        "tactics_highest": tact_hi,
        "max_live_rating": max_live,
        "paper_tiger_gap": paper_gap,
        "peak_story": peak_story,
        "max_timeout_percent": max_timeout,
    }
    if tournament_out is not None:
        out["tournament"] = tournament_out
    return out
