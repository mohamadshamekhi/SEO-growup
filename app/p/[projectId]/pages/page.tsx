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
      <h1>صفحات</h1>
      {!run && <p>هنوز ممیزی موفقی ثبت نشده.</p>}
      {run && (
        <>
          <p className="muted small">{faNum(rows.length)} صفحه از آخرین ممیزی</p>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th>آدرس</th><th>نوع</th><th>کد</th><th>عنوان</th><th>کلمات</th><th>مشکلات</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderTop: "1px solid #333" }}>
                  <td className="ltr mono" style={{ fontSize: 12 }}>{r.url}</td>
                  <td>{r.kind}</td>
                  <td>{r.status}</td>
                  <td style={{ fontSize: 12 }}>{r.title}</td>
                  <td>{faNum(r.words)}</td>
                  <td>{faNum(r.issues)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
