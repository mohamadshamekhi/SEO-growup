import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { get, update, remove, DATE_RE, type CampaignInput } from "@/lib/campaigns";
import { logActivity } from "@/lib/activity";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = get(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, c.project_id, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({})) as Partial<CampaignInput>;
  if (body.name !== undefined && !String(body.name).trim()) return NextResponse.json({ error: "نام کمپین لازم است" }, { status: 400 });
  for (const d of [body.start_date, body.end_date]) if (d && !DATE_RE.test(d)) return NextResponse.json({ error: "تاریخ مثل ۱۴۰۵/۰۸/۲۰" }, { status: 400 });

  update(cid, body);
  logActivity(c.project_id, gate.user.name, "PATCH", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = get(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, c.project_id, "edit");
  if ("response" in gate) return gate.response;

  remove(cid);
  logActivity(c.project_id, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
