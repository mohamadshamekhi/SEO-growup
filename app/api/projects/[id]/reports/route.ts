import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q } from "@/lib/db";
import { project } from "@/lib/projects";
import { runReport } from "@/lib/extras";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const rows = q<{ id: number; ts: number; data: string; prev: string }>("SELECT id, ts, data, prev FROM reports WHERE project_id=? ORDER BY id DESC LIMIT 30", pid);
  return NextResponse.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data), prev: JSON.parse(r.prev || "{}") })));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const p = project(pid)!;
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json(runReport(p));
}
