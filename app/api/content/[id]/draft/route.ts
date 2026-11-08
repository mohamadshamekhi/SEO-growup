// Ported from server.py's POST /api/content/[id]/draft. A REAL site write (creates an
// unpublished article draft on the live site via lib/publisher.ts's pushDraft()) — admin-only,
// matching Python's role gate.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { get as getContent } from "@/lib/content";
import { project } from "@/lib/projects";
import { pushDraft, DuplicateError } from "@/lib/publisher";
import { run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = getContent(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "admin");
  if ("response" in gate) return gate.response;
  const p = project(c.project_id)!;
  try {
    const draftId = await pushDraft(p, c);
    run("UPDATE content SET status='drafted', output=?, updated=? WHERE id=?", JSON.stringify(c.output), Date.now() / 1000, cid);
    logActivity(c.project_id, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ draft_id: draftId });
  } catch (e) {
    if (e instanceof DuplicateError) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
