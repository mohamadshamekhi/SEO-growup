// Runs after every daily «وضعیت ایندکس» job (URL Inspection already done by extras.runIndex):
//  1. sitemap → Google: resubmitted through the Search Console API only when its content changed
//     (needs the service account as a «Full» user in Search Console + webmasters scope);
//  2. changed/new URLs → Bing, Yandex, Seznam… via IndexNow (needs the key file served by the site);
//  3. a short Telegram report of pages Google still doesn't index (only if the project's «هشدارها» is on).
// Google's Indexing API is NOT used: it is only for JobPosting/BroadcastEvent pages.
import crypto from "node:crypto";
import { getSetting, setSetting, q } from "./db";
import { token } from "./google-auth";
import { googleFetch } from "./google-proxy";
import { fetchUrl } from "./crawl";
import { notify } from "./publisher";
import type { ProjectRow } from "./projects";

export const GSC_WRITE_SCOPE = "https://www.googleapis.com/auth/webmasters";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

function sitemapUrl(p: ProjectRow): string {
  return p.sitemap || `https://${p.domain}/sitemap.xml`;
}

/** All page URLs (+ lastmod) from the sitemap, following one level of sitemap index. */
async function readSitemap(url: string): Promise<{ body: string; urls: { loc: string; lastmod: string }[] }> {
  const r = await fetchUrl(url, "GET", true, 30000);
  if (r.status !== 200) throw new Error(`sitemap پاسخ ${r.status} داد`);
  let body = r.body;
  const locs = (xml: string) => [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
    loc: (/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/.exec(m[1])?.[1] || "").trim(),
    lastmod: (/<lastmod>\s*([^<\s]+)/.exec(m[1])?.[1] || "").trim(),
  })).filter((x) => x.loc);
  let urls = locs(body);
  if (body.includes("<sitemapindex")) {
    urls = [];
    for (const m of [...body.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/g)].slice(0, 10)) {
      const c = await fetchUrl(m[1], "GET", true, 30000);
      if (c.status === 200) { urls.push(...locs(c.body)); body += c.body; }
    }
  }
  return { body, urls };
}

/** Resubmits the sitemap to Google when it changed since the last submit (or weekly). */
export async function submitSitemap(p: ProjectRow, force = false): Promise<string> {
  const prop = p.gsc_property;
  if (!prop) return "property سرچ کنسول مشخص نیست (صفحه اتصال‌ها).";
  const url = sitemapUrl(p);
  const { body } = await readSitemap(url);
  const h = sha(body);
  const last = getSetting<{ hash?: string; at?: number }>(`sitemap_submit:${p.id}`, {});
  if (!force && last.hash === h && Date.now() / 1000 - (last.at || 0) < 7 * 86400) return "sitemap تغییری نکرده؛ ارسال لازم نبود.";
  const res = await googleFetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(prop)}/sitemaps/${encodeURIComponent(url)}`, {
    method: "PUT", headers: { Authorization: `Bearer ${await token(GSC_WRITE_SCOPE)}` }, cache: "no-store",
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 403) throw new Error("ایمیل Service Account در Search Console دسترسی کافی ندارد؛ نقش آن را Full (یا Owner) کنید.");
    throw new Error(`ثبت sitemap خطا داد (${res.status}): ${t.slice(0, 160)}`);
  }
  setSetting(`sitemap_submit:${p.id}`, { hash: h, at: Date.now() / 1000 });
  return `sitemap برای گوگل ثبت شد: ${url}`;
}

// ---------- IndexNow ----------
export function indexNowKey(pid: string): string {
  let k = getSetting<string>(`indexnow_key:${pid}`, "");
  if (!k) { k = crypto.randomBytes(16).toString("hex"); setSetting(`indexnow_key:${pid}`, k); }
  return k;
}

/** Is https://domain/{key}.txt served with the key? (IndexNow rejects submissions otherwise.) */
export async function indexNowReady(p: ProjectRow): Promise<{ ok: boolean; keyUrl: string; key: string }> {
  const key = indexNowKey(p.id);
  const keyUrl = `https://${p.domain}/${key}.txt`;
  const r = await fetchUrl(keyUrl, "GET", true, 15000);
  return { ok: r.status === 200 && r.body.trim() === key, keyUrl, key };
}

