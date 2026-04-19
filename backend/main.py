"""
Phase 2: FastAPI layer with background roast jobs + polling.

Run from repo root:
  .\\.venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000
"""

from __future__ import annotations

import sys
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, Literal, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from roast_mvp import build_roast, normalize_timeline  # noqa: E402

JobStatus = Literal["pending", "running", "completed", "failed"]

_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()

app = FastAPI(title="howbadami roast API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class JobCreateResponse(BaseModel):
    job_id: str
    status_url: str


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    progress: Optional[Dict[str, Any]] = None


def _run_roast_job(
    job_id: str,
    username: str,
    month: Optional[str],
    timeline: str,
) -> None:
    with _jobs_lock:
        rec = _jobs.get(job_id)
        if rec is None:
            return
        rec["status"] = "running"

    def _progress_hook(snapshot: Dict[str, Any]) -> None:
        with _jobs_lock:
            rec = _jobs.get(job_id)
            if rec is not None:
                rec["progress"] = dict(snapshot)

    try:
        m = month.strip() if month else None
        if m:
            payload = build_roast(
                username, month=m, timeline=None, on_progress=_progress_hook
            )
        else:
            payload = build_roast(
                username, month=None, timeline=timeline, on_progress=_progress_hook
            )
    except Exception as e:  # noqa: BLE001 — surface as job failure
        with _jobs_lock:
            rec = _jobs.get(job_id)
            if rec is not None:
                rec["status"] = "failed"
                rec["error"] = str(e)
                rec["result"] = None
                rec.pop("progress", None)
        return

    with _jobs_lock:
        rec = _jobs.get(job_id)
        if rec is not None:
            rec["status"] = "completed"
            rec["result"] = payload
            rec["error"] = None
            rec.pop("progress", None)


@app.get("/")
def root() -> RedirectResponse:
    """Browser default; avoids a bare 404 on `/`."""
    return RedirectResponse(url="/docs", status_code=307)


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.post("/api/roast/{username}", response_model=JobCreateResponse)
def start_roast(
    username: str,
    background_tasks: BackgroundTasks,
    timeline: str = Query(
        default="1m",
        description=(
            "Rolling window: 1d,1w, then 1m–11m by calendar month length, 1y, all. "
            "Uses Chess.com game end_time when present."
        ),
    ),
    month: Optional[str] = Query(
        default=None,
        description='If set, analyze this archive month only (e.g. "2026/03"); ignores timeline.',
    ),
) -> JobCreateResponse:
    if not (month and month.strip()):
        try:
            normalize_timeline(timeline)
        except ValueError as e:
            raise HTTPException(status_code=422, detail=str(e)) from e

    job_id = str(uuid.uuid4())
    with _jobs_lock:
        _jobs[job_id] = {
            "status": "pending",
            "username": username,
            "month": month,
            "timeline": timeline,
            "result": None,
            "error": None,
            "progress": None,
        }
    background_tasks.add_task(_run_roast_job, job_id, username, month, timeline)
    return JobCreateResponse(job_id=job_id, status_url=f"/api/roast/jobs/{job_id}")


@app.get("/api/roast/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str) -> JobStatusResponse:
    with _jobs_lock:
        rec = _jobs.get(job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Unknown job_id.")
    return JobStatusResponse(
        job_id=job_id,
        status=rec["status"],
        result=rec.get("result"),
        error=rec.get("error"),
        progress=rec.get("progress"),
    )
