// «پیدا کردن رقبا» on the Watches tab: given one of our pages, suggest the competitor pages that
// actually compete with it — from data the panel already collected, no new crawling or searching:
//  1. the Google queries this page gets impressions for (Search Console, query×page),
//  2. the saved Google results for those queries (serp table) → pages from other sites ranking there,
//  3. pages read from configured competitor sites (comp_pages / comp_seen) whose title/headings/slug
//     overlap this page's topic.
// Every suggestion carries the reason it was picked; nothing is invented.
import { one, q, run } from "./db";
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { words, domains } from "./kwgap";
import { flag, MARKETPLACES, setCompetitors, userEdited } from "./keywords";
import { addWatch } from "./extras";
import { project as getProject, type ProjectRow } from "./projects";

export type Rival = { url: string; title: string; domain: string; score: number; reasons: string[] };
export type RivalResult = { rivals: Rival[]; queries: string[]; notes: string[] };

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } };
const STOP = new Set(["و", "در", "به", "از", "با", "برای", "که", "این", "را", "یا", "تا", "استیو", "موبایل", "خرید", "قیمت", "the", "and", "for", "with", "of", "to", "a", "in"]);
const tokens = (t: string) => new Set(words(t.replace(/[-_/]+/g, " ")).filter((w) => w.length > 1 && !STOP.has(w)));
function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size);
}
const slugText = (u: string) => { try { return decodeURIComponent(new URL(u).pathname); } catch { return u; } };

export function findRivals(project: ProjectRow, pageUrl: string): RivalResult {
  const pid = project.id;
  const own = project.domain.toLowerCase().replace(/^www\./, "");
  const url = U(pageUrl);
  const notes: string[] = [];
  if (host(pageUrl) && host(pageUrl) !== own) notes.push("این آدرس مال سایت خود پروژه نیست؛ نتایج ممکن است دقیق نباشد.");

  // 1. What Google shows this page for.
  const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query_page'", pid)?.s;
  const qrows = snap
    ? q<{ key: string; impressions: number; position: number }>(
        "SELECT key, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query_page' ORDER BY impressions DESC LIMIT 5000", pid, snap,
      ).filter((r) => U(r.key.split("\t")[1] || "") === url).slice(0, 20)
    : [];
  const queries = qrows.map((r) => r.key.split("\t")[0]);
  if (!snap) notes.push("داده سرچ کنسول هنوز گرفته نشده؛ اتصال سرچ کنسول را در تنظیمات بررسی کنید.");
  else if (!queries.length) notes.push("این صفحه در ۲۸ روز گذشته برای هیچ جستجویی در گوگل دیده نشده؛ رقبا فقط از روی موضوع صفحه پیدا شدند.");

  const cat = catalogRows(pid).find((c) => U(c.url) === url);
  const topic = tokens([cat?.title || "", cat?.name || "", slugText(pageUrl), ...queries.slice(0, 8)].join(" "));

  const found = new Map<string, Rival>();
  const add = (u: string, title: string, score: number, reason: string) => {
    const d = host(u);
    if (!d || d === own || !u.startsWith("http")) return;
    const k = U(u);
    const r = found.get(k) || { url: u, title, domain: d, score: 0, reasons: [] };
    r.score += score;
    if (!r.title && title) r.title = title;
    if (r.reasons.length < 4 && !r.reasons.includes(reason)) r.reasons.push(reason);
    found.set(k, r);
  };

  // 2. Pages ranking on Google for the same queries.
  const imp = new Map(qrows.map((r) => [r.key.split("\t")[0], r.impressions]));
  let serpHits = 0;
  if (queries.length) {
    const marks = queries.map(() => "?").join(",");
    const latest = new Map<string, { url: string; title: string }[]>();
    for (const r of q<{ keyword: string; results: string }>(
      `SELECT keyword, results FROM serp WHERE project_id=? AND keyword IN (${marks}) ORDER BY checked DESC`, pid, ...queries,
    )) if (!latest.has(r.keyword)) latest.set(r.keyword, JSON.parse(r.results));
    for (const [kw, results] of latest) {
      results.forEach((res, i) => {
        serpHits++;
        add(res.url, res.title, (11 - Math.min(i + 1, 10)) * (1 + Math.log10(1 + (imp.get(kw) || 0))), `در گوگل برای «${kw}» رتبه ${i + 1} است`);
      });
    }
    if (!latest.size) notes.push("نتایج گوگل برای کلمه‌های این صفحه هنوز ذخیره نشده (بخش رتبه‌ها)؛ با اجرای آن، رقبای دقیق‌تری پیدا می‌شود.");
  }

  // 3. Similar pages on known competitor sites.
  const compDomains = domains(project);
  if (!compDomains.length) notes.push("هیچ سایت رقیبی در تنظیمات پروژه ثبت نشده؛ با افزودن رقبا، صفحه‌های مشابه آن‌ها هم پیدا می‌شود.");
  for (const r of q<{ domain: string; url: string; title: string; h1: string }>("SELECT domain, url, title, h1 FROM comp_pages WHERE project_id=?", pid)) {
    const sim = overlap(topic, tokens(`${r.title} ${JSON.parse(r.h1 || "[]").join(" ")} ${slugText(r.url)}`));
    if (sim >= 0.5) add(r.url, r.title, sim * 8, `صفحه هم‌موضوع در سایت رقیب ${r.domain} (عنوان: ${r.title})`);
  }
  for (const r of q<{ domain: string; url: string; title: string }>("SELECT domain, url, title FROM comp_seen WHERE project_id=?", pid)) {
    if (found.has(U(r.url))) continue;
    const sim = overlap(topic, tokens(`${r.title} ${slugText(r.url)}`));
    if (sim >= 0.6) add(r.url, r.title, sim * 6, `آدرس هم‌موضوع در sitemap رقیب ${r.domain}`);
  }

  // Prefer variety: at most 2 pages per site among the top picks.
  const perSite: Record<string, number> = {};
  const rivals = [...found.values()].sort((a, b) => b.score - a.score).filter((r) => (perSite[r.domain] = (perSite[r.domain] || 0) + 1) <= 2).slice(0, 8);
  if (!rivals.length && !serpHits) notes.push("با داده فعلی رقیبی پیدا نشد.");
  return { rivals: rivals.map((r) => ({ ...r, score: Math.round(r.score * 10) / 10 })), queries: queries.slice(0, 8), notes };
}

