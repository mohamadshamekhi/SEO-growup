import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { one, run } from "@/lib/db";
import { otherActiveAdmins, endAllSessions, type User } from "@/lib/auth";

function requireAdmin(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate;
  if (!gate.user.is_admin) return { response: NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 }) };
  return gate;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const gate = requireAdmin(req);
  if ("response" in gate) return gate.response;
  const target = one<User>("SELECT * FROM users WHERE id=?", uid);
  if (!target) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({}));
  if (b.clear_2fa) {
    run("UPDATE users SET totp_secret='', totp_pending='', recovery='[]' WHERE id=?", uid);
    return NextResponse.json({ ok: true });
  }
  const active = b.active !== undefined ? Number(!!b.active) : target.active;
  const isAdmin = b.is_admin !== undefined ? Number(!!b.is_admin) : target.is_admin;
  if (target.is_admin && target.active && !(active && isAdmin) && !otherActiveAdmins(uid)) {
    return NextResponse.json({ error: "حداقل یک مدیر فعال باید بماند" }, { status: 400 });
  }
  const name = String(b.name ?? target.name).trim().slice(0, 80) || target.name;
  const chat = String(b.telegram_chat ?? target.telegram_chat ?? "").trim().slice(0, 40);
  run("UPDATE users SET name=?, active=?, is_admin=?, telegram_chat=? WHERE id=?", name, active, isAdmin, chat, uid);
  if (!active) endAllSessions(uid);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const gate = requireAdmin(req);
  if ("response" in gate) return gate.response;
  if (uid === gate.user.id) return NextResponse.json({ error: "نمی‌توانید حساب خودتان را حذف کنید" }, { status: 400 });
  const target = one<User>("SELECT * FROM users WHERE id=?", uid);
  if (!target) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  if (target.is_admin && !otherActiveAdmins(uid)) return NextResponse.json({ error: "حداقل یک مدیر فعال باید بماند" }, { status: 400 });
  endAllSessions(uid);
  run("DELETE FROM members WHERE user_id=?", uid);
  run("DELETE FROM users WHERE id=?", uid);
  return NextResponse.json({ ok: true });
}
