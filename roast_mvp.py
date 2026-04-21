"""
Phase 1 MVP: fetch Chess.com archives + monthly PGNs, then compute roast heuristics.

Run:
  python roast_mvp.py --username magnuscarlsen --month 2024/01
  python roast_mvp.py --username magnuscarlsen --timeline 1m
  python roast_mvp.py --username magnuscarlsen --timeline all
"""

from __future__ import annotations

import argparse
import io
import json
import re
import statistics
import sys
import time
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterator, Optional
from urllib.parse import urlparse

import chess
import chess.pgn
import requests

ARCHIVES_URL = "https://api.chess.com/pub/player/{username}/games/archives"
USER_AGENT = "elosurgery-roast/0.1 (contact: local-dev; educational project)"

# Timeline id → rolling window in days (UTC). None = include every published game.
TIMELINE_WINDOWS: list[tuple[str, Optional[int]]] = [
    ("1d", 1),
    ("1w", 7),
    ("1m", 30),
    ("2m", 60),
    ("3m", 90),
    ("4m", 120),
    ("5m", 150),
    ("6m", 180),
    ("7m", 210),
    ("8m", 240),
    ("9m", 270),
    ("10m", 300),
    ("11m", 330),
    ("1y", 365),
    ("all", None),
]
VALID_TIMELINES: tuple[str, ...] = tuple(t for t, _ in TIMELINE_WINDOWS)
_TIMELINE_DAYS: dict[str, Optional[int]] = dict(TIMELINE_WINDOWS)

# Stop parsing after this many standard games (per roast run). Cuts CPU / time on huge archives.
MAX_GAMES_PARSED = 5000

ProgressCallback = Optional[Callable[[Dict[str, Any]], None]]


def _progress_pair(
    on_progress: ProgressCallback,
    *,
    min_interval_s: float = 0.1,
    min_game_delta: int = 25,
) -> tuple[Callable[[Dict[str, Any]], None], Callable[[], None]]:
    """
    Returns (emit, flush). emit merges keys and throttles noisy updates.
    flush sends the latest snapshot immediately (call before returning).
    """
    if on_progress is None:

        def noop_emit(_: Dict[str, Any]) -> None:
            return

        def noop_flush() -> None:
            return

        return noop_emit, noop_flush

    snapshot: Dict[str, Any] = {}
    last_t = 0.0
    last_g = -1

    def emit(update: Dict[str, Any]) -> None:
        nonlocal last_t, last_g
        snapshot.update(update)
        now = time.monotonic()
        g = int(snapshot.get("games_parsed", 0))
        if g - last_g < min_game_delta and now - last_t < min_interval_s:
            return
        last_t = now
        last_g = g
        on_progress(dict(snapshot))

    def flush() -> None:
        if snapshot:
            on_progress(dict(snapshot))

    return emit, flush


@dataclass
class ClockPoint:
    ply: int
    san: str
    remaining_sec: float


@dataclass
class TimeRoast:
    overthinker_ply: int | None
    overthinker_san: str | None
    overthinker_sec: float | None
    """Eval lost on the overthink move (pawns), mover POV; only when PGN has %eval."""
    overthink_eval_drop: float | None
    premove_ply: int | None
    premove_san: str | None
    premove_sec: float | None


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": USER_AGENT})
    return s


def _http_get(session: requests.Session, url: str, *, timeout: int = 60) -> requests.Response:
    """Chess.com-friendly GET with backoff on rate limits / transient errors."""
    delay = 1.2
    last_err: Optional[Exception] = None
    for _ in range(8):
        try:
            r = session.get(url, timeout=timeout)
            if r.status_code == 404:
                return r
            if r.status_code in (429, 500, 502, 503):
                time.sleep(min(24.0, delay))
                delay *= 1.65
                continue
            return r
        except requests.RequestException as e:
            last_err = e
            time.sleep(min(18.0, delay))
            delay *= 1.55
    if last_err is not None:
        raise last_err
    raise RuntimeError("HTTP GET failed")


def _finalize_roast_payload(
    payload: dict[str, Any], beh_total: Counter[str]
) -> dict[str, Any]:
    payload["behavior_stats"] = dict(beh_total)
    from snark_engine import attach_snark  # noqa: WPS433 — runtime hook

    attach_snark(payload)
    return payload


def fetch_archive_urls(session: requests.Session, username: str) -> list[str]:
    url = ARCHIVES_URL.format(username=requests.utils.quote(username, safe=""))
    r = _http_get(session, url, timeout=30)
    if r.status_code == 404:
        raise ValueError(f"No Chess.com player found for username {username!r}.")
    r.raise_for_status()
    data = r.json()
    archives = data.get("archives") or []
    if not isinstance(archives, list):
        return []
    return [u for u in archives if isinstance(u, str)]


def parse_archive_month(url: str) -> tuple[int, int] | None:
    """
    Archive URLs look like:
    https://api.chess.com/pub/player/{user}/games/2024/01
    """
    parts = urlparse(url).path.strip("/").split("/")
    if len(parts) < 2:
        return None
    try:
        y = int(parts[-2])
        m = int(parts[-1])
        return y, m
    except (ValueError, IndexError):
        return None


def pick_month_url(archive_urls: list[str], month: str | None) -> str:
    if not archive_urls:
        raise ValueError("Player has no published monthly archives (brand new account?).")

    if month:
        target = month.strip().replace("-", "/")
        if "/" not in target:
            raise ValueError('Month must look like "2024/01" or "2024-01".')
        for u in archive_urls:
            if u.rstrip("/").endswith(target):
                return u
        raise ValueError(f"No archive found for month {target!r}.")

    # Chess.com returns archives oldest->newest; latest is last.
    return archive_urls[-1]


def iter_month_games(
    session: requests.Session, archive_month_url: str
) -> Iterator[tuple[str, Optional[int], Any, dict[str, Any]]]:
    """Yield (pgn, end_time_unix, rules, raw_game) for each game in a monthly archive JSON."""
    r = _http_get(session, archive_month_url, timeout=60)
    if r.status_code == 404:
        raise ValueError("That monthly archive does not exist (404).")
    r.raise_for_status()
    payload = r.json()
    games = payload.get("games") or []
    if not isinstance(games, list):
        return
    for g in games:
        if not isinstance(g, dict):
            continue
        pgn = g.get("pgn")
        if not isinstance(pgn, str) or not pgn.strip():
            continue
        et_raw = g.get("end_time")
        ts: Optional[int]
        if isinstance(et_raw, (int, float)):
            ts = int(et_raw)
        elif isinstance(et_raw, str) and et_raw.isdigit():
            ts = int(et_raw)
        else:
            ts = None
        yield (pgn.strip(), ts, g.get("rules"), g)


def iter_month_pgns(session: requests.Session, archive_month_url: str) -> Iterator[str]:
    for pgn, _, _, _ in iter_month_games(session, archive_month_url):
        yield pgn


_VARIANT_HEADER_RE = re.compile(r'\[Variant\s+"([^"]*)"\]', re.I)


def _is_traditional_chess(rules_raw: Any, pgn: str) -> bool:
    """
    Chess.com monthly archives include `rules` on each game (e.g. chess960).
    Only standard rule set `chess` is kept; other modes are excluded from roasts.
    """
    if isinstance(rules_raw, str) and rules_raw.strip():
        return rules_raw.strip().lower() == "chess"
    m = _VARIANT_HEADER_RE.search(pgn)
    if not m:
        return True
    v = m.group(1).strip().lower()
    return v in ("", "standard", "standard chess", "normal", "classic")


_PGN_WHITE_USER_RE = re.compile(r'\[White\s+"([^"]*)"\]', re.I)
_PGN_BLACK_USER_RE = re.compile(r'\[Black\s+"([^"]*)"\]', re.I)

_LOSS_RESULTS_JSON = frozenset(
    {
        "checkmated",
        "timeout",
        "resigned",
        "lose",
        "lost",
        "abandoned",
    }
)
_DRAWISH_RESULTS_JSON = frozenset(
    {
        "agreed",
        "repetition",
        "stalemate",
        "insufficient",
        "50move",
        "timevsinsufficient",
        "none",
    }
)


def _username_from_player_blob(side: Any) -> str:
    if not isinstance(side, dict):
        return ""
    u = side.get("username")
    if isinstance(u, str) and u.strip():
        return u.strip().lower()
    for key in ("@id", "id", "url"):
        oid = side.get(key)
        if isinstance(oid, str) and "/player/" in oid:
            tail = oid.rstrip("/").split("/")[-1]
            if tail:
                return tail.lower()
    return ""


def _username_from_pgn_color(pgn: str, *, white: bool) -> str:
    m = _PGN_WHITE_USER_RE.search(pgn) if white else _PGN_BLACK_USER_RE.search(pgn)
    if not m:
        return ""
    return m.group(1).strip().lower()


def _display_name_from_side(side: Any, pgn: str, *, white: bool) -> str:
    if isinstance(side, dict):
        u = side.get("username")
        if isinstance(u, str) and u.strip():
            return u.strip()
        oid = side.get("@id") or side.get("id") or side.get("url")
        if isinstance(oid, str) and "/player/" in oid:
            return oid.rstrip("/").split("/")[-1] or "Unknown"
    m = _PGN_WHITE_USER_RE.search(pgn) if white else _PGN_BLACK_USER_RE.search(pgn)
    if m:
        return m.group(1).strip() or "Unknown"
    return "Unknown"


