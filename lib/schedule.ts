// Ported 1:1 from hub/schedule.py. Pure logic/data, no external dependency, so this is a
// straightforward port: per-project per-job-kind interval config (stored as JSON under
// `schedule:<pid>` in the settings table, exactly like the Python side), due-time checks,
// and next-run prediction for jobs either on a plain interval or pinned to a Tehran-local hour.
import { getSetting, one, q, setSetting } from "./db";
import type { ProjectRow } from "./projects";

export const TEHRAN_OFFSET_MIN = 3 * 60 + 30;

export type JobKey = "uptime" | "audit" | "articles" | "catalog" | "gsc" | "index" | "speed" | "watch" | "kwgap" | "prices" | "report";

// key: [label, about, default hours, minimum hours, on by default]
export const JOBS: Record<JobKey, [label: string, about: string, hours: number, minHours: number, onByDefault: boolean]> = {
  uptime: ["آپتایم", "بررسی در دسترس بودن سایت", 1 / 6, 1 / 60, true],
  audit: ["ممیزی فنی", "خزیدن صفحات و پیدا کردن مشکلات", 24, 1, true],
  articles: ["لیست مقالات و ایده‌ها", "خواندن مقالات سایت و به‌روزرسانی ایده‌ها", 24, 1, true],
  catalog: ["کاتالوگ محصولات", "خواندن محصولات و ساخت پیشنهاد اصلاح", 168, 6, true],
  gsc: ["Search Console", "کلیک، نمایش و رتبه کلمات", 24, 6, true],
  index: ["وضعیت ایندکس", "بررسی ایندکس صفحات در گوگل", 24, 6, true],
  speed: ["سرعت صفحات", "Core Web Vitals از PageSpeed", 168, 24, true],
  watch: ["پایش رقبا", "بررسی تغییر صفحات رقبا", 168, 24, true],
  kwgap: ["مدیریت کلمات", "پیدا کردن رقبا، تحلیل کلمات و ساخت ایده و کار", 168, 24, true],
  prices: ["قیمت رقبا در ترب", "خواندن صفحه محصول ترب برای لینک‌هایی که داده‌اید", 168, 24, true],
  report: ["گزارش هفتگی", "ساخت گزارش و مقایسه با دوره قبل", 168, 24, true],
};

const LEGACY: Partial<Record<JobKey, string>> = { uptime: "uptime", audit: "auto_audit", catalog: "auto_catalog", gsc: "auto_gsc", index: "auto_index", speed: "auto_speed", report: "weekly_report" };

export type JobConfig = { on: boolean; hours: number; at: number | null; idle?: boolean };

export function get(project: ProjectRow): Record<JobKey, JobConfig> {
  const saved = getSetting<Record<string, Partial<JobConfig>>>(`schedule:${project.id}`, {});
  const s = project.settings || {};
  const legacyHours: Partial<Record<JobKey, number | undefined>> = {
    audit: s.audit_hours as number | undefined,
    uptime: (s.uptime_minutes as number | undefined) ? (s.uptime_minutes as number) / 60 : undefined,
    catalog: s.catalog_hours as number | undefined,
  };
  const out = {} as Record<JobKey, JobConfig>;
  for (const key of Object.keys(JOBS) as JobKey[]) {
    const [, , hours, , onDefault] = JOBS[key];
    const cur = saved[key] || {};
    const legacyKey = LEGACY[key];
    const legacyOn = legacyKey ? s[legacyKey] : undefined;
    out[key] = {
      on: cur.on ?? (typeof legacyOn === "boolean" ? legacyOn : onDefault),
      hours: Number(cur.hours || legacyHours[key] || hours),
      at: cur.at ?? null,
    };
  }
  return out;
}

