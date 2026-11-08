// Ported from server.py's gsc_data() (cached-data reader) and hub/gsc.py (the live Search
// Console API client: sites/query/pull). Token acquisition is lib/google-auth.ts.
import { many, one, q, run } from "./db";
import { project, type ProjectRow } from "./projects";
import { keyInfo, token, GSC_SCOPE } from "./google-auth";

export { keyInfo, saveKey } from "./google-auth";

type SnapRow = { key: string; clicks: number; impressions: number; ctr: number; position: number; prev_clicks: number | null; prev_position: number | null };

const EXPECTED_CTR: Record<number, number> = { 1: 0.28, 2: 0.15, 3: 0.1, 4: 0.07, 5: 0.05 };
const expectedCtr = (pos: number) => EXPECTED_CTR[Math.round(pos)] ?? 0.03;

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

// ---------- live Search Console API (hub/gsc.py) ----------

async function api(apiPath: string, body?: unknown) {
  const res = await fetch(`https://www.googleapis.com/webmasters/v3${apiPath}`, {
    method: body ? "POST" : "GET",
    headers: { Authorization: `Bearer ${await token(GSC_SCOPE)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store", // Next.js's fetch patch defaults to caching by URL only, ignoring
    // headers — without this, an authenticated call can silently replay another request's
    // (or another token's) cached response. Found by hand: a fresh, valid token still got
    // a stale 403 back through this exact route until this flag was added.
  });
  if (!res.ok) {
    let msg = (await res.text()).slice(0, 300);
    if (res.status === 403) msg = "دسترسی ندارد: ایمیل Service Account را در Search Console این سایت به‌عنوان کاربر اضافه کنید. " + msg;
    throw new Error(msg);
  }
  return res.json();
}

export async function sites(): Promise<string[]> {
  const d = await api("/sites");
  return (d.siteEntry || []).map((s: { siteUrl: string }) => s.siteUrl);
}

function stripDomain(domain: string): string {
  return domain.replace(/^https?:\/\//, "").replace(/\/+$/, "").replace(/^www\./, "");
}

export function guessProperty(domain: string, available: string[]): string {
  const d = stripDomain(domain);
  for (const cand of [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`]) if (available.includes(cand)) return cand;
  return "";
}

export function candidates(domain: string, available: string[]): string[] {
  const d = stripDomain(domain);
  return [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`].filter((c) => available.includes(c));
}

type GscApiRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };

export async function query(prop: string, start: string, end: string, dims: string[], limit = 500): Promise<GscApiRow[]> {
  const d = await api(`/sites/${encodeURIComponent(prop)}/searchAnalytics/query`, { startDate: start, endDate: end, dimensions: dims, rowLimit: limit, dataState: "final" });
  return d.rows || [];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysAgo(from: Date, n: number): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

export type PullResult = { days: number; query?: number; page?: number; clicks: number; impressions: number; property: string; snap: string };

export async function pull(p: ProjectRow): Promise<PullResult> {
  let prop = p.gsc_property;
  const available = await sites();
  if (!prop) {
    prop = guessProperty(p.domain, available);
    if (!prop) throw new Error("property این دامنه در Search Console پیدا نشد؛ ایمیل Service Account را به آن اضافه کنید یا property را در تنظیمات پروژه بنویسید.");
    run("UPDATE projects SET gsc_property=? WHERE id=?", prop, p.id);
  }
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 3); // GSC final data lags ~2-3 days
  const endIso = isoDate(end);
  const d = (n: number) => daysAgo(end, n);

  let rows = await query(prop, d(480), endIso, ["date"], 25000);
  if (!rows.length) {
    for (const other of candidates(p.domain, available)) {
      if (other === prop) continue;
      const found = await query(other, d(480), endIso, ["date"], 25000);
      if (found.length) { prop = other; rows = found; run("UPDATE projects SET gsc_property=? WHERE id=?", prop, p.id); break; }
    }
  }

  many("INSERT OR REPLACE INTO gsc_daily VALUES (?,?,?,?,?,?)", rows.map((r) => [p.id, r.keys[0], r.clicks, r.impressions, r.ctr, r.position]));
  const snap = endIso;
  const out: Record<string, number> = { days: rows.length };
  for (const dim of ["query", "page"] as const) {
    const cur = await query(prop, d(27), endIso, [dim], 1000);
    const prevRows = await query(prop, d(55), d(28), [dim], 1000);
    const prev = new Map(prevRows.map((r) => [r.keys[0], r]));
    run("DELETE FROM gsc_snap WHERE project_id=? AND snap=? AND dim=?", p.id, snap, dim);
    many(
      "INSERT INTO gsc_snap VALUES (?,?,?,?,?,?,?,?,?,?)",
      cur.map((r) => [p.id, snap, dim, r.keys[0], r.clicks, r.impressions, r.ctr, r.position, prev.get(r.keys[0])?.clicks ?? null, prev.get(r.keys[0])?.position ?? null]),
    );
    out[dim] = cur.length;
  }
  const pairs = await query(prop, d(27), endIso, ["query", "page"], 5000);
  run("DELETE FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query_page'", p.id, snap);
  many(
    "INSERT INTO gsc_snap VALUES (?,?,?,?,?,?,?,?,NULL,NULL)",
    pairs.map((r) => [p.id, snap, "query_page", r.keys.join("\t"), r.clicks, r.impressions, r.ctr, r.position]),
  );

  const last28 = rows.filter((r) => r.keys[0] > d(28));
  const clicks = last28.reduce((a, r) => a + r.clicks, 0);
  const impressions = last28.reduce((a, r) => a + r.impressions, 0);
  return { ...out, clicks, impressions, property: prop, snap } as PullResult;
}
