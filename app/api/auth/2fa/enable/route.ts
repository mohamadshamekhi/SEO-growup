import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";
import { totpOk } from "@/lib/extras";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  if (!gate.user.totp_pending || !totpOk(gate.user.totp_pending, b.code)) {
    return NextResponse.json({ error: "کد درست نیست" }, { status: 400 });
  }
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString("hex"));
  const hashed = codes.map((c) => crypto.createHash("sha256").update(c).digest("hex"));
  run("UPDATE users SET totp_secret=totp_pending, totp_pending='', recovery=? WHERE id=?", JSON.stringify(hashed), gate.user.id);
  return NextResponse.json({ recovery: codes });
}
