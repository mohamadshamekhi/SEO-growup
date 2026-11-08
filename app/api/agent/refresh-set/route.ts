import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { project } from "@/lib/projects";
import { refreshSet } from "@/lib/growth";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const p = project(b.project);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  try {
    return NextResponse.json(await refreshSet(p, b.html));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
