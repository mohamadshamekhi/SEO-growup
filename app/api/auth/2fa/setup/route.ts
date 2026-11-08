import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";
import { totpSecret } from "@/lib/extras";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const sec = totpSecret();
  run("UPDATE users SET totp_pending=? WHERE id=?", sec, gate.user.id);
  return NextResponse.json({ secret: sec, uri: `otpauth://totp/GrowthHub:${encodeURIComponent(gate.user.username)}?secret=${sec}&issuer=GrowthHub` });
}
