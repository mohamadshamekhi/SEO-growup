import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { CHECKS } from "@/lib/checks";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

const SEV_FA: Record<string, string> = { critical: "بحرانی", warning: "هشدار", info: "اطلاع" };

export default async function IssuesTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { projectId } = await params;
  const { status = "open" } = await searchParams;
  if (!project(projectId)) notFound();

  const rows = q<{ code: string; severity: string; url: string; detail: string; status: string }>(
    `SELECT * FROM issues WHERE project_id=? AND (?='all' OR status=?)
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code, url`,
    projectId, status, status,
  );

  return (
    <div>
      <h1>مشکلات</h1>
      <p className="muted small">{faNum(rows.length)} مورد با وضعیت «{status === "open" ? "باز" : status}»</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr><th>شدت</th><th>عنوان</th><th>صفحه</th><th>جزئیات</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const c = CHECKS[r.code];
            return (
              <tr key={i} style={{ borderTop: "1px solid #333" }}>
                <td>{SEV_FA[r.severity] || r.severity}</td>
                <td>{c ? c[1] : r.code}</td>
                <td className="ltr mono" style={{ fontSize: 12 }}>{r.url}</td>
                <td style={{ fontSize: 12, opacity: 0.8 }}>{r.detail}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
