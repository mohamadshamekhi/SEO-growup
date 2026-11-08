// Ported 1:1 from hub/planner.py. Content planning: the site's real article list, topic
// ideas that don't repeat it, and the weekly schedule. Scheduled writing only ever fills the
// review queue — nothing here sends anything to a site.
import * as adapters from "./adapters";
import { tokens as catalogTokens, catalogRows } from "./catalog";
import { articleBrief, add, listing } from "./content";
import { getSetting, many, now as dbNow, one, q, run, setSetting } from "./db";
import { bestSellers } from "./growth";
import type { ProjectRow } from "./projects";

const TEHRAN_OFFSET_MIN = 3 * 60 + 30; // fixed offset, so containers without tzdata agree
const DEFAULT_PLAN = { enabled: false, days: [5], hour: 9, per_run: 1, ideate: true, auto_write: false, ig_weekly: false, ig_day: 4 };
const MAX_PER_RUN = 5;
// Article shapes the writer can use; length follows the shape, not one fixed number.
const ARTICLE_TYPES: Record<string, [string, number, number]> = {
  news: ["خبر و تحلیل کوتاه", 350, 800], guide: ["راهنمای خرید", 900, 1600], compare: ["مقایسه", 800, 1400],
  howto: ["آموزش و حل مشکل", 500, 1100], list: ["فهرست پیشنهادی", 700, 1300], faq: ["پرسش و پاسخ", 400, 900],
};
// Jalali month/day of occasions shoppers plan for.
const OCCASIONS: [number, number, string][] = [[1, 1, "نوروز"], [2, 12, "روز معلم"], [6, 31, "بازگشایی مدارس"], [8, 13, "روز دانش‌آموز"], [9, 16, "روز دانشجو"], [9, 30, "شب یلدا"], [12, 1, "خرید عید"]];
export const SIMILAR = 0.6;

function norm(s: string): string {
  const x = String(s || "").toLowerCase().replace(/‌/g, " ").replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/آ/g, "ا").replace(/أ/g, "ا");
  return x.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
}

export function tok(s: string): Set<string> {
  return catalogTokens(norm(s));
}

// ---------- the site's article list ----------
type SiteArticleRecord = [string, string, string, number, string, number, string, string, string, number];

/** Every article on the site, drafts included, so planning never repeats one. Without an API, what the crawl found. */
export async function syncArticles(project: ProjectRow) {
  const pid = project.id;
  const now = dbNow();
  let recs: SiteArticleRecord[];
  let source: "api" | "crawl";
  if ((adapters.config(pid) || {}).type === "steve") {
    const api = adapters.client(pid);
    const rows: Record<string, unknown>[] = [];
    for (let page = 1; page <= 50; page++) {
      const d = await api.req("GET", `/article?page_number=${page}&page_size=100`);
      const items = (d.articles as Record<string, unknown>[]) || [];
      rows.push(...items);
      if (items.length < 100) break;
    }
    recs = rows.map((a) => [
      pid, String(a.slug), String(a.title || ""), a.is_published ? 1 : 0, String(a.meta_description || ""),
      Number(a.view_count || 0), String(a.created_at || ""), String(a.back_office_name || ""), JSON.stringify(a.tags || []), now,
    ]);
    source = "api";
  } else {
    recs = catalogRows(pid, "article").map((r) => [
      pid, decodeURIComponent(r.url.split("/").pop() || ""), r.name, 1, r.meta, 0, "", "", "[]", now,
    ]);
    source = "crawl";
  }
  run("DELETE FROM site_articles WHERE project_id=?", pid);
  many("INSERT INTO site_articles(project_id,slug,title,published,meta,views,created,author,tags,synced) VALUES (?,?,?,?,?,?,?,?,?,?)", recs);
  return { total: recs.length, published: recs.reduce((s, r) => s + (r[3] as number), 0), drafts: recs.reduce((s, r) => s + (1 - (r[3] as number)), 0), source };
}

type SiteArticle = { slug: string; title: string; published: number; meta: string; views: number; created: string; author: string; tags: string };

export function siteArticles(pid: string): SiteArticle[] {
  return q<SiteArticle>("SELECT slug, title, published, meta, views, created, author, tags FROM site_articles WHERE project_id=? ORDER BY created DESC, title", pid);
}

