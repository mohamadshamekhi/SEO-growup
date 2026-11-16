import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { gscData } from "@/lib/gsc";
import { one } from "@/lib/db";
import { GscPullButton } from "./gsc-pull-button";
import { GscClient } from "./gsc-client";
import { queryRows, summary } from "@/lib/seo-actions";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";

export const dynamic = "force-dynamic";


export default async function GscTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const proj = project(projectId);
  if (!proj) notFound();
  const user = await currentUser();
  const r = user ? role(user, projectId) : null;
  const canEdit = r === "admin" || r === "editor";
  const d = gscData(projectId);
  const lastRun = one<{ status: string; started_at: number; error: string }>(
    "SELECT status, started_at, error FROM runs WHERE project_id=? AND kind='gsc' ORDER BY id DESC LIMIT 1",
    projectId,
  );

  if (!d.snap) {
    return (
      <div>
        <div className="page-head"><div className="head-title"><h1>سرچ کنسول</h1></div></div>
        <GscPullButton projectId={projectId} lastRun={lastRun} />
        <div className="empty-inline"><p>هنوز داده‌ای از Search Console خوانده نشده (یا هنوز متصل نیست).</p></div>
      </div>
    );
  }

  const { rows } = queryRows(proj);
  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>سرچ کنسول</h1></div></div>
      <p className="page-note">هر کلمه‌ای که سایت در گوگل برایش دیده می‌شود، با صفحه‌اش، وضعیتش و کاری که آن را به صفحه اول می‌برد.</p>
      <GscPullButton projectId={projectId} lastRun={lastRun} />
      <GscClient projectId={projectId} rows={rows} summary={summary(proj, rows)} canEdit={canEdit} />
    </div>
  );
}
