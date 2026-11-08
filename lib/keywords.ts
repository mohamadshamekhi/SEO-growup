// Partial port of hub/keywords.py — only the self-contained, DB-only functions. The
// Claude-interactive workflow (set_competitors/next_batch/save_batch/next_step state
// machine, autorun) needs hub/content.py's writer-prompt building (Phase 5e) and is not
// ported yet; managed()/weekly() need hub/growth.py's sales math (also Phase 5e).
import { getSetting, one, q, run, setSetting } from "./db";
import { project } from "./projects";
import { words } from "./kwgap";

function flag<T>(pid: string, name: string, fallback: T): T {
  return getSetting(`kw_${name}:${pid}`, fallback);
}

function setFlag(pid: string, name: string, value: unknown) {
  setSetting(`kw_${name}:${pid}`, value);
}

/** A site chosen automatically that can't be read gets replaced; one the owner entered stays and shows its error. */
export function dropFailed(pid: string, failed: Record<string, string>) {
  if (!failed || !Object.keys(failed).length || !flag(pid, "auto", false)) return;
  const p = project(pid);
  if (!p) return;
  const blocked = flag<string[]>(pid, "blocked", []);
  setFlag(pid, "blocked", [...new Set([...blocked, ...Object.keys(failed)])]);
  const remaining = (p.competitors as string[]).filter((h) => !(h in failed));
  run("UPDATE projects SET competitors=? WHERE id=?", JSON.stringify(remaining), pid);
}

/** Real numbers from Search Console, so each keyword shows whether the work moved it. */
export function track(pid: string) {
  const snapRow = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid);
  const snap = snapRow?.s;
  const queries = snap
    ? q<{ key: string; clicks: number; impressions: number; position: number }>(
      "SELECT key, clicks, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query'", pid, snap,
    ).map((r) => [new Set(words(r.key)), r] as const)
    : [];
  for (const r of q<{ keyword: string }>("SELECT keyword FROM keywords WHERE project_id=?", pid)) {
    const need = new Set(words(r.keyword));
    const hits = queries.filter(([ws]) => [...need].every((w) => ws.has(w))).map(([, q]) => q);
    const imp = hits.reduce((a, q) => a + q.impressions, 0);
    const pos = imp ? hits.reduce((a, q) => a + q.position * q.impressions, 0) / imp : null;
    const clicks = hits.reduce((a, q) => a + q.clicks, 0);
    run(
      `UPDATE keywords SET position=?, impressions=?, clicks=?, first_position=COALESCE(first_position,?),
       status=CASE WHEN ? THEN 'reached' WHEN status='reached' THEN 'tracking' ELSE status END WHERE project_id=? AND keyword=?`,
      pos, imp, clicks, pos, pos !== null && pos <= 10 ? 1 : 0, pid, r.keyword,
    );
  }
}

/** Searches where Google splits impressions between several of this site's pages, so none of them ranks well. */
export function cannibal(pid: string, limit = 30) {
  const snapRow = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query_page'", pid);
  if (!snapRow?.s) return [];
  const rows = q<{ key: string; impressions: number; position: number }>(
    "SELECT key, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query_page'", pid, snapRow.s,
  );
  const groups = new Map<string, { url: string; impressions: number; position: number }[]>();
  for (const r of rows) {
    const [query, page] = r.key.split("\t");
    if (!groups.has(query)) groups.set(query, []);
    groups.get(query)!.push({ url: page, impressions: r.impressions, position: r.position });
  }
  const out: { query: string; impressions: number; pages: { url: string; impressions: number; position: number }[] }[] = [];
  for (const [query, pages] of groups) {
    const total = pages.reduce((a, p) => a + p.impressions, 0);
    const big = pages.filter((p) => p.impressions >= Math.max(3, total * 0.2)).sort((a, b) => b.impressions - a.impressions);
    if (big.length >= 2) out.push({ query, impressions: total, pages: big });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, limit);
}

export type DecayingRow = { url: string; clicks: number; prev_clicks: number; position: number; prev_position: number };

export function decaying(pid: string, limit = 20): DecayingRow[] {
  const snapRow = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='page'", pid);
  if (!snapRow?.s) return [];
  return q<DecayingRow>(
    `SELECT key url, clicks, prev_clicks, position, prev_position FROM gsc_snap
     WHERE project_id=? AND snap=? AND dim='page' AND prev_clicks>=5 AND clicks<=prev_clicks*0.6
     ORDER BY prev_clicks-clicks DESC LIMIT ?`,
    pid, snapRow.s, limit,
  );
}
