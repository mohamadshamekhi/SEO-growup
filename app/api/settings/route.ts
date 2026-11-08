// Ported from server.py's /api/settings.
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { getSetting, q, setSetting } from "@/lib/db";
import { keyInfo } from "@/lib/gsc";

export const dynamic = "force-dynamic";

function adminOnly(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate;
  if (!gate.user.is_admin) return { response: NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 }) };
  return gate;
}

export async function GET(req: NextRequest) {
  const gate = adminOnly(req);
  if ("response" in gate) return gate.response;
  return NextResponse.json({
    gsc_key: keyInfo(),
    has_pagespeed: !!getSetting("pagespeed_key", ""),
    agents: q("SELECT id, name, last_seen FROM agent_tokens ORDER BY id"),
  });
}

export async function POST(req: NextRequest) {
  const gate = adminOnly(req);
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  if (body.pagespeed_key) setSetting("pagespeed_key", String(body.pagespeed_key).trim().slice(0, 120));
  return GET(req);
}