/** Published articles the sitemap may be missing, so the crawl still reads them. */
export function urlsForCatalog(project: ProjectRow): string[] {
  return q<{ slug: string }>("SELECT slug FROM site_articles WHERE project_id=? AND published=1", project.id).map((r) => `https://${project.domain}/blog/${encodeURIComponent(r.slug)}`);
}

type ContentArticleRow = ReturnType<typeof listing>[number];

/** The existing article or queued piece that already covers this topic, if any. */
export function findSimilar(topic: string, pid: string): string | null {
  const t = tok(topic);
  if (!t.size) return null;
  let best: string | null = null, bestScore = 0;
  const pool: [string, string][] = [
    ...siteArticles(pid).map((a): [string, string] => [`${a.title} ${(JSON.parse(a.tags || "[]") as string[]).join(" ")}`, a.title]),
    ...listing(pid, "article").filter((c) => c.status !== "rejected").map((c: ContentArticleRow): [string, string] => [
      `${c.topic} ${(c.output.title as string) || ""}`, (c.output.title as string) || c.topic,
    ]),
  ];
  for (const [text, title] of pool) {
    const other = tok(text);
    const score = [...t].filter((w) => other.has(w)).length / t.size;
    if (score > bestScore) { best = title; bestScore = score; }
  }
  return bestScore >= SIMILAR ? best : null;
}

// ---------- ideas ----------
export function refreshIdeas(project: ProjectRow) {
  const pid = project.id;
  const now = Date.now() / 1000;
  const brand = new Set([...tok(project.name), ...tok(project.domain.split(".")[0]), norm(project.domain)]);
  const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid)?.s;
  const cands: [string, string, string, number][] = (project.keywords as string[]).map((k) => [k, k, "کلمه هدف", 50.0]);
  if (snap) {
    for (const r of q<{ key: string; impressions: number; position: number }>(
      "SELECT key, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query' AND impressions>=2", pid, snap,
    )) {
      const t = tok(r.key);
      if (t.size < 2 || [...t].some((w) => brand.has(w))) continue; // single words and brand searches aren't article topics
      cands.push([r.key, r.key, "جستجوی گوگل", r.impressions * (r.position <= 30 ? 2 : 1)]);
    }
  }
  for (const g of catalogGroups(pid)) if (!g.covered_by && g.in_stock >= 10) cands.push([`راهنمای انتخاب ${g.name}`, g.name, "کاتالوگ فروشگاه", g.in_stock]);
  let added = 0;
  for (const [topic, kw, source, score] of [...cands].sort((a, b) => b[3] - a[3])) {
    const key = [...tok(topic)].sort().join(" ");
    if (!key) continue;
    const row = one<{ id: number; status: string }>("SELECT id, status FROM ideas WHERE project_id=? AND topic_key=?", pid, key);
    const sim = findSimilar(topic, pid);
    if (row) {
      if (row.status === "idea" && sim) run("UPDATE ideas SET status='exists', reason=? WHERE id=?", sim, row.id);
      else if (row.status === "idea") run("UPDATE ideas SET score=? WHERE id=?", score, row.id);
      continue;
    }
    const meta = JSON.stringify(source === "کاتالوگ فروشگاه" ? { type: "guide" } : {});
    run(
      "INSERT INTO ideas(project_id,topic,keyword,topic_key,source,score,status,reason,ts,meta) VALUES (?,?,?,?,?,?,?,?,?,?)",
      pid, topic, kw, key, source, score, sim ? "exists" : "idea", sim || "", now, meta,
    );
    if (!sim) added++;
  }
  return { new_ideas: added };
}

