import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  run("UPDATE users SET telegram_chat=? WHERE id=?", String(b.telegram_chat || "").trim().slice(0, 40), gate.user.id);
  return NextResponse.json({ ok: true });
}
