// Ported from server.py's combined GET .../kwgap. managed/proposals/backlinks (need
// hub/keywords.py's Claude-interactive workflow) and refreshes/impact/clusters (need
// hub/growth.py) are Phase 5e — returned as empty/null here, not faked, so the frontend can
// tell "not built yet" from "really empty". analyse/domains/cannibal/decaying/serp/ga are real.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { analyse, domains, newPages } from "@/lib/kwgap";
import { cannibal, decaying } from "@/lib/keywords";
import { state as serpState } from "@/lib/serp";
import { state as gaState } from "@/lib/ga";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid)!;

  return NextResponse.json({
    ...analyse(p),
    domains: domains(p),
    managed: [], // Phase 5e (hub/keywords.py's Claude-review workflow)
    proposals: [], // Phase 5e
    backlinks: [], // Phase 5e
    cannibal: cannibal(pid),
    decaying: decaying(pid),
    refreshes: [], // Phase 5e (hub/growth.py)
    impact: [], // Phase 5e
    clusters: null, // Phase 5e
    comp_new: newPages(pid),
    serp: serpState(p),
    ga: gate.role === "admin" ? gaState(pid) : null,
    can_see_sales: gate.role === "admin",
    auto: { on: false, working: false }, // Phase 5e (autorun state machine)
  });
}
