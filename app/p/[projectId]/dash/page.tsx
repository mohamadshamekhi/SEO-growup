// Phase 1's one real vertical slice: a genuine dashboard tab fed by the ported
// projectSummary()/uptimeStats(), against the real hub.db. Chart rendering (the gsc.spark
// line, score-history chart) is left as plain numbers for now — Phase 6 does the frontend
// parity pass that brings back real charts; this proves the data layer, not the visuals.
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { projectSummary } from "@/lib/overview";
import { faNum } from "@/lib/intl/fa";
import { formatJalali } from "@/lib/intl/jalali";

export const dynamic = "force-dynamic";

export default async function DashboardTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const s = projectSummary(p);

  return (
    <div>
      <h1>{p.name} — داشبورد</h1>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, margin: "16px 0" }}>
        <Kpi label="امتیاز فنی" value={s.audit?.score != null ? faNum(s.audit.score) : "—"} />
        <Kpi label="مشکل بحرانی" value={faNum(s.issues.critical)} />
        <Kpi label="مشکل هشدار" value={faNum(s.issues.warning)} />
        <Kpi label="آپتایم ۲۴ ساعت" value={s.uptime.pct == null ? "—" : `${faNum(s.uptime.pct, 1)}٪`} />
        <Kpi label="آپتایم ۷ روز" value={s.uptime7 == null ? "—" : `${faNum(s.uptime7, 1)}٪`} />
      </div>

      {s.gsc && (
        <section style={{ margin: "16px 0" }}>
          <h3>جستجوی گوگل (۲۸ روز)</h3>
          <p>
            کلیک: {faNum(s.gsc.clicks)}{s.gsc.prev_clicks != null && ` (قبلاً ${faNum(s.gsc.prev_clicks)})`} ·
            {" "}نمایش: {faNum(s.gsc.impressions)} ·
            {" "}جایگاه: {s.gsc.position != null ? faNum(s.gsc.position, 1) : "—"}
          </p>
        </section>
      )}

      <section style={{ margin: "16px 0" }}>
        <h3>آخرین بررسی</h3>
        <p>{s.last_check ? formatJalali(s.last_check * 1000) : "هنوز بررسی نشده"}</p>
        {s.audit && <p className="muted small">{faNum(s.fixed_since_check)} مشکل از آن زمان رفع شده</p>}
      </section>

      {s.running && <p role="status">در حال اجرا: {s.running}</p>}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #333", borderRadius: 10, padding: 12 }}>
      <div style={{ fontSize: 13, opacity: 0.7 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
