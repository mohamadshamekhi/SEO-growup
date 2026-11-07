// Ported from server.py's gsc_data() — reads the gsc_daily/gsc_snap tables the Python
// side's GSC pull already filled. Fetching new data from the Search Console API itself
// (hub/gsc.py's pull()/token()) is Phase 5a; keyInfo() is stubbed until then so callers
// can tell "not connected yet" from "connected but empty" the same way the UI did before.
import { one, q } from "./db";
import { project } from "./projects";

type SnapRow = { key: string; clicks: number; impressions: number; ctr: number; position: number; prev_clicks: number | null; prev_position: number | null };

const EXPECTED_CTR: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.05 };
const expectedCtr = (pos: number) => EXPECTED_CTR[Math.round(pos)] ?? 0.03;

export function keyInfo(): { client_email: string } | null {
  return null; // Phase 5a wires the real service-account key check.
}

export function gscData(pid: string) {
  const snapRow = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid);
  const snap = snapRow?.s ?? null;
  const daily = q<{ date: string; clicks: number; impressions: number; ctr: number; position: number }>(
    "SELECT date, clicks, impressions, ctr, position FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 120", pid,
  ).reverse();
  const queries = snap ? q<SnapRow>(
    "SELECT key, clicks, impressions, ctr, position, prev_clicks, prev_position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query' ORDER BY impressions DESC", pid, snap,
  ) : [];
  const pages = snap ? q<SnapRow>(
    "SELECT key, clicks, impressions, ctr, position, prev_clicks, prev_position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='page' ORDER BY clicks DESC, impressions DESC", pid, snap,
  ) : [];

  const opps: (SnapRow & { type: string; why: string })[] = [];
  for (const r of queries) {
    if (r.position >= 8 && r.position <= 20 && r.impressions >= 10) {
      opps.push({ ...r, type: "striking", why: "جایگاه ۸ تا ۲۰ با نمایش خوب؛ با بهبود محتوا و لینک داخلی به صفحه اول می‌رسد." });
    } else if (r.position <= 5 && r.impressions >= 30 && r.ctr < expectedCtr(r.position) * 0.6) {
      opps.push({ ...r, type: "low_ctr", why: "رتبه خوب ولی نرخ کلیک پایین؛ عنوان و meta description جذاب‌تر بنویسید." });
    } else if (r.prev_position != null && r.position - r.prev_position >= 5 && r.impressions >= 10) {
      opps.push({ ...r, type: "dropping", why: `افت جایگاه از ${Math.round(r.prev_position)} به ${Math.round(r.position)}؛ صفحه را به‌روز کنید.` });
    }
  }

  const p = project(pid);
  const tracked = (p?.keywords as string[] || []).map((kw) => {
    const hist = q<{ snap: string; position: number; clicks: number; impressions: number }>(
      "SELECT snap, position, clicks, impressions FROM gsc_snap WHERE project_id=? AND dim='query' AND key=? ORDER BY snap", pid, kw,
    );
    return { keyword: kw, history: hist, current: hist.length ? hist[hist.length - 1] : null };
  });

  return { snap, daily, queries: queries.slice(0, 500), pages: pages.slice(0, 300), opportunities: opps.slice(0, 80), tracked, property: p?.gsc_property ?? "", key: keyInfo() };
}
