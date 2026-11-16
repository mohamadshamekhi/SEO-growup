import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { rivalSites, setRivalSites } from "@/lib/rivals";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json(rivalSites(p));
}

/** Replaces the competitor-site list (max 5). Removed sites are never re-added automatically. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { domains?: string[] };
  const current = setRivalSites(p, Array.isArray(b.domains) ? b.domains : []);
  logActivity(pid, gate.user.name, "PUT", req.nextUrl.pathname);
  return NextResponse.json({ current });
}
