// Ported from server.py's POST .../run, now that every job kind's owning module has landed
// (lib/jobs/queues.ts wires audit/catalog/gsc/speed/kwgap/prices and, as of this pass,
// index/watch/articles/report/recheck too — see that file for the full dispatch).
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { project } from "@/lib/projects";
import { ping } from "@/lib/tools";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";
import { keyInfo } from "@/lib/google-auth";
import type { JobKey } from "@/lib/schedule";

const JOB_KINDS = new Set(["audit", "gsc", "catalog", "speed", "index", "watch", "articles", "kwgap", "prices", "report", "content"]);

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
  if (kind === "recheck") {
    // Reads only the pages with an open issue (lighter than a full audit), and if GSC is
    // connected also asks Google again about just the unindexed ones.
    let started = enqueue({ project: pid, kind: "recheck" });
    const google = !!(p.gsc_property && keyInfo());
    if (google) started = enqueue({ project: pid, kind: "index", only_open: true }) || started;
    logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
    return NextResponse.json({ queued: started, google });
  }
  if (!JOB_KINDS.has(kind)) return NextResponse.json({ error: "bad kind" }, { status: 400 });
  if (kind === "gsc" && !keyInfo()) return NextResponse.json({ error: "اول کلید Search Console را در تنظیمات اضافه کنید" }, { status: 400 });

  const queued = enqueue(kind === "index" && body.only_open ? { project: pid, kind: "index", only_open: true } : { project: pid, kind: kind as JobKey });
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ queued });
}
