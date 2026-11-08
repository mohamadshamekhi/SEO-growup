import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { setProperty, pull } from "@/lib/ga";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  try {
    setProperty(pid, body.property);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  const p = project(pid)!;
  try {
    const pages = await pull(p);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ pages });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
