import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { getPlan, savePlan, nextSlot } from "@/lib/planner";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const plan = getPlan(pid);
  return NextResponse.json({ ...plan, next: nextSlot(plan) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  try {
    savePlan(pid, b);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    const plan = getPlan(pid);
    return NextResponse.json({ ...plan, next: nextSlot(plan) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
