// GET ports server.py's project list (via auth.visibleProjects). POST creates a project
// (admin-only), same validation as Python's clean_project()/slugify().
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/access";
import { role, visibleProjects } from "@/lib/auth";
import { run } from "@/lib/db";
import { project, projects, slugify, cleanProject } from "@/lib/projects";
import { projectSummary } from "@/lib/overview";
import { enqueue } from "@/lib/jobs/queues";
import { detect } from "@/lib/onboard";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  const { user } = gate;
  const list = visibleProjects(user).map((p) => ({ ...p, my_role: role(user, p.id) }));
  return NextResponse.json(list);
}

export async function POST(req: NextRequest) {
  const gate = requireUser(req);
  if ("response" in gate) return gate.response;
  if (!gate.user.is_admin) return NextResponse.json({ error: "شما اجازه این کار را ندارید" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  let data: ReturnType<typeof cleanProject>;
  try {
    data = cleanProject(b);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  let pid = slugify(String(b.id || data.domain || ""));
  const existing = new Set(projects().map((p) => p.id));
  while (existing.has(pid)) pid += "-2";
  if (!("settings" in data)) data.settings = JSON.stringify({ auto_audit: true, audit_hours: 24, uptime: true, uptime_minutes: 10, auto_gsc: true });
  const cols = ["id", "created_at", ...Object.keys(data)];
  const values = [pid, Date.now() / 1000, ...Object.values(data)];
  run(`INSERT INTO projects(${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...values);
  enqueue({ project: pid, kind: "audit" });
  enqueue({ project: pid, kind: "catalog" });
  const p = project(pid)!;
  detect(p).catch(() => {}); // a site that's down shows as an open onboarding step, not a crash here
  return NextResponse.json(projectSummary(p));
}
