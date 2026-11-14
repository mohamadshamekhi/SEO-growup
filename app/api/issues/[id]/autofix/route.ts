import { NextRequest, NextResponse } from "next/server";
import { requireProjectAccess } from "@/lib/access";
import { one } from "@/lib/db";
import { project } from "@/lib/projects";
import { logActivity } from "@/lib/activity";
import { autoFixIssue } from "@/lib/issue-autofix";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const iid = Number(id);
  const row = one<{ project_id: string }>("SELECT project_id FROM issues WHERE id=?", iid);
  if (!row) return NextResponse.json({ error: "پیدا نشد" }, { status: 404 });

  const gate = requireProjectAccess(req, row.project_id, "edit");
  if ("response" in gate) return gate.response;
  const p = project(row.project_id);
  if (!p) return NextResponse.json({ error: "پروژه پیدا نشد" }, { status: 404 });

  const result = await autoFixIssue(p, gate.user.name, iid);
  logActivity(row.project_id, gate.user.name, "POST", req.nextUrl.pathname);
  return NextResponse.json(result);
}