/** [year, month, day] in the Jalali calendar, via a fixed +03:30 offset so containers without tzdata agree. */
export function jalaliToday(now?: number): [number, number, number] {
  const ts = (now ?? Date.now() / 1000) * 1000 + TEHRAN_OFFSET_MIN * 60 * 1000;
  const d = new Date(ts);
  const gy = d.getUTCFullYear(), gm = d.getUTCMonth() + 1, gd = d.getUTCDate();
  const y2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + 365 * gy + Math.floor((y2 + 3) / 4) - Math.floor((y2 + 99) / 100) + Math.floor((y2 + 399) / 400) + gd
    + [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334][gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days = days % 12053;
  jy += 4 * Math.floor(days / 1461);
  days = days % 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  const jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return [jy, jm, jd];
}

export function upcomingOccasions(now?: number, within = 45) {
  const [, m, d] = jalaliToday(now);
  const today = m <= 6 ? (m - 1) * 31 + d : 186 + (m - 7) * 30 + d;
  const out: { name: string; days_left: number }[] = [];
  for (const [om, od, name] of OCCASIONS) {
    const at = om <= 6 ? (om - 1) * 31 + od : 186 + (om - 7) * 30 + od;
    const left = ((at - today) % 365 + 365) % 365;
    if (left <= within) out.push({ name, days_left: left });
  }
  return out.sort((a, b) => a.days_left - b.days_left);
}

type CatalogGroup = { name: string; products: number; in_stock: number; covered_by: string | null };

/** What the store sells most, by the first words of product names, with whether an article already covers it. */
export function catalogGroups(pid: string): CatalogGroup[] {
  const groups = new Map<string, CatalogGroup>();
  for (const r of catalogRows(pid, "product")) {
    const words = norm(r.name).split(/\s+/).filter((w) => w.length > 1);
    if (words.length < 2) continue;
    const key = words.slice(0, 2).join(" ");
    if (!groups.has(key)) groups.set(key, { name: r.name.split(/\s+/).slice(0, 2).join(" "), products: 0, in_stock: 0, covered_by: null });
    const g = groups.get(key)!;
    g.products++;
    g.in_stock += r.available !== 0 ? 1 : 0;
  }
  const out = [...groups.values()].filter((g) => g.in_stock >= 5);
  for (const g of out) g.covered_by = findSimilar(g.name, pid);
  return out.sort((a, b) => b.in_stock - a.in_stock).slice(0, 15);
}

export function ideas(pid: string) {
  return q<{ id: number; topic: string; keyword: string; source: string; score: number; status: string; reason: string; meta: string }>(
    "SELECT id, topic, keyword, source, score, status, reason, meta FROM ideas WHERE project_id=? ORDER BY CASE status WHEN 'idea' THEN 0 WHEN 'exists' THEN 1 ELSE 2 END, score DESC LIMIT 100", pid,
  );
}

/** Everything current that should decide what to write next. It changes as the site and its traffic change. */
export function signals(project: ProjectRow, now?: number) {
  const pid = project.id;
  const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid)?.s;
  const queries = snap
    ? q<{ key: string; clicks: number; impressions: number; position: number; prev_clicks: number | null; prev_position: number | null }>(
        "SELECT key, clicks, impressions, position, prev_clicks, prev_position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query' ORDER BY impressions DESC LIMIT 60", pid, snap,
      )
    : [];
  const rising = queries.filter((r) => r.prev_position && r.position < r.prev_position - 2);
  const arts = siteArticles(pid);
  const top = [...arts].sort((a, b) => (b.views || 0) - (a.views || 0)).slice(0, 10);
  const recent = arts.filter((a) => a.created).slice(0, 10);
  const [y, m, d] = jalaliToday(now);
  return {
    site: project.name, domain: project.domain, today_jalali: `${y}/${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}`, occasions_soon: upcomingOccasions(now),
    top_queries: queries.slice(0, 25), rising_queries: rising.slice(0, 10),
    target_keywords: [...(project.keywords as string[]), ...q<{ keyword: string }>("SELECT keyword FROM keywords WHERE project_id=? AND status IN ('idea','task','new') LIMIT 30", pid).map((r) => r.keyword)],
    best_articles: top.map((a) => ({ title: a.title, views: a.views, date: a.created.slice(0, 10) })),
    newest_articles: recent.map((a) => ({ title: a.title, views: a.views, date: a.created.slice(0, 10) })),
    all_titles: arts.map((a) => a.title).slice(0, 300), store_groups: catalogGroups(pid),
    best_selling_products: bestSellers(project).slice(0, 15).map((r) => ({ name: r.name, units: r.units })),
    rejected_topics: q<{ topic: string }>("SELECT topic FROM ideas WHERE project_id=? AND status='skipped' LIMIT 40", pid).map((r) => r.topic),
    open_ideas: ideas(pid).filter((i) => i.status === "idea").map((i) => i.topic),
    article_types: Object.fromEntries(Object.entries(ARTICLE_TYPES).map(([k, v]) => [k, v[0]])),
  };
}

