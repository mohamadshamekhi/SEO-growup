import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { ignore } from "@/lib/kwgap";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  ignore(pid, String(body.phrase || ""));
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
