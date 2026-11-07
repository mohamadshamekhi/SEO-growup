import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q, run } from "@/lib/db";
import { role, type User } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

type Task = { id: number; project_id: string; status: string; assignee_id: number | null; due: string };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tid = Number(id);
  const t = one<Task>("SELECT * FROM tasks WHERE id=?", tid);
  if (!t) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, t.project_id, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const status = body.status ?? t.status;
  if (!["todo", "doing", "done"].includes(status)) return NextResponse.json({ error: "وضعیت نامعتبر است" }, { status: 400 });
  const who = "assignee_id" in body ? (body.assignee_id ? Number(body.assignee_id) : null) : t.assignee_id;
  if (who) {
    const target = one<User>("SELECT * FROM users WHERE id=?", who);
    if (!target || !role(target, t.project_id)) return NextResponse.json({ error: "این کاربر عضو پروژه نیست" }, { status: 400 });
  }
  run("UPDATE tasks SET status=?, assignee_id=?, due=?, updated=? WHERE id=?", status, who, body.due ?? t.due, Date.now() / 1000, tid);
  // Telegram notify_user() on reassignment is Phase 5e.
  logActivity(t.project_id, gate.user.name, "PATCH", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const tid = Number(id);
  const t = one<Task>("SELECT * FROM tasks WHERE id=?", tid);
  if (!t) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, t.project_id, "edit");
  if ("response" in gate) return gate.response;

  run("DELETE FROM comments WHERE task_id=?", tid);
  run("DELETE FROM tasks WHERE id=?", tid);
  logActivity(t.project_id, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