def _side_rating_json(side: Any) -> Optional[int]:
    if not isinstance(side, dict):
        return None
    r = side.get("rating")
    if isinstance(r, (int, float)):
        x = int(r)
        return x if x > 0 else None
    if isinstance(r, str) and r.strip().lstrip("-").isdigit():
        x = int(r.strip())
        return x if x > 0 else None
    return None


def _count_full_moves_from_pgn(pgn: str) -> int:
    try:
        g = chess.pgn.read_game(io.StringIO(pgn))
    except Exception:
        return 0
    if g is None:
        return 0
    plies = sum(1 for _ in g.mainline_moves())
    return plies // 2


class _EgoAccumulator:
    """Tracks worst rated loss to a lower-listed opponent (archive JSON ratings)."""

    __slots__ = (
        "best_diff",
        "best_moves",
        "opponent",
        "end_ts",
        "user_elo",
        "opp_elo",
    )

    def __init__(self) -> None:
        self.best_diff = -1
        self.best_moves = 10**9
        self.opponent = ""
        self.end_ts = 0
        self.user_elo = 0
        self.opp_elo = 0

    def consider(
        self,
        archive_game: dict[str, Any],
        username_lower: str,
        pgn_text: str,
    ) -> None:
        if archive_game.get("rated") is False:
            return
        w = archive_game.get("white")
        b = archive_game.get("black")
        if not isinstance(w, dict) or not isinstance(b, dict):
            return
        wu = _username_from_player_blob(w) or _username_from_pgn_color(pgn_text, white=True)
        bu = _username_from_player_blob(b) or _username_from_pgn_color(pgn_text, white=False)
        if username_lower == wu:
            user_white = True
        elif username_lower == bu:
            user_white = False
        else:
            return
        user_side = w if user_white else b
        opp_side = b if user_white else w
        res = (user_side.get("result") or "").strip().lower()
        if res == "win" or not res:
            return
        if res in _DRAWISH_RESULTS_JSON:
            return
        if res not in _LOSS_RESULTS_JSON:
            return
        ur = _side_rating_json(user_side)
        orating = _side_rating_json(opp_side)
        if ur is None or orating is None:
            return
        diff = int(ur) - int(orating)
        if diff <= 0:
            return
        moves = _count_full_moves_from_pgn(pgn_text)
        et_raw = archive_game.get("end_time")
        et = int(et_raw) if isinstance(et_raw, (int, float)) else 0
        if et <= 0:
            ts = parse_pgn_utc_timestamp(pgn_text)
            et = int(ts) if ts is not None else 0
        better = diff > self.best_diff or (
            diff == self.best_diff and moves < self.best_moves
        )
        if not better:
            return
        self.best_diff = diff
        self.best_moves = max(0, moves)
        self.opponent = _display_name_from_side(opp_side, pgn_text, white=not user_white)
        self.end_ts = et
        self.user_elo = ur
        self.opp_elo = orating


def _finalize_ego_check(acc: _EgoAccumulator) -> dict[str, Any]:
    if acc.best_diff <= 0:
        return {
            "found": False,
            "snark_lines": [
                "You only lose to people better than you. How incredibly boring."
            ],
        }
    dt = (
        datetime.fromtimestamp(acc.end_ts, tz=timezone.utc)
        if acc.end_ts > 0
        else None
    )
    date_display = dt.strftime("%B %d, %Y") if dt else "some forgotten Tuesday"
    mv = acc.best_moves
    diff = acc.best_diff
    opp = acc.opponent or "Unknown"
    lines: list[str] = [
        f"On {date_display}, you lost to {opp} despite being {diff} points higher on "
        f"the post-game scoresheet — in {mv} moves. You had the paper advantage; they "
        f"had the last word."
    ]
    if mv > 60 and diff > 100:
        lines.append(
            f"You spent 60+ moves slowly being dismantled by someone {diff} points "
            f"below you. You had time to notice. The board noticed first."
        )
    if mv < 15 and diff > 150:
        lines.append(
            f"Under 15 moves, {diff}+ points up on paper — then not up on the board. "
            f"Either your cat touched a piece or the ego wrote checks your tactics "
            f"couldn't cash."
        )
    return {
        "found": True,
        "elo_diff": diff,
        "full_moves": mv,
        "opponent": opp,
        "end_time_unix": acc.end_ts or None,
        "date_display": date_display,
        "user_elo": acc.user_elo,
        "opponent_elo": acc.opp_elo,
        "upset_favorite": True,
        "snark_lines": lines[:4],
    }


def _game_half_move_count(game: chess.pgn.Game) -> int:
    return sum(1 for _ in game.mainline_moves())


def _clocks_from_game(game: chess.pgn.Game) -> list[ClockPoint]:
    """%clk samples aligned to mainline (same construction as analyze_game)."""
    clocks: list[ClockPoint] = []
    board = game.board()
    node = game
    ply = 0
    while not node.is_end():
        nxt = node.variation(0)
        mv = nxt.move
        ply += 1
        san = board.san(mv)
        clk = extract_clk_from_comment(nxt.comment)
        if clk is not None:
            clocks.append(ClockPoint(ply=ply, san=san, remaining_sec=clk))
        board.push(mv)
        node = nxt
    return clocks


def _archive_user_sides(
    raw_g: dict[str, Any], username_lower: str, pgn_text: str
) -> Optional[tuple[bool, dict[str, Any], dict[str, Any]]]:
    w = raw_g.get("white")
    b = raw_g.get("black")
    if not isinstance(w, dict) or not isinstance(b, dict):
        return None
    wu = _username_from_player_blob(w) or _username_from_pgn_color(pgn_text, white=True)
    bu = _username_from_player_blob(b) or _username_from_pgn_color(pgn_text, white=False)
    if username_lower == wu:
        return True, w, b
    if username_lower == bu:
        return False, b, w
    return None


def _disaster_end_display(raw_g: dict[str, Any], game: chess.pgn.Game) -> str:
    et_raw = raw_g.get("end_time")
    if isinstance(et_raw, (int, float)) and int(et_raw) > 0:
        return datetime.fromtimestamp(int(et_raw), tz=timezone.utc).strftime(
            "%B %d, %Y"
        )
    h = dict(game.headers)
    dt = _utc_dt_from_headers(h, "UTCDate", "UTCTime")
    if dt is None:
        dt = _utc_dt_from_headers(h, "Date", "UTCTime")
    return dt.strftime("%B %d, %Y") if dt else "One suspicious calendar day"


def _final_material_lead(game: chess.pgn.Game, user_color: chess.Color) -> int:
    """Piece-value sum (P=1,N=B=3,R=5,Q=9) for user minus opponent on the terminal board."""
    board = game.board()
    node = game
    while not node.is_end():
        nxt = node.variation(0)
        board.push(nxt.move)
        node = nxt
    u = _material_mobility(board, user_color)
    o = _material_mobility(board, not user_color)
    return int(u - o)


def _fastest_user_subsecond_spend(
    game: chess.pgn.Game, user_color: chess.Color
) -> Optional[tuple[float, int, str]]:
    clocks = _clocks_from_game(game)
    if len(clocks) < 2:
        return None
    best: Optional[tuple[float, int, str]] = None
    for i in range(1, len(clocks)):
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend < 0 or spend >= 1.0:
            continue
        ply = clocks[i].ply
        mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
        if mover != user_color:
            continue
        san = clocks[i].san
        cand = (float(spend), int(ply), san)
        if best is None or spend < best[0]:
            best = cand
    return best