/** Sends URLs that are new or whose <lastmod> moved since the last send. */
export async function pushIndexNow(p: ProjectRow): Promise<string> {
  const ready = await indexNowReady(p);
  if (!ready.ok) return `IndexNow ارسال نشد: فایل کلید روی سایت نیست (${ready.keyUrl}).`;
  const { urls } = await readSitemap(sitemapUrl(p));
  const sent = getSetting<Record<string, string>>(`indexnow_sent:${p.id}`, {});
  const changed = urls.filter((u) => sent[u.loc] === undefined || (u.lastmod && u.lastmod !== sent[u.loc])).slice(0, 10000);
  if (!changed.length) return "IndexNow: آدرس تازه یا تغییرکرده‌ای نبود.";
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, cache: "no-store",
    body: JSON.stringify({ host: p.domain, key: ready.key, keyLocation: ready.keyUrl, urlList: changed.map((u) => u.loc) }),
  });
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow پاسخ ${res.status} داد`);
  for (const u of changed) sent[u.loc] = u.lastmod || "";
  setSetting(`indexnow_sent:${p.id}`, sent);
  return `IndexNow: ${changed.length} آدرس برای Bing/Yandex فرستاده شد.`;
}

// ---------- Bing Webmaster API (no file on the site needed) ----------
export function bingKey(pid: string): string { return getSetting<string>(`bing_key:${pid}`, ""); }
export function setBingKey(pid: string, key: string) { setSetting(`bing_key:${pid}`, key.trim()); }

export async function bingQuota(p: ProjectRow): Promise<number> {
  const key = bingKey(p.id);
  if (!key) throw new Error("کلید API بینگ وارد نشده.");
  const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/GetUrlSubmissionQuota?siteUrl=${encodeURIComponent(`https://${p.domain}`)}&apikey=${encodeURIComponent(key)}`, { cache: "no-store" });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 400 ? "کلید بینگ معتبر نیست یا سایت در Bing Webmaster Tools ثبت/تأیید نشده." : `بینگ پاسخ ${r.status} داد`);
  const d = await r.json() as { d?: { DailyQuota?: number } };
  return Number(d.d?.DailyQuota ?? 0);
}

/** Sends new/changed sitemap URLs to Bing within today's quota. */
export async function pushBing(p: ProjectRow): Promise<string> {
  if (!bingKey(p.id)) return "بینگ: کلید وارد نشده؛ رد شد.";
  const quota = await bingQuota(p);
  if (!quota) return "بینگ: سهمیه امروز تمام شده.";
  const { urls } = await readSitemap(sitemapUrl(p));
  const sent = getSetting<Record<string, string>>(`bing_sent:${p.id}`, {});
  const changed = urls.filter((u) => sent[u.loc] === undefined || (u.lastmod && u.lastmod !== sent[u.loc])).slice(0, Math.min(quota, 500));
  if (!changed.length) return "بینگ: آدرس تازه یا تغییرکرده‌ای نبود.";
  const r = await fetch(`https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey=${encodeURIComponent(bingKey(p.id))}`, {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, cache: "no-store",
    body: JSON.stringify({ siteUrl: `https://${p.domain}`, urlList: changed.map((u) => u.loc) }),
  });
  if (!r.ok) throw new Error(`ارسال به بینگ خطا داد (${r.status}): ${(await r.text()).slice(0, 120)}`);
  for (const u of changed) sent[u.loc] = u.lastmod || "";
  setSetting(`bing_sent:${p.id}`, sent);
  return `بینگ: ${changed.length} آدرس فرستاده شد.`;
}

/** Plain team message: how many pages Google doesn't index yet, and the top few to fix by hand. */
async function reportNotIndexed(p: ProjectRow): Promise<void> {
  const rows = q<{ url: string; detail: string }>("SELECT url, detail FROM issues WHERE project_id=? AND code='not_indexed' AND status='open' ORDER BY first_seen DESC", p.id);
  if (!rows.length) return;
  const prev = getSetting<number>(`not_indexed_count:${p.id}`, -1);
  setSetting(`not_indexed_count:${p.id}`, rows.length);
  if (prev === rows.length) return; // nothing new to say
  const lines = [
    `گزارش ایندکس امروز: ${rows.length} صفحه هنوز در گوگل ایندکس نشده${prev >= 0 ? ` (دیروز ${prev})` : ""}.`,
    "امروز برای این صفحه‌ها در Search Console درخواست ایندکس بدهید:",
    ...rows.slice(0, 5).map((r) => decodeURIComponent(r.url)),
  ];
  await notify(p, "alerts", lines.join("\n"));
}

/** Everything after URL Inspection; each step's failure is reported, none stops the others. */
export async function afterIndexCheck(p: ProjectRow): Promise<string[]> {
  const out: string[] = [];
  for (const step of [() => submitSitemap(p), () => pushIndexNow(p), () => pushBing(p)]) {
    try { out.push(await step()); } catch (e) { out.push(String((e as Error).message || e)); }
  }
  try { await reportNotIndexed(p); } catch (e) { out.push(`گزارش تلگرام: ${(e as Error).message}`); }
  setSetting(`indexing_auto:${p.id}`, { at: Date.now() / 1000, log: out });
  return out;
}
