import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { autoDiscover } from "@/lib/rivals";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Finds rival sites and creates/refreshes a watch for each important page right now. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  try {
    const r = await autoDiscover(p);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "خطا" }, { status: 500 });
  }
}
