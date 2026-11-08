// Ported from server.py's summary()/uptime_stats()/current_errors()/friendly()/priorities().
// keywords.proposals() (hub/keywords.py's Claude-review workflow) isn't ported, so
// priorities() skips that one bullet (the "پیشنهاد ..." items) rather than faking it.
import { one, q } from "./db";
import { CHECKS } from "./checks";
import { state, type RunningSlot } from "./jobs/queues";
import { visibleProjects, type User } from "./auth";
import { refreshes } from "./growth";
import { newPages } from "./kwgap";
import type { ProjectRow } from "./projects";

export type UptimeStats = { pct: number | null; avg_ms: number | null; last: { ts: number; status: number; ms: number } | null; checks: number };

export function uptimeStats(pid: string, hours = 24): UptimeStats {
  const rows = q<{ ts: number; status: number; ms: number }>(
    "SELECT ts, status, ms FROM uptime WHERE project_id=? AND ts>=? ORDER BY ts", pid, Date.now() / 1000 - hours * 3600,
  );
  if (!rows.length) return { pct: null, avg_ms: null, last: null, checks: 0 };
  const up = rows.filter((r) => r.status >= 200 && r.status < 400);
  return {
    pct: Math.round((100 * up.length / rows.length) * 100) / 100,
    avg_ms: up.length ? Math.round(up.reduce((a, r) => a + r.ms, 0) / up.length) : null,
    last: rows[rows.length - 1],
    checks: rows.length,
  };
}

function friendly(err: string): string {
  if (err.includes("دسترسی ندارد") || err.includes("پیدا نشد")) return "این سایت به حساب Search Console وصل نیست.";
  return err.split("{")[0].trim().slice(0, 200);
}

export type CurrentError = { kind: string; status: string; error: string; started_at: number };

export function currentErrors(pid: string): CurrentError[] {
  const out: CurrentError[] = [];
  for (const k of ["audit", "catalog", "gsc"]) {
    const r = one<CurrentError>("SELECT kind, status, error, started_at FROM runs WHERE project_id=? AND kind=? ORDER BY id DESC LIMIT 1", pid, k);
    if (r && r.status === "error" && r.error !== "interrupted") out.push({ ...r, error: friendly(r.error) });
  }
  return out;
}

type Audit = { id: number; started_at: number; score: number | null; summary: string; status: string };

export function projectSummary(p: ProjectRow) {
  const pid = p.id;
  const audits = q<Audit>("SELECT id, started_at, score, summary, status FROM runs WHERE project_id=? AND kind='audit' AND status='ok' ORDER BY id DESC LIMIT 20", pid);
  const sevRows = q<{ severity: string; n: number }>("SELECT severity, COUNT(*) n FROM issues WHERE project_id=? AND status='open' GROUP BY severity", pid);
  const sev = Object.fromEntries(sevRows.map((r) => [r.severity, r.n]));
  const dailyAsc = q<{ date: string; clicks: number; impressions: number; position: number }>(
    "SELECT date, clicks, impressions, position FROM gsc_daily WHERE project_id=? ORDER BY date DESC LIMIT 56", pid,
  ).reverse();
  const last28 = dailyAsc.slice(-28);
  const prev28 = dailyAsc.slice(0, -28);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const gsc = dailyAsc.length ? {
    position: avg(last28.map((d) => d.position)),
    prev_position: prev28.length >= 20 ? avg(prev28.map((d) => d.position)) : null,
    clicks: sum(last28.map((d) => d.clicks)),
    impressions: sum(last28.map((d) => d.impressions)),
    prev_clicks: prev28.length >= 20 ? sum(prev28.map((d) => d.clicks)) : null,
    prev_impressions: prev28.length >= 20 ? sum(prev28.map((d) => d.impressions)) : null,
    spark: last28.map((d) => d.clicks),
  } : null;

  const check = one<{ started_at: number }>("SELECT started_at FROM runs WHERE project_id=? AND kind IN ('audit','recheck') AND status='ok' ORDER BY id DESC LIMIT 1", pid);
  const fixedSince = one<{ n: number }>("SELECT COUNT(*) n FROM issues WHERE project_id=? AND status='fixed' AND fixed_at>=?", pid, check ? check.started_at : Date.now() / 1000)!.n;
  const audit = audits[0] ? { ...audits[0], summary: JSON.parse(audits[0].summary || "{}") } : null;

  const cur = state.current;
  const running = state.writing && state.writing.project === pid ? state.writing.kind
    : cur && cur.project === pid ? cur.kind : null;

  return {
    ...p,
    last_check: check ? check.started_at : null,
    fixed_since_check: fixedSince,
    audit,
    score_history: audits.slice().reverse().map((a) => ({ t: a.started_at, score: a.score })),
    issues: { critical: sev["critical"] || 0, warning: sev["warning"] || 0, info: sev["info"] || 0 },
    uptime: uptimeStats(pid),
    uptime7: uptimeStats(pid, 168).pct,
    gsc,
    running,
    queued: state.queued.filter((j) => j.project === pid).map((j) => j.kind),
    last_errors: currentErrors(pid),
  };
}

