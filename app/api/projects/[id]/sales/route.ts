import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { croRewrite } from "@/lib/sales-actions";
import { optimize } from "@/lib/seo-actions";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** {action: "cro", url} rewrites + applies the product description; {action: "optimize", query} = Search Console optimize. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { action?: string; url?: string; query?: string };
  try {
    let result: unknown;
    if (b.action === "cro" && b.url) result = await croRewrite(p, gate.user.name, b.url);
    else if (b.action === "optimize" && b.query) result = await optimize(p, gate.user.name, b.query);
    else return NextResponse.json({ error: "درخواست نامعتبر" }, { status: 400 });
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "خطا" }, { status: 400 });
  }
}
