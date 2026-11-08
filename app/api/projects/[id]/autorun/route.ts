// Ported from server.py's GET/POST .../autorun + its autorun_step() helper. "One click on the
// tasks page: write what's missing, put it on the site, close the task."
//
// autorun_step()'s start_writer() (local `claude` CLI spawn) has no equivalent here — per the
// architecture plan, the remote agent.py-style poll loop is primary — so instead this queues
// a writer_requests row for "kw_optimize", same pattern as /write and /autofix.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { config } from "@/lib/adapters";
import { run } from "@/lib/db";
import { project } from "@/lib/projects";
import { autorunTasks, autorunQueue, autorunStart, autorunSettle, autorunUnwritten, autorunMayWrite, autorunTriesOut, autorunWrote, autorunUser } from "@/lib/keywords";
import { enqueue } from "@/lib/jobs/queues";
import { writerAvailable } from "@/lib/jobs/writer";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

function autorunStep(pid: string) {
  if (!autorunQueue(pid).length) return;
  const ids = autorunSettle(pid);
  if (ids.length) enqueue({ project: pid, kind: "apply", ids, user: autorunUser(pid) || "اعمال خودکار" });
  const waiting = autorunUnwritten(pid);
  const now = Date.now() / 1000;
  if (waiting.length && autorunMayWrite(pid, now)) {
    run("INSERT INTO writer_requests(project_id,what,limit_n,status,ts) VALUES (?,?,?,'queued',?)", pid, "kw_optimize", Math.min(waiting.length, 20), now);
    autorunWrote(pid, now);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  const tasks = autorunTasks(pid);
  const queue = new Set(autorunQueue(pid));
  return NextResponse.json({
    connected: !!config(pid),
    tasks: tasks.map((r) => r.id),
    running: tasks.filter((r) => queue.has(r.url)).map((r) => r.id),
    pages: queue.size,
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  if (!config(pid)) return NextResponse.json({ error: "این پروژه به API سایت وصل نیست" }, { status: 400 });
  const b = await req.json().catch(() => ({}));
  if (!b.confirm) return NextResponse.json({ error: "تأیید لازم است" }, { status: 400 });
  const p = project(pid)!;
  const ids = Array.isArray(b.ids) ? new Set<number>(b.ids.map(Number)) : undefined;
  const res = autorunStart(p, gate.user.name, ids);
  if (!res.tasks) return NextResponse.json({ error: "کاری برای اعمال خودکار نیست" }, { status: 400 });
  if (autorunUnwritten(pid).length && !writerAvailable()) autorunTriesOut(pid);
  autorunStep(pid);
  logActivity(pid, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json(res);
}
