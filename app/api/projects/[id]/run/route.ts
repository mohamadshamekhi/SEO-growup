// Ported from server.py's POST .../run. The "recheck" and "kwgap competitor-finding" special
// cases depend on unported modules (gsc.py, kwgap.py, keywords.py) and are left out rather
// than faked; "uptime" runs synchronously for real (ping()), everything else is queued and
// the queue is honest about what it can actually do yet (see lib/jobs/queues.ts).
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { ping } from "@/lib/tools";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";
import type { JobKey } from "@/lib/schedule";

const JOB_KINDS = new Set(["audit", "gsc", "catalog", "speed", "index", "watch", "articles", "kwgap"]);

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const kind = body.kind;
  const p = project(pid)!;

  if (kind === "uptime") {
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json(await ping(p));
  }
  if (!JOB_KINDS.has(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });

  const queued = enqueue({ project: pid, kind: kind as JobKey });
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ queued });
}
