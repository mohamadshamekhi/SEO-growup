import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { optimize, queueArticle, mergeGuide } from "@/lib/seo-actions";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

/** One action for one Google query: optimize (writes to the live site), article (queues a draft), merge (guide). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { query?: string; action?: string };
  const query = String(b.query || "").trim();
  if (!query) return NextResponse.json({ error: "کلمه مشخص نیست" }, { status: 400 });
  try {
    let result: unknown;
    if (b.action === "optimize") result = await optimize(p, gate.user.name, query);
    else if (b.action === "article") result = queueArticle(p, query);
    else if (b.action === "merge") result = mergeGuide(p, query);
    else return NextResponse.json({ error: "اقدام نامعتبر" }, { status: 400 });
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "خطا" }, { status: 400 });
  }
}
