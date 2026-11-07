// First-admin bootstrap — local-machine-only, same restriction as server.py's /api/auth/setup
// (so a remotely-exposed instance can't have its first admin created remotely).
import { NextRequest, NextResponse } from "next/server";
import { guardRequest, isLocal, setSessionCookie } from "@/lib/access";
import { createUser, needsSetup, newSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (!needsSetup() || !isLocal(req)) return NextResponse.json({ error: "ساخت مدیر اول مجاز نیست" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const uid = createUser(body.name, body.username, body.password, true);
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, newSession(uid));
    return res;
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
