// Ported from public/app.js's tabDash(), using real server-side data (no client fetch) —
// this is a Next.js server component, so every piece tabDash() fetched over the API is just
// a direct function call here instead.
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { projectSummary, uptimeStats, priorities } from "@/lib/overview";
import { checklist } from "@/lib/onboard";
import { role, type User } from "@/lib/auth";
import { currentUser } from "@/lib/server/current-user";
import { q } from "@/lib/db";
import { CHECKS } from "@/lib/checks";
import { faNum } from "@/lib/intl/fa";
import { formatJalali } from "@/lib/intl/jalali";
import Icon from "@/components/Icon";
import Link from "next/link";

export const dynamic = "force-dynamic";

function kpiClass(kind: string) { return kind ? ` ${kind}` : ""; }

function durFmt(ms: number | null): string {
  if (ms == null) return "—";
  return ms < 1000 ? `${faNum(ms)} میلی‌ثانیه` : `${faNum(Math.round(ms / 100) / 10, 1)} ثانیه`;
}

function delta(cur: number | null | undefined, prev: number | null | undefined, invert = false): string {
  if (cur == null || prev == null || prev === 0) return "";
  const d = ((cur - prev) / prev) * 100;
  if (Math.abs(d) < 1) return "";
  const good = invert ? d < 0 : d > 0;
  return `${d > 0 ? "▲" : "▼"} ${faNum(Math.abs(d))}٪` + (good ? "" : "");
}

