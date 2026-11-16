import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";
import { enrichIssues, type IssueDbRow } from "@/lib/issue-view";
import { IssuesClient } from "./issues-client";

export const dynamic = "force-dynamic";

export default async function IssuesTab({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ status?: string }> }) {
  const { projectId } = await params;
  const { status = "open" } = await searchParams;
  if (!project(projectId)) notFound();

  const rows = q<IssueDbRow>(
    `SELECT * FROM issues WHERE project_id=? AND (?='all' OR status=?)
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code, url`,
    projectId, status, status,
  );
  const withLabels = enrichIssues(projectId, rows);

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>سلامت فنی</h1></div></div>
      <p className="page-note">{faNum(withLabels.length)} مورد با وضعیت «{status === "open" ? "باز" : status}»</p>
      <IssuesClient projectId={projectId} initialRows={withLabels} />
    </div>
  );
}
