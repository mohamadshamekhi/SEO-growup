import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; uid: string }> }) {
  const { id: pid, uid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  run("DELETE FROM members WHERE user_id=? AND project_id=?", Number(uid), pid);
  logActivity(pid, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
