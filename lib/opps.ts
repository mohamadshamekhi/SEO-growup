// Ported 1:1 from hub/opps.py. Read-only findings: search-cannibalization, category-page SEO
// issues, unmet-demand searches, and the owner's weekly digest. Nothing here writes to a site.
import { catalogRows } from "./catalog";
import { one, q } from "./db";
import { key as urlKey, paidOos, restock } from "./funnel";
import * as ga from "./ga";
import type { ProjectRow } from "./projects";

const MIN_COMPETE = 3;
const TWINS: Record<string, string> = { iphone: "آیفون", samsung: "سامسونگ", galaxy: "گلکسی", xiaomi: "شیائومی", airpods: "ایرپاد", apple: "اپل" };
const SKIP = new Set(["خرید", "قیمت", "بهترین", "ارزان", "مدل", "برای", "مناسب", "جدید", "فروش", "با", "و", "در", "از", "به"]);
const INFO = /راهنمای|چیست|چگونه|چطور|آموزش|تشخیص|مشکل|آپدیت|مشخصات|فرق|تفاوت|معرفی|نقد|\bios\b/i;

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩";
function faDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (c) => String(FA_DIGITS.indexOf(c) % 10));
}

type SnapRow = { key: string; clicks: number; impressions: number; position: number };

function snapRows(pid: string, dim: string): SnapRow[] {
  const last = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim=?", pid, dim);
  return last?.s ? q<SnapRow>("SELECT * FROM gsc_snap WHERE project_id=? AND dim=? AND snap=?", pid, dim, last.s) : [];
}

function brandWords(project: ProjectRow): Set<string> {
  const stem = (project.domain || "").split(".")[0].toLowerCase();
  const name = (project.name || "").toLowerCase();
  return new Set([stem, name].filter(Boolean));
}

function isBrandQuery(query: string, project: ProjectRow): boolean {
  const q2 = query.toLowerCase();
  return [...brandWords(project)].some((b) => q2.includes(b));
}

function pairs(pid: string): [string, string, SnapRow][] {
  return snapRows(pid, "query_page")
    .filter((r) => r.key.includes("\t"))
    .map((r) => {
      const idx = r.key.indexOf("\t");
      return [r.key.slice(0, idx), r.key.slice(idx + 1), r] as [string, string, SnapRow];
    });
}

// ---------- two of your pages answering the same search ----------
type CannibalStat = { url: string; clicks: number; impressions: number; position: number };
export type CannibalGroup = { primary: CannibalStat; others: CannibalStat[]; queries: { query: string; impressions: number }[]; impressions: number };

