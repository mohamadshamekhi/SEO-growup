// GET ports server.py's project list (via auth.visible_projects). POST (project creation,
// admin-only) is deferred — Phase 1's goal is one real read-mostly slice end-to-end, not
// every mutation yet.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const projects = visibleProjects(user).map((p) => ({ ...p, my_role: role(user, p.id) }));
  return NextResponse.json(projects);
}
