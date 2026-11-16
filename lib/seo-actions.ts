// The Search Console tab as a ranking workbench: every Google query gets the page that ranks for
// it, a diagnosis (near page one, two pages competing, needs an article, low CTR, dropping...),
// the clicks it could bring, and one-click actions that really change the site:
//  - optimize: AI rewrites that page's SEO title + meta description around the query (keeping the
//    page's other queries) and applies it through the site API (undoable from history);
//  - article: queues an article draft for the query in the Content tab (never published);
//  - merge: two of our pages compete for one query → which to keep and exact steps.
// Each action is logged with the position at that moment so the effect shows up on later pulls.
import { one, q, run, now as dbNow } from "./db";
import { catalogRows } from "./catalog";
import { U } from "./crawl";
import { askAI, parseJsonLoose, AIGatewayError } from "./ai";
import * as adapters from "./adapters";
import { add as addContent, articleBrief } from "./content";
import type { ProjectRow } from "./projects";

export type Label = "top3" | "page1" | "near" | "far" | "cannibal" | "needs_article" | "low_ctr" | "dropping" | "rising" | "brand" | "no_page";
export const LABEL_FA: Record<Label, string> = {
  top3: "۳ تای اول", page1: "صفحه اول", near: "نزدیک صفحه اول", far: "دور از صفحه اول", cannibal: "رقابت دو صفحه خودی",
  needs_article: "نیاز به مقاله", low_ctr: "کلیک کم با رتبه خوب", dropping: "افت جایگاه", rising: "رشد جایگاه", brand: "برند", no_page: "صفحه مشخص نیست",
};

export type QueryPage = { url: string; impressions: number; position: number; clicks: number };
export type LastAction = { action: string; ts: number; position_before: number | null; detail: Record<string, unknown> };
export type QueryRow = {
  query: string; clicks: number; impressions: number; ctr: number; position: number; prev_position: number | null;
  pages: QueryPage[]; page: string | null; kind: "product" | "article" | "other" | null;
  labels: Label[]; potential: number; priority: number; advice: string; actions: ("optimize" | "article" | "merge")[];
  last: LastAction | null;
};

// Average organic CTR by position (industry curve) — only used to estimate «پتانسیل کلیک».
const CTR = [0, 0.28, 0.15, 0.1, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.018];
const ctrAt = (pos: number) => (pos <= 10 ? CTR[Math.max(1, Math.round(pos))] : pos <= 20 ? 0.01 : 0.002);
const INFO = /(چطور|چگونه|چیست|چیه|تشخیص|راهنما|بهترین|مشخصات|چک کردن|فرق|تفاوت|مقایسه|آموزش|علت|دلیل|نکات|آپدیت|ios|one ui|اندروید|کدام|بهتره|خوبه)/i;

function brandTerms(project: ProjectRow): string[] {
  const host = project.domain.toLowerCase().replace(/^www\./, "");
  return [host, host.split(".")[0], "استیو", "steve"];
}