export default async function DashboardTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = (await currentUser())!;
  const myRole = role(user, projectId);
  const s = projectSummary(p);
  const up = { day: uptimeStats(projectId, 24), week: uptimeStats(projectId, 168) };
  const setup = myRole === "admin" ? checklist(p) : null;

  const issueRows = q<{ code: string; severity: string }>("SELECT code, severity FROM issues WHERE project_id=? AND status='open'", projectId);
  const groups = new Map<string, { code: string; severity: string; n: number }>();
  for (const i of issueRows) {
    if (!groups.has(i.code)) groups.set(i.code, { code: i.code, severity: i.severity, n: 0 });
    groups.get(i.code)!.n++;
  }
  const rank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const top = [...groups.values()].sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.n - a.n).slice(0, 6);

  const allPriorities = priorities(user, true).filter((i) => i.project === projectId && i.href !== `#/p/${projectId}/issues` && i.href !== "#/settings").slice(0, 4);
  const connIssue = s.last_errors.find((e) => e.kind === "gsc");
  const hist = s.score_history.filter((h) => h.score != null);

  return (
    <div>
      <div className="page-head">
        <div className="head-title">
          <span className="swatch lg" style={{ background: p.color }} />
          <h1>{p.name}</h1>
          {myRole !== "admin" && <span className="chip">{myRole === "editor" ? "ویرایشگر" : "بیننده"}</span>}
          <a className="mono muted" href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer">{p.domain}</a>
        </div>
      </div>

      {setup && setup.left > 0 && (
        <section className="panel flush setup-box" style={{ marginBottom: 14 }}>
          <h3>راه‌اندازی این سایت <span className="count">{faNum(setup.left)} مانده</span></h3>
          <p className="muted small" style={{ padding: "0 16px" }}>
            {setup.platform_name ? `نوع سایت: ${setup.platform_name}. ` : ""}هر مرحله تمام شود خودکار از این فهرست می‌رود.
          </p>
          <ul className="plain-list setup-steps">
            {setup.steps.map((st) => (
              <li key={st.key} className={st.done ? "is-done" : ""}>
                <span className={`dot${st.done ? " ok" : ""}`} aria-hidden="true" />
                <span className="grow">
                  <Link href={`/p/${projectId}/${st.tab}`}>{st.label}</Link>
                  {!st.done && <div className="muted small">{st.hint}</div>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="kpis six">
        <div className={`kpi${kpiClass(s.audit ? (s.audit.score! >= 80 ? "good" : s.audit.score! >= 55 ? "warn" : "bad") : "")}`}>
          <span className="kpi-l">امتیاز فنی</span>
          <b>{s.audit ? faNum(s.audit.score!) : "—"}</b>
          <span className="kpi-x">{s.audit ? formatJalali(s.audit.started_at * 1000) : "هنوز ممیزی نشده"}</span>
        </div>
        <div className={`kpi${kpiClass(s.issues.critical ? "bad" : "")}`}>
          <span className="kpi-l">مشکلات باز</span>
          <b>{faNum(s.issues.critical + s.issues.warning)}</b>
          <span className="kpi-x">{faNum(s.issues.critical)} بحرانی · {faNum(s.issues.info)} پیشنهاد</span>
        </div>
        <div className={`kpi${kpiClass(s.uptime7 != null && s.uptime7 < 99 ? "bad" : "good")}`}>
          <span className="kpi-l">آپتایم ۷ روز</span>
          <b>{s.uptime7 == null ? "—" : `${faNum(s.uptime7)}٪`}</b>
          <span className="kpi-x">{durFmt(up.week.avg_ms)}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">کلیک ۲۸ روز</span>
          <b>{s.gsc ? faNum(s.gsc.clicks) : "—"}</b>
          <span className="kpi-x">{s.gsc ? (delta(s.gsc.clicks, s.gsc.prev_clicks) || "بدون تغییر") : "وصل نیست"}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">نمایش ۲۸ روز</span>
          <b>{s.gsc ? faNum(s.gsc.impressions) : "—"}</b>
          <span className="kpi-x">{s.gsc ? (delta(s.gsc.impressions, s.gsc.prev_impressions) || "بدون تغییر") : ""}</span>
        </div>
        <div className="kpi">
          <span className="kpi-l">میانگین جایگاه</span>
          <b>{s.gsc?.position ? faNum(s.gsc.position, 1) : "—"}</b>
          <span className="kpi-x">{s.gsc?.position ? (delta(s.gsc.position, s.gsc.prev_position, true) || "بدون تغییر") : ""}</span>
        </div>
      </div>

      {connIssue && (
        <div className="banner warn">
          <Icon name="alert" />
          <div className="grow"><strong>Search Console این سایت وصل نیست.</strong> داده‌ای که می‌بینید ممکن است قدیمی باشد.</div>
          <Link className="btn sm" href={`/p/${projectId}/settings`}>راهنمای اتصال</Link>
        </div>
      )}

      <div className="dash">
        <section className="panel c8">
          <h3>جستجوی گوگل</h3>
          {s.gsc ? (
            <div className="kv">
              <div><b>{faNum(s.gsc.clicks)}</b><span>کلیک</span></div>
              <div><b>{faNum(s.gsc.impressions)}</b><span>نمایش</span></div>
              <div><b>{s.gsc.position != null ? faNum(s.gsc.position, 1) : "—"}</b><span>جایگاه</span></div>
            </div>
          ) : (
            <div className="empty-inline">
              <p>کلیک، نمایش و رتبه کلمات اینجا نمایش داده می‌شود.</p>
              <Link className="btn" href={`/p/${projectId}/settings`}>اتصال Search Console</Link>
            </div>
          )}
        </section>

        <section className="panel c4">
          <h3>کارهای بعدی</h3>
          {allPriorities.length ? (
            <ol className="todo compact">
              {allPriorities.map((i, idx) => (
                <li key={idx}>
                  <div className="grow"><strong>{i.title}</strong><div className="muted">{i.why}</div></div>
                  <a className="btn sm" href={i.href}>{i.action}</a>
                </li>
              ))}
            </ol>
          ) : <div className="muted">کار دیگری باز نیست.</div>}
        </section>

        <section className="panel c6">
          <h3>مهم‌ترین مشکلات<span className="spacer" /><Link className="btn sm link" href={`/p/${projectId}/issues`}>همه</Link></h3>
          {top.length ? (
            <ul className="plain-list">
              {top.map((i) => (
                <li key={i.code}>
                  <span className={`sev ${i.severity}`}>{i.severity === "critical" ? "بحرانی" : i.severity === "warning" ? "هشدار" : "پیشنهاد"}</span>
                  <span className="grow">{CHECKS[i.code]?.[1] || i.code}</span>
                  <span className="count">{faNum(i.n)}</span>
                </li>
              ))}
            </ul>
          ) : <div className="muted">مشکل بازی نیست.</div>}
        </section>

        <section className="panel c6">
          <h3>روند امتیاز فنی</h3>
          {hist.length > 1 ? (
            <div className="kv">
              {hist.slice(-3).map((h, idx) => (
                <div key={idx}><b>{faNum(h.score!)}</b><span>{formatJalali(h.t * 1000)}</span></div>
              ))}
            </div>
          ) : <div className="empty-inline"><p>بعد از دومین ممیزی نمایش داده می‌شود.</p></div>}
        </section>

        <section className="panel c12">
          <h3>آپتایم ۲۴ ساعت<span className="spacer" /><span className="muted head-note">{up.day.pct == null ? "هنوز داده‌ای نیست" : `${faNum(up.day.pct)}٪ · میانگین پاسخ ${durFmt(up.day.avg_ms)}`}</span></h3>
        </section>
      </div>
    </div>
  );
}
