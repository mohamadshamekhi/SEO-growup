import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { uptimeStats } from "@/lib/overview";
import { faNum } from "@/lib/intl/fa";
import { formatJalaliDateTime } from "@/lib/intl/jalali";

export const dynamic = "force-dynamic";

export default async function UptimeTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const day = uptimeStats(projectId, 24);
  const week = uptimeStats(projectId, 168);
  const month = uptimeStats(projectId, 720);
  const rows = q<{ ts: number; status: number; ms: number }>(
    "SELECT ts, status, ms FROM uptime WHERE project_id=? AND ts>=? ORDER BY ts DESC LIMIT 50", projectId, Date.now() / 1000 - 168 * 3600,
  );

  const Stat = ({ label, s }: { label: string; s: ReturnType<typeof uptimeStats> }) => (
    <div style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{s.pct == null ? "—" : `${faNum(s.pct, 1)}٪`}</div>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{s.avg_ms != null ? `میانگین ${faNum(s.avg_ms)} میلی‌ثانیه` : "—"} · {faNum(s.checks)} بررسی</div>
    </div>
  );

  return (
    <div>
      <h1>آپتایم</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, margin: "16px 0" }}>
        <Stat label="۲۴ ساعت" s={day} />
        <Stat label="۷ روز" s={week} />
        <Stat label="۳۰ روز" s={month} />
      </div>
      <h3>آخرین بررسی‌ها (۷ روز)</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>زمان</th><th>کد</th><th>میلی‌ثانیه</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderTop: "1px solid #333", color: r.status >= 200 && r.status < 400 ? undefined : "#e66" }}>
              <td>{formatJalaliDateTime(r.ts * 1000)}</td>
              <td>{r.status || "بدون پاسخ"}</td>
              <td>{faNum(r.ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
