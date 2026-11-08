import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { tgPublic, tgRemove, tgSend, tgSave } from "@/lib/publisher";
import { logActivity } from "@/lib/activity";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  tgRemove(pid);
  logActivity(pid, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ telegram_config: tgPublic(pid) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const p = project(pid)!;
  try {
    if (b.test) await tgSend(pid, `پیام آزمایشی پنل برای ${p.name}. نیازی به اقدام نیست.`);
    else tgSave(pid, b.token, b.chat, b.mention_site, b.mention_ig, b.alerts, b.reports);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ telegram_config: tgPublic(pid) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
