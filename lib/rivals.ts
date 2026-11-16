// «پیدا کردن رقبا» on the Watches tab: given one of our pages, suggest the competitor pages that
// actually compete with it — from data the panel already collected, no new crawling or searching:
//  1. the Google queries this page gets impressions for (Search Console, query×page),
//  2. the saved Google results for those queries (serp table) → pages from other sites ranking there,
//  3. pages read from configured competitor sites (comp_pages / comp_seen) whose title/headings/slug
//     overlap this page's topic.
// Every suggestion carries the reason it was picked; nothing is invented.
import { one, q } from "./db";
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { words, domains } from "./kwgap";
import type { ProjectRow } from "./projects";

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
