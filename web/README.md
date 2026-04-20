# howbadami — web

The public-facing site for the roast report. The analysis server lives in the repo root (`backend/`, `Dockerfile`).

## Deploy on Vercel (recommended)

The UI is a normal Next.js app. Long-running analysis runs on your **API host** (e.g. Render); the browser calls it directly via `NEXT_PUBLIC_API_URL`, so Vercel’s serverless timeouts do not apply to the roast job.

1. Push this repo to GitHub (or GitLab / Bitbucket).
2. In [Vercel](https://vercel.com) → **Add New…** → **Project** → import the repo.
3. **Root Directory:** set to `web` (required — the Next app is not at the repository root).
4. **Environment variables** (Production, and Preview if you want previews to hit a real API):
   - `NEXT_PUBLIC_API_URL` = your public API base URL, **no trailing slash** (e.g. `https://your-api.onrender.com`).
5. Deploy. Then add your Vercel site URL to the API’s `CORS_ORIGINS` (comma-separated if multiple), e.g. `https://your-project.vercel.app`.

CLI alternative: `npm i -g vercel`, `cd web`, `vercel` (link project), then `vercel --prod`. Set the same env var in the Vercel dashboard or via `vercel env add`.

## For developers hosting the site

Point the browser build at wherever the analysis server is running. In most setups that means setting one environment variable in your host’s dashboard to the server’s **https** address (no trailing slash). Local development usually talks to `http://127.0.0.1:8000` automatically.

## Scripts

```bash
npm ci
npm run dev      # http://localhost:3000
npm run lint
npm run build
```

Typical split hosting: run this Next app on a static/frontend host and the Python API on a small cloud service; allow the frontend’s URL in the API’s browser-security (CORS) settings.
