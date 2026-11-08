// Ported from server.py's POST/DELETE /api/content/[id] (approve/reject/requeue, delete).
// /draft, /check, /publish, /image, /result sub-actions aren't wired yet — a follow-up.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { run } from "@/lib/db";
import { get as getContent } from "@/lib/content";
import { logActivity } from "@/lib/activity";

const STATUSES = new Set(["approved", "rejected", "queued"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = getContent(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "edit");
  if ("response" in gate) return gate.response;
  const body = await req.json().catch(() => ({}));
  if (!STATUSES.has(body.status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
  run("UPDATE content SET status=?, note=?, updated=? WHERE id=?", body.status, String(body.note || "").slice(0, 1000), Date.now() / 1000, cid);
  logActivity(c.project_id, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cid = Number(id);
  const c = getContent(cid);
  if (!c) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });
  const gate = requireProjectAccess(req, c.project_id, "edit");
  if ("response" in gate) return gate.response;
  run("DELETE FROM content WHERE id=?", cid);
  logActivity(c.project_id, gate.user.name, "DELETE", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
