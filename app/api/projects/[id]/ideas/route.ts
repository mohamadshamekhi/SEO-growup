import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, run } from "@/lib/db";
import { project } from "@/lib/projects";
import { ideas, addIdea, refreshIdeas, queueIdea } from "@/lib/planner";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  return NextResponse.json(ideas(pid));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const p = project(pid)!;
  const act = b.action;
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  try {
    if (act === "add") return NextResponse.json({ id: addIdea(p, b.topic, b.topic, "guide", b.why || "", 60, b.sources, undefined, true) });
    if (act === "refresh") return NextResponse.json(refreshIdeas(p));
    const iid = Number(b.id || 0);
    if (!one("SELECT 1 FROM ideas WHERE id=? AND project_id=?", iid, pid)) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
    if (act === "queue") return NextResponse.json({ id: queueIdea(p, iid) });
    if (act === "skip" || act === "restore") {
      run("UPDATE ideas SET status=? WHERE id=?", act === "skip" ? "skipped" : "idea", iid);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "bad action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
