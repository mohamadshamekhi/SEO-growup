import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { saveKey } from "@/lib/gsc";

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(saveKey(String(body.key || "")));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
