import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { get } from "@/lib/campaigns";
import { generatePlan } from "@/lib/campaign-plan";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** Builds (or rebuilds) the full campaign brief. Writes nothing to the live site. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = get(Number(id));
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "edit");
  if ("response" in gate) return gate.response;
  const p = project(c.project_id);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });

  try {
    const plan = await generatePlan(p, c.id);
    logActivity(c.project_id, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ plan, product_urls: get(c.id)?.product_urls || [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "خطا" }, { status: 502 });
  }
}
