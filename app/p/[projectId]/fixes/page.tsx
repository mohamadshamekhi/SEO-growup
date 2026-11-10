// New UI — hub/content.py's openFixes()/setFix()/fixbulk/apply APIs already existed (ported
// earlier) but nothing in app/ rendered them; the issues tab only showed status, no review
// screen for the writable text fixes (seo_title/meta_description/description).
import { notFound, redirect } from "next/navigation";
import { project } from "@/lib/projects";
import { currentUser } from "@/lib/server/current-user";
import { role } from "@/lib/auth";
import { q } from "@/lib/db";
import { config } from "@/lib/adapters";
import { faNum } from "@/lib/intl/fa";
import { FixesClient } from "./fixes-client";

export const dynamic = "force-dynamic";

export default async function FixesTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();
  if (!user) redirect("/login");
  if (role(user, projectId) !== "admin") redirect(`/p/${projectId}/dash`);

  const rows = q<{ id: number; url: string; type: string; current: string; proposed: string; detail: string; status: string; apply_error: string }>(
    "SELECT id, url, type, current, proposed, detail, status, apply_error FROM fixes WHERE project_id=? AND status IN ('pending','approved') AND type IN ('seo_title','meta_description','description') ORDER BY status='approved', id DESC LIMIT 300",
    projectId,
  );
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>اصلاحات متنی</h1></div></div>
      <p className="page-note">{faNum(rows.length)} مورد؛ {faNum(pending.filter((r) => !r.proposed).length)} منتظر متن، {faNum(pending.filter((r) => r.proposed).length)} منتظر تأیید</p>
      <FixesClient projectId={projectId} initialRows={rows} hasAdapter={!!config(projectId)} />
    </div>
  );
}
