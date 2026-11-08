// Ported from server.py's POST /api/content/[id]/publish. A REAL site write (the actual
// is_published=true PATCH via lib/prepublish.ts's publish()) — admin-only.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { get as getContent } from "@/lib/content";
import { project } from "@/lib/projects";
import { publish } from "@/lib/prepublish";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = getContent(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "admin");
  if ("response" in gate) return gate.response;
  const p = project(c.project_id)!;
  const body = await req.json().catch(() => ({}));
  try {
    const result = await publish(p, c, gate.user.name, !!body.force);
    logActivity(c.project_id, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
