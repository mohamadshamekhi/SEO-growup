import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { uptimeStats } from "@/lib/overview";
import { faNum } from "@/lib/intl/fa";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

export const dynamic = "force-dynamic";

function Stat({ label, s }: { label: string; s: ReturnType<typeof uptimeStats> }) {
  return (
    <div className={`kpi${s.pct != null && s.pct < 99 ? " bad" : s.pct != null ? " good" : ""}`}>
      <span className="kpi-l">{label}</span>
      <b>{s.pct == null ? "—" : `${faNum(s.pct, 1)}٪`}</b>
      <span className="kpi-x">{s.avg_ms != null ? `میانگین ${faNum(s.avg_ms)} میلی‌ثانیه` : "—"} · {faNum(s.checks)} بررسی</span>
    </div>
  );
}

export default async function UptimeTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const day = uptimeStats(projectId, 24);
  const week = uptimeStats(projectId, 168);
  const month = uptimeStats(projectId, 720);
  // eslint-disable-next-line react-hooks/purity -- this is an async Server Component (data fetch per request), not a client component re-render
  const since = Date.now() / 1000 - 168 * 3600;
  const rows = q<{ ts: number; status: number; ms: number }>(
    "SELECT ts, status, ms FROM uptime WHERE project_id=? AND ts>=? ORDER BY ts DESC LIMIT 50", projectId, since,
  );

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>آپتایم</h1></div></div>
      <div className="kpis">
        <Stat label="۲۴ ساعت" s={day} />
        <Stat label="۷ روز" s={week} />
        <Stat label="۳۰ روز" s={month} />
      </div>
      <section className="panel">
        <h3>آخرین بررسی‌ها (۷ روز)</h3>
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>زمان</th><th>کد</th><th className="num">میلی‌ثانیه</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{formatJalaliDateTime(r.ts * 1000)}</td>
                  <td className={r.status >= 200 && r.status < 400 ? "ok-txt" : "bad-txt"}>{r.status || "بدون پاسخ"}</td>
                  <td className="num">{faNum(r.ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
