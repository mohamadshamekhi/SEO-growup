import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const token = crypto.randomBytes(32).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  run("INSERT INTO agent_tokens(name,token_hash,created) VALUES (?,?,?)", String(body.name || "agent").slice(0, 60), hash, Date.now() / 1000);
  return NextResponse.json({ token });
}
