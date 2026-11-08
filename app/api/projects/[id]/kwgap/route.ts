// Ported from server.py's combined GET .../kwgap. Every field is real now.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { analyse, domains, newPages, ignore as kwgapIgnore } from "@/lib/kwgap";
import { cannibal, decaying, managed, proposals, backlinks, status as kwStatus, setBacklink, remove as removeKeyword } from "@/lib/keywords";
import { refreshes, impact, clusters } from "@/lib/growth";
import { state as serpState } from "@/lib/serp";
import { state as gaState } from "@/lib/ga";
import { get as scheduleGet } from "@/lib/schedule";
import { writerState } from "@/lib/jobs/writer";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const KW_WORKING_KINDS = new Set(["keywords", "kw_competitors", "kw_optimize", "backlinks", "refresh", "faq", "clusters", "cro", "serp"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid)!;
  const w = writerState();
  const working = w.running && w.project === pid && w.what && KW_WORKING_KINDS.has(w.what) ? w.what : false;

  return NextResponse.json({
    ...analyse(p),
    domains: domains(p),
    managed: gate.role === "admin" ? managed(pid) : [],
    proposals: proposals(pid),
    backlinks: gate.role === "admin" ? backlinks(pid) : [],
    cannibal: cannibal(pid),
    decaying: decaying(pid),
    refreshes: refreshes(pid),
    impact: impact(pid),
    clusters: clusters(pid),
    comp_new: newPages(pid),
    serp: serpState(p),
    ga: gate.role === "admin" ? gaState(pid) : null,
    can_see_sales: gate.role === "admin",
    auto: { ...kwStatus(p), on: scheduleGet(p).kwgap.on, working },
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.backlink) setBacklink(pid, Number(b.backlink), b.status);
    else if (b.keyword) removeKeyword(pid, String(b.keyword));
    else kwgapIgnore(pid, String(b.phrase || ""));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
