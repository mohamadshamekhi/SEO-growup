import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { skipLink } from "@/lib/autofix";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  return NextResponse.json(skipLink(Number(b.id), b.reason || ""));
}
