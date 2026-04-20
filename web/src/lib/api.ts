import type { JobCreate, JobState } from "@/types/roast";

/** Raw env value for display; same normalization as requests. */
function apiEnvRaw(): string {
  return process.env.NEXT_PUBLIC_API_URL?.trim() ?? "http://127.0.0.1:8000";
}

/**
 * Public API origin (no trailing slash). Uses `URL` so a trailing slash in
 * NEXT_PUBLIC_API_URL cannot produce `//health` or `//api/...`.
 */
export function apiBase(): string {
  const raw = apiEnvRaw();
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+$/, "");
    return path ? `${u.origin}${path}` : u.origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

/** Absolute URL for a path (e.g. `/health`, `/api/roast/...?q=1`). Handles any slash on the env base. */
export function apiUrl(path: string): string {
  const raw = apiEnvRaw();
  const p = path.startsWith("/") ? path : `/${path}`;
  try {
    return new URL(p, raw).href;
  } catch {
    return `${apiBase()}${p}`;
  }
}

/**
 * Fire-and-forget GET /health so a cold API host (e.g. Render free tier) can start
 * spinning up while the user reads the page. Errors are ignored.
 */
export function warmupBackend(): void {
  void fetch(apiUrl("/health"), { method: "GET", cache: "no-store" }).catch(
    () => undefined,
  );
}

function networkHelpMessage(): string {
  const base = apiBase();
  const local =
    base.includes("127.0.0.1") || base.includes("localhost");
  if (local) {
    return (
      `Cannot reach the analysis server at ${base}. ` +
      `Start it from the repo root (same machine): ` +
      `.venv\\Scripts\\python.exe -m uvicorn backend.main:app --reload --port 8000`
    );
  }
  return (
    `Cannot reach the analysis server at ${base}. ` +
    `Open ${base}/health in a new tab; if that works, check the browser console on this page for a CORS error — ` +
    `on Render set CORS_ORIGINS to your exact Vercel origin (e.g. https://your-app.vercel.app). ` +
    `Redeploy Vercel after changing NEXT_PUBLIC_API_URL.`
  );
}

function rethrowIfNetworkFailure(e: unknown): never {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.toLowerCase();
  if (
    msg === "Failed to fetch" ||
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network request failed") ||
    m.includes("load failed")
  ) {
    throw new Error(networkHelpMessage());
  }
  throw e instanceof Error ? e : new Error(msg);
}

export async function startRoast(
  username: string,
  timeline: string,
): Promise<JobCreate> {
  const q = new URLSearchParams({ timeline: timeline.trim() || "1m" });
  let res: Response;
  try {
    res = await fetch(
      apiUrl(
        `/api/roast/${encodeURIComponent(username)}?${q.toString()}`,
      ),
      { method: "POST" },
    );
  } catch (e) {
    rethrowIfNetworkFailure(e);
  }
  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getJob(jobId: string): Promise<JobState> {
  let res: Response;
  try {
    res = await fetch(apiUrl(`/api/roast/jobs/${jobId}`));
  } catch (e) {
    rethrowIfNetworkFailure(e);
  }
  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }
  return res.json();
}
