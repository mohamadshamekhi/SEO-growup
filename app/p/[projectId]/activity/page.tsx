// New tab — jobs already ran silently in the background (lib/jobs/queues.ts's state +
// the `runs` table) with no UI surfacing them; this makes "what's running now / what just
// ran" visible instead of invisible.
import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { JobsClient } from "./jobs-client";

export const dynamic = "force-dynamic";

export default async function ActivityTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();

  const activity = q<{ user_name: string; action: string; ts: number }>(
    "SELECT user_name, action, ts FROM activity WHERE project_id=? ORDER BY id DESC LIMIT 50",
    projectId,
  );

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>فعالیت و کارها</h1></div></div>
      <p className="page-note">چه کاری الان در حال اجراست، چه چیزی در صف است، و نتیجه اجراهای اخیر — همراه با آخرین اقدام‌های کاربران.</p>
      <JobsClient projectId={projectId} initialActivity={activity} />
    </div>
  );
}
