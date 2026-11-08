import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { nextLink } from "@/lib/autofix";

export async function GET(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const pid = req.nextUrl.searchParams.get("project") || "";
  return NextResponse.json(await nextLink(pid));
}
