import { notFound } from "next/navigation";
import { project } from "@/lib/projects";
import { q } from "@/lib/db";
import { faNum } from "@/lib/intl/fa";
import { TasksClient } from "./tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksTab({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (!project(projectId)) notFound();

  const rows = q<{ id: number; title: string; status: string; due: string; assignee: string | null; assignee_id: number | null }>(
    `SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=? ORDER BY t.status='done', t.due='', t.due, t.id DESC LIMIT 300`,
    projectId,
  );

  return (
    <div>
      <div className="page-head"><div className="head-title"><h1>کارها</h1></div></div>
      <p className="page-note">{faNum(rows.length)} کار</p>
      <TasksClient projectId={projectId} initialTasks={rows} />
    </div>
  );
}