export function save(project: ProjectRow, body: Record<string, { hours?: number; at?: number | string | null; on?: boolean }>): Record<JobKey, JobConfig> {
  const cur = get(project);
  for (const [key, val] of Object.entries(body || {})) {
    if (!(key in JOBS)) throw new Error("کار ناشناخته");
    const k = key as JobKey;
    const hours = Number(val.hours ?? cur[k].hours);
    if (hours < JOBS[k][3] - 1e-9) throw new Error(`${JOBS[k][0]}: فاصله خیلی کوتاه است`);
    if (hours > 24 * 90) throw new Error(`${JOBS[k][0]}: فاصله خیلی بلند است`);
    const at: number | null = val.at === undefined ? cur[k].at : (val.at === null || val.at === "" ? null : Number(val.at));
    if (at !== null && !(at >= 0 && at <= 23)) throw new Error("ساعت باید بین ۰ و ۲۳ باشد");
    cur[k] = { on: val.on ?? cur[k].on, hours, at };
  }
  setSetting(`schedule:${project.id}`, cur);
  return cur;
}

// Tehran is a fixed UTC+3:30 offset (no DST since 2022) — compute it directly with plain
// arithmetic rather than relying on a specific Intl timezone database entry being present.
const TEHRAN_OFFSET_SEC = TEHRAN_OFFSET_MIN * 60;

function tehranHour(ts: number): number {
  return Math.floor((ts + TEHRAN_OFFSET_SEC) / 3600) % 24;
}

// Start of the Tehran-local calendar day containing ts, expressed back in UTC epoch seconds.
function tehranMidnightUtc(ts: number): number {
  const localDayStart = Math.floor((ts + TEHRAN_OFFSET_SEC) / 86400) * 86400;
  return localDayStart - TEHRAN_OFFSET_SEC;
}

export function isDue(job: JobConfig, last: number | null | undefined, now?: number): boolean {
  now = now ?? Date.now() / 1000;
  if (!job.on) return false;
  if (job.at === null) return !last || now - last >= job.hours * 3600;
  const hour = tehranHour(now);
  return hour === job.at && (!last || now - last >= Math.max(job.hours - 1, 0.5) * 3600);
}

export function nextRun(job: JobConfig, last: number | null | undefined, now?: number): number | null {
  now = now ?? Date.now() / 1000;
  if (!job.on) return null;
  if (job.at === null) return last ? Math.max(now, last + job.hours * 3600) : now;
  const t = last ? Math.max(now, last + Math.max(job.hours - 1, 0.5) * 3600) : now;
  if (tehranHour(t) === job.at) return t;
  let candidate = tehranMidnightUtc(t) + job.at * 3600;
  if (candidate <= t) candidate += 86400;
  return candidate;
}

export function lastTimes(pid: string): Partial<Record<JobKey, number | null>> {
  const rows = q<{ kind: string; t: number | null }>("SELECT kind, MAX(started_at) t FROM runs WHERE project_id=? GROUP BY kind", pid);
  const out: Partial<Record<JobKey, number | null>> = Object.fromEntries(rows.map((r) => [r.kind, r.t]));
  const u = one<{ t: number | null }>("SELECT MAX(ts) t FROM uptime WHERE project_id=?", pid);
  const r = one<{ t: number | null }>("SELECT MAX(ts) t FROM reports WHERE project_id=?", pid);
  out.uptime = u?.t ?? null;
  out.report = r?.t ?? null;
  return out;
}

export function describe(project: ProjectRow, now?: number) {
  const jobs = get(project);
  const last = lastTimes(project.id);
  if (!one("SELECT 1 FROM watches WHERE project_id=?", project.id)) jobs.watch = { ...jobs.watch, idle: true };
  return (Object.keys(jobs) as JobKey[]).map((k) => ({
    key: k, label: JOBS[k][0], about: JOBS[k][1], min_hours: JOBS[k][3], ...jobs[k],
    last: last[k] ?? null, next: jobs[k].idle ? null : nextRun(jobs[k], last[k], now),
  }));
}
