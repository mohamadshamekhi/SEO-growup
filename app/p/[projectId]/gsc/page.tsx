import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { gscData } from "@/lib/gsc";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

const OPP_FA: Record<string, string> = { striking: "نزدیک صفحه اول", low_ctr: "نرخ کلیک پایین", dropping: "افت جایگاه" };

export default async function GscTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();
  const d = gscData(projectId);

  if (!d.snap) {
    return (
      <div>
        <div className="page-head"><div className="head-title"><h1>سرچ کنسول</h1></div></div>
        <div className="empty-inline"><p>هنوز داده‌ای از Search Console خوانده نشده (یا هنوز متصل نیست).</p></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>سرچ کنسول</h1></div></div>
      {d.opportunities.length > 0 && (
        <section className="panel" style={{ marginBottom: 14 }}>
          <h3>فرصت‌ها <span className="count">{faNum(d.opportunities.length)}</span></h3>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>کلمه</th><th>نوع</th><th className="num">جایگاه</th><th className="num">نمایش</th><th>چرا</th></tr></thead>
              <tbody>
                {d.opportunities.slice(0, 30).map((o, i) => (
                  <tr key={i}>
                    <td>{o.key}</td>
                    <td><span className="chip info">{OPP_FA[o.type] || o.type}</span></td>
                    <td className="num">{faNum(o.position, 1)}</td>
                    <td className="num">{faNum(o.impressions)}</td>
                    <td className="muted" style={{ fontSize: 12 }}>{o.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <section className="panel">
        <h3>پرکلیک‌ترین کلمات</h3>
        <div className="table-wrap plain">
          <table>
            <thead><tr><th>کلمه</th><th className="num">کلیک</th><th className="num">نمایش</th><th className="num">جایگاه</th></tr></thead>
            <tbody>
              {d.queries.slice(0, 30).map((q, i) => (
                <tr key={i}>
                  <td>{q.key}</td><td className="num">{faNum(q.clicks)}</td><td className="num">{faNum(q.impressions)}</td><td className="num">{faNum(q.position, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
