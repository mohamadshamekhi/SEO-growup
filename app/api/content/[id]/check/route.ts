// Ported from server.py's POST /api/content/[id]/check. Read-only (reads the live draft back
// from the site and runs the pre-publish checklist) — admin-only, matching Python's gate.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { get as getContent } from "@/lib/content";
import { project } from "@/lib/projects";
import { check } from "@/lib/prepublish";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = getContent(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "admin");
  if ("response" in gate) return gate.response;
  const p = project(c.project_id)!;
  try {
    return NextResponse.json(await check(p, c));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
