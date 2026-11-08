import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { placeLinks } from "@/lib/autofix";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  try {
    return NextResponse.json(await placeLinks(Number(b.id), b.links || []));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
