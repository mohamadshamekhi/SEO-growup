// Ported from server.py's summary()/uptime_stats() — the data behind the dashboard tab and
// the projects picker. priorities()/writer_available()/gsc_key (which need crawl.CHECKS,
// the GSC key, and the writer-slot) are deferred to the phases that port those modules;
// /api/overview returns stub values for those fields in the meantime, documented below.
import { one, q } from "./db";
import { state, type RunningSlot } from "./jobs/queues";
import type { ProjectRow } from "./projects";

export type UptimeStats = { pct: number | null; avg_ms: number | null; last: { ts: number; status: number; ms: number } | null; checks: number };

export function uptimeStats(pid: string, hours = 24): UptimeStats {
  const rows = q<{ ts: number; status: number; ms: number }>(
    "SELECT ts, status, ms FROM uptime WHERE project_id=? AND ts>=? ORDER BY ts", pid, Date.now() / 1000 - hours * 3600,
  );
  if (!rows.length) return { pct: null, avg_ms: null, last: null, checks: 0 };
  const up = rows.filter((r) => r.status >= 200 && r.status < 400);
  return {
    pct: Math.round((100 * up.length / rows.length) * 100) / 100,
    avg_ms: up.length ? Math.round(up.reduce((a, r) => a + r.ms, 0) / up.length) : null,
    last: rows[rows.length - 1],
    checks: rows.length,
  };
}

type Audit = { id: number; started_at: number; score: number | null; summary: string; status: string };

export function projectSummary(p: ProjectRow) {
  const pid = p.id;
  const audits = q<Audit>("SELECT id, started_at, score, summary, status FROM runs WHERE project_id=? AND kind='audit' AND status='ok' ORDER BY id DESC LIMIT 20", pid);
  const sevRows = q<{ severity: string; n: number }>("SELECT severity, COUNT(*) n FROM issues WHERE project_id=? AND status='open' GROUP BY severity", pid);
  const sev = Object.fromEntries(sevRows.map((r) => [r.severity, r.n]));
  const dailyAsc = q<{ date: string; clicks: number; impressions: number; position: number }>(
    "SELECT date, clicks, impressions, position FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 56", pid,
  ).reverse();
  const last28 = dailyAsc.slice(-28);
  const prev28 = dailyAsc.slice(0, -28);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const gsc = dailyAsc.length ? {
    position: avg(last28.map((d) => d.position)),
    prev_position: prev28.length >= 20 ? avg(prev28.map((d) => d.position)) : null,
    clicks: sum(last28.map((d) => d.clicks)),
    impressions: sum(last28.map((d) => d.impressions)),
    prev_clicks: prev28.length >= 20 ? sum(prev28.map((d) => d.clicks)) : null,
    prev_impressions: prev28.length >= 20 ? sum(prev28.map((d) => d.impressions)) : null,
    spark: last28.map((d) => d.clicks),
  } : null;

  const check = one<{ started_at: number }>("SELECT started_at FROM runs WHERE project_id=? AND kind IN ('audit','recheck') AND status='ok' ORDER BY id DESC LIMIT 1", pid);
  const fixedSince = one<{ n: number }>("SELECT COUNT(*) n FROM issues WHERE project_id=? AND status='fixed' AND fixed_at>=?", pid, check ? check.started_at : Date.now() / 1000)!.n;
  const audit = audits[0] ? { ...audits[0], summary: JSON.parse(audits[0].summary || "{}") } : null;

  const cur = state.current;
  const running = state.writing && state.writing.project === pid ? state.writing.kind
    : cur && cur.project === pid ? cur.kind : null;

  return {
    ...p,
    last_check: check ? check.started_at : null,
    fixed_since_check: fixedSince,
    audit,
    score_history: audits.slice().reverse().map((a) => ({ t: a.started_at, score: a.score })),
    issues: { critical: sev["critical"] || 0, warning: sev["warning"] || 0, info: sev["info"] || 0 },
    uptime: uptimeStats(pid),
    uptime7: uptimeStats(pid, 168).pct,
    gsc,
    running,
    queued: state.queued.filter((j) => j.project === pid).map((j) => j.kind),
    // Phase 2 (crawl.CHECKS) will fill this from runs.error for audit/gsc/etc.
    last_errors: [] as unknown[],
  };
}

// Changes once per process start — the frontend's future deploy-detection poll (ported with
// Phase 6) compares this to notice a new version is running and reload when idle, same as
// server.py's build() cache-buster.
export const BUILD_ID = String(Date.now());

// Ported from server.py's jobs_state(): only "current" (one slot, preferring writing >
// current > reading) and queue/history entries the user can actually see.
export function jobsState(visiblePids: Set<string>) {
  const mine = (slot: RunningSlot) => (slot && visiblePids.has(slot.project) ? slot : null);
  const current = mine(state.writing) || mine(state.current) || mine(state.reading);
  return {
    build: BUILD_ID,
    current,
    queued: state.queued.filter((j) => visiblePids.has(j.project)),
    history: state.history.filter((h) => visiblePids.has(h.project)).slice(0, 10),
  };
}
