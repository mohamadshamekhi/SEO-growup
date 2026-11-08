// Ported 1:1 from hub/ga.py. Token acquisition via lib/google-auth.ts (same service-account
// key as GSC, different scope).
import { getSetting, setSetting } from "./db";
import { token, GA_SCOPE, keyInfo } from "./google-auth";
import type { ProjectRow } from "./projects";

export function getProperty(pid: string): string {
  return getSetting(`ga_property:${pid}`, "");
}

export function setProperty(pid: string, value: string) {
  const v = String(value || "").trim().replace(/^properties\//, "");
  if (v && !/^\d+$/.test(v)) throw new Error("شناسه property باید عدد باشد، نه G-...؛ در GA: Admin ← Property details");
  setSetting(`ga_property:${pid}`, v);
}

type DimValue = { dimensionValues: { value: string }[]; metricValues: { value: string }[] };

async function report(prop: string, body: unknown): Promise<{ rows?: DimValue[] }> {
  const res = await fetch(`https://analyticsdata.googleapis.com/v1beta/properties/${prop}:runReport`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token(GA_SCOPE)}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store", // see lib/gsc.ts's api() for why this is required, not optional
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403 && (text.includes("has not been used") || text.includes("SERVICE_DISABLED"))) {
      const link = text.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/[^\s"\\]+/);
      throw new Error("سرویس Google Analytics Data API روی پروژه گوگل پنل خاموش است؛ این صفحه را باز کنید و Enable بزنید: " + (link ? link[0] : "console.cloud.google.com"));
    }
    if (res.status === 403) throw new Error("ایمیل حساب سرویس به این property دسترسی ندارد؛ در GA نقش Viewer بدهید");
    throw new Error(`Analytics پاسخ ${res.status} داد`);
  }
  return res.json();
}

export type PageStat = { path: string; sessions: number; organic: number; purchases: number; organic_purchases: number };

export function summarize(rows: DimValue[]): Record<string, PageStat> {
  const pages: Record<string, PageStat> = {};
  for (const r of rows) {
    const path = decodeURIComponent(r.dimensionValues[0].value.split("?")[0]).replace(/\/$/, "") || "/";
    const channel = r.dimensionValues[1].value;
    const sessions = Math.trunc(Number(r.metricValues[0].value));
    const buys = Math.trunc(Number(r.metricValues[1].value));
    const p = (pages[path] ??= { path, sessions: 0, organic: 0, purchases: 0, organic_purchases: 0 });
    p.sessions += sessions; p.purchases += buys;
    if (channel === "Organic Search") { p.organic += sessions; p.organic_purchases += buys; }
  }
  return pages;
}

export type FunnelStat = { views: number; carts: number };

export function summarizeFunnel(rows: DimValue[]): Record<string, FunnelStat> {
  const out: Record<string, FunnelStat> = {};
  for (const r of rows) {
    const path = decodeURIComponent(r.dimensionValues[0].value.split("?")[0]).replace(/\/$/, "") || "/";
    const p = (out[path] ??= { views: 0, carts: 0 });
    p.views += Math.trunc(Number(r.metricValues[0].value));
    p.carts += Math.trunc(Number(r.metricValues[1].value));
  }
  return out;
}

export type SourceStat = { channel: string; source: string; sessions: number };

export function summarizeSources(rows: DimValue[]): Record<string, SourceStat[]> {
  const out: Record<string, Map<string, number>> = {};
  for (const r of rows) {
    const d = r.dimensionValues;
    const path = decodeURIComponent(d[0].value.split("?")[0]).replace(/\/$/, "") || "/";
    const key = `${d[1].value}\u0000${d.length > 2 ? d[2].value : ""}`;
    const page = (out[path] ??= new Map());
    page.set(key, (page.get(key) || 0) + Math.trunc(Number(r.metricValues[0].value)));
  }
  const result: Record<string, SourceStat[]> = {};
  for (const [path, m] of Object.entries(out)) {
    result[path] = [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => { const [channel, source] = key.split("\u0000"); return { channel, source, sessions: n }; });
  }
  return result;
}

export function sources(pid: string): Record<string, SourceStat[]> {
  return getSetting<{ sources?: Record<string, SourceStat[]> }>(`ga:${pid}`, {}).sources || {};
}

export function channels(pid: string): { channel: string; sessions: number }[] {
  const total: Record<string, number> = {};
  for (const page of Object.values(sources(pid))) for (const s of page) total[s.channel] = (total[s.channel] || 0) + s.sessions;
  return Object.entries(total).sort((a, b) => b[1] - a[1]).map(([channel, sessions]) => ({ channel, sessions }));
}

// Days of silence before an event counts as stopped: rarer events get longer, a small shop
// can go weeks without a sale.
export const EVENTS: [event: string, label: string, limitDays: number][] = [
  ["page_view", "بازدید صفحه", 3], ["view_item", "دیدن محصول", 7], ["add_to_cart", "افزودن به سبد", 14],
  ["begin_checkout", "شروع پرداخت", 21], ["purchase", "خرید", 30],
];

export type TrackingEvent = { event: string; label: string; total: number; days: number | null; status: "ok" | "stopped" | "never" };

