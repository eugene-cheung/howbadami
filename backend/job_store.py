"""Roast job state: in-process only (single worker / single instance)."""

from __future__ import annotations

import threading
from typing import Any, Dict, Optional


class JobStore:
    def __init__(self) -> None:
        self._mem: dict[str, dict[str, Any]] = {}
        self._lock = threading.Lock()

    def get(self, job_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            rec = self._mem.get(job_id)
            return dict(rec) if rec is not None else None

    def put(self, job_id: str, record: Dict[str, Any]) -> None:
        with self._lock:
            self._mem[job_id] = dict(record)

    def merge(self, job_id: str, patch: Dict[str, Any]) -> None:
        rec = self.get(job_id)
        if rec is None:
            return
        rec.update(patch)
        self.put(job_id, rec)

    def close(self) -> None:
        pass


def job_store_from_env() -> JobStore:
    return JobStore()
