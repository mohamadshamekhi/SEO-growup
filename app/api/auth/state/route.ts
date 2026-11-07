import { NextRequest, NextResponse } from "next/server";
import { guardRequest, getCurrentUser, isLocal } from "@/lib/access";
import { needsSetup, publicUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  const user = getCurrentUser(req);
  return NextResponse.json({ setup_needed: needsSetup(), can_setup: isLocal(req), user: user ? publicUser(user) : null });
}
