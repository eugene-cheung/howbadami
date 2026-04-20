"""JobStore: in-process job state."""

from __future__ import annotations

from backend.job_store import JobStore


def test_in_memory_put_get_merge() -> None:
    store = JobStore()
    store.put("j1", {"status": "pending", "n": 1})
    assert store.get("j1") == {"status": "pending", "n": 1}
    store.merge("j1", {"status": "running"})
    assert store.get("j1") == {"status": "running", "n": 1}
    assert store.get("missing") is None


def test_merge_missing_job_is_noop() -> None:
    store = JobStore()
    store.merge("nope", {"x": 1})
    assert store.get("nope") is None


def test_close_does_not_raise() -> None:
    store = JobStore()
    store.close()
