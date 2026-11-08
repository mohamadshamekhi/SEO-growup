// Ported from hub/tools.py's ping(). Uses Node's native fetch with a timeout instead of
// porting crawl.fetch() wholesale (that function backs the full audit crawler, which is
// Phase 5) — functionally equivalent for an uptime check: one GET, status + elapsed ms.
import { one, run } from "./db";
import type { ProjectRow } from "./projects";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<{ status: number; ms: number; error?: string }> {
  const t0 = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "User-Agent": "GrowthHub-Uptime/1.0" }, cache: "no-store" });
    // Draining the body isn't needed for a status check, but undici can otherwise hold the
    // connection open; closing it keeps consecutive pings fast.
    await res.body?.cancel().catch(() => {});
    return { status: res.status, ms: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, error: String((e as Error).message || e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ping(project: ProjectRow): Promise<{ status: number; ms: number; up: boolean; changed: "up" | "down" | null }> {
  const domain = project.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const base = `https://${domain}/`;
  let r = await fetchWithTimeout(base, 20000);
  if (r.status === 0 || r.status >= 500) { await sleep(5000); r = await fetchWithTimeout(base, 20000); } // confirm before recording an outage

  run("INSERT INTO uptime VALUES (?,?,?,?)", project.id, Date.now() / 1000, r.status, r.ms);
  const up = r.status >= 200 && r.status < 400;
  const openIssue = one<{ id: number }>("SELECT id FROM issues WHERE project_id=? AND code='site_down' AND status='open'", project.id);
  let changed: "up" | "down" | null = null;
  const now = Date.now() / 1000;
  if (!up && !openIssue) {
    run(
      `INSERT INTO issues(project_id,code,url,severity,detail,status,first_seen,last_seen) VALUES(?,?,?,?,?,'open',?,?)
       ON CONFLICT(project_id,code,url) DO UPDATE SET status='open', last_seen=excluded.last_seen, detail=excluded.detail, fixed_at=NULL`,
      project.id, "site_down", base, "critical", String(r.status || r.error || ""), now, now,
    );
    changed = "down";
  } else if (up && openIssue) {
    run("UPDATE issues SET status='fixed', fixed_at=? WHERE id=?", now, openIssue.id);
    changed = "up";
  }
  return { status: r.status, ms: r.ms, up, changed };
}
