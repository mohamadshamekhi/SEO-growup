// Ported from server.py's GET /api/schedule: cross-project digest of what's coming up next.
// The content-plan row (planner.next_slot()) is Phase 5e — omitted here, not faked.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { visibleProjects } from "@/lib/auth";
import { describe } from "@/lib/schedule";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;

  const out: { project: string; project_name: string; label: string; next: number }[] = [];
  for (const p of visibleProjects(gate.user)) {
    for (const j of describe(p)) {
      if (j.next && j.key !== "uptime") out.push({ project: p.id, project_name: p.name, label: j.label, next: j.next });
    }
  }
  out.sort((a, b) => a.next - b.next);
  return NextResponse.json(out.slice(0, 60));
}
