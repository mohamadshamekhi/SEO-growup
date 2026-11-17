// «اتصال‌ها»: every external service the panel depends on, whether it's configured, and a live
// test for each — so "is Analytics connected?" has a real answer with Google's own error.
import { one } from "./db";
import { keyInfo, token, GSC_SCOPE } from "./google-auth";
import { testConnection as gscTest } from "./gsc";
import * as ga from "./ga";
import * as adapters from "./adapters";
import { askAI } from "./ai";
import { tgConfig, tgSend } from "./publisher";
import { getSetting } from "./db";
import { googleFetch } from "./google-proxy";
import { fetchUrl } from "./crawl";
import { formatJalaliDateTime } from "./intl/jalali";
import type { ProjectRow } from "./projects";
import { indexNowKey, indexNowReady, submitSitemap, bingKey, bingQuota } from "./indexing-auto";

export type ConnName = "site" | "site_api" | "google_key" | "gsc" | "gsc_write" | "indexnow" | "bing" | "ga" | "ai" | "telegram" | "pagespeed";
export type Conn = {
  name: ConnName; title: string; purpose: string; configured: boolean; detail: string;
  lastError: string; where: string; editable?: "gsc" | "ga" | "bing";
};
export type TestResult = { ok: boolean; message: string; ms: number };

function lastRun(pid: string, kind: string) {
  return one<{ status: string; started_at: number; error: string }>("SELECT status, started_at, error FROM runs WHERE project_id=? AND kind=? ORDER BY id DESC LIMIT 1", pid, kind);
}
const when = (ts?: number) => (ts ? formatJalaliDateTime(ts * 1000) : "");

export function list(p: ProjectRow): Conn[] {
  const key = keyInfo();
  const keyOk = !!key && "client_email" in key;
  const adapter = adapters.config(p.id);
  const gscRun = lastRun(p.id, "gsc");
  const gaProp = ga.getProperty(p.id);
  const gaState = ga.state(p.id, 1);
  const tg = tgConfig(p.id);
  return [
    { name: "site", title: "خود سایت", purpose: "ممیزی، آپتایم، پایش رقبا و همه خواندن‌های صفحه از همین اتصال است.", configured: true, detail: p.domain, lastError: "", where: "" },
    { name: "site_api", title: "API سایت (نوشتن روی سایت)", purpose: "همه دکمه‌های «رفع خودکار» و «بهینه‌سازی» از این راه روی سایت ثبت می‌شوند.", configured: !!adapter,
      detail: adapter ? `${adapter.type} · ${adapter.base_url}` : "وصل نیست", lastError: "", where: "تنظیمات پروژه ← اتصال به API سایت" },
    { name: "google_key", title: "کلید Service Account گوگل", purpose: "کلید مشترک برای Search Console و Analytics.", configured: keyOk,
      detail: keyOk ? (key as { client_email: string }).client_email : key && "error" in key ? key.error : "بارگذاری نشده", lastError: "", where: "تنظیمات کلی پنل ← کلید Service Account" },
    { name: "gsc", title: "Google Search Console", purpose: "کلمه‌ها، جایگاه، صفحه‌های ایندکس‌نشده و همه فرصت‌های سئو.", configured: keyOk,
      detail: `${p.gsc_property || "property خودکار از دامنه"}${gscRun ? ` · آخرین دریافت ${when(gscRun.started_at)} (${gscRun.status === "ok" ? "موفق" : "ناموفق"})` : " · هنوز دریافت نشده"}`,
      lastError: gscRun && gscRun.status !== "ok" ? gscRun.error || "" : "", where: "", editable: "gsc" },
    { name: "gsc_write", title: "ثبت خودکار sitemap در گوگل", purpose: "هر روز بعد از بررسی ایندکس، اگر sitemap عوض شده باشد دوباره برای گوگل ثبت می‌شود.", configured: keyOk && !!p.gsc_property,
      detail: (() => { const s = getSetting<{ at?: number }>(`sitemap_submit:${p.id}`, {}); return s.at ? `آخرین ثبت ${when(s.at)}` : "هنوز ثبت نشده"; })(),
      lastError: "", where: "ایمیل Service Account باید در Search Console ← Settings ← Users and permissions نقش Full داشته باشد." },
    { name: "indexnow", title: "IndexNow (Bing، Yandex و…)", purpose: "آدرس‌های تازه و تغییرکرده هر روز به موتورهای جستجوی غیر گوگل خبر داده می‌شود.", configured: true,
      detail: `فایل کلید لازم: https://${p.domain}/${indexNowKey(p.id)}.txt با محتوای «${indexNowKey(p.id)}»`, lastError: "", where: "" },
    { name: "bing", title: "Bing Webmaster (بدون فایل روی سایت)", purpose: "جایگزین IndexNow که هیچ تغییری در سایت لازم ندارد: آدرس‌های تازه هر روز مستقیم به بینگ فرستاده می‌شود.", configured: !!bingKey(p.id),
      detail: bingKey(p.id) ? "کلید API ثبت شده" : "کلید API وارد نشده", lastError: "", where: "", editable: "bing" },
    { name: "ga", title: "Google Analytics 4", purpose: "بازدید، افزودن به سبد و فروش هر صفحه؛ بدون آن تب فروش فقط کلیک گوگل را می‌بیند.", configured: keyOk && !!gaProp,
      detail: gaProp ? `property ${gaProp}${gaState.at ? ` · آخرین دریافت ${when(gaState.at)}` : " · هنوز دریافت نشده"}` : "شناسه property وارد نشده",
      lastError: ga.lastError(p.id), where: "", editable: "ga" },
    { name: "ai", title: "سرویس هوش مصنوعی", purpose: "نوشتن متن‌ها، راه‌حل فنی، برنامه کمپین و بهینه‌سازی عنوان‌ها.", configured: !!process.env.AI_GATEWAY_TOKEN,
      detail: process.env.AI_GATEWAY_TOKEN ? `مدل ${process.env.AI_GATEWAY_MODEL || "haiku"}` : "AI_GATEWAY_TOKEN در env سرور نیست", lastError: "", where: "env سرور" },
    { name: "telegram", title: "تلگرام", purpose: "ارسال کارهای روزانه و هشدارها به گروه تیم.", configured: !!tg, detail: tg ? "ربات تنظیم شده" : "تنظیم نشده", lastError: "", where: "تنظیمات پروژه ← تلگرام" },
    { name: "pagespeed", title: "PageSpeed Insights (اختیاری)", purpose: "سرعت و Core Web Vitals صفحه‌ها.", configured: !!getSetting("pagespeed_key", ""),
      detail: getSetting("pagespeed_key", "") ? "کلید ثبت شده" : "کلید ثبت نشده", lastError: "", where: "تنظیمات کلی پنل ← PageSpeed" },
  ];
}

