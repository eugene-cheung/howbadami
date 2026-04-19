import type { JobCreate, JobState } from "@/types/roast";

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";
}

export async function startRoast(
  username: string,
  timeline: string,
): Promise<JobCreate> {
  const q = new URLSearchParams({ timeline: timeline.trim() || "1m" });
  const res = await fetch(
    `${apiBase()}/api/roast/${encodeURIComponent(username)}?${q.toString()}`,
    { method: "POST" },
  );
  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function getJob(jobId: string): Promise<JobState> {
  const res = await fetch(`${apiBase()}/api/roast/jobs/${jobId}`);
  if (!res.ok) {
    throw new Error((await res.text()) || `HTTP ${res.status}`);
  }
  return res.json();
}
