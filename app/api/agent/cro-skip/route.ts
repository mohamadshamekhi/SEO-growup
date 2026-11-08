import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { project } from "@/lib/projects";
import { croSkip } from "@/lib/funnel";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const p = project(b.project);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json(await croSkip(p, b.url, b.reason));
}
