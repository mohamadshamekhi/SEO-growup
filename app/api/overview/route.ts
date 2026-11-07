// Ported from server.py's GET /api/overview. gsc_key/priorities/my_tasks/writer fields are
// stubbed until the phases that port GSC, crawl.CHECKS, tasks and the writer-slot land —
// the frontend should treat them as "not yet available", not "confirmed empty".
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";
import { projectSummary, jobsState } from "@/lib/overview";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const projects = visibleProjects(user).map((p) => ({ ...projectSummary(p), my_role: role(user, p.id) }));
  return NextResponse.json({
    projects,
    jobs: jobsState(),
    gsc_key: null,
    priorities: [],
    my_tasks: [],
    writer_available: false,
    writer: { running: false },
  });
}
