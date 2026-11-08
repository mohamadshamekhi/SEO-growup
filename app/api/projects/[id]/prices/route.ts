// Ported from server.py's POST .../prices (sub=prices): add/remove a Torob link, or queue a
// real check run (dispatched through lib/jobs/queues.ts's "prices" kind).
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { addLink, removeLink } from "@/lib/prices";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  try {
    if (b.run) { const queued = enqueue({ project: pid, kind: "prices" }); return NextResponse.json({ queued }); }
    if (b.remove) { removeLink(pid, String(b.remove)); logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname); return NextResponse.json({ ok: true }); }
    addLink(pid, b.url, b.torob_url);
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
