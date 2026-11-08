// Ported from server.py's GET /api/overview. priorities() skips the one bullet needing
// keywords.proposals() (hub/keywords.py's Claude-review workflow isn't ported) — everything
// else is real.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";
import { projectSummary, jobsState, priorities } from "@/lib/overview";
import { writerState, writerAvailable } from "@/lib/jobs/writer";
import { keyInfo } from "@/lib/gsc";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const visible = visibleProjects(user);
  const projects = visible.map((p) => ({ ...projectSummary(p), my_role: role(user, p.id) }));
  const w = writerState();
  const gk = keyInfo();
  const myTasks = q(
    `SELECT t.id, t.title, t.due, t.status, t.project_id, p.name project_name FROM tasks t JOIN projects p ON p.id=t.project_id
     WHERE t.assignee_id=? AND t.status!='done' ORDER BY t.due='', t.due LIMIT 20`,
    user.id,
  );
  return NextResponse.json({
    projects,
    jobs: jobsState(new Set(visible.map((p) => p.id))),
    gsc_key: user.is_admin ? gk : !!gk,
    priorities: priorities(user, !!gk),
    my_tasks: myTasks,
    writer_available: writerAvailable(),
    writer: user.is_admin ? { running: w.running, project: w.project, what: w.what } : { running: w.running },
  });
}
