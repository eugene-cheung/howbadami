"""Roast job state: Redis when REDIS_URL is set, else in-process dict (single-worker dev)."""

from __future__ import annotations

import json
import os
import threading
from typing import Any, Dict, Optional

_JOB_PREFIX = "howbadami:roast_job:"
# Refresh on each write so long-running roasts do not expire mid-flight.
_JOB_TTL_SEC = int(os.environ.get("ROAST_JOB_TTL_SEC", str(86400 * 7)))


def _job_key(job_id: str) -> str:
    return f"{_JOB_PREFIX}{job_id}"


class JobStore:
    def __init__(self, redis_url: Optional[str]) -> None:
        self._redis_url = (redis_url or "").strip() or None
        self._redis: Any = None
        self._mem: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    @property
    def uses_redis(self) -> bool:
        return self._redis_url is not None

    def _client(self) -> Any:
        if self._redis is None:
            import redis

            self._redis = redis.from_url(
                self._redis_url,
                decode_responses=True,
                health_check_interval=30,
            )
        return self._redis

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        if not self._redis_url:
            with self._lock:
                rec = self._mem.get(job_id)
                return dict(rec) if rec is not None else None
        raw = self._client().get(_job_key(job_id))
        if raw is None:
            return None
        return json.loads(raw)

    def put(self, job_id: str, record: Dict[str, Any]) -> None:
        if not self._redis_url:
            with self._lock:
                self._mem[job_id] = dict(record)
            return
        self._client().set(
            _job_key(job_id),
            json.dumps(record, ensure_ascii=False, separators=(",", ":")),
            ex=_JOB_TTL_SEC,
        )

    def merge(self, job_id: str, patch: Dict[str, Any]) -> None:
        rec = self.get(job_id)
        if rec is None:
            return
        rec.update(patch)
        self.put(job_id, rec)

    def close(self) -> None:
        if self._redis is not None:
            try:
                self._redis.close()
            finally:
                self._redis = None


def job_store_from_env() -> JobStore:
    url = os.environ.get("REDIS_URL", "").strip()
    return JobStore(url if url else None)
