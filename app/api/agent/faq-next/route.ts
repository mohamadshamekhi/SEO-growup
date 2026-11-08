import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { project } from "@/lib/projects";
import { nextFaq } from "@/lib/growth";

export async function GET(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const p = project(req.nextUrl.searchParams.get("project") || "");
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json(await nextFaq(p));
}
