import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { one, q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

export default async function PagesTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const run = one<{ id: number; started_at: number }>(
    "SELECT id, started_at FROM runs WHERE project_id=? AND kind='audit' AND status='ok' ORDER BY id DESC LIMIT 1", projectId,
  );
  const rows = run
    ? q<{ url: string; kind: string; status: number; title: string; words: number; issues: number }>(
      "SELECT * FROM pages WHERE run_id=? ORDER BY issues DESC, url", run.id,
    )
    : [];

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>صفحات</h1></div></div>
      {!run && <div className="empty-inline"><p>هنوز ممیزی موفقی ثبت نشده.</p></div>}
      {run && (
        <>
          <p className="page-note">{faNum(rows.length)} صفحه از آخرین ممیزی</p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>آدرس</th><th>نوع</th><th>کد</th><th>عنوان</th><th className="num">کلمات</th><th className="num">مشکلات</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="url">{r.url}</td>
                    <td>{r.kind}</td>
                    <td className={r.status >= 400 ? "bad-txt" : ""}>{r.status}</td>
                    <td style={{ fontSize: 12 }}>{r.title}</td>
                    <td className="num">{faNum(r.words)}</td>
                    <td className="num">{r.issues ? <span className="sev warning">{faNum(r.issues)}</span> : faNum(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
