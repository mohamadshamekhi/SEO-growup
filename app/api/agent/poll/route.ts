import { NextRequest, NextResponse } from "next/server";
import { requireAgentToken } from "@/lib/agent-auth";
import { one, run } from "@/lib/db";
import { project } from "@/lib/projects";
import { tryAcquire } from "@/lib/jobs/writer";

export const dynamic = "force-dynamic";

type WriterRequest = { id: number; project_id: string; what: string; limit_n: number; status: string };

export async function GET(req: NextRequest) {
  const gate = requireAgentToken(req);
  if ("response" in gate) return gate.response;

  const r = one<WriterRequest>("SELECT * FROM writer_requests WHERE status='queued' ORDER BY id LIMIT 1");
  if (!r) return NextResponse.json({});

  const p = project(r.project_id);
  if (!p) { run("UPDATE writer_requests SET status='done' WHERE id=?", r.id); return NextResponse.json({}); }
  run("UPDATE writer_requests SET status='running' WHERE id=?", r.id);
  tryAcquire(p.id, r.what);
  return NextResponse.json({ id: r.id, project: p.id, name: p.name, what: r.what, limit: r.limit_n });
}
