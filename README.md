# elosurgery

Live: https://elosurgery.vercel.app

Chess.com already ships everything this app needs—monthly PGN archives, clock annotations when games record them, and a public profile stats JSON—but none of that is easy to read at a glance. elosurgery takes a public username and a time window, pulls those published sources, parses standard games with `python-chess`, and folds the result into one JSON report that a Next.js UI turns into charts, counters, and tongue-in-cheek copy. The jokes come from rules and string templates (`snark_engine`, `data/roast_templates.json`), not from an LLM.

The design favors a batch “generate a report” workflow over live play or millisecond APIs. A FastAPI handler kicks off `roast_mvp.build_roast` in a background task; the browser polls `GET /api/roast/jobs/{id}` until the job is `completed` or `failed`. Heavy results are memoized in SQLite under `.cache/` (`roast_cache.py`) with a versioned cache key so a deploy that changes analysis shape does not reuse incompatible JSON forever—but forgetting to bump that key when semantics change is still a footgun. Job status lives only in memory (`backend/job_store.py`), which keeps the deploy small but means a process restart drops every job id and a second uvicorn worker would not share state; that is intentional for a single-instance demo, not a hidden limitation.

Scope stays on public data: no OAuth, no private games, no engine line-by-line analysis of every position. Non-traditional variants are dropped (`skipped_non_traditional_games`). Whatever malformed or partial PGN slips through is skipped or counted defensively; clock-heavy features simply stay empty when `%clk` is missing—that is missing data, not a crash. When things go wrong, failed jobs often return raw exception text to the client; triage in production is usually `/health`, then whether Chess.com or your deploy is unhappy, then CORS and `NEXT_PUBLIC_API_URL` alignment (the API’s `CORS_ORIGINS` must allow `https://elosurgery.vercel.app` and any other frontends), then container stdout for tracebacks inside `build_roast`. There is no separate metrics or tracing layer in the repo—only default uvicorn logging.

---

### Run locally

Needs Python **3.11+**, Node **20+**, and outbound access to Chess.com.

```bash
python -m venv .venv
.venv\Scripts\activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --port 8000
```

API docs: http://127.0.0.1:8000/docs

```bash
npm --prefix web ci
set NEXT_PUBLIC_API_URL=http://127.0.0.1:8000   # Unix: export NEXT_PUBLIC_API_URL=...
npm run dev
```

App: http://localhost:3000 — After installs, `npm run ci` runs pytest, lint, and `next build`. If you add a new **root-level** Python module imported by the API, add it to the `Dockerfile` `COPY` list or the image will fail on import.

### Deploy

Ship the API from the `Dockerfile` with **one worker**. Set `CORS_ORIGINS` to your real frontend origins. Point the Vercel (or other) build at the public API with `NEXT_PUBLIC_API_URL`. `render.yaml` is only an example host blueprint.

Before you treat this as real multi-instance infra, the obvious upgrades are durable jobs, structured errors on `failed`, documented backoff to Chess.com, request IDs and phase timings, and Docker packaging that does not rely on a hand-maintained `COPY` list. The repo only uses public Chess.com data (no OAuth or stored credentials); respect their terms and rate limits at scale. It is built with FastAPI, uvicorn, requests, python-chess on the backend and Next 15, React 19, Tailwind 3, and D3 7 on the frontend; see `.github/workflows/ci.yml` for CI.

### Source layout

| Path | Role |
|------|------|
| `backend/main.py` | HTTP routes, CORS, job endpoints |
| `backend/job_store.py` | In-memory job records |
| `roast_mvp.py` | Archives, parse loop, payload assembly |
| `roast_ds.py` | Quant appendix (survival, correlations, z-scores) |
| `snark_engine.py` | Template narrative over payload |
| `roast_cache.py` | SQLite TTL cache for roast JSON |
| `chesscom_stats.py` | Profile stats normalization |
| `web/src/app/page.tsx` | Dashboard UI |
| `web/src/types/roast.ts` | Shared types |
