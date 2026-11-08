import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { getGuide, saveGuide } from "@/lib/content";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  return NextResponse.json(getGuide(pid));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const result = saveGuide(pid, b.article, b.ig_post);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json(result);
}
