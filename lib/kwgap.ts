// Ported from hub/kwgap.py — competitor keyword-gap analysis from free, public data only
// (titles/headings of their public pages), never prices, robots.txt respected, 1 req/s.
import { many, one, q, run, getSetting, setSetting } from "./db";
import { fetchUrl, parsePage, sample as crawlSample } from "./crawl";
import { catalogRows } from "./catalog";
import type { ProjectRow } from "./projects";

const MAX_PAGES = 150;
const SITE_SECONDS = 900_000; // ms — one slow or enormous site can't hold up the others
const MAX_SITEMAPS = 6;
const DELAY_MS = 1000;

// Product-sheet and shop-page words: a phrase with one of these is a spec or a template.
const SPEC = new Set("گیگابایت ترابایت مگابایت ظرفیت رم سیم کارت مگاپیکسل اینچ اینچی میلی لیتر گرم حجم ماه ماهه گارانتی مشخصات ویژگی ویژگیها نظرات کاربران فروشندگان فروشنده اقساطی اعتباری قرارداد ارسال فوری سریع خریدانلاین ناموجود موجود سبد تومان ریال پرداخت تحویل".split(" "));
const SPLIT = /\s+[|\-–—:،]\s+|\s*[|–—]\s*/;
const WORD_RE = /[0-9a-zء-يپچژکگی]+/g;
const PUNCT = /[،؛,;:!؟?()«»[\]"/]/;
// Never at either end of a phrase.
const EDGE = new Set("از به در با و که برای این آن یا را تا هم است های ها ی بر هر چه چی چرا چگونه چطور کدام یک دو سه مدل ظرفیت همراه رنگ بدون تا".split(" "));
// Templated shop words: dropped from the start of a title, and a phrase of only these says nothing.
const GENERIC = new Set("قیمت خرید بهترین فروش ارزان اصل اورجینال انلاین فروشگاه نقد بررسی مشخصات تخصصی مشاهده لیست جدید و به همراه با از در گارانتی ارسال رایگان محصول محصولات".split(" "));

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

/** Ported from hub/planner.py's norm() — the one function kwgap.py needs from it. Inlined
 * here (and duplicated, not imported, since planner.py itself isn't ported yet — Phase 5e)
 * rather than left as a cross-phase dependency. */
export function norm(s: string): string {
  const x = String(s || "").toLowerCase().replace(/‌/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/آ/g, "ا").replace(/أ/g, "ا");
  return x.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

export function words(text: string): string[] {
  return norm(text).match(WORD_RE) || [];
}

function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/** title, up to 2 H1s, up to 15 H2s — plain text, tags stripped. */
export function readPage(body: string): [string, string[], string[]] {
  const p = parsePage(body);
  const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => plainText(m[1])).filter(Boolean).slice(0, 2);
  const h2 = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => plainText(m[1])).filter(Boolean).slice(0, 15);
  return [p.title, h1, h2];
}

export function domains(project: ProjectRow): string[] {
  const out: string[] = [];
  const own = project.domain.toLowerCase().replace(/^www\./, "");
  for (const raw of (project.competitors as string[]) || []) {
    const c = String(raw).trim();
    try {
      const host = new URL(c.includes("://") ? c : `https://${c}`).hostname.toLowerCase().replace(/^www\./, "");
      if (host && host !== own && !out.includes(host)) out.push(host);
    } catch { /* skip malformed entries */ }
  }
  return out;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function readPageHeadings(body: string): { title: string; h1: string[]; h2: string[] } {
  const p = parsePage(body);
  const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1])).filter(Boolean).slice(0, 2);
  const h2 = [...body.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => stripTags(m[1])).filter(Boolean).slice(0, 15);
  return { title: p.title, h1, h2 };
}