export function addIdea(project: ProjectRow, topicIn: string, keyword = "", kind = "guide", why = "", priority = 50, sources?: string[], outline?: string[], nearOk = false): number | bigint {
  const topic = String(topicIn || "").trim().slice(0, 200);
  if (tok(topic).size < 2) throw new Error("موضوع مشخص نیست");
  if (!(kind in ARTICLE_TYPES)) throw new Error("نوع مقاله نامعتبر است");
  const pid = project.id;
  const sim = findSimilar(topic, pid);
  if (sim && !nearOk) throw new Error(`تکراری است؛ مقاله موجود: ${sim}`);
  if (sim) why = `${why} مقاله نزدیک موجود: «${sim}»؛ زاویه تازه بنویس و تکرارش نکن.`;
  const key = [...tok(topic)].sort().join(" ");
  if (one("SELECT 1 FROM ideas WHERE project_id=? AND topic_key=?", pid, key)) throw new Error("این ایده قبلاً ثبت شده");
  const meta = {
    type: kind, why: String(why).slice(0, 400),
    sources: (sources || []).map((x) => String(x).slice(0, 300)).filter((x) => x.startsWith("http")).slice(0, 6),
    outline: (outline || []).map((x) => String(x).slice(0, 120)).slice(0, 10),
  };
  return run(
    "INSERT INTO ideas(project_id,topic,keyword,topic_key,source,score,status,reason,ts,meta) VALUES (?,?,?,?,?,?,'idea','',?,?)",
    pid, topic, String(keyword || topic).slice(0, 120), key, "پیشنهاد هوشمند", Math.max(0, Math.min(100, Number(priority))), Date.now() / 1000, JSON.stringify(meta),
  ).lastInsertRowid;
}

export function queueIdea(project: ProjectRow, ideaId: number, auto = false) {
  const i = one<{ id: number; topic: string; keyword: string; meta: string }>("SELECT * FROM ideas WHERE id=? AND project_id=?", ideaId, project.id);
  if (!i) throw new Error("پیدا نشد");
  const brief = articleBrief(project, i.topic, i.keyword) as Record<string, unknown>;
  brief.auto = auto;
  Object.assign(brief, JSON.parse(i.meta || "{}")); // type, reason, sources and outline chosen for this topic
  if (brief.type && (brief.type as string) in ARTICLE_TYPES) {
    const [name, lo, hi] = ARTICLE_TYPES[brief.type as string];
    Object.assign(brief, { type_name: name, words_min: lo, words_max: hi });
  }
  const cid = add(project.id, "article", i.topic, brief);
  run("UPDATE ideas SET status='queued' WHERE id=?", ideaId);
  return cid;
}

// ---------- weekly schedule ----------
export type ContentPlan = { enabled: boolean; days: number[]; hour: number; per_run: number; ideate: boolean; auto_write: boolean; ig_weekly: boolean; ig_day: number };

export function getPlan(pid: string): ContentPlan {
  const raw = getSetting<Partial<ContentPlan> & { weekday?: number; articles_per_week?: number }>(`content_plan:${pid}`, {});
  const p: ContentPlan & { weekday?: number; articles_per_week?: number } = { ...DEFAULT_PLAN, ...raw };
  if (p.weekday !== undefined) { p.days = [p.weekday]; delete p.weekday; }
  if (p.articles_per_week !== undefined) { p.per_run = Math.max(1, Math.min(MAX_PER_RUN, p.articles_per_week || 1)); delete p.articles_per_week; }
  return p;
}

export function savePlan(pid: string, b: Record<string, unknown>): ContentPlan {
  const days = [...new Set(((b.days as unknown[]) || []).map((x) => Number(x)))].sort((a, b2) => a - b2);
  const n = Number(b.per_run ?? 1), hour = Number(b.hour ?? 9), igDay = Number(b.ig_day ?? 4);
  if (b.enabled && !days.length) throw new Error("حداقل یک روز انتخاب کنید");
  if (days.some((x) => !(x >= 0 && x <= 6)) || !(hour >= 0 && hour <= 23) || !(igDay >= 0 && igDay <= 6)) throw new Error("زمان نامعتبر است");
  if (!(n >= 1 && n <= MAX_PER_RUN)) throw new Error(`تعداد مقاله باید بین ۱ و ${MAX_PER_RUN} باشد`);
  const plan: ContentPlan = { enabled: !!b.enabled, days, hour, per_run: n, ideate: !!b.ideate, auto_write: !!b.auto_write, ig_weekly: !!b.ig_weekly, ig_day: igDay };
  setSetting(`content_plan:${pid}`, plan);
  return plan;
}

