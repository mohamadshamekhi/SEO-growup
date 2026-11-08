import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { analyse, domains, newPages } from "@/lib/kwgap";
import { cannibal, decaying } from "@/lib/keywords";
import { state as serpState } from "@/lib/serp";
import { faNum } from "@/lib/intl/fa";
import { IgnoreButton } from "./ignore-button";

export const dynamic = "force-dynamic";

const STATUS_FA: Record<string, string> = { lead: "رتبه خوب", weak: "رتبه ضعیف", no_rank: "صفحه دارید، رتبه ندارد", gap: "صفحه ندارید", other: "نامشخص" };

export default async function KwgapTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();

  const d = analyse(p);
  const comps = domains(p);
  const cann = cannibal(projectId, 10);
  const decay = decaying(projectId, 10);
  const serp = serpState(p);
  const compNew = newPages(projectId, 30, 10);

  return (
    <div>
      <h1>شکاف کلمات با رقبا</h1>
      <p className="muted small">
        رقبا: {comps.join("، ") || "—"} · {faNum(d.rows.length)} عبارت یافت‌شده
        {d.summary && Object.keys(d.summary).length > 0 && (
          <> · {Object.entries(d.summary).map(([k, n]) => `${STATUS_FA[k] || k}: ${n}`).join("، ")}</>
        )}
      </p>

      <section style={{ margin: "16px 0" }}>
        <h3>شکاف کلمات <span className="count">{faNum(d.rows.length)}</span></h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>عبارت</th><th>وضعیت</th><th>امتیاز</th><th>رقبا</th><th>نمایش گوگل</th><th>جایگاه</th><th></th></tr></thead>
          <tbody>
            {d.rows.slice(0, 80).map((r, i) => (
              <tr key={i} style={{ borderTop: "1px solid #333" }}>
                <td>{r.phrase}</td>
                <td>{STATUS_FA[r.status] || r.status}</td>
                <td>{faNum(r.score)}</td>
                <td>{faNum(r.competitors.length)}</td>
                <td>{faNum(r.impressions)}</td>
                <td>{r.position != null ? faNum(r.position, 1) : "—"}</td>
                <td><IgnoreButton projectId={projectId} phrase={r.phrase} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {cann.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h3>رقابت داخلی (چند صفحه خودتان روی یک جستجو)</h3>
          <ul>{cann.map((c, i) => <li key={i}>{c.query} — {faNum(c.impressions)} نمایش بین {faNum(c.pages.length)} صفحه</li>)}</ul>
        </section>
      )}

      {decay.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h3>صفحات رو به افت</h3>
          <ul>{decay.map((r, i) => <li key={i} className="ltr mono" style={{ fontSize: 12 }}>{r.url} — {faNum(r.clicks)} ← {faNum(r.prev_clicks)}</li>)}</ul>
        </section>
      )}

      {serp.rows.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h3>جایگاه در جستجو (تقریبی)</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th>کلمه</th><th>جایگاه</th></tr></thead>
            <tbody>{serp.rows.slice(0, 20).map((r, i) => <tr key={i} style={{ borderTop: "1px solid #333" }}><td>{r.keyword}</td><td>{r.rank ? faNum(r.rank) : "—"}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {compNew.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h3>صفحه‌های تازه رقبا</h3>
          <ul>{compNew.map((r, i) => <li key={i}>{r.domain}: {r.title}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
