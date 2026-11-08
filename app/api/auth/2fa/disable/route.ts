import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";
import { checkPassword } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  if (!checkPassword(String(b.password || ""), gate.user.pass_hash)) {
    return NextResponse.json({ error: "رمز درست نیست" }, { status: 400 });
  }
  run("UPDATE users SET totp_secret='', totp_pending='', recovery='[]' WHERE id=?", gate.user.id);
  return NextResponse.json({ ok: true });
}
