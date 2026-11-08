import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, q, run } from "@/lib/db";
import { ROLES } from "@/lib/auth";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  return NextResponse.json(q(
    "SELECT u.id, u.name, u.username, u.active, u.last_login, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.project_id=? ORDER BY u.name",
    pid,
  ));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const uid = Number(b.user_id || 0);
  if (!(ROLES as readonly string[]).includes(b.role)) return NextResponse.json({ error: "نقش نامعتبر است" }, { status: 400 });
  if (!one("SELECT 1 FROM users WHERE id=?", uid)) return NextResponse.json({ error: "کاربر پیدا نشد" }, { status: 404 });
  run("INSERT OR REPLACE INTO members VALUES (?,?,?)", uid, pid, b.role);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