export function cannibals(project: ProjectRow): CannibalGroup[] {
  const pid = project.id;
  const stock = new Map(catalogRows(pid, "product").map((p) => [urlKey(p.url), p.available]));
  const byQuery = new Map<string, { url: string; clicks: number; impressions: number; position: number }[]>();
  for (const [query, page, r] of pairs(pid)) {
    if (!isBrandQuery(query, project)) {
      if (!byQuery.has(query)) byQuery.set(query, []);
      byQuery.get(query)!.push({ url: page, clicks: r.clicks, impressions: r.impressions, position: r.position });
    }
  }
  const groups = new Map<string, { queries: { query: string; impressions: number }[]; stats: Map<string, CannibalStat> }>();
  for (const [query, pages] of byQuery) {
    if (pages.length < 2 || pages.reduce((s, p) => s + p.impressions, 0) < MIN_COMPETE) continue;
    const gkey = [...new Set(pages.map((p) => p.url))].sort().join("\u0001");
    if (!groups.has(gkey)) groups.set(gkey, { queries: [], stats: new Map() });
    const g = groups.get(gkey)!;
    g.queries.push({ query, impressions: pages.reduce((s, p) => s + p.impressions, 0) });
    for (const p of pages) {
      if (!g.stats.has(p.url)) g.stats.set(p.url, { url: p.url, clicks: 0, impressions: 0, position: p.position });
      const s = g.stats.get(p.url)!;
      s.clicks += p.clicks; s.impressions += p.impressions; s.position = Math.min(s.position, p.position);
    }
  }
  const out: CannibalGroup[] = [];
  for (const g of groups.values()) {
    const sorted = [...g.stats.values()].sort((a, b) => {
      const aOos = stock.get(urlKey(a.url)) === 0 ? 1 : 0, bOos = stock.get(urlKey(b.url)) === 0 ? 1 : 0;
      return aOos - bOos || b.clicks - a.clicks || b.impressions - a.impressions || a.position - b.position;
    });
    out.push({
      primary: sorted[0], others: sorted.slice(1),
      queries: g.queries.sort((a, b) => b.impressions - a.impressions),
      impressions: g.queries.reduce((s, q2) => s + q2.impressions, 0),
    });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

export function cannibalBrief(groups: CannibalGroup[]): string {
  if (!groups.length) return "";
  const parts = groups.slice(0, 10).map((g) =>
    `جستجو: ${g.queries.slice(0, 3).map((q2) => q2.query).join("، ")}\nصفحه اصلی: ${g.primary.url}\nصفحه‌های رقیب: ${g.others.map((p) => p.url).join("، ")}`,
  );
  return "این صفحه‌های سایت برای یک جستجو با هم رقابت می‌کنند. برای هر گروه: اگر محتوا تکراری است، صفحه رقیب را با 301 به صفحه اصلی ببرید یا canonical آن را صفحه اصلی بگذارید. اگر هدف صفحه فرق دارد، عنوان و متن آن را متمایز کنید و به صفحه اصلی لینک بدهید.\n\n" + parts.join("\n\n");
}

// ---------- category pages ----------
type CategoryRow = { url: string; title: string; words: number | null; clicks: number; impressions: number; position: number | null; queries: string[]; issues: string[] };

export function categories(project: ProjectRow): CategoryRow[] {
  const pid = project.id;
  const run = one<{ i: number | null }>("SELECT MAX(id) i FROM runs WHERE project_id=? AND kind='audit' AND status='ok'", pid);
  if (!run?.i) return [];
  const seen = new Map(snapRows(pid, "page").map((r) => [urlKey(r.key), r]));
  const queries = new Map<string, [number, string][]>();
  for (const [query, page, r] of pairs(pid)) {
    if (!isBrandQuery(query, project)) {
      const k = urlKey(page);
      if (!queries.has(k)) queries.set(k, []);
      queries.get(k)!.push([r.impressions, query]);
    }
  }
  const out: CategoryRow[] = [];
  for (const p of q<{ url: string; title: string | null; words: number | null; title_len: number | null; desc_len: number | null }>(
    "SELECT * FROM pages WHERE run_id=? AND kind='listing'", run.i,
  )) {
    const k = urlKey(p.url);
    const g = seen.get(k);
    const top = [...(queries.get(k) || [])].sort((a, b) => b[0] - a[0]).slice(0, 3).map(([, q2]) => q2);
    const title = p.title || "";
    const issues: string[] = [];
    if ((p.words || 0) < 300) issues.push(`متن کم (${p.words || 0} کلمه)`);
    if (!(p.title_len != null && p.title_len >= 30 && p.title_len <= 60)) issues.push("طول عنوان مناسب نیست");
    if (!(p.desc_len != null && p.desc_len >= 120 && p.desc_len <= 160)) issues.push("طول توضیح مناسب نیست");
    if (top.length && !top[0].split(/\s+/).some((w) => !SKIP.has(w) && title.includes(w))) issues.push(`جستجوی اصلی در عنوان نیست: ${top[0]}`);
    out.push({ url: p.url, title, words: p.words, clicks: g?.clicks || 0, impressions: g?.impressions || 0, position: g?.position ?? null, queries: top, issues });
  }
  return out.sort((a, b) => b.impressions - a.impressions || b.issues.length - a.issues.length);
}

export function categoryBrief(rows: CategoryRow[]): string {
  const bad = rows.filter((r) => r.issues.length);
  if (!bad.length) return "";
  const lines = bad.slice(0, 15).map((r) => `${r.url}: ${r.issues.join("؛ ")}`);
  return "صفحه‌های دسته‌بندی برای رتبه گرفتن به عنوان، توضیح و متن اختصاصی نیاز دارند. لطفاً امکان عنوان سئو، توضیح سئو و متن معرفی را برای هر دسته اضافه کنید تا از بک‌آفیس قابل ویرایش باشد و در صفحه نمایش داده شود، نه یک الگوی ثابت برای همه دسته‌ها.\n\nوضعیت فعلی:\n" + lines.join("\n");
}

// ---------- searches with nothing to sell ----------
function tokens(text: string | undefined | null): Set<string> {
  const out = new Set<string>();
  for (const w of (faDigits(text || "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [])) if (!SKIP.has(w)) out.add(TWINS[w] || w);
  return out;
}

type DemandRow = { query: string; impressions: number; clicks: number; position: number; status: "out_of_stock" | "none"; example: string };

export function demand(project: ProjectRow): DemandRow[] {
  const pid = project.id;
  const products: [Set<string>, { name?: string; available: number | null }][] = catalogRows(pid, "product")
    .filter((p) => p.name)
    .map((p) => [tokens(p.name), p]);
  const out: DemandRow[] = [];
  for (const r of snapRows(pid, "query")) {
    const query = r.key;
    if (isBrandQuery(query, project) || INFO.test(query)) continue;
    const w = tokens(query);
    if (!w.size || (w.size === 1 && query.length < 4)) continue;
    const matched = products.filter(([t]) => [...w].filter((x) => t.has(x)).length / w.size >= 0.7).map(([, p]) => p);
    if (matched.some((p) => p.available === 1)) continue;
    out.push({ query, impressions: r.impressions, clicks: r.clicks, position: r.position, status: matched.length ? "out_of_stock" : "none", example: matched[0]?.name || "" });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, 40);
}

// ---------- the owner's week ----------
export function digest(project: ProjectRow, now?: number) {
  const pid = project.id;
  now = now ?? Date.now() / 1000;
  const week = now - 7 * 86400;
  const changes = q<{ type: string; n: number }>(
    "SELECT type, COUNT(*) n FROM applied WHERE project_id=? AND undone=0 AND type!='publish' AND ts>=? GROUP BY type ORDER BY n DESC", pid, week,
  );
  const verdicts: Record<string, number> = {};
  for (const r of q<{ verdict: string; n: number }>("SELECT verdict, COUNT(*) n FROM impact WHERE project_id=? AND measured>=? GROUP BY verdict", pid, week)) verdicts[r.verdict] = r.n;
  const days = q<{ clicks: number; impressions: number }>("SELECT clicks, impressions FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 14", pid);
  const clicks = days.length ? days.slice(0, 7).reduce((s, d) => s + d.clicks, 0) : null;
  const before = days.length >= 14 ? days.slice(7, 14).reduce((s, d) => s + d.clicks, 0) : null;
  const paid = paidOos(pid);
  const silent = ga.tracking(pid).filter((t) => t.status !== "ok");
  const waiting = one<{ n: number }>(
    "SELECT COUNT(*) n FROM fixes WHERE project_id=? AND status='pending' AND type IN ('oos_links','cro_description','kw_title','kw_description','kw_faq','kw_refresh') AND proposed!=''", pid,
  )!.n;
  const worse = verdicts.worse || 0;
  const competing = cannibals(project);
  const weak = categories(project).filter((r) => r.issues.length);
  const actions: string[] = [];
  if (worse) actions.push(`${worse} تغییر این هفته افت داشته است؛ نتیجه تغییرها را ببین و در صورت نیاز برگردان.`);
  if (silent.length) actions.push(`${silent.length} رویداد فروش به Analytics نمی‌رسد؛ پیگیری از فرانت.`);
  if (paid.length) actions.push(`${paid.length} محصول ناموجود ورودی پولی می‌گیرد؛ در ترب خاموش کن یا موجودی را به‌روز کن.`);
  if (waiting) actions.push(`${waiting} پیشنهاد منتظر تأیید توست.`);
  if (competing.length) actions.push(`${competing.length} گروه صفحه برای یک جستجو رقابت می‌کنند؛ پیام برنامه‌نویس آماده است.`);
  if (weak.length) actions.push(`${weak.length} صفحه دسته‌بندی ایراد دارد؛ پیام برنامه‌نویس آماده است.`);
  return {
    changes, total_changes: changes.reduce((s, c) => s + c.n, 0), verdicts, clicks, clicks_before: before,
    paid_oos: paid.length, paid_sessions: paid.reduce((s, r) => s + r.sessions, 0),
    restock: restock(pid, 3).map((r) => r.name), waiting, actions: actions.slice(0, 3),
  };
}

export function state(project: ProjectRow) {
  const competing = cannibals(project);
  const cats = categories(project);
  return { digest: digest(project), cannibals: competing, cannibal_brief: cannibalBrief(competing), categories: cats, category_brief: categoryBrief(cats), demand: demand(project) };
}