// ---------- competitor sites (whole store) ----------
export type RivalSite = { domain: string; keywords: number; avgRank: number; score: number; sample: string[]; current: boolean };

/** Sites that most often rank next to us on Google across all tracked keywords (saved results only). */
export function rivalSites(project: ProjectRow): { sites: RivalSite[]; current: string[]; notes: string[] } {
  const pid = project.id;
  const own = project.domain.toLowerCase().replace(/^www\./, "");
  const current = domains(project);
  const blocked = new Set(flag<string[]>(pid, "blocked", []));
  const latest = new Map<string, { url: string }[]>();
  for (const r of q<{ keyword: string; results: string }>("SELECT keyword, results FROM serp WHERE project_id=? ORDER BY checked DESC LIMIT 2000", pid)) {
    if (!latest.has(r.keyword)) latest.set(r.keyword, JSON.parse(r.results));
  }
  const imp = new Map<string, number>();
  const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query'", pid)?.s;
  if (snap) for (const r of q<{ key: string; impressions: number }>("SELECT key, impressions FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query'", pid, snap)) imp.set(r.key, r.impressions);

  const agg = new Map<string, { kws: Set<string>; ranks: number[]; score: number }>();
  for (const [kw, results] of latest) {
    const seen = new Set<string>();
    results.slice(0, 10).forEach((res, i) => {
      const d = host(res.url);
      if (!d || d === own || seen.has(d) || MARKETPLACES.has(d) || blocked.has(d)) return;
      seen.add(d);
      const a = agg.get(d) || { kws: new Set<string>(), ranks: [], score: 0 };
      a.kws.add(kw); a.ranks.push(i + 1);
      a.score += (11 - (i + 1)) * (1 + Math.log10(1 + (imp.get(kw) || 0)));
      agg.set(d, a);
    });
  }
  const notes: string[] = [];
  if (!latest.size) notes.push("نتایج گوگل هنوز ذخیره نشده؛ بعد از اولین اجرای «رتبه‌ها» در زمان‌بندی، رقبا پیدا می‌شوند.");
  const sites = [...agg.entries()]
    .filter(([, a]) => a.kws.size >= 2)
    .map(([domain, a]) => ({
      domain, keywords: a.kws.size, avgRank: Math.round((a.ranks.reduce((x, y) => x + y, 0) / a.ranks.length) * 10) / 10,
      score: Math.round(a.score), sample: [...a.kws].slice(0, 4), current: current.includes(domain),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  return { sites, current, notes };
}

// ---------- automatic discovery ----------
const AUTO_PAGES = 20, AUTO_RIVALS = 3;

/** Important pages first: most Google impressions (Search Console), else the catalog. */
function importantPages(project: ProjectRow): string[] {
  const own = project.domain.toLowerCase().replace(/^www\./, "");
  const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='page'", project.id)?.s;
  const fromGsc = snap
    ? q<{ key: string }>("SELECT key FROM gsc_snap WHERE project_id=? AND snap=? AND dim='page' ORDER BY impressions DESC LIMIT 60", project.id, snap).map((r) => r.key)
    : [];
  const pages = (fromGsc.length ? fromGsc : catalogRows(project.id).map((c) => c.url))
    .filter((u) => host(u) === own && new URL(u).pathname.length > 1);
  return [...new Set(pages)].slice(0, AUTO_PAGES);
}

/**
 * Runs before every watch check (and from the «پیدا کردن خودکار» button):
 * 1. if the competitor list was never set by hand, fills it with the top rival sites;
 * 2. gives each important page a watch with its best rival pages. Watches the owner added
 *    stay untouched; auto ones get their rivals refreshed; a deleted auto watch never returns.
 */
export async function autoDiscover(project: ProjectRow): Promise<{ sites: string[]; created: number; updated: number }> {
  const pid = project.id;
  let sites = domains(project);
  if (!sites.length || flag<boolean>(pid, "auto", true)) {
    const top = rivalSites(project).sites.map((s) => s.domain);
    if (top.length) { try { sites = setCompetitors(project, top).competitors; } catch { /* nothing valid */ } }
  }

  const fresh = getProject(pid) || project;
  const manual = new Set(q<{ mine: string; id: number }>("SELECT mine, id FROM watches WHERE project_id=?", pid)
    .filter((w) => !one("SELECT 1 FROM watch_auto WHERE project_id=? AND watch_id=?", pid, w.id))
    .map((w) => U(w.mine)));
  let created = 0, updated = 0;
  for (const page of importantPages(fresh)) {
    const key = U(page);
    if (manual.has(key)) continue;
    const meta = one<{ watch_id: number; blocked: number }>("SELECT watch_id, blocked FROM watch_auto WHERE project_id=? AND mine=?", pid, key);
    if (meta?.blocked) continue;
    const picks = findRivals(fresh, page).rivals.slice(0, AUTO_RIVALS);
    if (!picks.length) continue;
    const others = picks.map((r) => r.url);
    const reasons = JSON.stringify(Object.fromEntries(picks.map((r) => [r.url, r.reasons])));
    if (meta && one("SELECT 1 FROM watches WHERE id=?", meta.watch_id)) {
      run("UPDATE watches SET others=? WHERE id=?", JSON.stringify(others), meta.watch_id);
      run("UPDATE watch_auto SET reasons=? WHERE project_id=? AND mine=?", reasons, pid, key);
      updated++;
      continue;
    }
    try {
      const id = Number(await addWatch(pid, page, others));
      run("INSERT OR REPLACE INTO watch_auto(project_id, mine, watch_id, blocked, reasons) VALUES (?,?,?,0,?)", pid, key, id, reasons);
      created++;
    } catch { /* a URL that fails the public-address check is just skipped */ }
  }
  return { sites, created, updated };
}

/** The owner deleted a watch: drop it; if the panel made it, remember not to make it again. */
export function deleteWatch(pid: string, watchId: number) {
  const w = one<{ mine: string }>("SELECT mine FROM watches WHERE id=? AND project_id=?", watchId, pid);
  if (!w) throw new Error("پیدا نشد");
  run("DELETE FROM watches WHERE id=?", watchId);
  run("UPDATE watch_auto SET blocked=1 WHERE project_id=? AND mine=?", pid, U(w.mine));
}

/** The owner edits the competitor-site list by hand. */
export function setRivalSites(project: ProjectRow, list: string[]) {
  const old = (project.competitors as string[]) || [];
  const after = [...new Set(list.map((x) => String(x).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean))].slice(0, 5);
  run("UPDATE projects SET competitors=? WHERE id=?", JSON.stringify(after), project.id);
  userEdited(project.id, old, after);
  return domains({ ...project, competitors: after } as ProjectRow);
}
