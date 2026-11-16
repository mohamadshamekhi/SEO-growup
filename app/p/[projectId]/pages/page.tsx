import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { one, q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";
import { U } from "@/lib/crawl";
import { enrichIssues, type IssueDbRow } from "@/lib/issue-view";
import { PagesClient } from "./pages-client";

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

  const open = enrichIssues(projectId, q<IssueDbRow>(
    `SELECT * FROM issues WHERE project_id=? AND status='open'
     ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, code`, projectId,
  ));
  const issues: Record<string, typeof open> = {};
  for (const i of open) (issues[U(i.url)] ||= []).push(i);
  const pages = rows
    .map((r) => ({ url: r.url, key: U(r.url), kind: r.kind, status: r.status, title: r.title, words: r.words }))
    .sort((a, b) => (issues[b.key]?.length || 0) - (issues[a.key]?.length || 0));

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>صفحات</h1></div></div>
      {!run && <div className="empty-inline"><p>هنوز ممیزی موفقی ثبت نشده.</p></div>}
      {run && (
        <>
          <p className="page-note">{faNum(rows.length)} صفحه از آخرین ممیزی</p>
          <PagesClient projectId={projectId} rows={pages} issues={issues} />
        </>
      )}
    </div>
  );
}
