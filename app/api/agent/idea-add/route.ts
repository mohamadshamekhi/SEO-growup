import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { project } from "@/lib/projects";
import { addIdea } from "@/lib/planner";

export async function POST(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const p = project(b.project);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  try {
    const id = addIdea(p, b.topic, b.keyword, b.kind || "guide", b.why || "", b.priority ?? 50, b.sources, b.outline);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
