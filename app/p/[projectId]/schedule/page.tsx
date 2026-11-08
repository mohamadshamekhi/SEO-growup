import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { describe } from "@/lib/schedule";
import { currentUser } from "@/lib/server/current-user";
import { ScheduleClient } from "./schedule-client";

export const dynamic = "force-dynamic";

export default async function ScheduleTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const p = project(projectId);
  if (!p) notFound();
  const user = await currentUser();

  return (
    <div>
      <h1>زمان‌بندی</h1>
      <ScheduleClient projectId={projectId} initialJobs={describe(p)} isAdmin={!!user?.is_admin} />
    </div>
  );
}
