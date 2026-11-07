import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getToken, guardRequest } from "@/lib/access";
import { endSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  endSession(getToken(req));
  const res = NextResponse.json({ ok: true });
  clearSessionCookie(res);
  return res;
}
