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
      <div className="page-head"><div className="head-title"><h1>کلمات</h1></div></div>
      <p className="page-note">
        رقبا: {comps.join("، ") || "—"} · {faNum(d.rows.length)} عبارت یافت‌شده
        {d.summary && Object.keys(d.summary).length > 0 && (
          <> · {Object.entries(d.summary).map(([k, n]) => `${STATUS_FA[k] || k}: ${n}`).join("، ")}</>
        )}
      </p>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h3>شکاف کلمات <span className="count">{faNum(d.rows.length)}</span></h3>
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>عبارت</th><th>وضعیت</th><th className="num">امتیاز</th><th className="num">رقبا</th><th className="num">نمایش گوگل</th><th className="num">جایگاه</th><th /></tr></thead>
            <tbody>
              {d.rows.slice(0, 80).map((r, i) => (
                <tr key={i}>
                  <td>{r.phrase}</td>
                  <td><span className="chip">{STATUS_FA[r.status] || r.status}</span></td>
                  <td className="num">{faNum(r.score)}</td>
                  <td className="num">{faNum(r.competitors.length)}</td>
                  <td className="num">{faNum(r.impressions)}</td>
                  <td className="num">{r.position != null ? faNum(r.position, 1) : "—"}</td>
                  <td><IgnoreButton projectId={projectId} phrase={r.phrase} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="dash">
        {cann.length > 0 && (
          <section className="panel c6">
            <h3>رقابت داخلی</h3>
            <ul className="plain-list">{cann.map((c, i) => <li key={i}><span className="grow">{c.query}</span><span className="muted small">{faNum(c.impressions)} نمایش بین {faNum(c.pages.length)} صفحه</span></li>)}</ul>
          </section>
        )}

        {decay.length > 0 && (
          <section className="panel c6">
            <h3>صفحات رو به افت</h3>
            <ul className="plain-list">{decay.map((r, i) => <li key={i}><span className="url grow">{r.url}</span><span className="muted small">{faNum(r.clicks)} ← {faNum(r.prev_clicks)}</span></li>)}</ul>
          </section>
        )}

        {serp.rows.length > 0 && (
          <section className="panel c6">
            <h3>جایگاه در جستجو (تقریبی)</h3>
            <div className="table-wrap plain">
              <table>
                <thead><tr><th>کلمه</th><th className="num">جایگاه</th></tr></thead>
                <tbody>{serp.rows.slice(0, 20).map((r, i) => <tr key={i}><td>{r.keyword}</td><td className="num">{r.rank ? faNum(r.rank) : "—"}</td></tr>)}</tbody>
              </table>
            </div>
          </section>
        )}

        {compNew.length > 0 && (
          <section className="panel c6">
            <h3>صفحه‌های تازه رقبا</h3>
            <ul className="plain-list">{compNew.map((r, i) => <li key={i}><span className="muted small">{r.domain}</span><span className="grow">{r.title}</span></li>)}</ul>
          </section>
        )}
      </div>
    </div>
  );
}