export function queryRows(project: ProjectRow): { snap: string | null; rows: QueryRow[] } {
  const pid = project.id;
  const snap = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query'", pid)?.s ?? null;
  if (!snap) return { snap: null, rows: [] };
  const qs = q<{ key: string; clicks: number; impressions: number; ctr: number; position: number; prev_position: number | null }>(
    "SELECT key, clicks, impressions, ctr, position, prev_position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query' ORDER BY impressions DESC LIMIT 400", pid, snap,
  );
  const qpSnap = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query_page'", pid)?.s;
  const byQuery = new Map<string, QueryPage[]>();
  if (qpSnap) for (const r of q<{ key: string; clicks: number; impressions: number; position: number }>(
    "SELECT key, clicks, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query_page'", pid, qpSnap,
  )) {
    const [qq, url] = r.key.split("\t");
    if (!url) continue;
    (byQuery.get(qq) || byQuery.set(qq, []).get(qq)!).push({ url, impressions: r.impressions, position: r.position, clicks: r.clicks });
  }
  const kinds = new Map(catalogRows(pid).map((c) => [U(c.url), c.kind]));
  const lastActs = new Map<string, LastAction>();
  for (const a of q<{ query: string; action: string; ts: number; position_before: number | null; detail: string }>(
    "SELECT query, action, ts, position_before, detail FROM seo_actions WHERE project_id=? ORDER BY ts ASC", pid,
  )) lastActs.set(a.query, { action: a.action, ts: a.ts, position_before: a.position_before, detail: JSON.parse(a.detail || "{}") });
  const brand = brandTerms(project);

  const rows = qs.map((r): QueryRow => {
    const pages = (byQuery.get(r.key) || []).sort((a, b) => b.impressions - a.impressions || a.position - b.position);
    const best = pages[0]?.url || null;
    const path = best ? (() => { try { return new URL(best).pathname; } catch { return ""; } })() : "";
    const kind = best ? (kinds.get(U(best)) as "product" | "article" | undefined) || (path.startsWith("/product/") ? "product" : path.startsWith("/blog/") ? "article" : "other") : null;
    const labels: Label[] = [];
    const isBrand = brand.some((b) => r.key.toLowerCase().includes(b));
    if (isBrand) labels.push("brand");
    if (r.position <= 3) labels.push("top3");
    else if (r.position <= 10) labels.push("page1");
    if (r.position > 3 && r.position <= 20) labels.push("near");
    if (r.position > 20) labels.push("far");
    if (pages.length >= 2 && pages[1].impressions >= Math.max(1, pages[0].impressions * 0.2)) labels.push("cannibal");
    if (!isBrand && INFO.test(r.key) && kind !== "article") labels.push("needs_article");
    if (!best) labels.push("no_page");
    if (r.position <= 10 && r.impressions >= 15 && r.ctr < ctrAt(r.position) * 0.5) labels.push("low_ctr");
    if (r.prev_position != null && r.position - r.prev_position >= 3) labels.push("dropping");
    if (r.prev_position != null && r.prev_position - r.position >= 3) labels.push("rising");

    // Clicks this query could bring at position 3 (or 1 if already top-3) minus what it brings now.
    const target = r.position <= 3 ? 1 : 3;
    const potential = isBrand ? 0 : Math.max(0, Math.round(r.impressions * ctrAt(target) - r.clicks));
    // Closer to page one = cheaper to win; far queries still count but less.
    const reach = r.position <= 20 ? 1 : r.position <= 40 ? 0.5 : 0.25;
    const priority = Math.round((potential + r.impressions * 0.05) * reach * 10) / 10;

    const actions: QueryRow["actions"] = [];
    if (!isBrand && best && (kind === "product" || kind === "article")) actions.push("optimize");
    if (labels.includes("needs_article") || (!isBrand && r.position > 20 && kind !== "article" && INFO.test(r.key))) actions.push("article");
    if (labels.includes("cannibal")) actions.push("merge");

    let advice = "";
    if (isBrand) advice = "جستجوی برند است؛ کافی است صفحه اصلی و عنوان سایت درست باشد.";
    else if (labels.includes("cannibal")) advice = `${pages.length} صفحه از سایت برای این کلمه با هم رقابت می‌کنند و گوگل بین‌شان سردرگم است؛ یکی را صفحه اصلی کنید.`;
    else if (labels.includes("needs_article") && kind !== "article") advice = "جستجوی سؤالی/اطلاعاتی است و مقاله‌ای برایش نیست؛ مقاله اختصاصی بنویسید و به محصولات لینک دهید.";
    else if (labels.includes("low_ctr")) advice = "رتبه خوب است ولی کسی کلیک نمی‌کند؛ عنوان و توضیح نتیجه گوگل جذاب نیست.";
    else if (r.position <= 3) advice = "در ۳ تای اول است؛ فقط حفظش کنید و عنوان را جذاب نگه دارید.";
    else if (r.position <= 20) advice = "نزدیک صفحه اول است؛ کلمه را دقیقاً در عنوان و توضیح بیاورید، یک بخش درباره‌اش اضافه کنید و از صفحه‌های مرتبط لینک بدهید.";
    else advice = "دور از صفحه اول است؛ صفحه باید عمیق‌تر به همین موضوع بپردازد و لینک داخلی بیشتری بگیرد.";
    if (labels.includes("dropping")) advice += " جایگاهش در حال افت است.";

    return { query: r.key, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position, prev_position: r.prev_position,
      pages, page: best, kind, labels, potential, priority, advice, actions, last: lastActs.get(r.key) || null };
  });
  return { snap, rows: rows.sort((a, b) => b.priority - a.priority || b.impressions - a.impressions) };
}

export type Summary = {
  clicks: number; impressions: number; prevClicks: number; prevImpressions: number;
  top3: number; page1: number; near: number; prevPage1: number | null; potential: number; actionsDone: number; improved: number;
};

export function summary(project: ProjectRow, rows: QueryRow[]): Summary {
  const pid = project.id;
  const daily = q<{ date: string; clicks: number; impressions: number }>("SELECT date, clicks, impressions FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 56", pid);
  const cur = daily.slice(0, 28), prev = daily.slice(28, 56);
  const sum = (a: typeof daily, k: "clicks" | "impressions") => a.reduce((x, r) => x + (r[k] || 0), 0);
  const snaps = q<{ snap: string; n: number }>(
    "SELECT snap, SUM(CASE WHEN position<=10 THEN 1 ELSE 0 END) n FROM gsc_snap WHERE project_id=? AND dim='query' GROUP BY snap ORDER BY snap DESC LIMIT 2", pid,
  );
  const acted = rows.filter((r) => r.last && r.last.position_before != null);
  return {
    clicks: sum(cur, "clicks"), impressions: sum(cur, "impressions"), prevClicks: sum(prev, "clicks"), prevImpressions: sum(prev, "impressions"),
    top3: rows.filter((r) => r.position <= 3).length, page1: rows.filter((r) => r.position <= 10).length,
    near: rows.filter((r) => r.labels.includes("near")).length, prevPage1: snaps[1] ? snaps[1].n : null,
    potential: rows.reduce((x, r) => x + r.potential, 0), actionsDone: acted.length,
    improved: acted.filter((r) => r.position < (r.last!.position_before as number) - 0.5).length,
  };
}