export function trackingState(rows: DimValue[], today: Date): TrackingEvent[] {
  const seen: Record<string, { total: number; last: string }> = {};
  const known = new Set(EVENTS.map((e) => e[0]));
  for (const r of rows) {
    const name = r.dimensionValues[0].value, day = r.dimensionValues[1].value;
    if (!known.has(name)) continue;
    const s = (seen[name] ??= { total: 0, last: "" });
    s.total += Math.trunc(Number(r.metricValues[0].value));
    s.last = s.last > day ? s.last : day;
  }
  return EVENTS.map(([name, label, limit]) => {
    const s = seen[name];
    const days = s ? Math.floor((today.getTime() - Date.UTC(+s.last.slice(0, 4), +s.last.slice(4, 6) - 1, +s.last.slice(6, 8))) / 86400000) : null;
    return { event: name, label, total: s ? s.total : 0, days, status: !s ? "never" : (days as number) > limit ? "stopped" : "ok" };
  });
}

export function tracking(pid: string): TrackingEvent[] {
  return getSetting<{ tracking?: TrackingEvent[] }>(`ga:${pid}`, {}).tracking || [];
}

// Only what changed since the last check. The first check sets the baseline, and when no
// page views arrive at all that one message covers the rest.
export function trackingAlerts(pid: string): string[] {
  const now: Record<string, TrackingEvent> = Object.fromEntries(tracking(pid).map((t) => [t.event, t]));
  if (!Object.keys(now).length) return [];
  const was = getSetting<Record<string, string> | null>(`ga_track:${pid}`, null);
  setSetting(`ga_track:${pid}`, Object.fromEntries(Object.entries(now).map(([k, t]) => [k, t.status])));
  if (was === null) return [];
  if (now.page_view.status !== "ok" && was.page_view === "ok") return ["هیچ بازدیدی به Analytics نمی‌رسد؛ کد Analytics سایت را بررسی کنید."];
  const out: string[] = [];
  for (const [k, t] of Object.entries(now)) {
    if (t.status === "ok" && was[k] !== "ok") out.push(`رویداد «${t.label}» به Analytics می‌رسد.`);
    else if (t.status !== "ok" && was[k] === "ok" && now.page_view.status === "ok") out.push(`رویداد «${t.label}» مدتی است به Analytics نرسیده؛ کد فروشگاه را بررسی کنید.`);
  }
  return out;
}

export function funnel(pid: string): Record<string, FunnelStat> {
  return getSetting<{ funnel?: Record<string, FunnelStat> }>(`ga:${pid}`, {}).funnel || {};
}

export function hasCartEvents(pid: string): boolean {
  return Object.values(funnel(pid)).some((v) => v.carts);
}

export async function pageWindow(pid: string, url: string, start: string, end: string): Promise<{ views: number; carts: number } | null> {
  const prop = getProperty(pid);
  if (!prop) return null;
  const path = new URL(url).pathname;
  let d: { rows?: DimValue[] };
  try {
    d = await report(prop, {
      dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "addToCarts" }],
      dimensionFilter: { filter: { fieldName: "pagePath", inListFilter: { values: [path, path.replace(/\/$/, ""), decodeURIComponent(path)] } } },
    });
  } catch { return null; }
  const s = summarizeFunnel(d.rows || []);
  const vals = Object.values(s);
  return { views: vals.reduce((a, v) => a + v.views, 0), carts: vals.reduce((a, v) => a + v.carts, 0) };
}

export async function pull(p: ProjectRow): Promise<number | null> {
  const prop = getProperty(p.id);
  if (!prop) return null;
  const d = await report(prop, {
    dateRanges: [{ startDate: "28daysAgo", endDate: "yesterday" }], dimensions: [{ name: "landingPage" }, { name: "sessionDefaultChannelGroup" }, { name: "sessionSource" }],
    metrics: [{ name: "sessions" }, { name: "ecommercePurchases" }], limit: 2000,
  });
  const pages = summarize(d.rows || []);
  const f = await report(prop, { dateRanges: [{ startDate: "90daysAgo", endDate: "yesterday" }], dimensions: [{ name: "pagePath" }], metrics: [{ name: "screenPageViews" }, { name: "addToCarts" }], limit: 5000 });
  const e = await report(prop, {
    dateRanges: [{ startDate: "45daysAgo", endDate: "yesterday" }], dimensions: [{ name: "eventName" }, { name: "date" }], metrics: [{ name: "eventCount" }], limit: 1000,
    dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: EVENTS.map((e) => e[0]) } } },
  });
  setSetting(`ga:${p.id}`, {
    at: Date.now() / 1000, pages, sources: summarizeSources(d.rows || []), funnel: summarizeFunnel(f.rows || []),
    tracking: trackingState(e.rows || [], new Date()),
  });
  setSetting(`ga_error:${p.id}`, "");
  return Object.keys(pages).length;
}

export function state(pid: string, limit = 30) {
  const data = getSetting<{ at?: number; pages?: Record<string, PageStat> }>(`ga:${pid}`, {});
  const rows = Object.values(data.pages || {}).sort((a, b) => b.purchases - a.purchases || b.organic - a.organic);
  const ki = keyInfo();
  return { property: getProperty(pid), at: data.at ?? null, error: getSetting(`ga_error:${pid}`, ""), pages: rows.slice(0, limit), email: ki && "client_email" in ki ? ki.client_email : "" };
}

export function purchasesFor(pid: string, url: string): number {
  const pages = getSetting<{ pages?: Record<string, PageStat> }>(`ga:${pid}`, {}).pages || {};
  const path = decodeURIComponent(new URL(url).pathname).replace(/\/$/, "") || "/";
  return pages[path]?.purchases ?? 0;
}
