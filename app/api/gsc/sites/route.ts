import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { sites } from "@/lib/gsc";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });
  try {
    return NextResponse.json(await sites());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
