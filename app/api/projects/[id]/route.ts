// Ported from server.py's GET/PATCH/DELETE /api/projects/[id].
//
// PATCH's keywords.user_edited() call (tracks a competitors-list edit so hub/kwgap.py can
// tell a deliberate removal from one it should re-propose) isn't ported — hub/keywords.py's
// Claude-review workflow isn't built yet — so a competitors edit here just saves, without
// that tracking side effect.
import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { q, run } from "@/lib/db";
import { project, cleanProject } from "@/lib/projects";
import { projectSummary } from "@/lib/overview";
import { logActivity } from "@/lib/activity";

export const dynamic = "force-dynamic";

const DELETE_TABLES = [
  "price_links", "price_checks", "impact", "backlinks", "keywords", "comp_pages", "issues", "uptime",
  "gsc_daily", "gsc_snap", "compares", "images", "catalog", "fixes", "content", "members", "applied",
  "vitals", "index_status", "watches", "reports", "tasks", "activity", "writer_requests", "site_articles", "ideas",
];

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "view");
  if ("response" in gate) return gate.response;
  // requireProjectAccess lets an admin through for ANY pid string (role() returns "admin"
  // without checking the project exists) — each handler must 404 on a missing project itself,
  // same as Python's access(): "if admin and not db.project(pid): return True # handler 404s".
  const p = project(pid);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  const runs = q<{ id: number; kind: string; started_at: number; finished_at: number | null; status: string; score: number | null; summary: string; error: string }>(
    "SELECT id, kind, started_at, finished_at, status, score, summary, error FROM runs WHERE project_id=? ORDER BY id DESC LIMIT 60", pid,
  ).map((r) => ({ ...r, summary: JSON.parse(r.summary || "{}") }));
  return NextResponse.json({ ...projectSummary(p), runs, my_role: gate.role });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "edit");
  if ("response" in gate) return gate.response;
  if (!project(pid)) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  let body = await req.json().catch(() => ({}));
  if (gate.role !== "admin") {
    // members can't change the site itself, only the keyword/competitor targeting lists
    body = Object.fromEntries(Object.entries(body).filter(([k]) => k === "keywords" || k === "competitors"));
  }
  let data: ReturnType<typeof cleanProject>;
  try {
    data = cleanProject(body, true);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  if (Object.keys(data).length) {
    const sets = Object.keys(data).map((k) => `${k}=?`).join(",");
    run(`UPDATE projects SET ${sets} WHERE id=?`, ...Object.values(data), pid);
  }
  logActivity(pid, gate.user.name, "PATCH", req.nextUrl.pathname);
  return NextResponse.json(projectSummary(project(pid)!));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: pid } = await params;
  const gate = requireProjectAccess(req, pid, "admin");
  if ("response" in gate) return gate.response;
  if (!project(pid)) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });
  for (const t of DELETE_TABLES) run(`DELETE FROM ${t} WHERE project_id=?`, pid);
  run("DELETE FROM pages WHERE run_id IN (SELECT id FROM runs WHERE project_id=?)", pid);
  run("DELETE FROM runs WHERE project_id=?", pid);
  run("DELETE FROM projects WHERE id=?", pid);
  return NextResponse.json({ ok: true });
}
