import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { CHECKS } from "@/lib/checks";
import { faNum } from "@/lib/intl/fa";
import { IssuesClient } from "./issues-client";

export const dynamic = "force-dynamic";

export default async function IssuesTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { projectId } = await params;
  const { status = "open" } = await searchParams;
  if (!project(projectId)) notFound();

  const rows = q<{ id: number; code: string; severity: string; url: string; detail: string; status: string }>(
    `SELECT * FROM issues WHERE project_id=? AND (?='all' OR status=?)
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code, url`,
    projectId, status, status,
  );
  const withLabels = rows.map((r) => {
    const c = CHECKS[r.code];
    return { ...r, label: c ? c[1] : r.code, fix: c ? c[2] : "" };
  });

  return (
    <div>
      <h1>مشکلات</h1>
      <p className="muted small">{faNum(withLabels.length)} مورد با وضعیت «{status === "open" ? "باز" : status}»</p>
      <IssuesClient initialRows={withLabels} />
    </div>
  );
}
