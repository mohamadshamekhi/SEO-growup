// Ported from server.py's PATCH /api/fixes/{id}. This only updates the fix row's status/
// proposed text (e.g. an admin approving or rejecting a Claude-written proposal) — actually
// writing the change onto the live site happens through POST /api/projects/{id}/apply, which
// needs hub/adapters.py (Phase 5c) and is NOT built yet. Approving here records the decision;
// nothing reaches the site until adapters land.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

const STATUSES = new Set(["pending", "approved", "rejected", "done"]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fid = Number(id);
  const row = one<{ id: number; project_id: string; proposed: string; status: string }>("SELECT * FROM fixes WHERE id=?", fid);
  if (!row) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, row.project_id, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const proposed = "proposed" in body ? String(body.proposed).trim().slice(0, 4000) : row.proposed;
  const status = body.status ?? row.status;
  if (!STATUSES.has(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });
  if (status === "approved" && !proposed) return NextResponse.json({ error: "اول مقدار پیشنهادی را بنویسید" }, { status: 400 });

  run("UPDATE fixes SET proposed=?, status=?, updated=? WHERE id=?", proposed, status, Date.now() / 1000, fid);
  logActivity(row.project_id, gate.user.name, "PATCH", req.nextUrl.pathname);
  return NextResponse.json({ ok: true });
}
