import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { get, save } from "@/lib/policy";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  return NextResponse.json(get(pid));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  try {
    const result = save(pid, body);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
