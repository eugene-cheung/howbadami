"""FastAPI smoke tests (no live Chess.com roast runs)."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    import importlib

    import backend.main as main

    importlib.reload(main)
    monkeypatch.setattr(main, "_run_roast_job", MagicMock())
    with TestClient(main.app) as c:
        yield c


def test_health(client: TestClient) -> None:
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_root_redirects_to_docs(client: TestClient) -> None:
    r = client.get("/", follow_redirects=False)
    assert r.status_code == 307
    assert r.headers["location"] == "/docs"


def test_invalid_timeline_422(client: TestClient) -> None:
    r = client.post("/api/roast/testuser?timeline=2y")
    assert r.status_code == 422


def test_start_roast_returns_job_and_pollable(client: TestClient) -> None:
    r = client.post("/api/roast/hikaru?timeline=1m")
    assert r.status_code == 200
    body = r.json()
    assert "job_id" in body
    assert body["status_url"].startswith("/api/roast/jobs/")
    job_id = body["job_id"]
    jr = client.get(f"/api/roast/jobs/{job_id}")
    assert jr.status_code == 200
    assert jr.json()["status"] == "pending"
    assert jr.json()["job_id"] == job_id


def test_unknown_job_404(client: TestClient) -> None:
    r = client.get("/api/roast/jobs/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 404
