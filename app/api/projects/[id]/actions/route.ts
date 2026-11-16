import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { suggestions, list, start, dismiss, restore, setStatus, redraft, applyTitleMeta, sendSocial, type Suggestion } from "@/lib/growth-actions";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  return NextResponse.json({ suggestions: suggestions(p), actions: list(pid) });
}

/**
 * op: start {suggestion} | dismiss {suggestion} | restore {key} | status {id, status} | redraft {id}
 *     | apply {id} (writes title/meta to the live site) | telegram {id} (posts to the team group)
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const b = await req.json().catch(() => ({})) as { op?: string; suggestion?: Suggestion; key?: string; id?: number; status?: "doing" | "published" };
  try {
    let result: unknown = { ok: true };
    switch (b.op) {
      case "start": if (!b.suggestion?.key) throw new Error("پیشنهاد مشخص نیست"); result = await start(p, gate.user.name, b.suggestion); break;
      case "dismiss": if (!b.suggestion?.key) throw new Error("پیشنهاد مشخص نیست"); dismiss(p, gate.user.name, b.suggestion); break;
      case "restore": restore(pid, String(b.key || "")); break;
      case "status": setStatus(pid, Number(b.id), b.status === "published" ? "published" : "doing"); break;
      case "redraft": result = await redraft(p, gate.user.name, Number(b.id)); break;
      case "apply": result = await applyTitleMeta(p, gate.user.name, Number(b.id)); break;
      case "telegram": await sendSocial(p, Number(b.id)); break;
      default: return NextResponse.json({ error: "عملیات نامعتبر" }, { status: 400 });
    }
    logActivity(pid, gate.user.name, "POST", `${req.nextUrl.pathname}#${b.op}`);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || "خطا" }, { status: 400 });
  }
}
