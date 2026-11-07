import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one, run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

const STATUSES = new Set(["approved", "rejected", "pending", "done"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).slice(0, 2000);
  const status = body.status;
  if (!STATUSES.has(status)) return NextResponse.json({ error: "bad status" }, { status: 400 });

  let skipped = 0;
  for (const i of ids) {
    const r = one<{ proposed: string }>("SELECT proposed FROM fixes WHERE id=? AND project_id=?", i, pid);
    if (!r || (status === "approved" && !r.proposed)) { skipped++; continue; }
    run("UPDATE fixes SET status=?, updated=? WHERE id=?", status, Date.now() / 1000, i);
  }
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ updated: ids.length - skipped, skipped });
}
