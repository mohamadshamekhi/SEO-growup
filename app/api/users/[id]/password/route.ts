import { NextRequest, NextResponse } from "next/server";
import { requireUser, getToken } from "@/lib/access";
import { hashPassword, cleanPassword, endAllSessions } from "@/lib/auth";
import { run } from "@/lib/db";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = Number(id);
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  try {
    run("UPDATE users SET pass_hash=? WHERE id=?", hashPassword(cleanPassword(b.password)), uid);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  endAllSessions(uid, uid === gate.user.id ? getToken(req) || undefined : undefined);
  return NextResponse.json({ ok: true });
}
