// Ported from server.py's POST .../autofix. Direct fixes are queued through the normal
// "apply" job; internal-link fixes need a writing agent — Python can spawn `claude` locally
// or (per the architecture plan, primary here) queue a writer_requests row for a remote
// agent.py poll loop. writerAvailable() drops the local-CLI check (no local Claude Code
// spawn from this server) and only checks for a recently-polling remote agent token.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { config } from "@/lib/adapters";
import { run } from "@/lib/db";
import { project } from "@/lib/projects";
import { request as autofixRequest } from "@/lib/autofix";
import { enqueue } from "@/lib/jobs/queues";
import { logActivity } from "@/lib/activity";
import { writerAvailable } from "@/lib/jobs/writer";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  if (!config(pid)) return NextResponse.json({ error: "این پروژه به API سایت وصل نیست" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  const ids = ((b.ids as unknown[]) || []).map(Number).slice(0, 2000);
  const p = project(pid)!;
  const [direct, links, skipped] = autofixRequest(p, ids);
  if (direct.length) enqueue({ project: pid, kind: "apply", ids: direct, user: gate.user.name });
  if (links && !writerAvailable()) return NextResponse.json({ error: "برای لینک داخلی Claude Code لازم است و الان در دسترس نیست" }, { status: 400 });
  if (links) run("INSERT INTO writer_requests(project_id,what,limit_n,status,ts) VALUES (?,?,?,'queued',?)", pid, "links", Math.min(links, 5), Date.now() / 1000);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json({ applying: direct.length, linking: links, skipped });
}
