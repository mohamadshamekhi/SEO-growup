import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one } from "@/lib/db";
import { undoApplied } from "@/lib/adapters";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aid = Number(id);
  const row = one<{ project_id: string }>("SELECT project_id FROM applied WHERE id=?", aid);
  if (!row) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, row.project_id, "admin");
  if ("response" in gate) return gate.response;

  try {
    await undoApplied(aid);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  logActivity(row.project_id, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
