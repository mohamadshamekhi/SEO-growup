import { NextRequest, NextResponse } from "next/server";
import { clientIp, guardRequest, setSessionCookie } from "@/lib/access";
import { login, NeedCode } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const body = await req.json().catch(() => ({}));
  try {
    const token = login(body.username, body.password, clientIp(req), body.code);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, token);
    return res;
  } catch (e) {
    if (e instanceof NeedCode) return NextResponse.json({ needs_code: true });
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
