// Ported from server.py's POST .../write. Python has two paths: spawn `claude` locally if
// the CLI is on the server's PATH, or queue a writer_requests row for a remote agent.py poll
// loop. Per the architecture plan, the remote-poll path is primary here (no local Claude
// Code spawn from the Next.js server) — this always queues, same as Python's "panel on a
// server, no local claude" branch.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { run } from "@/lib/db";
import { logActivity } from "@/lib/activity";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const b = await req.json().catch(() => ({}));
  const what = b.what === "fixes" || b.what === "ideas" ? b.what : "content";
  const limit = Math.max(1, Math.min(20, Number(b.limit) || 5));
  run("INSERT INTO writer_requests(project_id,what,limit_n,status,ts) VALUES (?,?,?,'queued',?)", pid, what, limit, Date.now() / 1000);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ started: true });
}
