// Ported from hub/extras.py. Index status (URL Inspection), competitor watch, weekly
// reports, backups, two-step login (TOTP). run_speed()/key_pages() are NOT re-ported here —
// lib/pagespeed.ts's runSpeed() already covers that half of hub/extras.py from Phase 5a.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CHECKS } from "./checks";
import { catalogRows } from "./catalog";
import { DATA_DIR, db, many, now as dbNow, one, q, run } from "./db";
import { token as googleToken, GSC_SCOPE } from "./google-auth";
import { publicUrl, compare } from "./tools";
import type { ProjectRow } from "./projects";
import { googleFetch } from "./google-proxy";

async function get(url: string, body?: unknown, headers?: Record<string, string>, timeoutMs = 120_000) {
  const res = await googleFetch(url, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

// ---------- index status ----------
function issue(pid: string, code: string, url: string, detail: string) {
  const t = dbNow();
  run(
    `INSERT INTO issues(project_id,code,url,severity,detail,status,first_seen,last_seen) VALUES(?,?,?,?,?,'open',?,?)
     ON CONFLICT(project_id,code,url) DO UPDATE SET detail=excluded.detail, last_seen=excluded.last_seen,
     status=CASE WHEN issues.status='ignored' THEN 'ignored' ELSE 'open' END, fixed_at=NULL`,
    pid, code, url, CHECKS[code]?.[0] || "warning", detail, t, t,
  );
}

function clearIssue(pid: string, code: string, url?: string) {
  if (url) run("UPDATE issues SET status='fixed', fixed_at=? WHERE project_id=? AND code=? AND status='open' AND url=?", dbNow(), pid, code, url);
  else run("UPDATE issues SET status='fixed', fixed_at=? WHERE project_id=? AND code=? AND status='open'", dbNow(), pid, code);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runIndex(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}, onlyOpen = false) {
  const prop = project.gsc_property;
  if (!prop) throw new Error("اول Search Console را برای این پروژه وصل کنید");
  const tok = await googleToken(GSC_SCOPE);
  const head = { Authorization: `Bearer ${tok}` };
  const smRes = await get(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/sitemaps`, undefined, head);
  const sm = (smRes.sitemap as { path?: string; errors?: number; warnings?: number; lastDownloaded?: string }[]) || [];
  const sitemaps = sm.map((s) => ({ path: s.path, errors: Number(s.errors || 0), warnings: Number(s.warnings || 0), last: s.lastDownloaded }));
  const now = dbNow();
  if (!sm.length) issue(project.id, "sitemap_not_submitted", prop, "");
  else clearIssue(project.id, "sitemap_not_submitted");
  // Oldest-checked pages first: the daily quota (2000/site) covers a catalog over a few runs.
  const known = new Map(q<{ url: string; ts: number }>("SELECT url, ts FROM index_status WHERE project_id=?", project.id).map((r) => [r.url, r.ts]));
  let urls: string[];
  if (onlyOpen) urls = q<{ url: string }>("SELECT url FROM issues WHERE project_id=? AND code='not_indexed' AND status='open'", project.id).map((r) => r.url);
  else urls = [...catalogRows(project.id).map((r) => r.url), `https://${project.domain}`];
  const batch = Number(project.settings?.index_batch ?? 200);
  urls = [...new Set(urls)].sort((a, b) => (known.get(a) ?? 0) - (known.get(b) ?? 0)).slice(0, batch);
  let bad = 0;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    progress(i, urls.length, decodeURIComponent(url));
    const target = encodeURI(decodeURIComponent(url));
    let d: { inspectionResult?: { indexStatusResult?: { verdict?: string; coverageState?: string; lastCrawlTime?: string; googleCanonical?: string } } };
    try {
      d = await get("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: target, siteUrl: prop }, head, 60_000);
    } catch (e) {
      if (String((e as Error).message || e).includes("HTTP 429")) break;
      continue;
    }
    const r = d.inspectionResult?.indexStatusResult || {};
    const verdict = r.verdict || "";
    run(
      "INSERT OR REPLACE INTO index_status(project_id,url,verdict,coverage,last_crawl,canonical,ts) VALUES (?,?,?,?,?,?,?)",
      project.id, url, verdict, r.coverageState || "", r.lastCrawlTime || "", r.googleCanonical || "", now,
    );
    if (verdict === "PASS") clearIssue(project.id, "not_indexed", url);
    else { issue(project.id, "not_indexed", url, r.coverageState || ""); bad++; }
    await sleep(300);
  }
  return { checked: urls.length, not_indexed: bad, sitemaps };
}

// ---------- competitor watch ----------
type WatchRow = { id: number; project_id: string; mine: string; others: string; last: string; changes: string; ts: number };

export async function addWatch(pid: string, mine: string, others: string[]) {
  await publicUrl(mine);
  for (const o of others) await publicUrl(o);
  return run("INSERT INTO watches(project_id,mine,others,last,changes,ts) VALUES (?,?,?,'{}','[]',0)", pid, mine, JSON.stringify(others)).lastInsertRowid;
}

export async function runWatches(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}) {
  const rows = q<WatchRow>("SELECT * FROM watches WHERE project_id=?", project.id);
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    const w = rows[i];
    progress(i, rows.length, w.mine);
    const cur = await compare(project.id, w.mine, JSON.parse(w.others));
    const prevOthers = (JSON.parse(w.last || "{}").others || []) as { url?: string; words?: number; title?: string; h2?: string[] }[];
    const prev = new Map(prevOthers.map((o) => [o.url, o]));
    const changes: string[] = [];
    for (const o of cur.others) {
      const p = prev.get(o.url);
      if (o.status !== 200) { changes.push(`${o.url}: در دسترس نبود (${o.status})`); continue; }
      if (!p) continue;
      if (Math.abs((o.words || 0) - (p.words || 0)) >= Math.max(100, (p.words || 0) * 0.15)) changes.push(`${o.url}: محتوا از ${p.words} به ${o.words} کلمه رسید`);
      if (o.title !== p.title) changes.push(`${o.url}: عنوان عوض شد: ${o.title}`);
      const neu = (o.h2 || []).filter((h) => !(p.h2 || []).includes(h));
      if (neu.length) changes.push(`${o.url}: تیتر جدید: ${neu.slice(0, 4).join("، ")}`);
    }
    total += changes.length;
    run("UPDATE watches SET last=?, changes=?, ts=? WHERE id=?", JSON.stringify(cur), JSON.stringify(changes), dbNow(), w.id);
  }
  return { watches: rows.length, changes: total };
}

// ---------- weekly report ----------
export function snapshot(project: ProjectRow) {
  const pid = project.id, now = dbNow();
  const a = one<{ score: number }>("SELECT score FROM runs WHERE project_id=? AND kind='audit' AND status='ok' ORDER BY id DESC LIMIT 1", pid);
  const sev: Record<string, number> = {};
  for (const r of q<{ severity: string; n: number }>("SELECT severity, COUNT(*) n FROM issues WHERE project_id=? AND status='open' GROUP BY severity", pid)) sev[r.severity] = r.n;
  const fixed = one<{ n: number }>("SELECT COUNT(*) n FROM issues WHERE project_id=? AND status='fixed' AND fixed_at>?", pid, now - 7 * 86400)!.n;
  const days = q<{ date: string; clicks: number; impressions: number; position: number }>("SELECT date, clicks, impressions, position FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 7", pid);
  const up = q<{ status: number }>("SELECT status FROM uptime WHERE project_id=? AND ts>?", pid, now - 7 * 86400);
  const v = one<{ s: number | null }>("SELECT AVG(score) s FROM vitals WHERE project_id=? AND strategy='mobile' AND ts>?", pid, now - 14 * 86400);
  const ix = one<{ ok: number; n: number }>("SELECT SUM(verdict='PASS') ok, COUNT(*) n FROM index_status WHERE project_id=?", pid)!;
  return {
    score: a ? a.score : null, critical: sev.critical || 0, warning: sev.warning || 0, fixed_week: fixed,
    clicks: days.reduce((s, d) => s + d.clicks, 0), impressions: days.reduce((s, d) => s + d.impressions, 0), gsc_days: days.length,
    uptime: up.length ? Math.round((100 * up.filter((u) => u.status >= 200 && u.status < 400).length / up.length) * 100) / 100 : null,
    mobile_speed: v && v.s !== null ? Math.round(v.s) : null, indexed: ix.ok, index_checked: ix.n,
    done_fixes: one<{ n: number }>("SELECT COUNT(*) n FROM applied WHERE project_id=? AND undone=0 AND ts>?", pid, now - 7 * 86400)!.n,
    tasks_open: one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE project_id=? AND status!='done'", pid)!.n,
  };
}

export function runReport(project: ProjectRow) {
  const prev = one<{ data: string }>("SELECT data FROM reports WHERE project_id=? ORDER BY id DESC LIMIT 1", project.id);
  const data = snapshot(project);
  const rid = run("INSERT INTO reports(project_id,ts,data,prev) VALUES (?,?,?,?)", project.id, dbNow(), JSON.stringify(data), prev ? prev.data : "{}").lastInsertRowid;
  return { report: rid, ...data };
}

// ---------- backups ----------
export async function backup(keep = 14): Promise<string | null> {
  const dir = path.join(DATA_DIR, "backups");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const today = new Date();
  const isoDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const name = path.join(dir, `hub-${isoDate}.db`);
  if (fs.existsSync(name)) return null;
  await db.backup(name); // better-sqlite3's own online-backup API — creates the destination file itself
  fs.chmodSync(name, 0o600);
  const files = fs.readdirSync(dir).filter((f) => /^hub-.*\.db$/.test(f)).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, old));
  return path.basename(name);
}

// ---------- two-step login (TOTP, RFC 6238) ----------
function base32Encode(buf: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

function base32Decode(s: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = s.toUpperCase().replace(/=+$/, "");
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const c of clean) {
    const idx = alphabet.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function totpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function totpCode(secret: string, t?: number, digits = 6, step = 30): string {
  const counter = Math.floor((t ?? Date.now() / 1000) / step);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = (h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits;
  return String(code).padStart(digits, "0");
}

export function totpOk(secret: string, code: unknown): boolean {
  const cleaned = String(code ?? "").replace(/\D/g, "");
  if (cleaned.length !== 6) return false;
  const now = Date.now() / 1000;
  for (const d of [-1, 0, 1]) {
    const expected = totpCode(secret, now + d * 30);
    if (expected.length === cleaned.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cleaned))) return true;
  }
  return false;
}