// Changes once per process start — the frontend's future deploy-detection poll (ported with
// Phase 6) compares this to notice a new version is running and reload when idle, same as
// server.py's build() cache-buster.
export const BUILD_ID = String(Date.now());

// Ported from server.py's jobs_state(): only "current" (one slot, preferring writing >
// current > reading) and queue/history entries the user can actually see.
export function jobsState(visiblePids: Set<string>) {
  const mine = (slot: RunningSlot) => (slot && visiblePids.has(slot.project) ? slot : null);
  const current = mine(state.writing) || mine(state.current) || mine(state.reading);
  return {
    build: BUILD_ID,
    current,
    queued: state.queued.filter((j) => visiblePids.has(j.project)),
    history: state.history.filter((h) => visiblePids.has(h.project)).slice(0, 10),
  };
}

type PriorityItem = { rank: number; tone: "danger" | "warn" | "info" | "muted"; project: string; project_name: string; title: string; why: string; action: string; href: string; fix_id?: number };

/** What deserves attention now, across the user's projects, most urgent first. */
export function priorities(user: User, hasGscKey: boolean): PriorityItem[] {
  const items: PriorityItem[] = [];
  const add = (rank: number, tone: PriorityItem["tone"], pid: string, name: string, title: string, why: string, action: string, href: string) => {
    items.push({ rank, tone, project: pid, project_name: name, title, why, action, href });
  };
  for (const p of visibleProjects(user)) {
    const pid = p.id, name = p.name;
    const link = (t: string) => `#/p/${pid}/${t}`;
    const last = one<{ status: number | null }>("SELECT status FROM uptime WHERE project_id=? ORDER BY ts DESC LIMIT 1", pid);
    if (last && !(last.status !== null && last.status >= 200 && last.status < 400)) {
      add(0, "danger", pid, name, "سایت از دسترس خارج است", `آخرین بررسی کد ${last.status || "بدون پاسخ"} برگرداند.`, "دیدن آپتایم", link("uptime"));
    }
    const groups = q<{ code: string; severity: string; n: number }>(
      "SELECT code, severity, COUNT(*) n FROM issues WHERE project_id=? AND status='open' AND severity!='info' GROUP BY code ORDER BY CASE severity WHEN 'critical' THEN 0 ELSE 1 END, n DESC",
      pid,
    );
    for (const g of groups.filter((x) => x.severity === "critical")) {
      const c = CHECKS[g.code];
      if (c) add(1, "danger", pid, name, c[1], `${g.n} مورد. ${c[2]}`, "دیدن مشکل", link("issues"));
    }
    for (const g of groups.filter((x) => x.severity === "warning").slice(0, 2)) {
      const c = CHECKS[g.code];
      if (c) add(4, "warn", pid, name, c[1], `${g.n} مورد. ${c[2]}`, "دیدن مشکل", link("issues"));
    }
    if (user.is_admin && hasGscKey && currentErrors(pid).some((e) => e.kind === "gsc")) {
      add(2, "warn", pid, name, "Search Console این سایت وصل نیست", "ایمیل حساب سرویس را در Search Console این سایت اضافه کنید.", "راهنمای اتصال", "#/settings");
    }
    const g = one<{ status: string; summary: string }>("SELECT status, summary FROM runs WHERE project_id=? AND kind='gsc' ORDER BY id DESC LIMIT 1", pid);
    if (user.is_admin && g && g.status === "ok" && JSON.parse(g.summary || "{}").days === 0) {
      add(2, "warn", pid, name, "Search Console داده‌ای نداد", "این property کلیک و نمایشی ندارد. property درست (با www یا Domain) را به حساب سرویس بدهید.", "راهنمای اتصال", "#/settings");
    }
    let n = one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE project_id=? AND status!='done' AND assignee_id=?", pid, user.id)!.n;
    if (n) add(1, "info", pid, name, "کارهای واگذارشده به شما", `${n} کار باز دارید.`, "دیدن کارها", link("tasks"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM content WHERE project_id=? AND status='review'", pid)!.n;
    if (n) add(2, "info", pid, name, "محتوای منتظر بازبینی", `${n} مورد نوشته شده و منتظر تأیید شماست.`, "بازبینی", link("content"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM fixes WHERE project_id=? AND status='approved'", pid)!.n;
    if (n) add(3, "info", pid, name, "اصلاح تأییدشده برای ثبت در سایت", `${n} مورد آماده ثبت در بک‌آفیس است.`, "خروجی گرفتن", link("products"));
    const snap = one<{ s: number | null }>("SELECT MAX(snap) s FROM gsc_snap WHERE project_id=?", pid)?.s;
    if (snap) {
      const r = one<{ key: string; impressions: number; position: number }>(
        "SELECT key, impressions, position FROM gsc_snap WHERE project_id=? AND snap=? AND dim='query' AND position BETWEEN 8 AND 20 AND impressions>=10 ORDER BY impressions DESC LIMIT 1",
        pid, snap,
      );
      if (r) add(3, "info", pid, name, `«${r.key}» نزدیک صفحه اول است`, `جایگاه ${r.position.toFixed(1)} با ${r.impressions.toFixed(0)} نمایش.`, "دیدن فرصت", link("keywords"));
    }
    // keywords.proposals() (hub/keywords.py's Claude-review workflow) isn't ported — Python's
    // equivalent bullet here (up to 3 "پیشنهاد ..." items with a fix_id) is skipped.
    for (const r of q<{ url: string; id: number }>(
      "SELECT i.url, MAX(i.applied_id) id FROM impact i JOIN applied a ON a.id=i.applied_id AND a.undone=0 WHERE i.project_id=? AND i.verdict='worse' GROUP BY i.url LIMIT 3",
      pid,
    )) {
      add(1, "danger", pid, name, "بعد از یک تغییر، این صفحه افت کرده", decodeURIComponent(r.url).split("/").pop()!.slice(0, 70), "بررسی و برگرداندن", link("kwgap"));
    }
    n = refreshes(pid).length;
    if (n) add(2, "info", pid, name, "بازنویسی مقاله منتظر تأیید", `${n} مقاله بازنویسی شده و کنار متن فعلی قابل مقایسه است.`, "مقایسه و تأیید", link("kwgap"));
    n = newPages(pid, 7).length;
    if (n) add(4, "info", pid, name, "صفحه‌های تازه رقبا", `${n} صفحه تازه در این هفته دیده شد.`, "دیدن و ساخت ایده", link("kwgap"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM backlinks WHERE project_id=? AND status='open'", pid)!.n;
    if (n) add(3, "info", pid, name, "فرصت بک‌لینک", `${n} سایت با متن آماده منتظر ارسال است.`, "دیدن فرصت‌ها", link("kwgap"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM tasks WHERE project_id=? AND status!='done' AND assignee_id IS NULL", pid)!.n;
    if (n) add(3, "warn", pid, name, "کارهای بدون مسئول", `${n} کار هنوز به کسی واگذار نشده.`, "واگذاری", link("tasks"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM content WHERE project_id=? AND status='drafted'", pid)!.n;
    if (n) add(3, "info", pid, name, "پیش‌نویس آماده انتشار", `${n} مقاله در سایت پیش‌نویس است.`, "دیدن محتوا", link("content"));
    n = one<{ n: number }>("SELECT COUNT(*) n FROM fixes WHERE project_id=? AND status='pending'", pid)!.n;
    if (n) add(5, "muted", pid, name, "اصلاح‌های در انتظار تصمیم", `${n} پیشنهاد برای محصولات و مقاله‌ها.`, "بررسی", link("products"));
  }
  return items.sort((a, b) => a.rank - b.rank);
}