export async function test(p: ProjectRow, name: ConnName): Promise<TestResult> {
  const t0 = Date.now();
  const done = (ok: boolean, message: string): TestResult => ({ ok, message, ms: Date.now() - t0 });
  try {
    switch (name) {
      case "site": {
        const r = await fetchUrl(`https://${p.domain}/`, "GET", true, 20000);
        return done(r.status === 200, r.status === 200 ? `پاسخ ۲۰۰ در ${r.ms}ms` : `پاسخ ${r.status || "ندارد"} ${r.error || ""}`);
      }
      case "site_api": {
        if (!adapters.config(p.id)) return done(false, "API سایت تنظیم نشده.");
        await adapters.client(p.id).test();
        return done(true, "توکن معتبر است و API پاسخ داد.");
      }
      case "google_key": {
        const k = keyInfo();
        if (!k || !("client_email" in k)) return done(false, k && "error" in k ? k.error : "کلید بارگذاری نشده.");
        await token(GSC_SCOPE);
        return done(true, `گوگل کلید را پذیرفت (${k.client_email}).`);
      }
      case "gsc": {
        const r = await gscTest(p);
        if (r.ok) return done(true, `وصل است؛ property: ${r.property}`);
        const avail = r.available?.length ? ` property های قابل‌دسترس: ${r.available.join("، ")}` : "";
        return done(false, `${r.error || "ناموفق"}${avail}`);
      }
      case "gsc_write": return done(true, await submitSitemap(p, true));
      case "indexnow": {
        const r = await indexNowReady(p);
        return done(r.ok, r.ok ? "فایل کلید روی سایت هست؛ ارسال‌ها پذیرفته می‌شوند." : `فایل ${r.keyUrl} روی سایت نیست یا محتوایش «${r.key}» نیست.`);
      }
      case "bing": return done(true, `وصل است؛ سهمیه امروز: ${await bingQuota(p)} آدرس.`);
      case "ga": {
        const r = await ga.testGa(p.id);
        ga.saveError(p.id, r.ok ? "" : r.message);
        return done(r.ok, r.message);
      }
      case "ai": {
        const out = await askAI("فقط کلمه OK را بنویس.");
        return done(true, `پاسخ داد: ${out.trim().slice(0, 40)}`);
      }
      case "telegram": {
        if (!tgConfig(p.id)) return done(false, "تلگرام تنظیم نشده.");
        await tgSend(p.id, `پیام آزمایشی اتصال پنل برای ${p.name}. نیازی به اقدام نیست.`);
        return done(true, "پیام آزمایشی به گروه ارسال شد.");
      }
      case "pagespeed": {
        const key = getSetting("pagespeed_key", "");
        if (!key) return done(false, "کلید ثبت نشده.");
        const qs = new URLSearchParams({ url: `https://${p.domain}/`, key, category: "performance", strategy: "mobile" });
        const res = await googleFetch(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`, { cache: "no-store", signal: AbortSignal.timeout(90_000) });
        if (!res.ok) return done(false, `PageSpeed پاسخ ${res.status} داد: ${(await res.text()).slice(0, 160)}`);
        const d = await res.json() as { lighthouseResult?: { categories?: { performance?: { score?: number } } } };
        return done(true, `وصل است؛ امتیاز سرعت موبایل صفحه اصلی: ${Math.round((d.lighthouseResult?.categories?.performance?.score || 0) * 100)}`);
      }
    }
  } catch (e) {
    return done(false, String((e as Error).message || e).slice(0, 400));
  }
}
