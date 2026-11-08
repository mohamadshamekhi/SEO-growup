import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { project } from "@/lib/projects";
import { renderImage, type ImageSpec } from "@/lib/tools";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const rows = q<{ id: number; ts: number; file: string; spec: string }>("SELECT id, ts, file, spec FROM images WHERE project_id=? ORDER BY id DESC LIMIT 60", pid);
  return NextResponse.json(rows.map((r) => ({ ...r, spec: JSON.parse(r.spec) })));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = (await req.json().catch(() => ({}))) as ImageSpec;
  const p = project(pid)!;
  try {
    const result = await renderImage(p, b);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