function tehranLocal(ts: number): { weekday: number; hour: number; isoDate: string } {
  const d = new Date(ts * 1000 + TEHRAN_OFFSET_MIN * 60 * 1000);
  // getUTCDay(): Sun=0..Sat=6, same numbering Python's weekday() is NOT — Python Mon=0..Sun=6.
  // Converted explicitly so plan["days"] (stored using Python's numbering, since it's shared
  // schema/settings with the still-running Python app) compares correctly.
  const weekday = (d.getUTCDay() + 6) % 7;
  const isoDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { weekday, hour: d.getUTCHours(), isoDate };
}

/** When the content plan runs next. Works in a "shifted UTC" frame (real time + the fixed
 * Tehran offset) so getUTCDay()/getUTCHours() directly read as Tehran-local weekday/hour —
 * same trick as jalaliToday(), avoiding any dependency on the system's tz database. */
export function nextSlot(plan: ContentPlan, now?: number): number | null {
  now = now ?? Date.now() / 1000;
  if (!plan.enabled || !plan.days.length) return null;
  const offsetMs = TEHRAN_OFFSET_MIN * 60 * 1000;
  const shiftedNow = new Date(now * 1000 + offsetMs);
  const baseDay = new Date(shiftedNow); baseDay.setUTCHours(0, 0, 0, 0);
  for (let add = 0; add < 8; add++) {
    const candidate = new Date(baseDay); candidate.setUTCDate(candidate.getUTCDate() + add); candidate.setUTCHours(plan.hour, 0, 0, 0);
    const weekdayPy = (candidate.getUTCDay() + 6) % 7; // JS Sun=0..Sat=6 -> Python Mon=0..Sun=6
    const candidateRealSec = (candidate.getTime() - offsetMs) / 1000;
    if (plan.days.includes(weekdayPy) && candidateRealSec > now) return candidateRealSec;
  }
  return null;
}

/** Advances today's content run one step per call: fresh topics, then queueing, then writing.
 * Returns {ideate, write} for the caller, which owns Claude. Output only reaches the review queue. */
export async function tick(project: ProjectRow, now?: number) {
  const pid = project.id;
  const plan = getPlan(pid);
  const out: { ran: boolean; ideate: boolean; write: number; instagram?: number; articles?: number; no_ideas?: boolean } = { ran: false, ideate: false, write: 0 };
  if (!plan.enabled) return out;
  const t = now ?? Date.now() / 1000;
  const local = tehranLocal(t);
  const today = local.isoDate;
  if (plan.ig_weekly && local.weekday === plan.ig_day && local.hour >= plan.hour && getSetting(`content_ig:${pid}`, "") !== today) {
    setSetting(`content_ig:${pid}`, today);
    if (!listing(pid, "ig_post").some((c) => c.status === "queued" || c.status === "writing")) {
      const { planWeek } = require("./content") as typeof import("./content");
      out.instagram = planWeek(project).length;
    }
  }
  if (!plan.days.includes(local.weekday) || local.hour < plan.hour) return out;
  const getS = (k: string) => getSetting(`${k}:${pid}`, "");
  if (getS("content_prepared") !== today) {
    setSetting(`content_prepared:${pid}`, today);
    await syncArticles(project);
    refreshIdeas(project);
  }
  if (plan.ideate && getS("content_ideated") !== today) {
    out.ideate = true;
    return out;
  }
  if (getS("content_last") !== today) {
    setSetting(`content_last:${pid}`, today);
    const pending = ideas(pid).filter((i) => i.status === "idea").slice(0, plan.per_run);
    const queued = pending.map((i) => queueIdea(project, i.id, true));
    out.ran = true; out.articles = queued.length; out.no_ideas = !queued.length;
  }
  if (plan.auto_write && getS("content_wrote") !== today) {
    out.write = Math.min(one<{ n: number }>("SELECT COUNT(*) n FROM content WHERE project_id=? AND status='queued'", pid)!.n, 10);
  }
  return out;
}

export function markIdeated(pid: string, now?: number) {
  setSetting(`content_ideated:${pid}`, tehranLocal(now ?? Date.now() / 1000).isoDate);
}

export function markWritten(pid: string, now?: number) {
  setSetting(`content_wrote:${pid}`, tehranLocal(now ?? Date.now() / 1000).isoDate);
}
