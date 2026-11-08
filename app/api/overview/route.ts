// Ported from server.py's GET /api/overview. gsc_key/priorities/my_tasks fields are stubbed
// until the phases that port GSC and crawl.CHECKS-based priorities land — the frontend
// should treat them as "not yet available", not "confirmed empty". jobs/writer are real.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";
import { projectSummary, jobsState } from "@/lib/overview";
import { writerState } from "@/lib/jobs/writer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const visible = visibleProjects(user);
  const projects = visible.map((p) => ({ ...projectSummary(p), my_role: role(user, p.id) }));
  const w = writerState();
  return NextResponse.json({
    projects,
    jobs: jobsState(new Set(visible.map((p) => p.id))),
    gsc_key: null,
    priorities: [],
    my_tasks: [],
    writer_available: w.running,
    writer: user.is_admin ? { running: w.running, project: w.project, what: w.what } : { running: w.running },
  });
}
