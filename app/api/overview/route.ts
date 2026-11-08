// Ported from server.py's GET /api/overview. priorities/my_tasks fields are stubbed until
// crawl.CHECKS-based priorities (Phase 5) and Phase 3's task-digest query are wired here —
// the frontend should treat them as "not yet available", not "confirmed empty".
// jobs/writer/gsc_key are real.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";
import { projectSummary, jobsState } from "@/lib/overview";
import { writerState } from "@/lib/jobs/writer";
import { keyInfo } from "@/lib/gsc";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const visible = visibleProjects(user);
  const projects = visible.map((p) => ({ ...projectSummary(p), my_role: role(user, p.id) }));
  const w = writerState();
  const gk = keyInfo();
  return NextResponse.json({
    projects,
    jobs: jobsState(new Set(visible.map((p) => p.id))),
    gsc_key: user.is_admin ? gk : !!gk,
    priorities: [],
    my_tasks: [],
    writer_available: w.running,
    writer: user.is_admin ? { running: w.running, project: w.project, what: w.what } : { running: w.running },
  });
}
