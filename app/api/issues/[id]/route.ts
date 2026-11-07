import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const iid = Number(id);
  const row = one<{ project_id: string }>("SELECT project_id FROM issues WHERE id=?", iid);
  if (!row) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, row.project_id, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  if (body.status !== "open" && body.status !== "ignored") return NextResponse.json({ error: "bad status" }, { status: 400 });

  run("UPDATE issues SET status=? WHERE id=?", body.status, iid);
  logActivity(row.project_id, gate.user.name, "PATCH", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
