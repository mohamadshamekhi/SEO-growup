import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { run } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });
  const { id } = await params;
  run("DELETE FROM agent_tokens WHERE id=?", Number(id));
  return NextResponse.json({ ok: true });
}
