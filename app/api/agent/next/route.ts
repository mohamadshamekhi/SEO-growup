import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { nextItem } from "@/lib/content";

export async function GET(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const pid = req.nextUrl.searchParams.get("project") || "";
  const kind = req.nextUrl.searchParams.get("kind") as "article" | "ig_post" | null;
  return NextResponse.json(nextItem(pid, kind || undefined));
}
