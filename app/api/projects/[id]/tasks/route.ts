import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q, run } from "@/lib/db";
import { role, type User } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { project } from "@/lib/projects";
import { notifyPerson } from "@/lib/publisher";
import { taskHelp } from "@/lib/keywords";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const title = String(body.title || "").trim().slice(0, 300);
  if (!title) return NextResponse.json({ error: "عنوان لازم است" }, { status: 400 });
  const due = String(body.due || "").trim();
  if (due && !/^\d{4}\/\d{2}\/\d{2}$/.test(due)) return NextResponse.json({ error: "تاریخ مثل ۱۴۰۵/۰۸/۲۰" }, { status: 400 });
  const who = body.assignee_id ? Number(body.assignee_id) : null;
  if (who) {
    const target = one<User>("SELECT * FROM users WHERE id=?", who);
    if (!target || !role(target, pid)) return NextResponse.json({ error: "این کاربر عضو پروژه نیست" }, { status: 400 });
  }
  const now = Date.now() / 1000;
  const info = run(
    "INSERT INTO tasks(project_id,title,ref,assignee_id,due,status,created_by,created,updated) VALUES (?,?,?,?,?,'todo',?,?,?)",
    pid, title, String(body.ref || "").slice(0, 300), who, due, gate.user.name, now, now,
  );
  if (who && who !== gate.user.id) {
    const target = one<{ telegram_chat: string }>("SELECT telegram_chat FROM users WHERE id=?", who);
    const proj = project(pid);
    if (target?.telegram_chat && proj) notifyPerson(proj, target.telegram_chat, `کار جدید در ${proj.name}: ${title}`).catch(() => {});
  }
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ id: Number(info.lastInsertRowid) });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;

  const rows = q<{ id: number; [k: string]: unknown }>(
    `SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assignee_id
     WHERE t.project_id=? ORDER BY t.status='done', t.due='', t.due, t.id DESC LIMIT 300`,
    pid,
  );
  const out = rows.map((r) => {
    const comments = q<{ user_name: string; body: string; ts: number }>("SELECT user_name, body, ts FROM comments WHERE task_id=? ORDER BY id", r.id);
    return { ...r, comments, help: taskHelp(pid, { id: r.id as number, title: r.title as string, ref: r.ref as string, comments }) };
  });
  return NextResponse.json(out);
}