class _HallOfShameAccumulator:
    """Six provable comedy disasters per archive slice."""

    __slots__ = ("mutual", "mule", "scholar", "mouse", "pacifist", "charity")

    def __init__(self) -> None:
        self.mutual: Optional[dict[str, Any]] = None
        self.mule: Optional[dict[str, Any]] = None
        self.scholar: Optional[dict[str, Any]] = None
        self.mouse: Optional[dict[str, Any]] = None
        self.pacifist: Optional[dict[str, Any]] = None
        self.charity: Optional[dict[str, Any]] = None

    def consider(
        self,
        raw_g: dict[str, Any],
        username_lower: str,
        game: chess.pgn.Game,
        pgn_text: str,
    ) -> None:
        if not isinstance(raw_g, dict):
            return
        sides = _archive_user_sides(raw_g, username_lower, pgn_text)
        if sides is None:
            return
        user_white, user_side, opp_side = sides
        user_color = chess.WHITE if user_white else chess.BLACK
        half_moves = _game_half_move_count(game)
        full_moves = half_moves // 2
        w = raw_g.get("white")
        b = raw_g.get("black")
        if not isinstance(w, dict) or not isinstance(b, dict):
            return
        wr = (w.get("result") or "").strip().lower()
        br = (b.get("result") or "").strip().lower()
        ur = (user_side.get("result") or "").strip().lower()
        date_lbl = _disaster_end_display(raw_g, game)
        opp_name = _display_name_from_side(opp_side, pgn_text, white=not user_white)

        # 1) Mutual cowardice — agreed draw, suspiciously short.
        if wr == "agreed" and br == "agreed" and half_moves < 30:
            if self.mutual is None or half_moves < int(self.mutual["half_moves"]):
                m_disp = max(1, (half_moves + 1) // 2)
                self.mutual = {
                    "id": "mutual_cowardice",
                    "title": "Mutual cowardice",
                    "subtitle": "Grandmaster draw cosplay",
                    "half_moves": half_moves,
                    "full_moves": full_moves,
                    "display_move": m_disp,
                    "opponent": opp_name,
                    "date_display": date_lbl,
                    "roast": (
                        f"You agreed to a draw around move {m_disp}. What, did you both "
                        f"suddenly realize you left the stove on, or are you just terrified "
                        f"of actually playing chess?"
                    ),
                }

        # 2) Stubborn mule — dragged a lost game to checkmate city.
        if ur == "checkmated" and full_moves > 60:
            if self.mule is None or full_moves > int(self.mule["full_moves"]):
                self.mule = {
                    "id": "stubborn_mule",
                    "title": "Stubborn mule",
                    "subtitle": "The dignity-free defense",
                    "full_moves": full_moves,
                    "half_moves": half_moves,
                    "opponent": opp_name,
                    "date_display": date_lbl,
                    "roast": (
                        f"You got checkmated after {full_moves} full moves. You spent serious "
                        f"time shuffling wood while the position screamed; your opponent "
                        f"assembled a highlight reel. Have some dignity and learn where the "
                        f"'Resign' button lives."
                    ),
                }

        # 3) Scholar's victim — elite player still mated in the opening.
        if ur == "checkmated" and full_moves <= 10:
            elo = _side_rating_json(user_side) or 0
            if elo >= 1800:
                key = (elo, -full_moves, -half_moves)
                prev = self.scholar
                prev_key = None
                if prev is not None:
                    prev_key = (
                        int(prev.get("user_elo") or 0),
                        -int(prev.get("full_moves") or 0),
                        -int(prev.get("half_moves") or 0),
                    )
                if prev is None or key > prev_key:
                    self.scholar = {
                        "id": "scholars_victim",
                        "title": "Scholar's victim",
                        "subtitle": "Fast-food checkmate",
                        "full_moves": full_moves,
                        "half_moves": half_moves,
                        "user_elo": elo,
                        "opponent": opp_name,
                        "date_display": date_lbl,
                        "roast": (
                            f"You got checkmated in {full_moves} full moves at ~{elo} listed. "
                            f"We didn't think that was mathematically on the menu. Did the "
                            f"mouse slip, or did bishops become theoretical?"
                        ),
                    }

        # 5) Accidental pacifist — stalemated while up ≥ rook in value.
        if ur in ("stalemated", "stalemate"):
            try:
                lead = _final_material_lead(game, user_color)
            except Exception:
                lead = 0
            if lead >= 5:
                if self.pacifist is None or lead > int(self.pacifist.get("material_lead") or 0):
                    self.pacifist = {
                        "id": "accidental_pacifist",
                        "title": "Accidental pacifist",
                        "subtitle": "The heartbreaking stalemate",
                        "material_lead": lead,
                        "opponent": opp_name,
                        "date_display": date_lbl,
                        "roast": (
                            f"You were up {lead} points of wood by the usual counting and still "
                            f"stalemated them. You snatched a draw from the jaws of absolute "
                            f"victory. Please learn how to ladder mate."
                        ),
                    }

        # 6) Charity donor — timeout while clearly winning on material.
        if ur == "timeout":
            try:
                lead = _final_material_lead(game, user_color)
            except Exception:
                lead = 0
            if lead >= 3:
                if self.charity is None or lead > int(self.charity.get("material_lead") or 0):
                    self.charity = {
                        "id": "charity_donor",
                        "title": "Charity donor",
                        "subtitle": "Flagging while winning",
                        "material_lead": lead,
                        "opponent": opp_name,
                        "date_display": date_lbl,
                        "roast": (
                            f"You lost on time while up {lead} points of material. You played a "
                            f"convincing game of chess, right up until the clock filed a restraining "
                            f"order. The clock is a piece — learn how to use it."
                        ),
                    }

        # 4) Mouse slip tragedy — sub-second move then resignation loss.
        hdr = dict(game.headers)
        uc, ures = _user_color_and_result(hdr, username_lower)
        term = (hdr.get("Termination") or "").lower()
        if (
            uc is not None
            and ures == -1
            and "resign" in term
            and ur == "resigned"
        ):
            slip = _fastest_user_subsecond_spend(game, uc)
            if slip is not None:
                spend, _ply, san = slip
                if self.mouse is None or spend < float(self.mouse["spend_seconds"]):
                    self.mouse = {
                        "id": "mouse_slip",
                        "title": "Mouse slip tragedy",
                        "subtitle": "Instant regret",
                        "spend_seconds": round(spend, 2),
                        "san": san,
                        "opponent": opp_name,
                        "date_display": date_lbl,
                        "roast": (
                            f"On {date_lbl}, you spent {round(spend, 1)}s on {san}, then "
                            f"the position curdled and you resigned. Your hand moved at "
                            f"LAN speed; your brain filed for overtime."
                        ),
                    }


def _finalize_hall_of_shame(acc: _HallOfShameAccumulator) -> dict[str, Any]:
    order = (
        "mouse_slip",
        "accidental_pacifist",
        "charity_donor",
        "scholars_victim",
        "mutual_cowardice",
        "stubborn_mule",
    )
    by_id = {
        "mouse_slip": acc.mouse,
        "accidental_pacifist": acc.pacifist,
        "charity_donor": acc.charity,
        "scholars_victim": acc.scholar,
        "mutual_cowardice": acc.mutual,
        "stubborn_mule": acc.mule,
    }
    entries: list[dict[str, Any]] = []
    for oid in order:
        row = by_id.get(oid)
        if isinstance(row, dict):
            entries.append(row)
    snark_lines: list[str] = []
    for row in entries:
        r = row.get("roast")
        if isinstance(r, str) and r.strip():
            snark_lines.append(r.strip())
    return {
        "mutual_cowardice": acc.mutual,
        "stubborn_mule": acc.mule,
        "scholars_victim": acc.scholar,
        "mouse_slip": acc.mouse,
        "accidental_pacifist": acc.pacifist,
        "charity_donor": acc.charity,
        "entries": entries,
        "snark_lines": snark_lines[:2],
    }


_PGN_DATE_RE = re.compile(r'\[Date\s+"(\d{4})\.(\d{2})\.(\d{2})"\]')
_PGN_UTCDATE_RE = re.compile(r'\[UTCDate\s+"(\d{4})\.(\d{2})\.(\d{2})"\]')
_PGN_UTCTIME_RE = re.compile(r'\[UTCTime\s+"(\d{2}):(\d{2}):(\d{2})"\]')
_CLK_RE = re.compile(r"\[%clk\s+([^\]]+)\]")
_TIMECONTROL_RE = re.compile(r'\[TimeControl\s+"([^"]+)"\]')
_SESSION_GAP_SEC = 600  # 10 minutes — same session if next start within this of prev end


def _empty_game_psy() -> dict[str, Any]:
    return {
        "valid_for_tilt": False,
        "start_ts": None,
        "end_ts": None,
        "user_result": None,
        "red_zone_moves": 0,
        "had_red_zone": False,
        "opening5_std_sec": None,
        "rare_instamove": False,
        "rare_opp_moves": 0,
    }
_RARE_EARLY_SANS = frozenset(
    {
        "h5",
        "a5",
        "g5",
        "f6",
        "Na6",
        "Nh6",
        "Rh6",
        "a6",
        "h6",
        "Nh3",
        "Na3",
        "f5",
    }
)


def parse_time_control_initial_sec(pgn_or_headers: str | dict[str, str]) -> float | None:
    """
    Starting clock budget (seconds) for live games, from TimeControl first segment.
    Skips daily/correspondence style controls.
    """
    if isinstance(pgn_or_headers, dict):
        tc = (pgn_or_headers.get("TimeControl") or "").strip()
    else:
        m = _TIMECONTROL_RE.search(pgn_or_headers)
        tc = m.group(1).strip() if m else ""
    if not tc or tc == "0":
        return None
    first_seg = tc.split(":")[0]
    if "/" in first_seg and "+" not in first_seg.split("/")[0]:
        return None
    if "/" in first_seg:
        first_seg = first_seg.split("/")[0]
    if "+" in first_seg:
        base, _ = first_seg.split("+", 1)
    else:
        base = first_seg
    try:
        return float(base)
    except ValueError:
        return None


def _utc_dt_from_headers(
    headers: dict[str, str], date_key: str, time_key: str
) -> datetime | None:
    ds = (headers.get(date_key) or "").strip().strip('"')
    ts = (headers.get(time_key) or "").strip().strip('"')
    if not ds:
        return None
    try:
        y, mo, d = (int(x) for x in ds.replace("-", ".").split(".")[:3])
    except ValueError:
        return None
    hh = mm = ss = 0
    if ts:
        parts = ts.replace(":", " ").split()
        try:
            if len(parts) >= 3:
                hh, mm, ss = (int(parts[0]), int(parts[1]), int(parts[2]))
            elif len(parts) == 2:
                hh, mm = int(parts[0]), int(parts[1])
        except (ValueError, IndexError):
            pass
    try:
        return datetime(y, mo, d, hh, mm, ss, tzinfo=timezone.utc)
    except ValueError:
        return None


def parse_game_start_end_ts(
    game: chess.pgn.Game, end_ts_from_api: int | None
) -> tuple[int | None, int | None]:
    """Start/end unix (UTC). Prefer API end_time; start from UTCDate+UTCTime."""
    h = game.headers
    start = _utc_dt_from_headers(h, "UTCDate", "UTCTime")
    if start is None:
        start = _utc_dt_from_headers(h, "Date", "UTCTime")
    end: datetime | None = None
    if end_ts_from_api is not None:
        end = datetime.fromtimestamp(int(end_ts_from_api), tz=timezone.utc)
    if end is None:
        end = _utc_dt_from_headers(h, "UTCDate", "EndTime")
    start_ts = int(start.timestamp()) if start else None
    end_ts = int(end.timestamp()) if end else None
    if start_ts is not None and end_ts is not None and end_ts < start_ts:
        end_ts = start_ts + 60
    return start_ts, end_ts


def _user_color_and_result(
    headers: dict[str, str], username_lower: str
) -> tuple[chess.Color | None, int | None]:
    """(side of user, result: 1 win, 0 draw, -1 loss) or (None, None) if not in game."""
    w = (headers.get("White") or "").lower()
    b = (headers.get("Black") or "").lower()
    if username_lower == w:
        user_white = True
    elif username_lower == b:
        user_white = False
    else:
        return None, None
    res = (headers.get("Result") or "*").strip()
    if res == "1-0":
        return chess.WHITE if user_white else chess.BLACK, 1 if user_white else -1
    if res == "0-1":
        return chess.WHITE if user_white else chess.BLACK, -1 if user_white else 1
    if res in ("1/2-1/2", "½-½"):
        return chess.WHITE if user_white else chess.BLACK, 0
    return chess.WHITE if user_white else chess.BLACK, None


def _parse_header_int_elo(raw: str | None) -> int | None:
    if raw is None:
        return None
    s = str(raw).strip().strip('"')
    if not s or s in ("?", "-"):
        return None
    try:
        x = int(float(s))
    except (ValueError, TypeError):
        return None
    if x <= 0 or x > 4000:
        return None
    return x


def _user_pregame_rating(headers: dict[str, str], username_lower: str) -> int | None:
    """Listed rating before the game (PGN WhiteElo / BlackElo)."""
    w = (headers.get("White") or "").lower()
    b = (headers.get("Black") or "").lower()
    if username_lower == w:
        return _parse_header_int_elo(headers.get("WhiteElo"))
    if username_lower == b:
        return _parse_header_int_elo(headers.get("BlackElo"))
    return None


def _user_move_clock_spend_total(game: chess.pgn.Game, username_lower: str) -> float:
    """Sum of positive [%clk] deltas on the user's moves only (one game)."""
    uc, _ = _user_color_and_result(dict(game.headers), username_lower)
    if uc is None:
        return 0.0
    clocks = _clocks_from_game(game)
    if len(clocks) < 2:
        return 0.0
    total = 0.0
    for i in range(1, len(clocks)):
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend <= 0 or spend > 6 * 3600:
            continue
        ply = clocks[i].ply
        mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
        if mover == uc:
            total += float(spend)
    return total


def _worst_daily_rating_spiral(
    merged: list[tuple[int, int]],
) -> dict[str, Any] | None:
    """Largest negative same-UTC-day drift in listed pre-game rating."""
    if len(merged) < 2:
        return None
    by_day: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for t, r in merged:
        dt = datetime.fromtimestamp(int(t), tz=timezone.utc)
        by_day[dt.strftime("%Y-%m-%d")].append((int(t), int(r)))
    worst_delta = 0
    worst_meta: dict[str, Any] | None = None
    for day, arr in by_day.items():
        arr.sort(key=lambda x: x[0])
        if len(arr) < 2:
            continue
        r0 = arr[0][1]
        r1 = arr[-1][1]
        d = int(r1) - int(r0)
        if d < worst_delta:
            worst_delta = d
            worst_meta = {
                "delta_r": d,
                "date_display": datetime.strptime(day, "%Y-%m-%d")
                .replace(tzinfo=timezone.utc)
                .strftime("%B %d, %Y"),
                "games_that_day": len(arr),
            }
    if worst_meta is None or worst_delta >= 0:
        return None
    return worst_meta


def _append_rating_sample(
    buf: list[tuple[int, int]],
    game: chess.pgn.Game,
    username: str,
    end_ts: int | None,
) -> None:
    if end_ts is None:
        return
    r = _user_pregame_rating(dict(game.headers), username.strip().lower())
    if r is None:
        return
    buf.append((int(end_ts), int(r)))


def _downsample_rating_series(
    pairs: list[tuple[int, int]], max_n: int
) -> list[tuple[int, int]]:
    if len(pairs) <= max_n:
        return pairs
    if max_n < 2:
        return pairs[-1:]
    out: list[tuple[int, int]] = []
    for j in range(max_n):
        idx = round(j * (len(pairs) - 1) / (max_n - 1))
        out.append(pairs[idx])
    # de-dupe consecutive identical points from rounding
    deduped: list[tuple[int, int]] = []
    for p in out:
        if not deduped or deduped[-1] != p:
            deduped.append(p)
    return deduped


def _finalize_rating_journey(
    raw: list[tuple[int, int]],
    games_total: int,
    *,
    max_series: int = 1400,
) -> dict[str, Any] | None:
    """
    Chronological listed rating (pregame header) per archived game with a
    usable end timestamp. Bands are 100-point buckets: 900–999 → band_lo 900.
    """
    if games_total <= 0:
        return None
    pairs = [(t, r) for t, r in raw if isinstance(t, int) and isinstance(r, int)]
    if not pairs:
        return None
    pairs.sort(key=lambda x: x[0])
    merged: list[tuple[int, int]] = []
    for t, r in pairs:
        if merged and merged[-1][0] == t:
            merged[-1] = (t, r)
        else:
            merged.append((t, r))

    bands_ctr: Counter[int] = Counter()
    for _, r in merged:
        lo = (int(r) // 100) * 100
        bands_ctr[lo] += 1

    gw = len(merged)
    longest_lo, longest_n = max(bands_ctr.items(), key=lambda kv: kv[1])
    share = float(longest_n) / float(gw) if gw else 0.0
    first_r = merged[0][1]
    last_r = merged[-1][1]
    delta_r = int(last_r) - int(first_r)

    band_rows = [
        {"band_lo": int(lo), "games": int(n)}
        for lo, n in bands_ctr.most_common(16)
    ]

    series_pairs = _downsample_rating_series(merged, max_series)
    series = [{"t": int(t), "r": int(r)} for t, r in series_pairs]

    band_hi = int(longest_lo) + 99
    snark_lines: list[str] = []
    if gw >= 5:
        if longest_n >= 25 and share >= 0.22:
            snark_lines.append(
                f"You played {longest_n} games while still listed in the "
                f"{longest_lo}–{band_hi} band—that is not a pit stop; that is a lease."
            )
        elif longest_n >= 10:
            snark_lines.append(
                f"{longest_n} games with the {longest_lo}–{band_hi} sticker on your profile "
                f"rating. The Elo stayed cringe so you could grind."
            )
        if delta_r >= 100:
            snark_lines.append(
                f"Listed pre-game rating gained about +{delta_r} from first to last "
                f"game in this slice—statistically a glow-up, emotionally still suspicious."
            )
        elif delta_r <= -100:
            snark_lines.append(
                f"Listed rating slid ~{abs(delta_r)} across the window. The graph is "
                f"not a vibe check; it is a subpoena."
            )
        if len(snark_lines) < 2 and longest_n >= 6:
            pct = round(100.0 * float(longest_n) / float(gw), 1)
            snark_lines.append(
                f"Roughly {pct}% of games with a listed rating here lived in the "
                f"{longest_lo}–{band_hi} bucket—consistency is a coping strategy."
            )

    cov = round(100.0 * float(gw) / float(max(1, games_total)), 1)
    worst_day = _worst_daily_rating_spiral(merged)
    out_rj: dict[str, Any] = {
        "series": series,
        "bands": band_rows,
        "games_with_rating": gw,
        "games_total": int(games_total),
        "coverage_pct": cov,
        "first_r": int(first_r),
        "last_r": int(last_r),
        "delta_r": int(delta_r),
        "longest_band_lo": int(longest_lo),
        "longest_band_games": int(longest_n),
        "snark_lines": snark_lines[:4],
    }
    if worst_day is not None:
        out_rj["worst_daily_spiral"] = worst_day
    return out_rj


def parse_clk_seconds(raw: str) -> float | None:
    raw = raw.strip()
    parts = raw.split(":")
    try:
        if len(parts) == 3:
            h, m, s = parts
            return int(h) * 3600 + int(m) * 60 + float(s)
        if len(parts) == 2:
            m, s = parts
            return int(m) * 60 + float(s)
        return float(parts[0])
    except ValueError:
        return None


def extract_clk_from_comment(comment: str) -> float | None:
    if not comment:
        return None
    m = _CLK_RE.search(comment)
    if not m:
        return None
    return parse_clk_seconds(m.group(1))


_EVAL_RE = re.compile(r"\[%eval\s+([^\]]+)\]")


def extract_eval(comment: str) -> float | None:
    if not comment:
        return None
    m = _EVAL_RE.search(comment)
    if not m:
        return None
    token = m.group(1).strip().split()[0]
    if token.startswith("#"):
        try:
            mate_plies = int(token[1:])
            return 1000.0 if mate_plies > 0 else -1000.0
        except ValueError:
            return None
    try:
        return float(token)
    except ValueError:
        return None


def parse_pgn_utc_timestamp(pgn: str) -> Optional[int]:
    """Best-effort game end timestamp from PGN headers (Chess.com live/chess)."""
    um = _PGN_UTCDATE_RE.search(pgn)
    if um:
        y, mo, d = (int(um.group(i)) for i in range(1, 4))
        tm = _PGN_UTCTIME_RE.search(pgn)
        if tm:
            hh, mm, ss = (int(tm.group(i)) for i in range(1, 4))
            dt = datetime(y, mo, d, hh, mm, ss, tzinfo=timezone.utc)
        else:
            dt = datetime(y, mo, d, 0, 0, 0, tzinfo=timezone.utc)
        return int(dt.timestamp())
    dm = _PGN_DATE_RE.search(pgn)
    if dm:
        y, mo, d = (int(dm.group(i)) for i in range(1, 4))
        dt = datetime(y, mo, d, 0, 0, 0, tzinfo=timezone.utc)
        return int(dt.timestamp())
    return None


def normalize_timeline(timeline: Optional[str]) -> str:
    if timeline is None or not str(timeline).strip():
        return "1m"
    tid = str(timeline).strip().lower()
    if tid in _TIMELINE_DAYS:
        return tid
    raise ValueError(
        f"Unknown timeline {timeline!r}. Expected one of: {', '.join(VALID_TIMELINES)}."
    )


_PIECE_MOBILITY_VALUE: dict[int, int] = {
    chess.PAWN: 1,
    chess.KNIGHT: 3,
    chess.BISHOP: 3,
    chess.ROOK: 5,
    chess.QUEEN: 9,
    chess.KING: 0,
}


def _material_mobility(board: chess.Board, color: chess.Color) -> int:
    s = 0
    for sq in chess.SQUARES:
        p = board.piece_at(sq)
        if p and p.color == color:
            s += _PIECE_MOBILITY_VALUE.get(p.piece_type, 0)
    return s


def _botez_hang_once(
    moves_meta: list[dict[str, Any]], *, clean_only: bool
) -> int:
    """
    Queen to square T (optionally non-capture only if clean_only), opponent takes
    queen on T, victim does not recapture on T next. Greedy scan, one hit per game.
    """
    n = len(moves_meta)
    if n < 3:
        return 0
    i = 0
    while i <= n - 3:
        r0, r1, r2 = moves_meta[i], moves_meta[i + 1], moves_meta[i + 2]
        if r0.get("pt") != chess.QUEEN:
            i += 1
            continue
        if clean_only and r0.get("is_cap"):
            i += 1
            continue
        ok = (
            r1.get("is_cap")
            and r1.get("captured_pt") == chess.QUEEN
            and r1.get("to_sq") == r0.get("to_sq")
            and r1.get("mover") != r0.get("mover")
            and r2.get("mover") == r0.get("mover")
            and not (r2.get("is_cap") and r2.get("to_sq") == r0.get("to_sq"))
        )
        if ok:
            return 1
        i += 1
    return 0


def _botez_clean_game(moves_meta: list[dict[str, Any]]) -> int:
    return _botez_hang_once(moves_meta, clean_only=True)


def _botez_loose_hang_game(moves_meta: list[dict[str, Any]]) -> int:
    """Queen hang pattern allowing queen capture on the first move (trades into doom)."""
    return _botez_hang_once(moves_meta, clean_only=False)


def _evals_after_each_halfmove(game: chess.pgn.Game) -> list[Optional[float]]:
    evs: list[Optional[float]] = [None]
    node = game
    while not node.is_end():
        nxt = node.variation(0)
        evs.append(extract_eval(nxt.comment))
        node = nxt
    return evs


def _brain_freeze_game(game: chess.pgn.Game, clocks: list[ClockPoint]) -> int:
    """Long think on a move that also bombs the eval (≤ −3.0 for the mover)."""
    if len(clocks) < 2:
        return 0
    best_i = 1
    best_spend = -1.0
    for i in range(1, len(clocks)):
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend >= 0 and spend > best_spend:
            best_spend = spend
            best_i = i
    if best_spend < 60:
        return 0
    ply = clocks[best_i].ply
    evs = _evals_after_each_halfmove(game)
    if ply <= 0 or ply >= len(evs):
        return 0
    eb, ea = evs[ply - 1], evs[ply]
    if eb is None or ea is None:
        return 0
    side = chess.WHITE if ply % 2 == 1 else chess.BLACK
    if side == chess.WHITE:
        crash = (ea - eb) <= -3.0
    else:
        crash = (eb - ea) <= -3.0
    return 1 if crash else 0


def _opening_meme_hits(san_plies: list[str]) -> dict[str, int]:
    """Per-game 0/1 flags for meme openings (first ~8 half-moves)."""
    hits: dict[str, int] = {
        "french_sufferer": 0,
        "london_spam": 0,
        "bongcloud": 0,
        "wayward_queen": 0,
        "scholars_pressure": 0,
        "scandinavian": 0,
        "sicilian": 0,
        "italian_game": 0,
        "caro_kann": 0,
        "alekhine": 0,
        "grob": 0,
        "nimzo_larsen": 0,
        "pirc_modern": 0,
    }
    if len(san_plies) < 2:
        return hits
    if san_plies[0] == "e4" and san_plies[1] == "e6":
        hits["french_sufferer"] = 1
    if san_plies[0] == "e4" and san_plies[1] == "d5":
        hits["scandinavian"] = 1
    if san_plies[0] == "e4" and san_plies[1] == "c5":
        hits["sicilian"] = 1
    if san_plies[0] == "e4" and san_plies[1] == "c6":
        hits["caro_kann"] = 1
    if san_plies[0] == "e4" and san_plies[1] == "Nf6":
        hits["alekhine"] = 1
    whites = [san_plies[i] for i in range(0, min(len(san_plies), 8), 2)]
    blacks = [san_plies[i] for i in range(1, min(len(san_plies), 8), 2)]
    if whites and whites[0] == "d4" and any(x == "Bf4" for x in whites[:4]):
        hits["london_spam"] = 1
    if len(san_plies) >= 3 and san_plies[0] == "e4" and san_plies[1] == "e5" and san_plies[2] == "Ke2":
        hits["bongcloud"] = 1
    if (
        len(whites) >= 2
        and whites[0] == "e4"
        and len(blacks) >= 1
        and blacks[0] == "e5"
        and whites[1] == "Bc4"
    ):
        hits["italian_game"] = 1
    for i in range(0, min(6, len(san_plies)), 2):
        s = san_plies[i]
        if s.startswith("Q") and s[:3] in ("Qh5", "Qf3", "Qg4", "Qd2", "Qh4"):
            hits["wayward_queen"] = 1
            break
    if len(whites) >= 2 and "Qh5" in whites and "Bc4" in whites:
        hits["scholars_pressure"] = 1
    if whites and whites[0] == "g4":
        hits["grob"] = 1
    if whites and whites[0] in ("b3", "b4"):
        hits["nimzo_larsen"] = 1
    if len(blacks) >= 2 and "d6" in blacks[:3] and "Nf6" in blacks[:3]:
        hits["pirc_modern"] = 1
    elif len(blacks) >= 2 and any(x in ("g6", "Bg7") for x in blacks[:4]) and "Nf6" in blacks[:3]:
        hits["pirc_modern"] = 1
    return hits


def _spite_check_resignation(game: chess.pgn.Game, last_san: Optional[str]) -> int:
    term = (game.headers.get("Termination") or "").lower()
    res = game.headers.get("Result", "*")
    if res not in ("0-1", "1-0"):
        return 0
    if "resign" not in term:
        return 0
    if not last_san:
        return 0
    return 1 if "+" in last_san and "#" not in last_san else 0


def _build_game_psychometrics(
    game: chess.pgn.Game,
    clocks: list[ClockPoint],
    sans_all: list[str],
    username_lower: str,
    end_ts_from_api: Optional[int],
) -> dict[str, Any]:
    hdr = dict(game.headers)
    uc, ures = _user_color_and_result(hdr, username_lower)
    initial = parse_time_control_initial_sec(hdr)
    start_ts, end_ts = parse_game_start_end_ts(game, end_ts_from_api)

    red_moves = 0
    user_first5_spends: list[float] = []
    rare_instamove = False
    rare_opp_moves = 0

    for i in range(1, len(clocks)):
        ply = clocks[i].ply
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend < 0:
            continue
        mover = chess.WHITE if ply % 2 == 1 else chess.BLACK
        rem = clocks[i].remaining_sec
        if (
            uc is not None
            and initial is not None
            and initial > 0
            and mover == uc
            and rem < 0.1 * initial
        ):
            red_moves += 1
        if uc is not None and mover == uc and len(user_first5_spends) < 5:
            user_first5_spends.append(spend)
        if uc is not None and mover == uc and ply >= 2 and ply <= 12:
            opp_san = sans_all[ply - 2]
            if opp_san in _RARE_EARLY_SANS:
                rare_opp_moves += 1
                if spend < 0.5:
                    rare_instamove = True

    o5std: Optional[float] = None
    if len(user_first5_spends) == 5:
        o5std = float(statistics.pstdev(user_first5_spends))

    had_red = red_moves > 0
    valid_tilt = (
        start_ts is not None
        and end_ts is not None
        and ures is not None
        and start_ts <= end_ts
    )

    return {
        "valid_for_tilt": valid_tilt,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "user_result": ures,
        "red_zone_moves": red_moves,
        "had_red_zone": had_red,
        "opening5_std_sec": o5std,
        "rare_instamove": rare_instamove,
        "rare_opp_moves": rare_opp_moves,
    }


def _opening_agg_bump(
    agg: dict[str, dict[str, int]], key: str, user_result: Optional[int]
) -> None:
    b = agg.setdefault(key, {"n": 0, "w": 0, "l": 0, "d": 0})
    b["n"] += 1
    if user_result == 1:
        b["w"] += 1
    elif user_result == -1:
        b["l"] += 1
    elif user_result == 0:
        b["d"] += 1


def _opening_counts_for_hhi(agg: dict[str, dict[str, int]]) -> Counter[str]:
    return Counter({k: v["n"] for k, v in agg.items()})


def _top_openings_payload(
    agg: dict[str, dict[str, int]], limit: int = 15
) -> list[dict[str, Any]]:
    items = sorted(agg.items(), key=lambda kv: -kv[1]["n"])[:limit]
    out: list[dict[str, Any]] = []
    for k, r in items:
        decided = r["w"] + r["l"] + r["d"]
        wr: Optional[float] = None
        if decided > 0:
            wr = round(100.0 * r["w"] / decided, 2)
        out.append(
            {
                "opening": k,
                "games": r["n"],
                "wins": r["w"],
                "losses": r["l"],
                "draws": r["d"],
                "win_rate_pct": wr,
            }
        )
    return out


def finalize_psychometrics(
    game_psies: list[dict[str, Any]],
    openings: Counter[str],
    games_parsed: int,
) -> dict[str, Any]:
    """Aggregate red-zone, tilt/session, HHI, and opening-clock variance."""
    rz_moves = sum(int(r.get("red_zone_moves") or 0) for r in game_psies)
    rz_w = rz_l = rz_d = 0
    rz_games = 0
    for r in game_psies:
        if not r.get("had_red_zone"):
            continue
        ur = r.get("user_result")
        if ur is None:
            continue
        rz_games += 1
        if ur == 1:
            rz_w += 1
        elif ur == -1:
            rz_l += 1
        else:
            rz_d += 1
    rz_decided = rz_w + rz_l + rz_d
    win_rate_pct: Optional[float] = None
    if rz_decided > 0:
        win_rate_pct = round(100.0 * rz_w / rz_decided, 2)

    rows = [r for r in game_psies if r.get("valid_for_tilt")]
    rows.sort(key=lambda r: (int(r["start_ts"]), int(r["end_ts"])))

    max_session_loss_streak = 0
    if rows:
        sessions: list[list[dict[str, Any]]] = []
        cur: list[dict[str, Any]] = []
        for g in rows:
            if not cur:
                cur = [g]
            elif int(g["start_ts"]) - int(cur[-1]["end_ts"]) <= _SESSION_GAP_SEC:
                cur.append(g)
            else:
                sessions.append(cur)
                cur = [g]
        if cur:
            sessions.append(cur)
        for sess in sessions:
            streak = 0
            for g in sess:
                if g.get("user_result") == -1:
                    streak += 1
                    max_session_loss_streak = max(max_session_loss_streak, streak)
                else:
                    streak = 0

    loss_queue_gaps: list[float] = []
    for i in range(len(rows) - 1):
        if rows[i].get("user_result") == -1:
            gap = int(rows[i + 1]["start_ts"]) - int(rows[i]["end_ts"])
            if -120 <= gap <= 7200:
                loss_queue_gaps.append(max(0.0, float(gap)))

    avg_queue_after_loss: Optional[float] = None
    if loss_queue_gaps:
        avg_queue_after_loss = round(
            sum(loss_queue_gaps) / len(loss_queue_gaps), 2
        )

    rage_queue = (
        avg_queue_after_loss is not None
        and avg_queue_after_loss < 5.0
        and max_session_loss_streak >= 4
        and len(loss_queue_gaps) >= 6
    )

    t_open = sum(openings.values())
    hhi: Optional[float] = None
    if t_open >= 5:
        hhi = round(10000.0 * sum((c / t_open) ** 2 for c in openings.values()), 2)

    one_trick_pony = bool(hhi is not None and hhi > 2500.0 and games_parsed >= 12)

    stds = [
        float(r["opening5_std_sec"])
        for r in game_psies
        if isinstance(r.get("opening5_std_sec"), (int, float))
    ]
    mean_opening_std: Optional[float] = None
    if stds:
        mean_opening_std = round(sum(stds) / len(stds), 3)

    rare_opp_total = sum(int(r.get("rare_opp_moves") or 0) for r in game_psies)
    rare_instant_games = sum(1 for r in game_psies if r.get("rare_instamove"))
    games_touching_rare = sum(
        1 for r in game_psies if int(r.get("rare_opp_moves") or 0) > 0
    )

    autopilot_showcase = bool(
        mean_opening_std is not None
        and mean_opening_std < 0.38
        and len(stds) >= 10
        and games_touching_rare >= 4
        and rare_instant_games >= 3
    )

    choke_showcase = bool(
        rz_moves >= 35
        and rz_games >= 10
        and win_rate_pct is not None
        and win_rate_pct < 30.0
    )

    return {
        "red_zone": {
            "moves_total": rz_moves,
            "games_with_red": rz_games,
            "wins": rz_w,
            "losses": rz_l,
            "draws": rz_d,
            "win_rate_pct": win_rate_pct,
            "choke_showcase": choke_showcase,
        },
        "tilt": {
            "max_session_loss_streak": max_session_loss_streak,
            "avg_queue_sec_after_loss": avg_queue_after_loss,
            "loss_to_next_samples": len(loss_queue_gaps),
            "rage_queue_showcase": rage_queue,
        },
        "opening_hhi": hhi,
        "one_trick_pony": one_trick_pony,
        "autopilot": {
            "mean_opening5_std_sec": mean_opening_std,
            "games_with_full_clk5": len(stds),
            "games_touching_rare": games_touching_rare,
            "rare_opp_moves_total": rare_opp_total,
            "rare_instant_games": rare_instant_games,
            "autopilot_showcase": autopilot_showcase,
        },
    }


def _dirty_flag_time_win(game: chess.pgn.Game, board: chess.Board) -> int:
    term = (game.headers.get("Termination") or "").lower()
    res = game.headers.get("Result", "*")
    is_time_forfeit = "time forfeit" in term or (
        "time" in term and "forfeit" in term
    )
    if not is_time_forfeit:
        return 0
    w = _material_mobility(board, chess.WHITE)
    b = _material_mobility(board, chess.BLACK)
    if res == "0-1":
        if b < w - 5:
            return 1
    elif res == "1-0":
        if w < b - 5:
            return 1
    return 0


def analyze_game(
    game: chess.pgn.Game,
    *,
    end_ts: Optional[int] = None,
    username: str = "",
) -> tuple[TimeRoast | None, Counter[str], str | None, dict[str, int], dict[str, Any]]:
    """
    Returns:
      - time highlights for this game
      - per-square capture counts
      - opening key (first 5 plies) or None
      - behavior counters (this game's contribution)
      - per-game psychometrics row (merged in build_roast)
    """
    board = game.board()
    heat: Counter[str] = Counter()
    clocks: list[ClockPoint] = []
    san_upto8: list[str] = []
    sans_all: list[str] = []
    moves_meta: list[dict[str, Any]] = []
    node = game
    ply = 0
    while not node.is_end():
        nxt = node.variation(0)
        mv = nxt.move
        ply += 1
        mover = board.turn
        piece = board.piece_at(mv.from_square)
        is_cap = board.is_capture(mv)
        captured = board.piece_at(mv.to_square) if is_cap and not board.is_en_passant(mv) else None
        san = board.san(mv)
        clk = extract_clk_from_comment(nxt.comment)
        if clk is not None:
            clocks.append(ClockPoint(ply=ply, san=san, remaining_sec=clk))
        if board.is_capture(mv):
            heat[chess.square_name(mv.to_square)] += 1
        pt = piece.piece_type if piece else None
        moves_meta.append(
            {
                "san": san,
                "mover": mover,
                "pt": pt,
                "to_sq": mv.to_square,
                "from_sq": mv.from_square,
                "is_cap": is_cap,
                "captured_pt": captured.piece_type if captured else None,
            }
        )
        board.push(mv)
        sans_all.append(san)
        if len(san_upto8) < 8:
            san_upto8.append(san)
        node = nxt

    opening_key: Optional[str]
    if len(san_upto8) >= 5:
        opening_key = " ".join(san_upto8[:5])
    else:
        opening_key = None

    time_roast = time_highlights_from_clocks(game, clocks)

    b_clean = _botez_clean_game(moves_meta)
    b_loose = _botez_loose_hang_game(moves_meta)
    beh: dict[str, int] = {
        "botez_clean_games": b_clean,
        "botez_loose_hang_games": 1 if (b_loose and not b_clean) else 0,
        "botez_eventful_games": 1 if (b_clean or b_loose) else 0,
        "brain_freeze_games": _brain_freeze_game(game, clocks),
        "spite_checks": _spite_check_resignation(game, moves_meta[-1]["san"] if moves_meta else None),
        "dirty_flags": _dirty_flag_time_win(game, board),
    }
    for k, v in _opening_meme_hits(san_upto8).items():
        beh[f"meme_{k}"] = v

    game_psy = _build_game_psychometrics(
        game, clocks, sans_all, username.strip().lower(), end_ts
    )

    return time_roast, heat, opening_key, beh, game_psy


def time_highlights_from_clocks(game: chess.pgn.Game, clocks: list[ClockPoint]) -> TimeRoast | None:
    if len(clocks) < 2:
        return None

    max_spend = -1.0
    max_idx: int | None = None
    min_spend_before_bad: float | None = None
    min_idx: int | None = None

    for i in range(1, len(clocks)):
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend < 0:
            # Clock added time or missing data; ignore weird segments.
            continue
        if spend > max_spend:
            max_spend = spend
            max_idx = i

    board = game.board()
    node = game
    evals: list[float | None] = [None]
    ply = 0
    while not node.is_end():
        nxt = node.variation(0)
        ply += 1
        ev = extract_eval(nxt.comment)
        evals.append(ev)
        board.push(nxt.move)
        node = nxt

    for i in range(1, len(clocks)):
        ply = clocks[i].ply
        spend = clocks[i - 1].remaining_sec - clocks[i].remaining_sec
        if spend < 0:
            continue
        ev_before = evals[ply - 1] if ply - 1 < len(evals) else None
        ev_after = evals[ply] if ply < len(evals) else None
        side = chess.WHITE if ply % 2 == 1 else chess.BLACK
        bad = False
        if ev_before is not None and ev_after is not None:
            if side == chess.WHITE:
                bad = (ev_after - ev_before) <= -2.0
            else:
                bad = (ev_before - ev_after) <= -2.0
        if bad:
            if min_spend_before_bad is None or spend < min_spend_before_bad:
                min_spend_before_bad = spend
                min_idx = i

    if max_idx is None:
        return None

    over = clocks[max_idx]
    over_eval_drop: float | None = None
    oply = over.ply
    if 0 < oply < len(evals):
        ev_before = evals[oply - 1]
        ev_after = evals[oply]
        if ev_before is not None and ev_after is not None:
            side = chess.WHITE if oply % 2 == 1 else chess.BLACK
            if side == chess.WHITE:
                delta = ev_before - ev_after
            else:
                delta = ev_after - ev_before
            if delta > 0:
                over_eval_drop = float(delta)

    premove_ply = premove_san = None
    premove_sec = None
    if min_idx is not None:
        prem = clocks[min_idx]
        premove_ply, premove_san, premove_sec = prem.ply, prem.san, min_spend_before_bad

    return TimeRoast(
        overthinker_ply=over.ply,
        overthinker_san=over.san,
        overthinker_sec=float(round(max_spend, 3)),
        overthink_eval_drop=over_eval_drop,
        premove_ply=premove_ply,
        premove_san=premove_san,
        premove_sec=float(premove_sec) if premove_sec is not None else None,
    )


def merge_time(a: TimeRoast | None, b: TimeRoast | None) -> TimeRoast | None:
    if a is None:
        return b
    if b is None:
        return a
    a_over = a.overthinker_sec or -1.0
    b_over = b.overthinker_sec or -1.0
    over = a if a_over >= b_over else b

    a_pre = a.premove_sec
    b_pre = b.premove_sec
    if a_pre is None:
        pre = b
    elif b_pre is None:
        pre = a
    else:
        pre = a if a_pre <= b_pre else b

    return TimeRoast(
        overthinker_ply=over.overthinker_ply,
        overthinker_san=over.overthinker_san,
        overthinker_sec=over.overthinker_sec,
        overthink_eval_drop=over.overthink_eval_drop,
        premove_ply=pre.premove_ply,
        premove_san=pre.premove_san,
        premove_sec=pre.premove_sec,
    )


def build_roast(
    username: str,
    month: Optional[str] = None,
    timeline: Optional[str] = None,
    on_progress: ProgressCallback = None,
) -> dict[str, Any]:
    from roast_cache import cache_get, cache_set, roast_cache_key

    m_key = (month or "").strip() or None
    t_key = (timeline or "").strip() or "1m"
    cache_key = roast_cache_key(username, m_key, t_key)
    cached = cache_get(cache_key)
    if cached is not None:
        data = json.loads(cached)
        sess = _session()
        from chesscom_stats import (  # noqa: WPS433
            fetch_chesscom_player_stats,
            normalize_chesscom_stats,
        )
        from snark_engine import attach_snark  # noqa: WPS433

        data["player_stats"] = normalize_chesscom_stats(
            fetch_chesscom_player_stats(sess, username)
        )
        attach_snark(data)
        return data

    session = _session()
    urls = fetch_archive_urls(session, username)
    if not urls:
        raise ValueError("Player has no published monthly archives (brand new account?).")

    from chesscom_stats import (  # noqa: WPS433
        fetch_chesscom_player_stats,
        normalize_chesscom_stats,
    )

    stats_raw = fetch_chesscom_player_stats(session, username)
    player_stats = normalize_chesscom_stats(stats_raw)

    emit, flush = _progress_pair(on_progress)
    n_archives = len(urls)
    heat_total: Counter[str] = Counter()
    opening_agg: dict[str, dict[str, int]] = {}
    beh_total: Counter[str] = Counter()
    games_seen = 0
    merged_time: Optional[TimeRoast] = None
    psy_rows: list[dict[str, Any]] = []
    rating_raw: list[tuple[int, int]] = []
    skipped_non_traditional = 0
    ego_acc = _EgoAccumulator()
    shame_acc = _HallOfShameAccumulator()
    existential_clock_sec = 0.0
    existential_games_with_clk = 0
    from roast_ds import DSAccumulator, finalize_ds_payload  # noqa: WPS433

    ds_acc = DSAccumulator()

    if month is not None and str(month).strip():
        month_url = pick_month_url(urls, month)
        batch = list(iter_month_games(session, month_url))
        total_g = max(1, len(batch))
        emit(
            {
                "stage": "parsing",
                "mode": "single_month",
                "games_parsed": 0,
                "months_scanned": 1,
                "archive_months_total": 1,
                "percent": 0.0,
            }
        )
        row_i = 0
        for pgn_text, _et, rules, raw_g in batch:
            if games_seen >= MAX_GAMES_PARSED:
                break
            row_i += 1
            if not _is_traditional_chess(rules, pgn_text):
                skipped_non_traditional += 1
                emit(
                    {
                        "games_parsed": games_seen,
                        "months_scanned": 1,
                        "archive_months_total": 1,
                        "mode": "single_month",
                        "stage": "parsing",
                        "percent": min(99.0, 100.0 * row_i / total_g),
                    }
                )
                continue
            if isinstance(raw_g, dict):
                ego_acc.consider(raw_g, username.strip().lower(), pgn_text)
            games_seen += 1
            game = chess.pgn.read_game(io.StringIO(pgn_text))
            if game is None:
                psy_rows.append(_empty_game_psy())
                emit(
                    {
                        "games_parsed": games_seen,
                        "months_scanned": 1,
                        "archive_months_total": 1,
                        "mode": "single_month",
                        "stage": "parsing",
                        "percent": min(99.0, 100.0 * row_i / total_g),
                    }
                )
                continue
            end_eff = (
                _et if _et is not None else parse_pgn_utc_timestamp(pgn_text)
            )
            if isinstance(raw_g, dict):
                shame_acc.consider(raw_g, username.strip().lower(), game, pgn_text)
            t, h, op, beh, gpsy = analyze_game(
                game, end_ts=end_eff, username=username
            )
            psy_rows.append(gpsy)
            _append_rating_sample(rating_raw, game, username, end_eff)
            merged_time = merge_time(merged_time, t)
            uclk = _user_move_clock_spend_total(game, username.strip().lower())
            if uclk > 0:
                existential_games_with_clk += 1
            existential_clock_sec += uclk
            heat_total.update(h)
            beh_total.update(beh)
            if op:
                _opening_agg_bump(opening_agg, op, gpsy.get("user_result"))
            ds_acc.merge_game(game, username.strip().lower(), end_eff)
            emit(
                {
                    "games_parsed": games_seen,
                    "months_scanned": 1,
                    "archive_months_total": 1,
                    "mode": "single_month",
                    "stage": "parsing",
                    "percent": min(99.0, 100.0 * row_i / total_g),
                }
            )

        top_openings = _top_openings_payload(opening_agg)
        heatmap = {sq: heat_total[sq] for sq in sorted(heat_total.keys())}
        emit(
            {
                "games_parsed": games_seen,
                "months_scanned": 1,
                "archive_months_total": 1,
                "mode": "single_month",
                "stage": "finalizing",
                "percent": 100.0,
            }
        )
        flush()
        rj = _finalize_rating_journey(rating_raw, games_seen)
        ego_payload = _finalize_ego_check(ego_acc)
        shame_payload = _finalize_hall_of_shame(shame_acc)
        out = {
            "username": username,
            "archive_month_url": month_url,
            "games_parsed": games_seen,
            "skipped_non_traditional_games": skipped_non_traditional,
            "ego_check": ego_payload,
            "hall_of_shame": shame_payload,
            "player_stats": player_stats,
            "psychometrics": finalize_psychometrics(
                psy_rows, _opening_counts_for_hhi(opening_agg), games_seen
            ),
            "clock_trauma": asdict(merged_time) if merged_time else None,
            "spatial_comedy": {"capture_heatmap": heatmap},
            "openings": {"top_openings": top_openings},
            "existential_toll": {
                "user_clock_spend_sec": round(existential_clock_sec, 2),
                "games_with_clk_spend": existential_games_with_clk,
            },
        }
        if rj is not None:
            out["rating_journey"] = rj
        qa = finalize_ds_payload(ds_acc)
        if qa is not None:
            out["quant_appendix"] = qa
        out = _finalize_roast_payload(out, beh_total)
        cache_set(cache_key, json.dumps(out))
        return out

    tid = normalize_timeline(timeline)
    days = _TIMELINE_DAYS[tid]
    if days is None:
        cutoff_ts: Optional[int] = None
        cutoff_iso: Optional[str] = None
    else:
        cutoff_dt = datetime.now(timezone.utc) - timedelta(days=days)
        cutoff_ts = int(cutoff_dt.timestamp())
        cutoff_iso = cutoff_dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    months_scanned = 0
    mode = "all" if cutoff_ts is None else "rolling"
    emit(
        {
            "stage": "parsing",
            "mode": mode,
            "timeline": tid,
            "games_parsed": 0,
            "months_scanned": 0,
            "archive_months_total": n_archives,
        }
    )

    if cutoff_ts is None:
        for url in urls:
            batch = list(iter_month_games(session, url))
            if not batch:
                continue
            months_scanned += 1
            nb = max(1, len(batch))
            for j, (pgn_text, _et, rules, raw_g) in enumerate(batch):
                if games_seen >= MAX_GAMES_PARSED:
                    break
                if not _is_traditional_chess(rules, pgn_text):
                    skipped_non_traditional += 1
                    frac = (months_scanned - 1 + (j + 1) / nb) / max(1, n_archives)
                    emit(
                        {
                            "games_parsed": games_seen,
                            "months_scanned": months_scanned,
                            "archive_months_total": n_archives,
                            "mode": "all",
                            "timeline": tid,
                            "stage": "parsing",
                            "percent": min(99.0, 100.0 * frac),
                        }
                    )
                    continue
                if isinstance(raw_g, dict):
                    ego_acc.consider(raw_g, username.strip().lower(), pgn_text)
                games_seen += 1
                game = chess.pgn.read_game(io.StringIO(pgn_text))
                if game is None:
                    psy_rows.append(_empty_game_psy())
                    frac = (months_scanned - 1 + (j + 1) / nb) / max(1, n_archives)
                    emit(
                        {
                            "games_parsed": games_seen,
                            "months_scanned": months_scanned,
                            "archive_months_total": n_archives,
                            "mode": "all",
                            "timeline": tid,
                            "stage": "parsing",
                            "percent": min(99.0, 100.0 * frac),
                        }
                    )
                    continue
                end_eff = (
                    _et if _et is not None else parse_pgn_utc_timestamp(pgn_text)
                )
                if isinstance(raw_g, dict):
                    shame_acc.consider(raw_g, username.strip().lower(), game, pgn_text)
                t, h, op, beh, gpsy = analyze_game(
                    game, end_ts=end_eff, username=username
                )
                psy_rows.append(gpsy)
                _append_rating_sample(rating_raw, game, username, end_eff)
                merged_time = merge_time(merged_time, t)
                uclk = _user_move_clock_spend_total(game, username.strip().lower())
                if uclk > 0:
                    existential_games_with_clk += 1
                existential_clock_sec += uclk
                heat_total.update(h)
                beh_total.update(beh)
                if op:
                    _opening_agg_bump(opening_agg, op, gpsy.get("user_result"))
                ds_acc.merge_game(game, username.strip().lower(), end_eff)
                frac = (months_scanned - 1 + (j + 1) / nb) / max(1, n_archives)
                emit(
                    {
                        "games_parsed": games_seen,
                        "months_scanned": months_scanned,
                        "archive_months_total": n_archives,
                        "mode": "all",
                        "timeline": tid,
                        "stage": "parsing",
                        "percent": min(99.0, 100.0 * frac),
                    }
                )
            if games_seen >= MAX_GAMES_PARSED:
                break
    else:
        for url in reversed(urls):
            batch = list(iter_month_games(session, url))
            if not batch:
                continue
            known = [t for _, t, _, _ in batch if t is not None]
            batch_max = max(known) if known else None
            if (
                known
                and len(known) == len(batch)
                and batch_max is not None
                and batch_max < cutoff_ts
            ):
                break
            months_scanned += 1
            for pgn_text, et, rules, raw_g in batch:
                if games_seen >= MAX_GAMES_PARSED:
                    break
                ts = et if et is not None else parse_pgn_utc_timestamp(pgn_text)
                if ts is not None and ts < cutoff_ts:
                    continue
                if not _is_traditional_chess(rules, pgn_text):
                    skipped_non_traditional += 1
                    emit(
                        {
                            "games_parsed": games_seen,
                            "months_scanned": months_scanned,
                            "archive_months_total": n_archives,
                            "mode": "rolling",
                            "timeline": tid,
                            "stage": "parsing",
                        }
                    )
                    continue
                if isinstance(raw_g, dict):
                    ego_acc.consider(raw_g, username.strip().lower(), pgn_text)
                games_seen += 1
                game = chess.pgn.read_game(io.StringIO(pgn_text))
                if game is None:
                    psy_rows.append(_empty_game_psy())
                    emit(
                        {
                            "games_parsed": games_seen,
                            "months_scanned": months_scanned,
                            "archive_months_total": n_archives,
                            "mode": "rolling",
                            "timeline": tid,
                            "stage": "parsing",
                        }
                    )
                    continue
                end_eff = (
                    et if et is not None else parse_pgn_utc_timestamp(pgn_text)
                )
                if isinstance(raw_g, dict):
                    shame_acc.consider(raw_g, username.strip().lower(), game, pgn_text)
                t, h, op, beh, gpsy = analyze_game(
                    game, end_ts=end_eff, username=username
                )
                psy_rows.append(gpsy)
                _append_rating_sample(rating_raw, game, username, end_eff)
                merged_time = merge_time(merged_time, t)
                uclk = _user_move_clock_spend_total(game, username.strip().lower())
                if uclk > 0:
                    existential_games_with_clk += 1
                existential_clock_sec += uclk
                heat_total.update(h)
                beh_total.update(beh)
                if op:
                    _opening_agg_bump(opening_agg, op, gpsy.get("user_result"))
                ds_acc.merge_game(game, username.strip().lower(), end_eff)
                emit(
                    {
                        "games_parsed": games_seen,
                        "months_scanned": months_scanned,
                        "archive_months_total": n_archives,
                        "mode": "rolling",
                        "timeline": tid,
                        "stage": "parsing",
                    }
                )
            if games_seen >= MAX_GAMES_PARSED:
                break

    top_openings = _top_openings_payload(opening_agg)
    heatmap = {sq: heat_total[sq] for sq in sorted(heat_total.keys())}
    if mode == "all":
        emit(
            {
                "games_parsed": games_seen,
                "months_scanned": months_scanned,
                "archive_months_total": n_archives,
                "mode": "all",
                "timeline": tid,
                "stage": "finalizing",
                "percent": 100.0,
            }
        )
    else:
        emit(
            {
                "games_parsed": games_seen,
                "months_scanned": months_scanned,
                "archive_months_total": n_archives,
                "mode": "rolling",
                "timeline": tid,
                "stage": "finalizing",
            }
        )
    flush()
    rj = _finalize_rating_journey(rating_raw, games_seen)
    ego_payload = _finalize_ego_check(ego_acc)
    shame_payload = _finalize_hall_of_shame(shame_acc)
    out = {
        "username": username,
        "window": {
            "timeline": tid,
            "cutoff_utc": cutoff_iso,
            "months_scanned": months_scanned,
        },
        "games_parsed": games_seen,
        "skipped_non_traditional_games": skipped_non_traditional,
        "ego_check": ego_payload,
        "hall_of_shame": shame_payload,
        "player_stats": player_stats,
        "psychometrics": finalize_psychometrics(
            psy_rows, _opening_counts_for_hhi(opening_agg), games_seen
        ),
        "clock_trauma": asdict(merged_time) if merged_time else None,
        "spatial_comedy": {"capture_heatmap": heatmap},
        "openings": {"top_openings": top_openings},
        "existential_toll": {
            "user_clock_spend_sec": round(existential_clock_sec, 2),
            "games_with_clk_spend": existential_games_with_clk,
        },
    }
    if rj is not None:
        out["rating_journey"] = rj
    qa = finalize_ds_payload(ds_acc)
    if qa is not None:
        out["quant_appendix"] = qa
    out = _finalize_roast_payload(out, beh_total)
    cache_set(cache_key, json.dumps(out))
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="Chess.com roast MVP parser (Phase 1).")
    p.add_argument("--username", required=True, help="Chess.com username (case-insensitive on their side).")
    p.add_argument(
        "--month",
        default=None,
        help='Optional "YYYY/MM" or "YYYY-MM" for a single archive month (overrides --timeline).',
    )
    p.add_argument(
        "--timeline",
        default="1m",
        choices=VALID_TIMELINES,
        help="Rolling window from Chess.com end_time (ignored if --month is set).",
    )
    args = p.parse_args()

    try:
        if args.month:
            roast = build_roast(args.username, month=args.month, timeline=None)
        else:
            roast = build_roast(args.username, month=None, timeline=args.timeline)
    except (requests.RequestException, ValueError) as e:
        print(str(e), file=sys.stderr)
        return 2

    print(json.dumps(roast, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
