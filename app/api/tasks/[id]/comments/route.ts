import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tid = Number(id);
  const t = one<{ project_id: string }>("SELECT project_id FROM tasks WHERE id=?", tid);
  if (!t) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, t.project_id, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const text = String(body.body || "").trim().slice(0, 2000);
  if (!text) return NextResponse.json({ error: "متن لازم است" }, { status: 400 });

  run("INSERT INTO comments(task_id,user_name,body,ts) VALUES (?,?,?,?)", tid, gate.user.name, text, Date.now() / 1000);
  logActivity(t.project_id, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
