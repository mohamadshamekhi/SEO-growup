import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one } from "@/lib/db";
import { project } from "@/lib/projects";
import { add, listing, articleBrief } from "@/lib/content";
import { logActivity } from "@/lib/activity";
import { writerState } from "@/lib/jobs/writer";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const catalogSize = one<{ n: number }>("SELECT COUNT(*) n FROM catalog WHERE project_id=?", pid)!.n;
  const w = writerState();
  const scoped = gate.role === "admin" ? w : { running: w.running && w.project === pid, code: null, project: null, log: "" };
  return NextResponse.json({ items: listing(pid), writer: scoped, catalog_size: catalogSize });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const topic = String(b.topic || "").trim().slice(0, 200);
  if (!topic) return NextResponse.json({ error: "موضوع لازم است" }, { status: 400 });
  const p = project(pid)!;
  const brief = articleBrief(p, topic, String(b.keyword || "").trim().slice(0, 120), String(b.notes || "").trim().slice(0, 1000));
  const id = add(pid, "article", topic, brief);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ id });
}