// ---------- a minimal robots.txt parser (User-agent: * only, prefix Disallow/Allow) ----------
function parseRobots(body: string): { disallow: string[]; allow: string[] } {
  const lines = body.split(/\r?\n/);
  let inStar = false, inAny = false;
  const disallow: string[] = [], allow: string[] = [];
  for (const raw of lines) {
    const line = raw.split("#")[0].trim();
    if (!line) continue;
    const m = line.match(/^([a-zA-Z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const [, keyRaw, val] = m;
    const key = keyRaw.toLowerCase();
    if (key === "user-agent") { inStar = val.trim() === "*"; inAny = inAny || inStar; continue; }
    if (!inStar) continue;
    if (key === "disallow" && val.trim()) disallow.push(val.trim());
    if (key === "allow" && val.trim()) allow.push(val.trim());
  }
  return { disallow, allow };
}

function canFetch(rules: { disallow: string[]; allow: string[] }, url: string): boolean {
  let path: string;
  try { path = new URL(url).pathname; } catch { return true; }
  const matches = (pat: string) => path.startsWith(pat);
  const bestAllow = Math.max(0, ...rules.allow.filter(matches).map((p) => p.length));
  const bestDisallow = Math.max(0, ...rules.disallow.filter(matches).map((p) => p.length));
  return bestDisallow <= bestAllow;
}

/** A sample is all this needs, so it stops after a few files instead of walking a catalog of millions. */
async function readSitemapUrls(start: string[]): Promise<string[]> {
  const queue = [...start];
  const urls: string[] = [];
  let opened = 0;
  while (queue.length && opened < MAX_SITEMAPS && urls.length < 5000) {
    const u = queue.shift()!;
    const r = await fetchUrl(u); await sleep(DELAY_MS); opened++;
    if (r.status !== 200) continue;
    const locs = [...r.body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].map((m) => m[1]);
    if (r.body.includes("<sitemapindex")) queue.push(...locs); else urls.push(...locs);
  }
  return urls;
}

/** The first read only records what exists; after that, an address not seen before is new. */
function noteNew(projectId: string, host: string, urls: string[]): string[] {
  const seen = new Set(q<{ url: string }>("SELECT url FROM comp_seen WHERE project_id=? AND domain=?", projectId, host).map((r) => r.url));
  const first = seen.size === 0;
  const fresh = urls.filter((u) => { try { return !seen.has(decodeURIComponent(u)); } catch { return !seen.has(u); } });
  if (fresh.length) {
    const now = Date.now() / 1000;
    many("INSERT OR IGNORE INTO comp_seen VALUES (?,?,?,'',?)", fresh.map((u) => {
      let decoded = u; try { decoded = decodeURIComponent(u); } catch { /* keep raw */ }
      return [projectId, host, decoded, first ? 0 : now];
    }));
  }
  return first ? [] : fresh;
}

export type NewPageRow = { domain: string; url: string; title: string; first_seen: number };

export function newPages(pid: string, days = 30, limit = 40): NewPageRow[] {
  return q<NewPageRow>(
    "SELECT domain, url, title, first_seen FROM comp_seen WHERE project_id=? AND first_seen>? AND title!='' ORDER BY first_seen DESC LIMIT ?",
    pid, Date.now() / 1000 - days * 86400, limit,
  );
}

async function readSite(projectId: string, host: string, progress: (done: number, total: number, message: string) => void): Promise<number> {
  const base = `https://${host}`;
  const rb = await fetchUrl(base + "/robots.txt"); await sleep(DELAY_MS);
  const rules = rb.status === 200 ? parseRobots(rb.body) : { disallow: [], allow: [] };
  const maps = rb.status === 200 ? [...rb.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]) : [];
  const started = Date.now();
  let urls = await readSitemapUrls(maps.length ? maps : [base + "/sitemap.xml"]);
  urls = [...new Set(urls)].filter((u) => canFetch(rules, u));
  if (!urls.length) throw new Error("sitemap عمومی پیدا نشد یا robots اجازه نمی‌دهد");
  const fresh = noteNew(projectId, host, urls);
  const targets = [...new Set([...fresh.slice(0, 15), ...crawlSample(urls, base, MAX_PAGES)])];
  const rows: [string, string, string, string, string, string, number][] = [];
  for (let i = 0; i < targets.length; i++) {
    if (Date.now() - started > SITE_SECONDS) break;
    const u = targets[i];
    progress(i, targets.length, `${host}: ${decodeURIComponent(u)}`);
    const r = await fetchUrl(u); await sleep(DELAY_MS);
    if (r.status !== 200) continue;
    const { title, h1, h2 } = readPageHeadings(r.body);
    if (title) {
      let decoded = u; try { decoded = decodeURIComponent(u); } catch { /* keep raw */ }
      rows.push([projectId, host, decoded, title, JSON.stringify(h1), JSON.stringify(h2), Date.now() / 1000]);
    }
  }
  if (!rows.length) throw new Error("هیچ صفحه‌ای خوانده نشد");
  for (const r of rows) run("UPDATE comp_seen SET title=? WHERE project_id=? AND url=?", r[3], projectId, r[2]);
  run("DELETE FROM comp_pages WHERE project_id=? AND domain=?", projectId, host);
  many("INSERT OR REPLACE INTO comp_pages VALUES (?,?,?,?,?,?,?)", rows.map((r) => [...r]));
  return rows.length;
}

export async function runKwgap(project: ProjectRow, progress: (done: number, total: number, message: string) => void = () => {}) {
  const hosts = domains(project);
  if (!hosts.length) throw new Error("اول دامنه رقبا را وارد کنید");
  const read: Record<string, number> = {}, failed: Record<string, string> = {};
  for (const h of hosts) {
    try { read[h] = await readSite(project.id, h, progress); }
    catch (e) { failed[h] = String((e as Error).message || e).slice(0, 160); } // one blocked competitor shouldn't lose the others
  }
  if (hosts.length) run(`DELETE FROM comp_pages WHERE project_id=? AND domain NOT IN (${hosts.map(() => "?").join(",")})`, project.id, ...hosts);
  // keywords.dropFailed() is called here in Python; lib/keywords.ts's dropFailed() does the
  // same job and is wired in by the caller (avoids a circular kwgap<->keywords import).
  if (!Object.keys(read).length) throw new Error("هیچ رقیبی خوانده نشد: " + Object.entries(failed).map(([k, v]) => `${k}: ${v}`).join("؛ "));
  return { read, failed };
}

function segments(title: string, boilerplate: Set<string>): string[] {
  return (title || "").split(SPLIT).map((s) => s.trim()).filter((s) => s && !boilerplate.has(norm(s)));
}

function phrases(text: string): Set<string> {
  const out = new Set<string>();
  for (const part of text.split(PUNCT)) {
    let w = words(part);
    while (w.length && GENERIC.has(w[0])) w = w.slice(1);
    for (const n of [2, 3]) {
      for (let i = 0; i + n <= w.length; i++) {
        const g = w.slice(i, i + n);
        if (EDGE.has(g[0]) || EDGE.has(g[g.length - 1]) || GENERIC.has(g[0])) continue;
        if (/^\d+$/.test(g[g.length - 1]) && !/^[a-z0-9]+$/.test(g[g.length - 2] || "")) continue;
        if (g.some((x) => SPEC.has(x))) continue;
        if (g.every((x) => GENERIC.has(x) || /^\d+$/.test(x) || EDGE.has(x))) continue;
        if (g.filter((x) => /\d/.test(x)).length > 1) continue;
        if (g.some((x) => /^\d+(gb|tb|mb|mah|hz|w)$/.test(x))) continue; // part numbers
        out.add(g.join(" "));
      }
    }
  }
  return out;
}

function ownTitles(pid: string): [Set<string>, string, string][] {
  const rows: [string, string][] = catalogRows(pid).map((r) => [r.name || "", r.url]);
  const pageRows = q<{ title: string; url: string }>(
    "SELECT title, url FROM pages WHERE run_id=(SELECT MAX(id) FROM runs WHERE project_id=? AND kind='audit' AND status='ok')", pid,
  );
  rows.push(...pageRows.map((r) => [r.title || "", r.url] as [string, string]));
  return rows.filter(([t]) => t).map(([t, u]) => [new Set(words(t)), u, t]);
}

export type GapRow = {
  phrase: string; status: "lead" | "weak" | "no_rank" | "gap" | "other"; score: number; competitors: string[];
  pages: number; example: string; clicks: number; impressions: number; position: number | null; my_url: string | null; my_title: string | null;
};

export function analyse(project: ProjectRow, limit = 300) {
  const pid = project.id;
  const pages = q<{ domain: string; url: string; title: string; h1: string; h2: string; ts: number }>("SELECT * FROM comp_pages WHERE project_id=?", pid);
  if (!pages.length) return { rows: [] as GapRow[], competitors: [], summary: {}, has_gsc: false, failed: lastFailed(pid) };

  const perHost = new Map<string, number>();
  for (const p of pages) perHost.set(p.domain, (perHost.get(p.domain) || 0) + 1);
  const segCount = new Map<string, number>(); // key: `${domain}\u0000${seg}`
  for (const p of pages) {
    const parts = [...p.title.split(SPLIT).map((x) => x.trim()), ...JSON.parse(p.h1), ...JSON.parse(p.h2)];
    for (const s of new Set(parts.map(norm))) { const k = `${p.domain}\u0000${s}`; segCount.set(k, (segCount.get(k) || 0) + 1); }
  }
  // A title part repeated across a site is its brand or slogan, not a topic.
  const boiler = new Map<string, Set<string>>();
  for (const h of perHost.keys()) {
    const set = new Set<string>();
    for (const [k, n] of segCount) {
      const [d, s] = k.split("\u0000");
      if (d === h && n >= Math.max(3, perHost.get(h)! * 0.2)) set.add(s);
    }
    boiler.set(h, set);
  }

  const stats = new Map<string, { pages: number; weight: number; domains: Map<string, string> }>();
  for (const p of pages) {
    const h = p.domain;
    const brand = h.split(/[.-]/)[0];
    const seen = new Map<string, number>();
    const sources: [number, string][] = [
      ...segments(p.title, boiler.get(h)!).map((s) => [3, s] as [number, string]),
      ...(JSON.parse(p.h1) as string[]).map((x) => [2, x] as [number, string]),
      ...(JSON.parse(p.h2) as string[]).map((x) => [1, x] as [number, string]),
    ];
    for (const [weight, text] of sources) {
      if (boiler.get(h)!.has(norm(text))) continue;
      for (const g of phrases(text)) {
        if (g.split(" ").includes(brand)) continue;
        seen.set(g, Math.max(seen.get(g) || 0, weight));
      }
    }
    for (const [g, weight] of seen) {
      const s = stats.get(g) || { pages: 0, weight: 0, domains: new Map<string, string>() };
      s.pages++; s.weight += weight;
      if (!s.domains.has(h)) s.domains.set(h, p.url);
      stats.set(g, s);
    }
  }
  for (const [g, s] of [...stats]) if (s.pages < 2 || s.weight < 4) stats.delete(g);
  // Keep the longest wording when a shorter one only ever appears inside it.
  for (const g of [...stats.keys()].sort((a, b) => b.split(" ").length - a.split(" ").length)) {
    if (!stats.has(g)) continue;
    const parts = g.split(" ");
    for (let n = 2; n < parts.length; n++) {
      for (let i = 0; i + n <= parts.length; i++) {
        const sub = parts.slice(i, i + n).join(" ");
        if (stats.has(sub) && stats.get(g)!.pages >= 0.8 * stats.get(sub)!.pages) stats.delete(sub);
      }
    }
  }

  const snapRow = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid);
  const snap = snapRow?.s;
  const queries: [Set<string>, { key: string; clicks: number; impressions: number; position: number }][] = snap
    ? q<{ key: string; clicks: number; impressions: number; position: number }>(
      "SELECT key, clicks, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query'", pid, snap,
    ).map((r) => [new Set(words(r.key)), r])
    : [];
  const own = ownTitles(pid);
  const field = new Set<string>();
  for (const [ws] of own) for (const w of ws) field.add(w);
  for (const [ws] of queries) for (const w of ws) field.add(w);
  for (const k of (project.keywords as string[]) || []) for (const w of words(k)) field.add(w);
  for (const x of [...field]) if (/^\d+$/.test(x) || GENERIC.has(x) || EDGE.has(x)) field.delete(x);

  const ignored = new Set<string>(getSetting<string[]>(`kwgap_ignored:${pid}`, []));
  const rows: GapRow[] = [];
  for (const [g, s] of stats) {
    if (ignored.has(g)) continue;
    const need = new Set(g.split(" "));
    const topic = new Set([...need].filter((x) => !/^\d+$/.test(x) && !GENERIC.has(x) && !EDGE.has(x)));
    const hits = queries.filter(([ws]) => [...need].every((w) => ws.has(w))).map(([, q]) => q);
    const impressions = hits.reduce((a, q) => a + q.impressions, 0);
    const position = impressions ? hits.reduce((a, q) => a + q.position * q.impressions, 0) / impressions : null;
    const page = own.find(([ws]) => [...need].every((w) => ws.has(w)));
    const status: GapRow["status"] = position !== null && position <= 10 ? "lead" : position !== null ? "weak" : page ? "no_rank" : 2 * [...topic].filter((t) => field.has(t)).length >= topic.size ? "gap" : "other";
    const score = Math.round(s.domains.size * 30 + 8 * Math.log2(s.weight + 1) + 3 * Math.log2(impressions + 1));
    rows.push({
      phrase: g, status, score, competitors: [...s.domains.keys()].sort(), pages: s.pages, example: [...s.domains.values()][0],
      clicks: hits.reduce((a, q) => a + q.clicks, 0), impressions, position, my_url: page ? page[1] : null, my_title: page ? page[2] : null,
    });
  }
  rows.sort((a, b) => b.score - a.score);
  const summary: Record<string, number> = {};
  for (const r of rows) summary[r.status] = (summary[r.status] || 0) + 1;
  return {
    rows: rows.slice(0, limit), summary,
    competitors: [...perHost.entries()].map(([h, n]) => ({ domain: h, pages: n, read_at: Math.max(...pages.filter((p) => p.domain === h).map((p) => p.ts)) })),
    has_gsc: !!snap, failed: lastFailed(pid),
  };
}

export function ignore(pid: string, phrase: string) {
  const cur = getSetting<string[]>(`kwgap_ignored:${pid}`, []);
  setSetting(`kwgap_ignored:${pid}`, [...new Set([...cur, String(phrase).slice(0, 120)])]);
}

export function lastFailed(pid: string): Record<string, string> {
  const r = one<{ summary: string }>("SELECT summary FROM runs WHERE project_id=? AND kind='kwgap' AND status='ok' ORDER BY id DESC LIMIT 1", pid);
  return r ? (JSON.parse(r.summary || "{}").failed || {}) : {};
}
