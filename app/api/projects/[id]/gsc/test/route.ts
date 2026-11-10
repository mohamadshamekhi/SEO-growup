import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { testConnection } from "@/lib/gsc";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json(await testConnection(p));
}