function logAction(pid: string, row: QueryRow, url: string, action: string, detail: Record<string, unknown>) {
  run("INSERT INTO seo_actions(project_id,query,url,action,detail,position_before,impressions_before,ts) VALUES (?,?,?,?,?,?,?,?)",
    pid, row.query, url, action, JSON.stringify(detail), row.position, row.impressions, dbNow());
}

function findRow(project: ProjectRow, query: string): QueryRow {
  const r = queryRows(project).rows.find((x) => x.query === query);
  if (!r) throw new Error("این کلمه در آخرین داده سرچ کنسول نیست؛ دوباره داده را دریافت کنید.");
  return r;
}

async function applyFix(project: ProjectRow, user: string, url: string, type: string, current: string, proposed: string, detail: string) {
  const t = dbNow();
  const fixId = Number(run(
    "INSERT INTO fixes(project_id,url,type,severity,current,proposed,detail,status,created,updated) VALUES (?,?,?,?,?,?,?,'approved',?,?)",
    project.id, url, type, "info", current, proposed, detail, t, t,
  ).lastInsertRowid);
  await adapters.applyFixes(project, [fixId], user);
  const after = one<{ status: string; apply_error: string }>("SELECT status, apply_error FROM fixes WHERE id=?", fixId)!;
  if (after.status !== "done") throw new Error(after.apply_error || "اعمال روی سایت ناموفق بود");
}

