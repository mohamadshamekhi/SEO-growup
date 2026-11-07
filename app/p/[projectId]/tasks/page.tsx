// Read-only for Phase 2 — creating/editing a task is a mutation and lands in Phase 3.
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";

export const dynamic = "force-dynamic";

const STATUS_FA: Record<string, string> = { todo: "برای انجام", doing: "در حال انجام", done: "انجام‌شده" };

export default async function TasksTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const rows = q<{ id: number; title: string; status: string; due: string; assignee: string | null }>(
    `SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=? ORDER BY t.status='done', t.due='', t.due, t.id DESC LIMIT 300`,
    projectId,
  );

  return (
    <div>
      <h1>کارها</h1>
      <p className="muted small">{faNum(rows.length)} کار</p>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th>وضعیت</th><th>عنوان</th><th>مسئول</th><th>مهلت</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #333" }}>
              <td>{STATUS_FA[r.status] || r.status}</td>
              <td>{r.title}</td>
              <td>{r.assignee || "—"}</td>
              <td className="ltr">{r.due || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
