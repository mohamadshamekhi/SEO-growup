// Ported 1:1 from hub/onboard.py. What a newly entered site still needs, worked out from the
// panel's own data so the list can't go stale.
import { config } from "./adapters";
import { fetchUrl } from "./crawl";
import { getSetting, one, setSetting } from "./db";
import { domains as kwgapDomains } from "./kwgap";
import { get as scheduleGet } from "./schedule";
import { keyInfo } from "./gsc";
import type { ProjectRow } from "./projects";

const SIGNS: [string, RegExp][] = [
  ["woocommerce", /woocommerce|wc-ajax|\/wc-api\//i],
  ["wordpress", /wp-content|wp-includes/i],
  ["shopify", /cdn\.shopify\.com/i],
  ["nextjs", /\/_next\/static|__NEXT_DATA__/i],
  ["nuxt", /\/_nuxt\/|__NUXT__/i],
  ["laravel", /laravel_session/i],
];
const CONNECT: Record<string, string> = { woocommerce: "wordpress", wordpress: "wordpress" };
const NAMES: Record<string, string> = { woocommerce: "ووکامرس", wordpress: "وردپرس", shopify: "Shopify", nextjs: "Next.js (اختصاصی)", nuxt: "Nuxt (اختصاصی)", laravel: "Laravel (اختصاصی)", unknown: "ناشناخته" };

export async function detect(project: ProjectRow): Promise<string> {
  const r = await fetchUrl(`https://${project.domain}/`);
  if (r.status !== 200) throw new Error(`سایت باز نشد (${r.status})`);
  const found = SIGNS.find(([, sign]) => sign.test(r.body))?.[0] || "unknown";
  setSetting(`platform:${project.id}`, found);
  return found;
}

export function platform(pid: string): string {
  return getSetting(`platform:${pid}`, "");
}

type Step = { key: string; label: string; done: boolean; hint: string; tab: string };

export function checklist(project: ProjectRow) {
  const pid = project.id;
  const last = (k: string) => !!one("SELECT 1 FROM runs WHERE project_id=? AND kind=? AND status='ok' LIMIT 1", pid, k);
  const gscData = !!one("SELECT 1 FROM gsc_snap WHERE project_id=? LIMIT 1", pid);
  const ki = keyInfo();
  const email = ki && "client_email" in ki ? ki.client_email : "";
  const plat = platform(pid);
  const kind = (config(pid) || {}).type;
  const connectKey = plat ? (CONNECT[plat] ?? "x") : "";
  const adapterHint = connectKey === "wordpress"
    ? "نوع وردپرس را در تنظیمات انتخاب کن و Application Password بساز."
    : connectKey === ""
      ? "نوع سایت هنوز تشخیص داده نشده."
      : "این سایت اختصاصی است؛ پیام «سایت اختصاصی» را از تنظیمات به برنامه‌نویس بده.";
  const steps: Step[] = [
    { key: "audit", label: "ممیزی فنی سایت", done: last("audit"), hint: "خودکار شروع می‌شود.", tab: "issues" },
    { key: "catalog", label: "شناختن محصولات و صفحه‌ها", done: !!one("SELECT 1 FROM catalog WHERE project_id=? LIMIT 1", pid), hint: "خودکار شروع می‌شود.", tab: "products" },
    { key: "gsc", label: "اتصال Search Console", done: gscData, hint: email ? `در Search Console این ایمیل را با دسترسی Full اضافه کن: ${email}` : "اول فایل حساب سرویس گوگل را در تنظیمات کلی پنل بگذار.", tab: "settings" },
    { key: "ga", label: "اتصال Google Analytics", done: !!getSetting<{ at?: number }>(`ga:${pid}`, {}).at, hint: email ? `در GA نقش Viewer به ${email} بده و شناسه عددی property را در تب کلمات وارد کن.` : "اول فایل حساب سرویس گوگل را بگذار.", tab: "kwgap" },
    { key: "adapter", label: "اتصال برای ثبت تغییر روی سایت", done: !!kind, hint: adapterHint, tab: "settings" },
    { key: "competitors", label: "پیدا کردن رقبا", done: kwgapDomains(project).length > 0, hint: "مدیریت کلمات خودش رقبا را پیدا می‌کند.", tab: "kwgap" },
    { key: "auto", label: "کار خودکار روشن باشد", done: !!scheduleGet(project).kwgap.on, hint: "در تب زمان‌بندی «مدیریت کلمات» را روشن کن.", tab: "schedule" },
  ];
  return { platform: plat, platform_name: NAMES[plat] || "", steps, left: steps.filter((s) => !s.done).length };
}
