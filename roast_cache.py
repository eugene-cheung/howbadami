"""SQLite TTL cache for roast JSON (24h default). No Redis required."""

from __future__ import annotations

import hashlib
import sqlite3
import time
from pathlib import Path
from typing import Optional

_CACHE_PATH = Path(__file__).resolve().parent / ".cache" / "roast_cache.sqlite"


def roast_cache_key(username: str, month: Optional[str], timeline: Optional[str]) -> str:
    m = (month or "").strip()
    t = (timeline or "").strip() or "1m"
    raw = (
        f"{username.strip().lower()}|month={m}|timeline={t}|psych=v2|stats=v1|"
        f"elo=v1|var=v1|ego=v1|shame=v2"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _connect() -> sqlite3.Connection:
    _CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_CACHE_PATH), timeout=30)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS roast_cache "
        "(k TEXT PRIMARY KEY, v TEXT NOT NULL, exp REAL NOT NULL)"
    )
    return conn


def cache_get(key: str) -> Optional[str]:
    now = time.time()
    conn = _connect()
    try:
        cur = conn.execute("SELECT v, exp FROM roast_cache WHERE k = ?", (key,))
        row = cur.fetchone()
        if not row:
            return None
        v, exp = row
        if exp < now:
            conn.execute("DELETE FROM roast_cache WHERE k = ?", (key,))
            conn.commit()
            return None
        return str(v)
    finally:
        conn.close()


def cache_set(key: str, value: str, ttl_sec: int = 86400) -> None:
    exp = time.time() + float(ttl_sec)
    conn = _connect()
    try:
        conn.execute(
            "REPLACE INTO roast_cache (k, v, exp) VALUES (?, ?, ?)",
            (key, value, exp),
        )
        conn.commit()
    finally:
        conn.close()
