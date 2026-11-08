// Ported 1:1 from hub/prepublish.py. The last look before a person publishes a draft. It
// reads the draft from the site, because someone may have edited it there.
//
// publish() is a real site-mutating write (PATCHes is_published=true on the live article) —
// ported, type-checked and built, but never invoked against the real site from here without
// the user's explicit go-ahead each time, same caution as lib/publisher.ts.
import * as adapters from "./adapters";
import { catalogRows } from "./catalog";
import { U, fetchUrl } from "./crawl";
import { now as dbNow, run } from "./db";
import * as planner from "./planner";
import type { ContentRow } from "./content";
import type { ProjectRow } from "./projects";

const CLAIMS = /[^.؟!\n]{0,80}(?:تومان|ریال|٪|درصد|گارانتی|ضمانت|تضمین|ارزان‌ترین|بهترین قیمت|تخفیف|موجود است|۱۰۰|\b100\b)[^.؟!\n]{0,80}/g;
const MAX_LINKS = 25;

function plainText(h: string | undefined | null): string {
  return (h || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

type CheckItem = { level: "ok" | "warn" | "fail" | "verify"; text: string };
type CheckResult = { items: CheckItem[]; at: number; fails: number; ready: boolean };

export async function check(project: ProjectRow, c: ContentRow): Promise<CheckResult> {
  const o = c.output;
  const kind = (adapters.config(project.id) || {}).type;
  if (kind !== undefined && kind !== "steve") throw new Error("انتشار از پنل فعلاً فقط برای سایت‌های متصل با API استیو است");
  const aid = o.draft_id as string | undefined;
  if (!aid || aid === "created") throw new Error("پیش‌نویس این مقاله در سایت پیدا نشد");
  const d = await adapters.client(project.id).req("GET", `/article/${aid}`);
  const art = (d.article as Record<string, unknown>) ?? d;
  const body = (art.body as string) || "", title = ((art.title as string) || "").trim(), meta = ((art.meta_description as string) || "").trim();
  const text = plainText(body);
  const out: CheckItem[] = [];
  const add = (level: CheckItem["level"], msg: string) => out.push({ level, text: msg });

  if (art.is_published) add("fail", "این مقاله همین حالا منتشر شده است.");
  if (title.length >= 15 && title.length <= 65) add("ok", `عنوان ${title.length} کاراکتر است.`);
  else add("warn", `عنوان ${title.length} کاراکتر است؛ بهتر است ۱۵ تا ۶۵ باشد.`);
  if (meta.length >= 70 && meta.length <= 165) add("ok", `توضیح متا ${meta.length} کاراکتر است.`);
  else add(meta ? "warn" : "fail", `توضیح متا ${meta.length} کاراکتر است؛ باید ۷۰ تا ۱۶۵ باشد.`);
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words >= 300) add("ok", `متن ${words} کلمه است.`);
  else add("fail", `متن فقط ${words} کلمه است.`);
  const keyword = ((c.brief.keyword as string) || "").trim();
  if (keyword) {
    const need = planner.tok(keyword);
    const inTitle = planner.tok(title);
    if ([...need].every((w) => inTitle.has(w))) add("ok", "کلمه هدف در عنوان هست.");
    else add("warn", `همه کلمات «${keyword}» در عنوان نیست.`);
  }
  if (art.media_url || art.media_id) add("ok", "کاور دارد."); else add("fail", "مقاله کاور ندارد.");
  if (/<h2\b/i.test(body)) add("ok", "تیتر H2 دارد."); else add("warn", "مقاله هیچ تیتر H2 ندارد.");
  const noAlt = (body.match(/<img\b[^>]*>/gi) || []).filter((i) => !/alt="[^"]+"/.test(i)).length;
  if (noAlt) add("warn", `${noAlt} عکس متن alt ندارد.`);

  const links = [...new Set([...body.matchAll(/<a\b[^>]*href="(https?:\/\/[^"]+)"/g)].map((m) => m[1]))];
  const stock = new Map(catalogRows(project.id, "product").map((r) => [U(r.url), r]));
  let broken = 0;
  for (const u of links.slice(0, MAX_LINKS)) {
    let st = (await fetchUrl(u, "HEAD")).status;
    if (st === 403 || st === 405) st = (await fetchUrl(u)).status;
    if (st >= 400) { broken++; add("fail", `لینک خراب (${st}): ${decodeURIComponent(u).slice(0, 90)}`); }
    else if (stock.get(U(u))?.available === 0) add("warn", `محصول لینک‌شده ناموجود است: ${decodeURIComponent(u).slice(0, 90)}`);
  }
  if (links.length && !broken) add("ok", `${Math.min(links.length, MAX_LINKS)} لینک باز شدند.`);
  if (!links.some((u) => u.includes(project.domain) && u.includes("/product/"))) add("warn", "مقاله به هیچ محصولی لینک نداده است.");

  const own = planner.tok(title);
  if (own.size) {
    for (const a of planner.siteArticles(project.id)) {
      if (a.slug === art.slug) continue;
      const other = planner.tok(a.title);
      if ([...own].filter((w) => other.has(w)).length / own.size >= planner.SIMILAR) { add("warn", `مقاله مشابه در سایت هست: ${a.title}`); break; }
    }
  }
  const claims = [...new Set([...text.matchAll(CLAIMS)].map((m) => m[0].trim()).filter((s) => s.length > 10))].slice(0, 6);
  for (const s of claims) add("verify", s.slice(0, 170));

  const fails = out.filter((x) => x.level === "fail").length;
  const result: CheckResult = { items: out, at: dbNow(), fails, ready: !fails };
  o.check = result;
  run("UPDATE content SET output=?, updated=? WHERE id=?", JSON.stringify(o), dbNow(), c.id);
  return result;
}

/** Only ever called from a person's click. The change is recorded like any other, so it can be taken back. */
export async function publish(project: ProjectRow, c: ContentRow, userName: string, force = false): Promise<{ url: string }> {
  const o = c.output;
  if (c.kind !== "article" || c.status !== "drafted") throw new Error("فقط پیش‌نویس ثبت‌شده در سایت منتشر می‌شود");
  const result = await check(project, c);
  if (result.fails && !force) throw new Error(`${result.fails} مشکل جدی دارد؛ اول بررسی را ببینید`);
  const api = adapters.client(project.id);
  const aid = o.draft_id as string;
  const d = await api.req("GET", `/article/${aid}`);
  const art = (d.article as Record<string, unknown>) ?? d;
  await api.req("PATCH", `/article/${aid}`, { is_published: true });
  const backRaw = await api.req("GET", `/article/${aid}`);
  const back = (backRaw.article as Record<string, unknown>) ?? backRaw;
  if (!back.is_published) throw new Error("سایت مقاله را منتشر نکرد");
  const url = `https://${project.domain}/blog/${art.slug || o.slug}`;
  const now = dbNow();
  o.published_url = url; o.published_at = now;
  run("UPDATE content SET status='published', output=?, updated=? WHERE id=?", JSON.stringify(o), now, c.id);
  run(
    "INSERT INTO applied(project_id,fix_id,url,type,before,after,ts,user_name) VALUES (?,0,?,'publish',?,?,?,?)",
    project.id, url, JSON.stringify({ kind: "article", id: aid, before: { is_published: false } }), "مقاله منتشر شد", now, userName,
  );
  try { await planner.syncArticles(project); } catch { /* published is published; the list catches up on its next read */ }
  return { url };
}