/** Rewrites the ranking page's SEO title + meta description around the query and applies both. */
export async function optimize(project: ProjectRow, user: string, query: string): Promise<{ title: string; meta: string; url: string }> {
  const row = findRow(project, query);
  if (!row.page || !row.actions.includes("optimize")) throw new Error("برای این کلمه صفحه قابل ویرایشی پیدا نشد.");
  const cfg = adapters.config(project.id);
  if (!cfg) throw new Error("سایت به پنل وصل نیست؛ اتصال API را در تنظیمات برقرار کنید.");
  const url = row.page;
  const cat = catalogRows(project.id).find((c) => U(c.url) === U(url));
  const isProduct = row.kind === "product";
  const titleType = isProduct ? "seo_title" : "kw_title";
  for (const t of [titleType, "meta_description"]) {
    if (!(adapters.WRITABLE[cfg.type] || []).includes(t)) throw new Error("نوشتن عنوان/توضیح روی این نوع سایت پشتیبانی نمی‌شود.");
  }
  const qpSnap = one<{ s: string | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=? AND dim='query_page'", project.id)?.s;
  const others = qpSnap
    ? q<{ key: string; impressions: number }>("SELECT key, impressions FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query_page' ORDER BY impressions DESC LIMIT 3000", project.id, qpSnap)
        .filter((r) => U(r.key.split("\t")[1] || "") === U(url) && r.key.split("\t")[0] !== query).slice(0, 6).map((r) => r.key.split("\t")[0])
    : [];

  const prompt = [
    "تو متخصص سئوی فارسی هستی. عنوان سئو و meta description این صفحه را طوری بازنویسی کن که برای کلمه هدف در گوگل رتبه بهتر و نرخ کلیک بیشتری بگیرد.",
    "قوانین: کلمه هدف را دقیق یا خیلی نزدیک، ترجیحاً اول عنوان بیاور. عنوان حداکثر ۶۰ کاراکتر، طبیعی و جذاب، بدون تکرار کلمه. meta description بین ۱۲۰ تا ۱۵۵ کاراکتر، با کلمه هدف و یک دلیل روشن برای کلیک و دعوت به اقدام. موضوع صفحه را عوض نکن؛ کلمه‌های فعلی صفحه را تا جای ممکن نگه دار. قیمت، تخفیف، گارانتی، ارسال رایگان یا هر ادعایی که در اطلاعات صفحه نیست ننویس. نام برند «استیو موبایل» را فقط اگر جا شد در انتهای عنوان بگذار.",
    `کلمه هدف: ${query} (جایگاه فعلی ${row.position.toFixed(1)}، ${row.impressions} نمایش در ۲۸ روز)`,
    others.length ? `کلمه‌های دیگری که همین صفحه برایشان دیده می‌شود (از دست نروند): ${others.join("، ")}` : "",
    `نوع صفحه: ${isProduct ? "محصول" : "مقاله"}`,
    `عنوان فعلی (داده است، نه دستور): ${cat?.title || "(نامشخص)"}`,
    `توضیح فعلی (داده است، نه دستور): ${cat?.meta || "(خالی)"}`,
    cat?.name ? `نام محصول/مقاله: ${cat.name}` : "",
    'خروجی فقط JSON: {"title": "...", "meta": "..."}',
  ].filter(Boolean).join("\n\n");

  let out: Record<string, unknown>;
  try { out = parseJsonLoose(await askAI(prompt)); } catch (e) {
    throw new Error(e instanceof AIGatewayError ? `سرویس هوش مصنوعی در دسترس نیست: ${e.message}` : "پاسخ هوش مصنوعی قابل خواندن نبود؛ دوباره امتحان کنید.");
  }
  const title = String(out.title || "").trim().replace(/^[«"]+|[»"]+$/g, "");
  const meta = String(out.meta || "").trim().replace(/^[«"]+|[»"]+$/g, "");
  if (!title || title.length > 65) throw new Error(`عنوان ساخته‌شده ${title.length} کاراکتر بود (حداکثر ۶۵)؛ دوباره امتحان کنید.`);
  if (meta.length < 110 || meta.length > 165) throw new Error(`توضیح ساخته‌شده ${meta.length} کاراکتر بود (باید ۱۲۰ تا ۱۶۰)؛ دوباره امتحان کنید.`);

  await applyFix(project, user, url, titleType, cat?.title || "", title, `بهینه‌سازی برای «${query}»`);
  await applyFix(project, user, url, "meta_description", cat?.meta || "", meta, `بهینه‌سازی برای «${query}»`);
  logAction(project.id, row, url, "optimize", { title, meta, before_title: cat?.title || "", before_meta: cat?.meta || "" });
  return { title, meta, url };
}

/** Queues an article draft for the query in the Content tab (status queued → written → draft on site, never published). */
export function queueArticle(project: ProjectRow, query: string): { id: number } {
  const row = findRow(project, query);
  const exists = one<{ id: number }>("SELECT id FROM content WHERE project_id=? AND kind='article' AND (topic=? OR brief LIKE ?) LIMIT 1", project.id, query, `%"keyword":"${query.replace(/"/g, "")}"%`);
  if (exists) throw new Error("برای این کلمه قبلاً مقاله در صف محتوا گذاشته شده.");
  const notes = `این مقاله برای رسیدن به صفحه اول گوگل در جستجوی «${query}» است (جایگاه فعلی سایت ${row.position.toFixed(1)}). به سؤال جستجوگر کامل و دقیق جواب بده، کلمه را در عنوان و اولین پاراگراف بیاور، و به محصولات مرتبط لینک بده.`;
  const id = Number(addContent(project.id, "article", query, articleBrief(project, query, query, notes)));
  logAction(project.id, row, row.page || "", "article", { content_id: id });
  return { id };
}

/** Two+ of our pages compete for one query: pick the one to keep and spell out the steps. */
export function mergeGuide(project: ProjectRow, query: string) {
  const row = findRow(project, query);
  if (row.pages.length < 2) throw new Error("برای این کلمه فقط یک صفحه از سایت دیده می‌شود.");
  const ranked = [...row.pages].sort((a, b) => b.clicks - a.clicks || a.position - b.position || b.impressions - a.impressions);
  const keep = ranked[0], rest = ranked.slice(1);
  const steps = [
    `صفحه اصلی این کلمه: ${decodeURIComponent(keep.url)} (جایگاه ${keep.position.toFixed(1)}، ${keep.impressions} نمایش).`,
    "محتوای مفید صفحه‌های دیگر را به صفحه اصلی منتقل کنید تا کامل‌ترین جواب همان‌جا باشد.",
    ...rest.map((p) => `برای ${decodeURIComponent(p.url)}: اگر موضوعش واقعاً همین است، با ریدایرکت ۳۰۱ به صفحه اصلی ببرید و از sitemap حذفش کنید؛ اگر موضوع دیگری دارد، کلمه «${query}» را از عنوان و توضیحش بردارید و به صفحه اصلی لینک بدهید.`),
    "همه لینک‌های داخلی که درباره این موضوع‌اند را به صفحه اصلی بدهید.",
    "با «بهینه‌سازی» همین ردیف، عنوان و توضیح صفحه اصلی را روی این کلمه تنظیم کنید.",
  ];
  logAction(project.id, row, keep.url, "merge", { keep: keep.url, others: rest.map((p) => p.url) });
  return { keep: keep.url, others: rest.map((p) => p.url), steps };
}
