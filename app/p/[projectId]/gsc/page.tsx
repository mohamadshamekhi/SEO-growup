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
        <h1>سرچ کنسول</h1>
        <p>هنوز داده‌ای از Search Console خوانده نشده (یا هنوز متصل نیست).</p>
      </div>
    );
  }

  return (
    <div>
      <h1>سرچ کنسول</h1>
      {d.opportunities.length > 0 && (
        <section style={{ margin: "16px 0" }}>
          <h3>فرصت‌ها ({faNum(d.opportunities.length)})</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th>کلمه</th><th>نوع</th><th>جایگاه</th><th>نمایش</th><th>چرا</th></tr></thead>
            <tbody>
              {d.opportunities.slice(0, 30).map((o, i) => (
                <tr key={i} style={{ borderTop: "1px solid #333" }}>
                  <td>{o.key}</td>
                  <td>{OPP_FA[o.type] || o.type}</td>
                  <td>{faNum(o.position, 1)}</td>
                  <td>{faNum(o.impressions)}</td>
                  <td style={{ fontSize: 12, opacity: 0.8 }}>{o.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      <section style={{ margin: "16px 0" }}>
        <h3>پرکلیک‌ترین کلمات</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th>کلمه</th><th>کلیک</th><th>نمایش</th><th>جایگاه</th></tr></thead>
          <tbody>
            {d.queries.slice(0, 30).map((q, i) => (
              <tr key={i} style={{ borderTop: "1px solid #333" }}>
                <td>{q.key}</td><td>{faNum(q.clicks)}</td><td>{faNum(q.impressions)}</td><td>{faNum(q.position, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
