import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { openFixes } from "@/lib/content";

export async function GET(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const pid = req.nextUrl.searchParams.get("project") || "";
  const limit = Number(req.nextUrl.searchParams.get("limit") || 20);
  return NextResponse.json(openFixes(pid, limit));
}
