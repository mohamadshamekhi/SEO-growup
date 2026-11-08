// Ported from server.py's POST .../apply. This only QUEUES the write — explicit "confirm"
// required, same as the Python original — the actual site-write happens in the "apply"
// worker job (lib/jobs/queues.ts), one at a time, 1s apart, each recorded in `applied` for
// undo.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { config } from "@/lib/adapters";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  if (!config(pid)) return NextResponse.json({ error: "این پروژه به API سایت وصل نیست" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const ids = (Array.isArray(body.ids) ? body.ids : []).map(Number).slice(0, 2000);
  if (!body.confirm) return NextResponse.json({ error: "تأیید لازم است" }, { status: 400 });
  if (!ids.length) return NextResponse.json({ error: "موردی انتخاب نشده" }, { status: 400 });

  const queued = enqueue({ project: pid, kind: "apply", ids, user: gate.user.name });
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ queued });
}
