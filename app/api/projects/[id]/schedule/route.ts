// GET matches access()'s view-level rule for ?part=schedule; POST (changing the schedule) is
// admin-only, per the same rule.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { describe, save } from "@/lib/schedule";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid)!;
  return NextResponse.json(describe(p));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const p = project(pid)!;
  const body = await req.json().catch(() => ({}));
  try {
    const result = save(p, body);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
