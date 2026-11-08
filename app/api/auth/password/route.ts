import { NextRequest, NextResponse } from "next/server";
import { requireUser, getToken } from "@/lib/access";
import { checkPassword, cleanPassword, hashPassword, endAllSessions } from "@/lib/auth";
import { run } from "@/lib/db";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  if (!checkPassword(String(b.current || ""), gate.user.pass_hash)) {
    return NextResponse.json({ error: "رمز فعلی درست نیست" }, { status: 400 });
  }
  try {
    run("UPDATE users SET pass_hash=? WHERE id=?", hashPassword(cleanPassword(b.new)), gate.user.id);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  endAllSessions(gate.user.id, getToken(req) || undefined);
  return NextResponse.json({ ok: true });
}
